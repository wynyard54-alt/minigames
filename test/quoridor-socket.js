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
 console.log('쿼리도 2인·권한·복구·정원·AI 실제 차례·예약 취소·혼자 대결 검사 통과');
}finally{clients.forEach(s=>s.disconnect());server.close();}process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
