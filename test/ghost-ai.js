const assert = require('assert');
const { Expedition } = require('../ghost');
const { decide } = require('../ghost-ai');
const team = () => [
  { id: 'a', name: 'AI 모부기', partner: 0, ai: true },
  { id: 'b', name: 'AI 리오르', partner: 3, ai: true },
  { id: 'c', name: '학생', partner: 2, ai: false },
];
let g = new Expedition(team(), () => 0.99);
assert.deepEqual(decide(g.snapshot()), { type: 'roll' });
g.turn = 2; assert.equal(decide(g.snapshot()), null);
g.turn = 0; g.phase = 'act'; g.active.node = 'r1';
g.regions[0].mobs = ['가', '나', '다']; g.regions[0].dark = true;
assert.equal(decide(g.snapshot()).type, 'end', '다크라이 단독 공격 금지');
g.players[1].node = 'r1';
assert.equal(decide(g.snapshot()).helper, 'b');
g.phase = 'move'; g.moves = 6; g.active.carry = 1;
assert.equal(decide(g.snapshot()).node, 'r1', '다크라이에 갇힌 운반자는 퇴장 불가');
g.regions[0].dark = false; g.regions[0].mobs = []; g.active.node = 'camp';
g.active.carry = null; g.phase = 'act'; g.active.node = 'r2';
g.regions[1].fragment = 8; g.regions[1].revealed = true;
assert.equal(decide(g.snapshot()).type, 'end', '어려움은 다음 번호 먼저 회수');
g.difficulty = 'easy'; assert.equal(decide(g.snapshot()).type, 'pickup');
// AI도 배틀 결과 이후 조각을 회수하고, 재공격 없이 넘긴다.
g.phase = 'end'; g.battle = { success: false }; g.regions[1].mobs = ['가'];
assert.equal(decide(g.snapshot()).type, 'pickup');
g.action('a', decide(g.snapshot()));
assert.equal(decide(g.snapshot()).type, 'end');
g.active.carry = null;
// 공개되지 않은 번호가 다른 게임도 같은 결정을 내린다.
g.phase = 'move'; g.moves = 5; g.active.node = 'camp';
g.regions.forEach(r => r.revealed = false);
const original = decide(g.snapshot());
for (const r of g.regions) if (r.fragment) r.fragment = 9 - r.fragment;
assert.deepEqual(decide(g.snapshot()), original);
// 출현 없는 결정적 주사위로 양 난이도 전체 운반과 귀환을 검증한다.
for (const difficulty of ['easy', 'hard']) {
  g = new Expedition(team().map(p => ({ ...p, ai: true })), () => 0.99, difficulty);
  let steps = 0;
  while (!['won', 'lost'].includes(g.phase) && steps++ < 1800) {
    const snapshot = g.snapshot(), saved = JSON.stringify(snapshot), req = decide(snapshot);
    assert.equal(JSON.stringify(snapshot), saved, 'AI는 공개 상태를 수정하지 않음');
    assert(req);
    if (req.type === 'end') g.next();
    else assert.equal(g.action(g.active.id, req), undefined, JSON.stringify(req));
  }
  assert.equal(g.phase, 'won', difficulty + '에서 조각 회수 후 전원 귀환');
}
console.log('고스트헌터 AI 협동·숨은 정보 보호·합법 이동·양 난이도 완주 검사 통과');
