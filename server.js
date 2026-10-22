const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Match, TEAMS, WORLD } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 1000 / 30;
const TEAM_MAX = 8; // 팀당 최대 인원 (8이면 최대 8대8, 16명). 이 숫자만 바꾸면 된다
const MAX_PLAYERS = TEAM_MAX * 2;
const PLAYER_GRACE_MS = 60 * 1000; // 대기실에서 연결 끊긴 학생을 지우기까지
const HOST_GRACE_MS = 10 * 60 * 1000; // 선생님 화면이 닫힌 방을 지우기까지

const app = express();
const server = http.createServer(app);
// perMessageDeflate: 1KB 넘는 메시지는 압축해서 보낸다 (느린 연결에서 데이터 양을 크게 줄임)
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000, perMessageDeflate: { threshold: 1024 } });

app.use(express.static(path.join(__dirname, 'public')));

// 턴제 탐사는 별도 채널로 기존 실시간 게임과 분리한다.
require('./ghost').attach(io);

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text || text.length > 300) return res.status(400).end();
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').send(svg);
  } catch {
    res.status(500).end();
  }
});

// 선생님이 노트북에서 localhost로 열었을 때, QR에 넣을 같은 와이파이 주소를 알려준다
// 네트워크 장치 목록. 안드로이드(Termux)에서는 os.networkInterfaces()가 막힐 수 있어 ifconfig로 대신 읽는다
function interfaces() {
  try {
    return os.networkInterfaces();
  } catch {
    const out = {};
    try {
      const text = require('child_process').execSync('ifconfig 2>/dev/null', { encoding: 'utf8' });
      let name = null;
      for (const line of text.split('\n')) {
        const head = line.match(/^(\S+?):?\s/);
        if (head) name = head[1];
        const m = line.match(/inet (?:addr:)?(\d+\.\d+\.\d+\.\d+)/);
        if (name && m) (out[name] = out[name] || []).push({ family: 'IPv4', address: m[1], internal: m[1].startsWith('127.') });
      }
    } catch {}
    return out;
  }
}

// 와이파이·핫스팟 주소를 먼저, VPN·가상 장치·모바일 데이터 주소는 뒤로
function lanAddresses() {
  const virtual = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn|tap|tun|utun|bridge|rmnet|ccmni|dummy|p2p/i;
  const wifi = /wi-?fi|wlan|wireless|무선|en0|wl|ap\d|swlan/i;
  const list = [];
  for (const [name, nis] of Object.entries(interfaces())) {
    for (const ni of nis || []) {
      if (ni.family !== 'IPv4' || ni.internal || ni.address.startsWith('169.254.')) continue;
      let score = 0;
      if (wifi.test(name)) score += 4;
      if (virtual.test(name)) score -= 10;
      if (ni.address.startsWith('192.168.')) score += 2;
      else if (ni.address.startsWith('10.')) score += 1;
      list.push({ name, address: ni.address, score });
    }
  }
  return list.sort((a, b) => b.score - a.score);
}

app.get('/api/lan', (req, res) => {
  const list = lanAddresses();
  res.json({ ips: list.map((x) => x.address), list: list.map(({ name, address }) => ({ name, address })), port: PORT });
});

app.get('/healthz', (req, res) => res.send('ok'));

// 게임 규칙 파일을 폰에도 보내서, 내 캐릭터를 서버 응답 전에 미리 움직일 때 쓴다
app.get('/game.js', (req, res) => res.sendFile(path.join(__dirname, 'game.js')));

/** @type {Map<string, any>} */
const rooms = new Map();

