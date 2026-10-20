// 시각 효과가 쌓여도 처치·점수·아이템 규칙을 유지하는지 검사한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now = 0;
let frame;
const nodes = new Map();
const ctx = new Proxy({ globalAlpha: 1 }, { get: (target, key) => key in target ? target[key] : () => {} });
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} },
    listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, getContext: () => ctx });
  return nodes.get(id);
}
const reports = [];
const sandbox = {
  window: {}, document: { getElementById: node, createElement: () => ({ getContext: () => ctx }) },
  performance: { now: () => now }, navigator: {}, devicePixelRatio: 1, innerWidth: 844, innerHeight: 390,
  requestAnimationFrame: fn => { frame = fn; return 1; }, cancelAnimationFrame() {}, addEventListener() {},
  Image: class { set src(src) { this.onload(); } },
};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/arena.js'), 'utf8'), sandbox);
const arena = sandbox.window.Arena;
arena.start({ team: 'red', startIn: 0, duration: 100000, onReport: r => reports.push(r) });
const g = arena._state();
g.spawn = g.shoot = 999;
function tick(ms = 20) { now += ms; frame(now); }
// 큰 적은 명중 후 체력·피격 표시가 바뀌고 처치 전에는 점수를 주지 않는다.
g.enemies.push({ kind: 'big', x: 1300, y: 1200, r: 23, hp: 3, speed: 0, flash: 0 });
g.bullets.push({ x: 1300, y: 1200, vx: 0, vy: 0, dmg: 1, r: 7, life: 1 });
tick();
assert.equal(g.enemies[0].hp, 2);
assert.ok(g.enemies[0].flash > 0);
assert.equal(g.score, 0);
// 한 번에 100마리를 잡아도 효과 수는 제한하고 점수·처치는 전부 계산한다.
g.enemies.length = 0;
for (let i = 0; i < 100; i++) g.enemies.push({ kind: 'big', x: 1250, y: 1200, r: 23, hp: 3, speed: 0 });
g.charge = 100;
node('aSpecial').listeners.pointerdown({ preventDefault() {}, stopPropagation() {} });
assert.equal(g.kills, 100);
assert.equal(g.score, 3005);
assert.equal(g.enemies.length, 0);
assert.ok(g.fx.length <= 36);
assert.ok(g.floaters.length <= 10);
assert.ok(g.fx.some(f => f.wide), '큰 충격파 유지');
// 아이템 효과·표시와 기존 지속 시간을 확인한다.
g.items.push({ x: 1200, y: 1200, type: 'rapid', life: 7 });
tick();
assert.equal(g.buffs.rapid, 8);
now += 100; frame(now);
assert.ok(node('aBuffs').innerHTML.includes('빠른 연사'));
g.buffs.rapid = 0.01;
tick();
assert.ok(g.buffs.rapid <= 0);
now += 120; frame(now);
assert.ok(!node('aBuffs').innerHTML.includes('빠른 연사'));
g.player.hp = 3;
g.items.push({ x: 1200, y: 1200, type: 'heal', life: 7 });
tick();
assert.equal(g.player.hp, 4);
g.buffs.shield = 4;
g.enemies.push({ kind: 'small', x: 1200, y: 1200, r: 15, hp: 1, speed: 0 });
tick();
assert.equal(g.player.hp, 4, '보호막 피해 방지');
now = 100001; frame(now);
assert.equal(g.done, true);
assert.ok(reports.at(-1).done, '종료 점수 보고 유지');
arena.stop();
console.log('아레나 효과 상한·명중·아이템·점수 검사 통과');
