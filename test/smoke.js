// 선생님 1명 + 학생 4명을 흉내 내서 방 만들기 → 입장 → 경기 → 결과까지 확인
const assert = require('assert');
const { io } = require('socket.io-client');
const { server } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
const ack = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));

function engineTests() {
  const { Match, WORLD } = require('../game');
  const events = [];
  const m = new Match(
    [
      { id: 'a', name: 'A', team: 'red' },
      { id: 'b', name: 'B', team: 'blue' },
      { id: 'c', name: 'C', team: 'blue' },
    ],
    (e) => events.push(e)
  );
  m.step(3.1); // 카운트다운 끝
  assert.equal(m.phase, 'playing');
  const [a, b, c] = ['a', 'b', 'c'].map((id) => m.fighters.get(id));
  for (const f of [a, b, c]) f.shield = 0;

  // 필살기: 5발 맞히기 전에는 안 나가고, 충전되면 반경 안의 적만 맞는다
  Object.assign(a, { x: 800, y: 250 });
  Object.assign(b, { x: 900, y: 250 });
  Object.assign(c, { x: 800, y: 700 });
  m.useSuper('a');
  assert.equal(b.hp, 100, 'super must need charge');
  for (let i = 0; i < 5; i++) m.damage(c, 'a', 1, false);
  assert.equal(a.charge, WORLD.SUPER_HITS);
  assert.ok(events.some((e) => e.type === 'superReady'));
  m.useSuper('a');
  assert.equal(a.charge, 0);
  assert.ok(b.hp < 100, 'enemy in radius takes super damage');
  assert.equal(c.hp, 95, 'enemy out of radius is untouched');

  // 탄창: 한 발씩 차지 않고, 다 쓰면 교체 시간 뒤에 한 번에 3발
  const m4 = new Match([{ id: 'g', name: 'G', team: 'red' }]);
  m4.step(3.1);
  const g = m4.fighters.get('g');
  g.ammo = 1;
  for (let i = 0; i < 60; i++) m4.step(1 / 30);
  assert.equal(g.ammo, 1, 'partial magazine does not refill');
  g.ammo = 0;
  for (let i = 0; i < 20; i++) m4.step(1 / 30);
  assert.equal(g.ammo, 0, 'still reloading');
  for (let i = 0; i < 10; i++) m4.step(1 / 30);
  assert.equal(g.ammo, 3, 'full magazine after reload');

  // 회복: 우리 팀 리젠구역에서만, 밖에서는 시간이 지나도 그대로
  const m3 = new Match([{ id: 'h', name: 'H', team: 'red' }]);
  m3.step(3.1);
  const h = m3.fighters.get('h');
  Object.assign(h, { x: 800, y: 300, hp: 40, sinceHit: 10 });
  for (let i = 0; i < 90; i++) m3.step(1 / 30);
  assert.equal(Math.round(h.hp), 40, 'no regen outside home zone');
  Object.assign(h, { x: 100, y: 450 });
  for (let i = 0; i < 30; i++) m3.step(1 / 30);
  assert.ok(h.hp > 70, 'regen in home zone');
  Object.assign(h, { x: WORLD.W - 100, hp: 40 });
  for (let i = 0; i < 30; i++) m3.step(1 / 30);
  assert.equal(Math.round(h.hp), 40, 'no regen in enemy zone');

  // 어시스트: 한 대라도 맞힌 적을 우리 팀이 잡으면 어시스트
  const m2 = new Match([
    { id: 'r1', name: 'R1', team: 'red' },
    { id: 'r2', name: 'R2', team: 'red' },
    { id: 'r3', name: 'R3', team: 'red' },
    { id: 'b1', name: 'B1', team: 'blue' },
  ]);
  m2.step(3.1);
  const [r1, r2, r3, b1] = ['r1', 'r2', 'r3', 'b1'].map((id) => m2.fighters.get(id));
  b1.shield = 0;
  m2.damage(b1, 'r1', 25, false);
  m2.damage(b1, 'r2', 80, false);
  assert.deepEqual([r2.kills, r1.assists, r2.assists, r3.assists, b1.deaths], [1, 1, 0, 0, 1]);
  assert.equal(m2.result().players.find((p) => p.id === 'r1').assists, 1);
  // 개인 점수 = 킬×3 + 어시×1 − 데스×2 (최저 0점), 등수는 점수 순
  const res2 = m2.result().players;
  assert.deepEqual(res2.map((p) => [p.id, p.points]), [['r2', 3], ['r1', 1], ['r3', 0], ['b1', 0]]);

  // 부시: 안에 들어가면 숨고, 적이 가까이 오거나 쏘면 드러난다
  const bush = WORLD.bushes[0];
  Object.assign(b, { x: bush.x + bush.w / 2, y: bush.y + bush.h / 2, reveal: 0 });
  Object.assign(a, { x: 1500, y: 450 });
  m.updateHidden();
  assert.ok(b.inBush && b.hidden, 'player in bush is hidden');
  assert.equal(m.snapshot().players.find((p) => p.id === 'b').hid, true);
  a.x = b.x + 60;
  a.y = b.y;
  m.updateHidden();
  assert.equal(b.hidden, false, 'nearby enemy reveals bush player');
  a.x = 1500;
  a.y = 450;
  b.ammo = 3;
  b.cooldown = 0;
  m.fire('b', { facing: true });
  m.updateHidden();
  assert.equal(b.hidden, false, 'shooting reveals bush player');

  // 폰 화면: 부시에 숨은 적은 안 보내고, 숨은 우리 팀은 보낸다
  b.reveal = 0;
  b.x = bush.x + bush.w / 2;
  b.y = bush.y + bush.h / 2;
  a.x = b.x + 300;
  a.y = b.y;
  c.x = b.x + 20;
  c.y = b.y;
  c.reveal = 0;
  m.updateHidden();
  assert.ok(b.hidden);
  const ids = (v) => v.players.map((p) => p.id).sort();
  assert.deepEqual(ids(m.view('a')), ['a'], 'enemy hidden in bush is not sent to me');
  assert.deepEqual(ids(m.view('c')), ['a', 'b', 'c'], 'hidden teammate is still sent');
  assert.equal(m.view('a').me.team, 'red');
  console.log('engine tests OK');
}