function newCode() {
  for (let i = 0; i < 1000; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('no free room code');
}

function token() {
  return crypto.randomBytes(12).toString('hex');
}

function cleanName(name) {
  const s = String(name || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 10);
  return s || '플레이어';
}

// 인원이 적은 팀. 같으면 학생(사람)이 적은 팀
function smallerTeam(room) {
  const count = { red: 0, blue: 0 };
  const humans = { red: 0, blue: 0 };
  for (const p of room.players.values()) {
    count[p.team] += 1;
    if (!p.bot) humans[p.team] += 1;
  }
  if (count.red !== count.blue) return count.red < count.blue ? 'red' : 'blue';
  return humans.red <= humans.blue ? 'red' : 'blue';
}

// ---------- AI 봇 ----------
const BOT_NAMES = ['곰돌', '토끼', '여우', '상어', '늑대', '독수리', '호랑', '판다', '펭귄', '고양', '다람쥐', '부엉', '거북', '사자', '하마', '코알라'];
function addBot(room, team) {
  if (teamCount(room, team) >= TEAM_MAX) return false;
  const used = new Set([...room.players.values()].map((p) => p.name));
  const base = BOT_NAMES.find((n) => !used.has('AI' + n)) || String(room.players.size);
  const bot = { id: 'bot-' + token().slice(0, 6), key: null, name: 'AI' + base, team, ready: true, bot: true, connected: true, socketId: null };
  room.players.set(bot.id, bot);
  if (room.match) room.match.addPlayer(bot);
  return true;
}

function removeBot(room, bot) {
  room.players.delete(bot.id);
  if (room.match) room.match.removePlayer(bot.id);
}

function teamCount(room, team) {
  let n = 0;
  for (const p of room.players.values()) if (p.team === team) n += 1;
  return n;
}

// 학생이 들어오면 그 팀의 AI가 한 명 자리를 비켜 준다
function makeRoomForHuman(room, team) {
  const bots = [...room.players.values()].filter((p) => p.bot);
  const bot = bots.find((p) => p.team === team);
  if (bot) removeBot(room, bot);
}

// 팀당 인원을 size명으로 맞춘다: 모자라면 AI를 넣고, 넘치면 AI만 뺀다 (학생은 그대로)
function fitBots(room, size) {
  for (const team of TEAMS) {
    while (teamCount(room, team) < size && addBot(room, team));
    const extra = [...room.players.values()].filter((p) => p.bot && p.team === team);
    while (teamCount(room, team) > size && extra.length) removeBot(room, extra.pop());
  }
}

// ---------- 배틀 아레나: 각자 폰에서 하는 100초 점수 대결 ----------
// 게임은 학생 폰에서 돌아가고 서버는 점수만 모은다. 그래서 통신이 느려도 끊기지 않는다.
const ARENA_TIME = 100 * 1000;
const ARENA_COUNTDOWN = 3000;
const ARENA_WATCH = 6; // 선생님 화면에 플레이 모습을 보여 줄 최대 인원 (점수 상위)

function arenaEntry(room, p) {
  let e = room.arena.scores.get(p.id);
  if (!e) {
    e = { id: p.id, name: p.name, score: 0, kills: 0, hp: 5, level: 1, done: false, survived: false };
    room.arena.scores.set(p.id, e);
  }
  return e;
}

// 시작까지/끝까지 남은 시간 (늦게 들어온 학생도 같은 시각에 끝나도록)
function arenaTiming(room) {
  const now = Date.now();
  const a = room.arena;
  return {
    startIn: a.startAt - now,
    duration: Math.min(ARENA_TIME, a.startAt + ARENA_TIME - Math.max(now, a.startAt)),
    elapsed: Math.max(0, now - a.startAt),
  };
}

function arenaRanking(room) {
  return [...room.arena.scores.values()]
    .filter((e) => room.players.has(e.id))
    .sort((a, b) => b.score - a.score || b.kills - a.kills || Number(b.survived) - Number(a.survived))
    .map(({ id, name, score, kills, hp, level, done, survived }) => ({ id, name, score, kills, hp, level, done, survived }));
}

function startArena(room) {
  const now = Date.now();
  room.arena = { startAt: now + ARENA_COUNTDOWN, scores: new Map() };
  room.state = 'arena';
  for (const p of room.players.values()) if (!p.bot) arenaEntry(room, p);
  io.to(room.chan).emit('arena:start', arenaTiming(room));
  broadcastLobby(room);
}

function endArena(room) {
  if (!room.arena) return;
  const result = { mode: 'arena', players: arenaRanking(room) };
  room.arena = null;
  room.lastResult = result;
  room.state = 'result';
  for (const p of room.players.values()) p.ready = !!p.bot;
  for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
  io.to(room.chan).emit('arena:over', result);
  broadcastLobby(room);
}

function lobbyView(room) {
  return {
    code: room.code,
    state: room.state,
    mode: room.mode,
    teamMax: TEAM_MAX,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      ready: p.ready,
      connected: p.connected,
      bot: !!p.bot,
    })),
    result: room.state === 'result' ? room.lastResult : null,
  };
}

