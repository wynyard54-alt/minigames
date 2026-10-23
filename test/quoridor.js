const assert=require('assert'),Q=require('../public/quoridor-engine');
const players=[{id:'a',name:'조사병단'},{id:'b',name:'전사대'}];const make=()=>Q.create(players);
let g=make();assert.equal(g.players[0].remaining,10);assert.equal(g.players[1].r,0);
assert(Q.action(g,1,{type:'move',r:1,c:4}));assert.equal(Q.action(g,0,{type:'move',r:7,c:4}),'');assert.equal(g.turn,1);
assert(Q.action(g,1,{type:'wall',wall:{o:'h',r:8,c:2}}));
assert.equal(Q.action(g,1,{type:'wall',wall:{o:'h',r:3,c:3}}),'');assert.equal(g.players[1].remaining,9);
for(const w of [{o:'h',r:3,c:2},{o:'h',r:3,c:4},{o:'v',r:3,c:3}])assert(Q.wallError(g,w));
assert.equal(Q.wallError(g,{o:'v',r:3,c:4}),'');
assert(Q.blocked(g,{r:3,c:3},{r:4,c:3}));assert(Q.blocked(g,{r:3,c:4},{r:4,c:4}));assert(!Q.blocked(g,{r:3,c:2},{r:4,c:2}));
g=make();g.players[0].r=4;g.players[1].r=3;
assert(Q.moves(g,0).some(m=>m.r===2&&m.c===4&&m.jump));assert(!Q.moves(g,0).some(m=>m.r===3&&m.c===3));
g.walls=[{o:'h',r:2,c:4}];assert(!Q.moves(g,0).some(m=>m.r===2&&m.c===4));assert(Q.moves(g,0).some(m=>m.r===3&&m.c===3&&m.jump));assert(Q.moves(g,0).some(m=>m.r===3&&m.c===5&&m.jump));
g.walls.push({o:'v',r:3,c:3});assert(!Q.moves(g,0).some(m=>m.r===3&&m.c===3));
g=make();g.players[0].r=1;assert(Q.moves(g,0).some(m=>m.r===0&&m.c===3&&m.jump));
assert.equal(Q.action(g,0,{type:'move',r:0,c:3}),'');assert.equal(g.status,'won');assert.equal(g.winner,0);assert(Q.action(g,1,{type:'move',r:1,c:4}));
g=make();g.walls=[{o:'h',r:7,c:3},{o:'v',r:7,c:4}];assert(Q.wallError(g,{o:'v',r:7,c:2}).includes('길'));const before=JSON.stringify(g);assert(Q.action(g,0,{type:'wall',wall:{o:'v',r:7,c:2}}));assert.equal(JSON.stringify(g),before);
g=make();g.players[0].remaining=0;assert(Q.action(g,0,{type:'wall',wall:{o:'v',r:0,c:0}}));
for(const req of [null,{}, {type:'move',r:99,c:0},{type:'wall',wall:{o:'v',r:.5,c:1}},{type:'wall',wall:{o:'bad',r:0,c:0}}])assert(Q.action(g,0,req));
g=make();g.players[0].r=1;g.players[1].c=0;assert.equal(Q.chooseAI(g).type,'move');const a=Q.chooseAI(g);assert.equal(a.r,0);
// 실제 판처럼 양쪽 AI를 끝까지 진행해 합법 행동과 경로를 확인한다.
for(let first=0;first<2;first++){
 g=Q.create(players,first);let count=0;
 while(g.status==='playing'&&count++<300){const req=Q.chooseAI(g);assert(req);assert.equal(Q.action(g,g.turn,req),'');assert(Number.isFinite(Q.distance(g,0))&&Number.isFinite(Q.distance(g,1)));}
 assert.equal(g.status,'won','AI끼리 끝없이 왕복하지 않음');assert(g.players.every(p=>p.remaining>=0));
}
console.log('쿼리도 이동·직선/대각 점프·벽 중복/교차/길 봉쇄·승패·AI 완주 검사 통과');
// 어려움도 공개 정보만 읽고 원본 상태를 건드리지 않으며, 즉시 승리/상대 승리 차단을 우선한다.
for(const side of [0,1]){
 const h=make();h.turn=side;h.players[side].r=side?7:1;h.players[1-side].c=0;
 const saved=JSON.stringify(h),req=Q.chooseHardAI(h);assert.equal(JSON.stringify(h),saved);assert.equal(Q.action(h,side,req),'');assert.equal(h.winner,side);
 const danger=make();danger.turn=side;danger.players[1-side].r=side?1:7;danger.players[1-side].c=0;
 assert.equal(Q.action(danger,side,Q.chooseHardAI(danger)),'');assert(!Q.moves(danger,1-side).some(m=>m.r===(side?0:8)),'상대 즉시 도착 차단');
}
console.log('어려움 AI 양 진영 즉시 승리·상대 도착 차단·원본 보존 검사 통과');
// 동일 시작판에서 진영을 바꿔 기존 AI와 대결: 합법 수를 유지하며 양쪽에서 완주/승리.
for(const hardSide of [0,1]){
 const match=make();let turn=0;
 while(match.status==='playing'&&turn++<160){const req=(match.turn===hardSide?Q.chooseHardAI:Q.chooseAI)(match);assert.equal(Q.action(match,match.turn,req),'');}
 assert.equal(match.status,'won');assert.equal(match.winner,hardSide,'기존 AI 대비 양 진영 기준 대결');
}
console.log('어려움 AI 기존 AI와 진영 교대 대결 2판 승리 확인');
