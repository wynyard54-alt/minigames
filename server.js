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
const MAX_PLAYERS = 40;
const PLAYER_GRACE_MS = 60 * 1000; // 대기실에서 연결 끊긴 학생을 지우기까지
const HOST_GRACE_MS = 10 * 60 * 1000; // 선생님 화면이 닫힌 방을 지우기까지

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

app.use(express.static(path.join(__dirname, 'public')));

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
app.get('/api/lan', (req, res) => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  res.json({ ips, port: PORT });
});

app.get('/healthz', (req, res) => res.send('ok'));

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
const BOTS_PER_TEAM = 4; // '빈자리 채우기'를 누르면 팀마다 최소 이만큼 채운다

function addBot(room, team) {
  if (room.players.size >= MAX_PLAYERS) return false;
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
  const bot = bots.find((p) => p.team === team) || (room.players.size >= MAX_PLAYERS ? bots[0] : null);
  if (bot) removeBot(room, bot);
}

function lobbyView(room) {
  return {
    code: room.code,
    state: room.state,
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
  // ---------- 선생님(호스트) 화면 ----------
  socket.on('host:create', (_, cb) => {
    const code = newCode();
    const room = {
      code,
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
    if (typeof cb === 'function') cb({ ok: true, code: room.code, world: room.match ? WORLD : null });
    broadcastLobby(room);
  });

  const hostRoom = () => {
    const room = rooms.get(socket.data.hostOf);
    return room && room.hostSocket === socket.id ? room : null;
  };

  socket.on('host:start', () => {
    const room = hostRoom();
    if (!room || room.state === 'game' || room.players.size === 0) return;
    createMatch(room);
  });

  socket.on('host:stop', () => {
    const room = hostRoom();
    if (!room || !room.match) return;
    room.match.timer = 0; // 다음 틱에 결과 화면으로
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
      const target = Math.max(BOTS_PER_TEAM, teamCount(room, 'red'), teamCount(room, 'blue'));
      for (const team of TEAMS) {
        while (teamCount(room, team) < target && addBot(room, team));
      }
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
      const hasBot = [...room.players.values()].some((p) => p.bot);
      if (room.players.size >= MAX_PLAYERS && !hasBot) return reply({ ok: false, error: '방이 가득 찼어요.' });
      const team = smallerTeam(room);
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
    reply({ ok: true, id: player.id, key: player.key, name: player.name, inGame: !!room.match, world: WORLD });
    broadcastLobby(room);
  });

  socket.on('player:team', (team) => {
    const { room, player } = findPlayerBySocket(socket);
    if (!player || room.state === 'game' || !TEAMS.includes(team)) return;
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
    if (room.hostSocket) io.to(room.hostSocket).volatile.emit('state', room.match.snapshot());
    if (room.tickCount % 2 === 0) {
      // 학생 폰: 초당 15번, 각자 자기 주변 화면
      for (const p of room.players.values()) {
        if (p.socketId) io.to(p.socketId).volatile.emit('view', room.match.view(p.id));
      }
    }
  }
}, TICK_MS);

// 오래된 방과 나간 학생 정리
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.hostSocket && now - room.hostGoneAt > HOST_GRACE_MS) {
      io.to(room.chan).emit('kicked', { reason: 'room-closed' });
      rooms.delete(code);
      continue;
    }
    if (room.state === 'game') continue;
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

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`게임 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = { server, rooms };