function broadcastLobby(room) {
  io.to(room.chan).emit('lobby', lobbyView(room));
}

function createMatch(room) {
  const list = [...room.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot }));
  room.match = new Match(list, (ev) => onMatchEvent(room, ev));
  for (const p of room.players.values()) room.match.setConnected(p.id, p.connected);
  room.state = 'game';
  room.lastTick = Date.now();
  room.tickCount = 0;
  io.to(room.chan).emit('game:start', { world: WORLD });
  broadcastLobby(room);
}

function sendToPlayer(room, id, event, data) {
  const p = room.players.get(id);
  if (p && p.socketId) io.to(p.socketId).emit(event, data);
}

function onMatchEvent(room, ev) {
  if (ev.type === 'damaged') {
    sendToPlayer(room, ev.id, 'ev', { type: 'damaged' });
    sendToPlayer(room, ev.by, 'ev', { type: 'hitEnemy' }); // 쏜 사람 폰에 '맞혔다' 소리
  } else if (ev.type === 'kill') {
    sendToPlayer(room, ev.killer, 'ev', { type: 'kill' });
    sendToPlayer(room, ev.victim, 'ev', { type: 'dead' });
    io.to(room.chan).emit('fx', ev); // 선생님 화면과 학생 폰 모두 효과 표시
  } else if (ev.type === 'hit' || ev.type === 'super') {
    io.to(room.chan).emit('fx', ev);
  } else if (ev.type === 'superReady') {
    sendToPlayer(room, ev.id, 'ev', { type: 'superReady' });
  } else if (ev.type === 'over') {
    room.lastResult = ev.result;
    room.state = 'result';
    room.match = null;
    for (const p of room.players.values()) p.ready = !!p.bot; // AI는 언제나 준비 완료
    // 경기 중에 나간 학생은 결과가 나온 뒤 정리
    for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
    io.to(room.chan).emit('game:over', ev.result);
    broadcastLobby(room);
  }
}

function findPlayerBySocket(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return {};
  const player = room.players.get(socket.data.playerId);
  return { room, player };
}

