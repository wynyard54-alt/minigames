const assert = require('assert');
const { Expedition } = require('../ghost');
const { decide } = require('../ghost-ai');
const D = require('../public/ghost-data');
const team = () => [
  {id:'a',name:'가',partner:0}, {id:'b',name:'나',partner:3}, {id:'c',name:'다',partner:2},
];
const make = () => new Expedition(team(), () => 0.99);
let g = make();
assert.equal(g.deck.length,33);
assert.equal(g.deck.filter(c=>c===31).length,1);assert.equal(g.deck.filter(c=>c===32).length,1);
// 지원 카드에서도 주사위 후 카드 공개→이동, 출현은 없음.
g.deck=[31];g.rng=()=>0.1;g.action('a',{type:'roll'});
assert(g.flight);assert.equal(g.phase,'move');
assert(g.regions.every(r=>r.mobs.length===0));
assert.equal(Object.keys(g.reachable()).length,11);
assert(g.action('b',{type:'move',node:'r5'}));
assert(g.action('a',{type:'move',node:'v1'}));
assert.equal(g.action('a',{type:'move',node:'r5'}),undefined);
assert.equal(g.active.node,'r5');assert(!g.flight);assert(g.regions[4].revealed);
assert(!g.regions[3].revealed,'창공날기는 중간 지역을 방문하지 않음');
g=make();g.deck=[31];g.phase='move';g.active.node='r1';g.active.carry=1;g.regions[0].dark=true;g.draw();
assert.deepEqual(g.reachable(),{r1:0},'조각 운반자의 다크라이 퇴장 제한 유지');
g=make();g.deck=[32];g.rng=()=>0.1;g.action('a',{type:'roll'});
assert(g.active.blessed);assert(!g.players[1].blessed);assert(!g.flight);
assert(g.regions.every(r=>r.mobs.length===0));
g.phase='act';g.active.node='r1';g.regions[0].mobs=['나인테일'];
g.action('a',{type:'battle'});assert(g.active.blessed,'일반 배틀에 축복 소모 안 함');
g.next();g.next();g.next();assert(g.active.blessed,'차례가 바뀌어도 유지');
// 축복 소유자만 다크라이 면 확정, 다른 참가자는 평소대로 굴린다.
function darkSetup(){const e=make();e.phase='act';e.active.node='r1';e.regions[0].mobs=['가','나','다'];e.regions[0].dark=true;return e;}
g=darkSetup();g.active.blessed=true;
assert(g.action('a',{type:'battle'}));assert(g.active.blessed,'혼자서는 축복도 사용 불가');
g.players[1].node='r1';let randomRolls=0;g.rng=()=>{randomRolls++;return 0.99;};
assert.equal(g.action('a',{type:'battle'}),undefined);assert(g.battle.success);assert.equal(g.battle.blessedBy,'a');
assert.deepEqual(g.dice,[2,5]);assert.equal(randomRolls,1);assert(!g.active.blessed);assert(!g.regions[0].dark);assert.equal(g.regions[0].mobs.length,0);
assert.equal(g.active.rescues,3);assert.equal(g.players[1].rescues,3);
// 다른 사람 차례에 축복 소유자가 협동해도 소모/성공. 두 명 보유면 하나만 소모.
g=darkSetup();g.players[1].node='r1';g.players[1].blessed=true;
g.action('a',{type:'battle',helper:'b'});assert(g.battle.success);assert.equal(g.battle.blessedBy,'b');assert(!g.players[1].blessed);
g=darkSetup();g.players[1].node='r1';g.players[1].blessed=g.active.blessed=true;
g.action('a',{type:'battle'});assert(!g.active.blessed);assert(g.players[1].blessed);
// 배틀에 참여하지 않는 축복 소유자는 영향을 주지 않음.
g=darkSetup();g.players[1].node='r1';g.players[2].blessed=true;
g.action('a',{type:'battle'});assert(!g.battle.success);assert(g.players[2].blessed);
// 다시 섞기에는 지원 카드도 복원되며 중복 카드가 추가되지 않음.
g=make();g.deck=[30];g.discard=Array.from({length:33},(_,i)=>i).filter(i=>i!==30);g.draw();
assert.equal(g.deck.length,33);assert.equal(new Set(g.deck).size,33);
// AI도 비행으로 먼 지역 합류와 축복 협동을 선택.
g=darkSetup();g.active.ai=true;g.players[1].node='r1';g.players[1].blessed=true;
assert.equal(decide(g.snapshot()).helper,'b');
g=make();g.active.ai=true;g.active.blessed=true;g.phase='move';g.flight=true;g.players[1].node='r5';g.regions[4].dark=true;g.regions[4].mobs=['가','나','다'];
assert.equal(decide(g.snapshot()).node,'r5');
// 모든 그림의 표시 높이를 보정할 메타데이터가 존재.
for(const p of D.partners)for(let stage=0;stage<p.names.length;stage++)assert(D.pawnBounds[p.color+'-'+stage+'.webp']);
console.log('지원 카드 33장·비행·개인 축복 협동/소모·AI·말 크기 자료 검사 통과');
