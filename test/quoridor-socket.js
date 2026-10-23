const assert=require('assert'),{io}=require('socket.io-client'),{server,quoridorRooms}=require('../server');
const clients=[];const ack=(s,e,d)=>new Promise((res,rej)=>s.timeout(3000).emit(e,d,(err,r)=>err?rej(err):res(r)));
const connect=url=>new Promise(res=>{const s=io(url+'/quoridor',{forceNew:true,transports:['websocket']});clients.push(s);s.on('connect',()=>res(s));});
(async()=>{await new Promise(res=>server.listen(0,'127.0.0.1',res));const url='http://127.0.0.1:'+server.address().port;try{
 const host=await connect(url),r=await ack(host,'create',{});assert(r.ok);assert((await ack(host,'command',{type:'start'})).error);
 const a=await connect(url),b=await connect(url),other=await connect(url);const pa=await ack(a,'join',{code:r.code,name:'학생1'}),pb=await ack(b,'join',{code:r.code,name:'학생2'});assert(pa.ok&&pb.ok);assert((await ack(other,'join',{code:r.code,name:'늦은친구'})).error);
 assert((await ack(a,'command',{type:'addAI'})).error);assert((await ack(a,'command',{type:'swap'})).error);
 await ack(a,'command',{type:'ready'});await ack(b,'command',{type:'ready'});assert((await ack(host,'command',{type:'start'})).ok);
 assert((await ack(host,'command',{type:'move',r:7,c:4})).error);assert((await ack(b,'command',{type:'move',r:1,c:4})).error);assert((await ack(a,'command',{type:'move',r:7,c:4})).ok);
 assert((await ack(a,'command',{type:'reset'})).error);assert((await ack(b,'command',{type:'wall',wall:{o:'h',r:3,c:3}})).ok);
 const restored=await connect(url);assert((await ack(restored,'join',{...pa,code:r.code})).ok);assert((await ack(a,'command',{type:'move',r:6,c:4})).error);assert((await ack(restored,'command',{type:'move',r:6,c:4})).ok);
 let snapshot;other.on('update',s=>snapshot=s);assert((await ack(other,'join',{code:r.code,key:r.key,host:true})).ok);await new Promise(r=>setTimeout(r,30));assert(snapshot.players.every(p=>!p.key&&!p.socket));assert((await ack(host,'command',{type:'reset'})).error);
 await ack(other,'command',{type:'reset'});await ack(other,'command',{type:'kick',id:pb.id});assert((await ack(other,'command',{type:'addAI'})).ok);const room=quoridorRooms.get(r.code);assert(room.players[1].ai&&room.players[1].ready);
 await ack(restored,'command',{type:'ready'});await ack(other,'command',{type:'start'});await ack(restored,'command',{type:'move',r:7,c:4});await new Promise(r=>setTimeout(r,1600));assert.equal(room.game.revision,2,'AI가 실제 한 수 실행');assert.equal(room.game.turn,0);
 await ack(other,'command',{type:'reset'});assert.equal(room.game,null);assert(room.players[1].ready);await ack(other,'command',{type:'close'});assert(!quoridorRooms.has(r.code));
 const solo=await connect(url),sr=await ack(solo,'create',{solo:true,name:'혼자'});assert(sr.id);assert((await ack(solo,'command',{type:'gender',gender:'girl'})).ok);assert((await ack(solo,'command',{type:'start'})).ok);assert((await ack(solo,'command',{type:'move',r:7,c:4})).ok);await ack(solo,'command',{type:'reset'});await new Promise(r=>setTimeout(r,1300));assert.equal(quoridorRooms.get(sr.code).game,null,'리셋 후 예약 취소');await ack(solo,'command',{type:'start'});quoridorRooms.get(sr.code).game.status='won';assert((await ack(solo,'command',{type:'reset'})).ok);await ack(solo,'command',{type:'close'});
 // AI별 난이도: 두 AI에 서로 다른 설정, 진영 교환/게임/리셋에도 개체에 유지.
 {const h=await connect(url),r=await ack(h,'create',{});await ack(h,'command',{type:'addAI'});await ack(h,'command',{type:'addAI'});const room=quoridorRooms.get(r.code),[a,b]=room.players;
  assert.equal(a.aiLevel,'easy');assert.equal(b.aiLevel,'easy');assert((await ack(h,'command',{type:'aiLevel',id:a.id,level:'hard'})).ok);assert.equal(b.aiLevel,'easy');
  assert((await ack(h,'command',{type:'aiLevel',id:'없는AI',level:'hard'})).error);await ack(h,'command',{type:'swap'});assert.equal(room.players[1].id,a.id);await ack(h,'command',{type:'start'});assert.equal(room.game.players[0].aiLevel,'easy');assert.equal(room.game.players[1].aiLevel,'hard');
  await ack(h,'command',{type:'reset'});assert.equal(room.players.find(p=>p.id===a.id).aiLevel,'hard');await ack(h,'command',{type:'close'});}
 // 차례 시간 제한: 기본 30초 켜짐, 선생님만 끄고 켬, 시간이 지나면 AI가 대신 한 수(시간 초과 표시)
 {const th=await connect(url),tr=await ack(th,'create',{});const st=await connect(url);await ack(st,'join',{code:tr.code,name:'느린학생'});
  const troom=quoridorRooms.get(tr.code);assert.equal(troom.turnLimit??30,30);assert((await ack(st,'command',{type:'aiLevel',level:'hard'})).error);assert((await ack(th,'command',{type:'aiLevel',level:'bad'})).error);assert((await ack(st,'command',{type:'timer'})).error);
  assert((await ack(th,'command',{type:'timer'})).ok);assert.equal(troom.turnLimit,0);assert((await ack(th,'command',{type:'timer'})).ok);assert.equal(troom.turnLimit,30);
  await ack(th,'command',{type:'addAI'});const ai=troom.players.find(p=>p.ai);assert((await ack(th,'command',{type:'aiLevel',id:ai.id,level:'hard'})).ok);assert.equal(ai.aiLevel,'hard');assert((await ack(th,'command',{type:'aiLevel',id:troom.players.find(p=>!p.ai).id,level:'hard'})).error);await ack(st,'command',{type:'ready'});troom.turnLimit=0.3;let clock;th.on('update',u=>clock=u.clock);
  assert((await ack(th,'command',{type:'start'})).ok);assert((await ack(th,'command',{type:'aiLevel',level:'easy'})).error);await new Promise(r=>setTimeout(r,60));assert(clock&&clock.ms<=300&&clock.limit===0.3,'사람 차례 남은 시간 전달');
  await new Promise(r=>setTimeout(r,500));assert.equal(troom.game.revision,1,'시간 초과로 자동 한 수');assert(troom.game.lastAction.timeout);assert.equal(troom.game.turn,1);
  await ack(th,'command',{type:'close'});}
 // 일시정지: 선생님만, 멈춘 동안 시간이 흐르지 않고 학생 수도 막힘, 다시 시작하면 남은 시간부터
 {const ph=await connect(url),pr=await ack(ph,'create',{});const ps=await connect(url);await ack(ps,'join',{code:pr.code,name:'화장실'});
  const proom=quoridorRooms.get(pr.code);await ack(ph,'command',{type:'addAI'});await ack(ps,'command',{type:'ready'});assert((await ack(ph,'command',{type:'pause'})).error,'대기실에서는 일시정지 없음');
  proom.turnLimit=0.3;assert((await ack(ph,'command',{type:'start'})).ok);assert((await ack(ps,'command',{type:'pause'})).error,'학생은 멈출 수 없음');
  assert((await ack(ph,'command',{type:'pause'})).ok);assert(proom.paused);await new Promise(r=>setTimeout(r,500));assert.equal(proom.game.revision,0,'멈춘 동안 시간 초과 없음');
  assert((await ack(ps,'command',{type:'move',r:7,c:4})).error,'멈춘 동안 수를 둘 수 없음');
  assert((await ack(ph,'command',{type:'pause'})).ok);assert(!proom.paused);await new Promise(r=>setTimeout(r,500));assert.equal(proom.game.revision,1,'다시 시작 후 시간 초과');
  await ack(ph,'command',{type:'pause'});await ack(ph,'command',{type:'reset'});assert(!proom.paused,'대기실로 가면 일시정지 해제');await ack(ph,'command',{type:'close'});}
 console.log('쿼리도 2인·권한·복구·정원·AI 실제 차례·예약 취소·혼자 대결·차례 시간 제한·일시정지 검사 통과');
}finally{clients.forEach(s=>s.disconnect());server.close();}process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
