// 그림 전환만 검사한다. 서버의 발사·이동 방향은 변경하지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { WORLD } = require('../game');
let clock = 1000;
const calls = [];
function context(record = false) {
  return new Proxy({ globalAlpha: 1 }, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === 'drawImage') return (...args) => { if (record) calls.push(args); };
      if (name === 'rotate') return () => { throw new Error('캐릭터 전체를 회전하면 안 됩니다'); };
      return () => {};
    },
  });
}
const sandbox = {
  window: {}, performance: { now: () => clock },
  Image: class { set src(src) { this.path = src; this.onload(); } },
  document: { createElement: () => ({ getContext: () => context() }) },
};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/render.js'), 'utf8'), sandbox);
const scene = sandbox.window.GameRender.createScene(0);
const ctx = context(true);
function render(degrees, team = 'red', hidden = false) {
  clock += 100;
  const a = degrees * Math.PI / 180;
  scene.push({ st: clock, bullets: [], players: [{ id: 'one', n: '검사', t: team, x: 400, y: 300,
    fx: Math.cos(a), fy: Math.sin(a), hp: 100, am: 3, al: true, c: true, hid: hidden }] });
  scene.update(clock + 1000);
  calls.length = 0;
  scene.draw(ctx, WORLD, 1 / 60, clock + 1000);
  return calls.find(c => c[0].path === '/assets/fighters.webp');
}
const source = degrees => render(degrees)[1] / 0.75;
assert.equal(source(0), 51, '오른쪽');
assert.equal(source(64), 51, '경계 아래에서는 옆모습 유지');
assert.equal(source(66), 822, '아래쪽은 앞모습');
assert.equal(source(56), 822, '복귀 경계까지 앞모습 유지');
assert.equal(source(54), 51, '옆모습으로 복귀');
assert.equal(source(180), 294, '왼쪽도 똑바로 선 그림');
assert.equal(source(-90), 564, '위쪽은 뒷모습');
assert.equal(source(-56), 564);
assert.equal(source(-54), 51);
const red = render(0);
const blue = render(0, 'blue');
assert.notEqual(red[2], blue[2], '팀마다 다른 그림');
assert.equal(red[6] + red[8], blue[6] + blue[8], '두 팀의 발밑 높이 고정');
assert.equal(render(90, 'blue', true), undefined, '숨은 적은 그림을 보내지 않는다');
scene.reset();
assert.equal(source(60), 51, '새 경기에서는 이전 방향을 잊는다');
console.log('네 방향 그림 전환 검사 통과');
