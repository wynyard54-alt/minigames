// 선생님 1명 + 학생 4명을 흉내 내서 방 만들기 → 입장 → 경기 → 결과까지 확인
const assert = require('assert');
const { io } = require('socket.io-client');
const { server } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.once(ev, r));
const ack = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));

(async () => {
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
      p.s.emit('input', { mx: up ? 0 : dir, my: up ? Math.sign(80 - me.y) : 0 });
      p.s.emit('fire', { auto: true });
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
