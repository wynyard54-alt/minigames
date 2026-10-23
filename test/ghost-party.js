const assert = require('assert');
const { Expedition } = require('../ghost');
const D = require('../public/ghost-data');
for (const difficulty of ['easy', 'hard']) {
  for (const count of [1,2,3,4,5,6]) {
    for (const dark of [false,true]) {
      const players=Array.from({length:count},(_,i)=>({id:String(i),name:'탐사'+i,partner:i}));
      const g=new Expedition(players,()=>0.99,difficulty);
      g.phase='act'; g.players.forEach(p=>p.node='r1');
      g.regions[0].dark=dark;g.regions[0].mobs=dark?['가','나','다']:['가'];
      const limit=difficulty==='easy'?count:Math.min(2,count);
      assert.equal(D.battleTeam(g.players,'0',difficulty,String(count-1)).length,limit);
      if(dark&&count===1){assert(g.action('0',{type:'battle'}));continue;}
      // 마지막 참여자만 성공하여, 뒤쪽 주사위도 판정에 포함되는지 확인.
      let rolls=0;g.rng=()=>++rolls===limit?(dark?(D.difficulties[difficulty].balls+.1)/6:.01):.99;
      assert.equal(g.action('0',{type:'battle',helper:String(count-1)}),undefined);
      assert.equal(g.dice.length,limit);assert.equal(g.battle.participants.length,limit);
      assert(g.battle.success);
      const involved=new Set(g.battle.participants.map(p=>p.id));
      for(const p of g.players) assert.equal(p.rescues,involved.has(p.id)?(dark?3:1):0);
      assert.equal(g.phase,'end');assert(g.action('0',{type:'battle'}));
    }
  }
}
// 쉬움: 여섯 번째 참가자의 축복도 사용, 하나만 소모하고 전원 +3.
const g=new Expedition(Array.from({length:6},(_,i)=>({id:String(i),name:'AI'+i,partner:i})),()=>.99,'easy');
g.phase='act';g.players.forEach(p=>p.node='r1');g.players[4].blessed=g.players[5].blessed=true;
g.regions[0].dark=true;g.regions[0].mobs=['가','나','다'];g.action('0',{type:'battle',helper:'1'});
assert.equal(g.battle.blessedBy,'4');assert(!g.players[4].blessed);assert(g.players[5].blessed);
assert.equal(D.combatSymbol(g.dice[4],'easy'),'다크라이');
assert(g.players.every(p=>p.rescues===3));assert.equal(g.dice.length,6);
// 다른 지역 친구는 쉬움이어도 제외.
g.next();g.phase='act';g.players[0].node='r2';
assert.equal(D.battleTeam(g.players,'1','easy').length,5);
console.log('쉬움 1~6명 전원 주사위/구조 기록·어려움 두 명·다크라이 최소인원·축복 면 확정 검사 통과');