io.on('connection', (socket) => {
  // 통신 지연 측정용: 폰이 보낸 시각을 그대로 돌려준다
  socket.on('ping2', (t, cb) => typeof cb === 'function' && cb(Date.now()));

  // ---------- 선생님(호스트) 화면 ----------
  socket.on('host:create', (data, cb) => {
    const code = newCode();
    const room = {
      code,
      mode: data && data.mode === 'arena' ? 'arena' : 'battle', // battle: 팀 슈팅, arena: 배틀 아레나
      chan: 'room:' + code,
      hostKey: token(),
      hostSocket: socket.id,
      hostGoneAt: 0,
      players: new Map(),
      state: 'lobby',
      match: null,
      lastResult: null,
    };
    rooms.set(code, room);
    socket.data.hostOf = code;
    socket.join(room.chan);
    if (typeof cb === 'function') cb({ code, hostKey: room.hostKey });
    broadcastLobby(room);
  });

  socket.on('host:resume', (data, cb) => {
    const room = rooms.get(String(data && data.code));
    if (!room || room.hostKey !== (data && data.hostKey)) {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    room.hostSocket = socket.id;
    room.hostGoneAt = 0;
    socket.data.hostOf = room.code;
    socket.join(room.chan);
    if (typeof cb === 'function') cb({ ok: true, code: room.code, mode: room.mode, world: room.match ? WORLD : null });
    if (room.arena) socket.emit('arena:start', arenaTiming(room)); // 아레나 중에 선생님 화면을 새로고침한 경우
    broadcastLobby(room);
  });

  const hostRoom = () => {
    const room = rooms.get(socket.data.hostOf);
    return room && room.hostSocket === socket.id ? room : null;
  };

  // QR 대기실에서 게임 선택으로 돌아가면 방과 채널도 정리한다.
  socket.on('host:close', (data, cb) => {
    if (typeof data === 'function') cb = data;
    const room = hostRoom();
    if (!room || room.state !== 'lobby') {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    socket.to(room.chan).emit('kicked', { reason: 'room-closed' });
    io.in(room.chan).socketsLeave(room.chan);
    rooms.delete(room.code);
    socket.data.hostOf = null;
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('host:start', () => {
    const room = hostRoom();
    if (!room || room.state === 'game' || room.state === 'arena' || room.players.size === 0) return;
    if (room.mode === 'arena') startArena(room);
    else createMatch(room);
  });

  socket.on('host:stop', () => {
    const room = hostRoom();
    if (!room) return;
    if (room.arena) return endArena(room);
    if (room.match) room.match.timer = 0; // 다음 틱에 결과 화면으로
  });

  socket.on('host:lobby', () => {
    const room = hostRoom();
    if (!room || room.state !== 'result') return;
    room.state = 'lobby';
    broadcastLobby(room);
  });

  socket.on('host:shuffle', () => {
    const room = hostRoom();
    if (!room || room.state === 'game') return;
    const list = [...room.players.values()].sort(() => Math.random() - 0.5);
    list.forEach((p, i) => {
      p.team = TEAMS[i % 2];
      p.ready = !!p.bot;
    });
    broadcastLobby(room);
  });

  socket.on('host:bots', (req) => {
    const room = hostRoom();
    if (!room || !req) return;
    if (req.action === 'fill') {
      fitBots(room, Math.max(1, Math.min(TEAM_MAX, Math.floor(Number(req.size)) || 4)));
    } else if (req.action === 'add' && TEAMS.includes(req.team)) {
      addBot(room, req.team);
    } else if (req.action === 'clear') {
      for (const p of [...room.players.values()]) if (p.bot) removeBot(room, p);
    }
    broadcastLobby(room);
  });

  socket.on('host:kick', (id) => {
    const room = hostRoom();
    if (!room) return;
    const p = room.players.get(id);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('kicked');
    room.players.delete(id);
    if (room.match) room.match.removePlayer(id);
    broadcastLobby(room);
  });

  // ---------- 학생(플레이어) 폰 ----------
  socket.on('player:join', (data, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    const room = rooms.get(String(data && data.code));
    if (!room) return reply({ ok: false, error: '방을 찾을 수 없어요. 방 번호를 확인해 주세요.' });

    let player = null;
    if (data.id && data.key) {
      const p = room.players.get(data.id);
      if (p && p.key === data.key) player = p; // 새로고침/재접속
    }
    if (!player) {
      const team = smallerTeam(room);
      const teamHasBot = [...room.players.values()].some((p) => p.bot && p.team === team);
      if (teamCount(room, team) >= TEAM_MAX && !teamHasBot) {
        return reply({ ok: false, error: `방이 가득 찼어요. (팀당 최대 ${TEAM_MAX}명)` });
      }
      makeRoomForHuman(room, team);
      player = {
        id: token().slice(0, 8),
        key: token(),
        name: cleanName(data.name),
        team,
        ready: false,
      };
      room.players.set(player.id, player);
      if (room.match) room.match.addPlayer(player); // 경기 중 난입
    }
    if (player.socketId && player.socketId !== socket.id) {
      const old = io.sockets.sockets.get(player.socketId);
      if (old) {
        old.data.playerId = null;
        old.emit('kicked', { reason: 'other-device' });
      }
    }
    player.socketId = socket.id;
    player.connected = true;
    player.goneAt = 0;
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.chan);
    if (room.match) room.match.setConnected(player.id, true);
    reply({ ok: true, id: player.id, key: player.key, name: player.name, inGame: !!room.match, mode: room.mode, world: WORLD });
    // 아레나 진행 중에 들어오면 남은 시간만큼 바로 시작 (이미 끝낸 학생은 다시 시작하지 않음)
    if (room.arena && !arenaEntry(room, player).done) socket.emit('arena:start', arenaTiming(room));
    broadcastLobby(room);
  });

  socket.on('arena:report', (r) => {
    const { room, player } = findPlayerBySocket(socket);
    if (!player || !room.arena || !r) return;
    const e = arenaEntry(room, player);
    // 새로고침으로 다시 시작해도 가장 좋았던 점수는 지킨다
    e.score = Math.max(e.score, Math.floor(Number(r.score) || 0));
    e.kills = Math.max(e.kills, Math.floor(Number(r.kills) || 0));
    e.hp = Math.max(0, Math.min(5, Math.floor(Number(r.hp) || 0)));
    e.level = Math.max(1, Math.min(5, Math.floor(Number(r.level) || 1)));
    if (r.done) {
      e.done = true;
      e.survived = e.hp > 0;
    }
  });

  // 상위 6명의 폰이 보내는 작은 장면(위치 숫자)을 선생님 화면에만 그대로 넘긴다. 늦으면 버려도 된다.
  socket.on('arena:snap', (s) => {
    const { room, player } = findPlayerBySocket(socket);
    if (!player || !room.arena || !room.hostSocket || !s || typeof s !== 'object') return;
    if (!room.arena.watch || !room.arena.watch.includes(player.id)) return;
    if (!Array.isArray(s.e) || !Array.isArray(s.it) || !Array.isArray(s.b)) return;
    io.to(room.hostSocket).volatile.emit('arena:snap', { id: player.id, s });
  });

  socket.on('player:team', (team) => {
    const { room, player } = findPlayerBySocket(socket);
    if (!player || room.state === 'game' || !TEAMS.includes(team) || player.team === team) return;
    if (teamCount(room, team) >= TEAM_MAX) {
      // 꽉 찬 팀이라도 AI가 있으면 그 AI와 자리를 바꾼다
      const bot = [...room.players.values()].find((p) => p.bot && p.team === team);
      if (!bot) return;
      bot.team = player.team;
    }
    player.team = team;
    broadcastLobby(room);
  });

  socket.on('player:ready', (ready) => {
    const { room, player } = findPlayerBySocket(socket);
    if (!player || room.state === 'game') return;
    player.ready = !!ready;
    broadcastLobby(room);
  });

  socket.on('player:leave', () => {
    const { room, player } = findPlayerBySocket(socket);
    if (!player) return;
    room.players.delete(player.id);
    if (room.match) room.match.removePlayer(player.id);
    socket.data.playerId = null;
    broadcastLobby(room);
  });

  socket.on('input', (input) => {
    const { room, player } = findPlayerBySocket(socket);
    if (player && room.match) room.match.setInput(player.id, input);
  });

  socket.on('fire', () => {
    const { room, player } = findPlayerBySocket(socket);
    // 폰이 보낸 방향은 무시하고 항상 바라보는 방향으로 쏜다 (모두 같은 규칙)
    if (player && room.match) room.match.fire(player.id, { facing: true });
  });

  socket.on('super', () => {
    const { room, player } = findPlayerBySocket(socket);
    if (player && room.match) room.match.useSuper(player.id);
  });

  socket.on('disconnect', () => {
    const now = Date.now();
    const hosted = rooms.get(socket.data.hostOf);
    if (hosted && hosted.hostSocket === socket.id) {
      hosted.hostSocket = null;
      hosted.hostGoneAt = now;
    }
    const { room, player } = findPlayerBySocket(socket);
    if (player && player.socketId === socket.id) {
      player.connected = false;
      player.socketId = null;
      player.goneAt = now;
      if (room.match) room.match.setConnected(player.id, false);
      broadcastLobby(room);
    }
  });
});

// 게임 루프: 경기 중인 방만 계산
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.match) continue;
    const dt = Math.min(0.1, (now - room.lastTick) / 1000);
    room.lastTick = now;
    room.match.step(dt);
    if (!room.match) continue; // 이번 틱에 경기가 끝남
    room.tickCount += 1;
    if (room.hostSocket) io.to(room.hostSocket).volatile.emit('state', { ...room.match.snapshot(), st: now });
    if (room.tickCount % 2 === 0) {
      // 학생 폰: 초당 15번, 각자 자기 주변 화면
      for (const p of room.players.values()) {
        if (p.socketId) io.to(p.socketId).volatile.emit('view', { ...room.match.view(p.id), st: now });
      }
    }
  }
}, TICK_MS);

