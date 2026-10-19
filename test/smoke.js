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

  let lobby;
  host.on('lobby', (l) => (lobby = l));
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
  players[1].s.on('me', (m) => (personal = m));

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

  console.log('smoke test OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