(async () => {
  engineTests();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const connect = () => io(url, { transports: ['websocket'], forceNew: true });

  const qr = await fetch(`${url}/api/qr?text=${encodeURIComponent(url + '/play.html?room=1234')}`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /<svg/);

  const host = connect();
  let lobby;
  host.on('lobby', (l) => (lobby = l)); // 처음부터 듣고 있어야 마지막 소식을 놓치지 않는다
  const { code, hostKey } = await ack(host, 'host:create');
  assert.match(code, /^\d{4}$/);
  assert.ok(hostKey);

  const bad = await ack(connect(), 'player:join', { code: '0000', name: 'x' });
  assert.equal(bad.ok, false);

  const names = ['철수', '영희', '민수', '지영'];
  const players = [];
  for (const name of names) {
    const s = connect();
    const res = await ack(s, 'player:join', { code, name });
    assert.ok(res.ok, 'join failed');
    players.push({ s, ...res });
  }

  await wait(100);
  assert.equal(lobby.players.length, 4);
  const teams = lobby.players.map((p) => p.team).sort();
  assert.deepEqual(teams, ['blue', 'blue', 'red', 'red'], 'teams should auto-balance');

  // 재접속: 같은 id/key로 들어오면 같은 사람으로 인식
  const p0 = players[0];
  p0.s.disconnect();
  p0.s = connect();
  const again = await ack(p0.s, 'player:join', { code, id: p0.id, key: p0.key });
  assert.equal(again.id, p0.id);
  await wait(100);
  assert.equal(lobby.players.length, 4, 'rejoin must not duplicate');

  for (const p of players) p.s.emit('player:ready', true);
  await wait(100);
  assert.ok(lobby.players.every((p) => p.ready));

  const started = once(host, 'game:start');
  host.emit('host:start');
  const { world } = await started;
  assert.equal(world.W, 1600);

  let snap;
  host.on('state', (s) => (snap = s));
  let personal;
  players[1].s.on('view', (v) => (personal = v.me));

  await wait(3300); // 카운트다운
  assert.equal(snap.phase, 'playing');
  assert.ok(personal && personal.hp === 100);

  // 모두 가운데로 몰려가며 자동조준 사격
  const fireLoop = setInterval(() => {
    for (const p of players) {
      const me = snap.players.find((x) => x.id === p.id);
      const dir = me.x < 800 ? 1 : -1;
      // 윗쪽 통로(y=80)는 벽이 없으니 그쪽으로 돌아서 간다
      const up = Math.abs(me.y - 80) > 20;
      p.s.emit('input', { mx: up ? 0 : dir, my: up ? Math.sign(80 - me.y) : 0, firing: !up });
    }
  }, 100);
  await wait(6000);
  clearInterval(fireLoop);
  const kills = snap.score.red + snap.score.blue;
  const hurt = snap.players.some((p) => p.hp < 100 || !p.al);
  assert.ok(kills > 0 || hurt, 'someone should have been hit');
  console.log('score after 6s:', snap.score, 'feed:', snap.feed.length);

  const over = once(players[2].s, 'game:over');
  host.emit('host:stop');
  const result = await over;
  assert.equal(result.players.length, 4);
  assert.ok(['red', 'blue', 'draw'].includes(result.winner));
  await wait(100);
  assert.equal(lobby.state, 'result');

  host.emit('host:lobby');
  await wait(100);
  assert.equal(lobby.state, 'lobby');
  assert.ok(lobby.players.every((p) => !p.ready));

  // AI 봇: 빈자리 채우기 → 학생이 들어오면 AI가 비켜 줌 → 봇과 함께 경기
  host.emit('host:bots', { action: 'fill' });
  await wait(150);
  const count = (team, bot) => lobby.players.filter((p) => p.team === team && !!p.bot === bot).length;
  assert.equal(lobby.players.length, 8, 'fill to 4 per team');
  assert.equal(count('red', true) + count('blue', true), 4);
  const late = connect();
  const lateRes = await ack(late, 'player:join', { code, name: '늦게온애' });
  assert.ok(lateRes.ok);
  await wait(150);
  assert.equal(lobby.players.length, 8, 'a bot made room for the new student');
  assert.equal(count('red', false) + count('red', true), count('blue', false) + count('blue', true));
  const started2 = once(host, 'game:start');
  host.emit('host:start');
  await started2;
  await wait(3300 + 8000);
  const botKills = snap.players.filter((p) => p.bot).reduce((n, p) => n + p.k, 0);
  assert.ok(snap.players.some((p) => p.bot), 'bots are in the match');
  console.log('bot kills after 8s:', botKills, 'score', snap.score);
  host.emit('host:bots', { action: 'clear' });
  const over2 = once(host, 'game:over');
  host.emit('host:stop');
  await over2;
  await wait(100);
  host.emit('host:bots', { action: 'clear' });
  await wait(100);
  assert.equal(lobby.players.filter((p) => p.bot).length, 0, 'clear removes bots');

  // 팀당 최대 8명: 8대8까지 채우고, 인원을 줄이면 AI만 빠진다
  host.emit('host:bots', { action: 'fill', size: 8 });
  await wait(150);
  assert.equal(lobby.players.length, 16);
  assert.equal(lobby.teamMax, 8);
  host.emit('host:bots', { action: 'add', team: 'red' });
  await wait(100);
  assert.equal(lobby.players.length, 16, 'no 9th player on a team');
  host.emit('host:bots', { action: 'fill', size: 1 });
  await wait(150);
  assert.equal(lobby.players.filter((p) => p.bot).length, 0, 'shrinking removes only bots');
  assert.equal(lobby.players.length, 5, 'students stay');

  console.log('smoke test OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