// 배틀 아레나: 0.5초마다 순위표를 보내고, 시간이 다 되거나 모두 끝나면 결과
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.arena) continue;
    const players = arenaRanking(room);
    const t = arenaTiming(room);
    room.arena.watch = players.slice(0, ARENA_WATCH).map((p) => p.id); // 선생님 화면에 플레이 모습을 띄울 상위 6명
    io.to(room.chan).emit('arena:board', { players, watch: room.arena.watch, startIn: t.startIn, timeLeft: Math.max(0, room.arena.startAt + ARENA_TIME - now) });
    const live = [...room.arena.scores.values()].filter((e) => {
      const p = room.players.get(e.id);
      return p && p.connected && !e.done;
    });
    if (now > room.arena.startAt + ARENA_TIME + 2000 || (now > room.arena.startAt && players.length && !live.length)) endArena(room);
  }
}, 500);

// 오래된 방과 나간 학생 정리
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.hostSocket && now - room.hostGoneAt > HOST_GRACE_MS) {
      io.to(room.chan).emit('kicked', { reason: 'room-closed' });
      rooms.delete(code);
      continue;
    }
    if (room.state === 'game' || room.state === 'arena') continue;
    let changed = false;
    for (const [id, p] of room.players) {
      if (!p.connected && now - p.goneAt > PLAYER_GRACE_MS) {
        room.players.delete(id);
        changed = true;
      }
    }
    if (changed) broadcastLobby(room);
  }
}, 15 * 1000);

// 실행 파일로 켰을 때 선생님 화면을 기본 브라우저로 연다
function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : process.platform === 'android'
          ? `termux-open-url "${url}"` // 갤럭시(Termux)
          : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

if (require.main === module) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`\n${PORT}번 포트를 이미 쓰고 있어요. 게임 서버가 이미 켜져 있는지 확인해 주세요.`);
      console.log(`이미 켜져 있다면 브라우저에서 http://localhost:${PORT} 를 열면 돼요.\n`);
      if (process.env.OPEN_BROWSER) openBrowser(`http://localhost:${PORT}`);
      setTimeout(() => process.exit(1), 15000);
    } else throw err;
  });
  server.listen(PORT, () => {
    console.log(`게임 서버 실행 중: http://localhost:${PORT}`);
    const lan = lanAddresses();
    if (lan.length) console.log(`학생 폰 접속 주소: http://${lan[0].address}:${PORT}/play.html`);
    console.log('이 창을 닫으면 게임 서버가 꺼져요. 수업이 끝날 때까지 열어 두세요.');
    if (process.env.OPEN_BROWSER) openBrowser(`http://localhost:${PORT}`);
  });
}

module.exports = { server, rooms };
