// 네 번째 게임은 독립 채널에서 서버가 규칙·권한·AI를 판정한다.
const crypto=require('crypto'),Q=require('./public/quoridor-engine');
function attach(io){
  const ns=io.of('/quoridor'),rooms=new Map(),timers=new Map(),turnTimers=new Map();
  // 차례 시간 제한(사용자 지정 30초, 대기실에서 선생님이 켜고 끔). 시간이 지나면 AI가 대신 한 수를 둔다.
  const TURN_LIMIT=30;
  const secret=()=>crypto.randomBytes(16).toString('hex');
  const clean=v=>String(v||'플레이어').replace(/[<>\x00-\x1f]/g,'').trim().slice(0,12)||'플레이어';
  const cancel=r=>{clearTimeout(timers.get(r.code));timers.delete(r.code);clearTimeout(turnTimers.get(r.code)?.timer);turnTimers.delete(r.code);};
  function schedule(r){
    if(timers.has(r.code)||r.paused||!r.game||r.game.status!=='playing'||!r.game.players[r.game.turn].ai)return;
    if(!r.host&&!r.players.some(p=>!p.ai&&p.socket))return;
    const game=r.game,revision=game.revision;
    const timer=setTimeout(()=>{timers.delete(r.code);
      if(rooms.get(r.code)!==r||r.game!==game||game.revision!==revision||(!r.host&&!r.players.some(p=>!p.ai&&p.socket)))return;
      const req=(game.players[game.turn].aiLevel==='hard'?Q.chooseHardAI:Q.chooseAI)(game);if(req)Q.action(game,game.turn,req);publish(r);
    },1200);timer.unref();timers.set(r.code,timer);
  }
  // 사람 차례마다 마감 시각을 정하고, 같은 수(revision)가 그대로면 시간 초과로 처리한다
  function turnClock(r){
    const g=r.game,limit=r.turnLimit??TURN_LIMIT;
    if(!g||g.status!=='playing'||!limit||g.players[g.turn].ai){clearTimeout(turnTimers.get(r.code)?.timer);turnTimers.delete(r.code);return null;}
    let t=turnTimers.get(r.code);
    if(!t||t.game!==g||t.revision!==g.revision){
      clearTimeout(t?.timer);
      t={game:g,revision:g.revision,left:limit*1000};turnTimers.set(r.code,t);
    }
    // 일시정지 중에는 남은 시간을 그대로 보관하고, 다시 시작하면 그만큼 다시 센다
    if(r.paused){if(t.timer){clearTimeout(t.timer);t.timer=null;t.left=Math.max(0,t.deadline-Date.now());}return {limit,ms:t.left,revision:g.revision,paused:true};}
    if(!t.timer){
      t.deadline=Date.now()+t.left;
      t.timer=setTimeout(()=>{
        if(rooms.get(r.code)!==r||r.game!==g||g.revision!==t.revision||g.status!=='playing'||r.paused)return;
        if(!r.host&&!r.players.some(p=>!p.ai&&p.socket))return;
        const req=Q.chooseAI(g);if(req&&!Q.action(g,g.turn,req)&&g.lastAction)g.lastAction.timeout=true;
        publish(r);
      },t.left);
      t.timer.unref?.();
    }
    return {limit,ms:Math.max(0,t.deadline-Date.now()),revision:g.revision};
  }
  function publish(r){const clock=turnClock(r);ns.to(r.code).emit('update',{code:r.code,solo:r.solo,paused:!!r.paused,turnLimit:r.turnLimit??TURN_LIMIT,clock,players:r.players.map(({key,socket,...p})=>({...p,connected:!!p.ai||!!socket})),game:r.game});schedule(r);}
  function addAI(r){r.players.push({id:secret().slice(0,10),name:'AI 상대',gender:'girl',ai:true,aiLevel:'easy',ready:true});}
  ns.on('connection',s=>{
    s.on('create',(d,cb=()=>{})=>{
      if(rooms.has(s.data.code))return cb({error:'이미 방에 참가하고 있어요.'});
      let code;do{code=String(1000+crypto.randomInt(9000));}while(rooms.has(code));
      const r={code,key:secret(),host:s.id,solo:!!d?.solo,players:[],game:null,touched:Date.now()};
      s.data.playerId=null;
      if(r.solo){const p={id:secret().slice(0,10),key:secret(),name:clean(d?.name),gender:'boy',ready:true,socket:s.id};r.players.push(p);s.data.playerId=p.id;addAI(r);}
      rooms.set(code,r);s.data.code=code;s.data.host=true;s.join(code);
      cb({ok:true,code,key:r.key,host:true,id:s.data.playerId||null});publish(r);
    });
    s.on('join',(d,cb=()=>{})=>{
      if(rooms.has(s.data.code)&&s.data.code!==String(d?.code))return cb({error:'이미 다른 방에 참가하고 있어요.'});
      const r=rooms.get(String(d?.code));if(!r)return cb({error:'방을 찾을 수 없어요.'});
      const host=!!d?.host&&d.key===r.key;
      if(d?.host&&!host)return cb({error:'선생님 방 복구 정보가 만료됐어요.'});
      let p;
      if(host){r.host=s.id;s.data.host=true;if(r.solo){p=r.players.find(p=>!p.ai);if(p){if(p.socket&&p.socket!==s.id){const old=ns.sockets.get(p.socket);if(old){old.leave(r.code);old.data.playerId=null;old.emit('closed','다른 기기에서 접속했습니다.');}}p.socket=s.id;s.data.playerId=p.id;}}}
      else{
        p=r.players.find(p=>!p.ai&&p.id===d.id&&p.key===d.key);
        if(!p){if(r.game)return cb({error:'대전이 시작됐어요. 다음 판에 참가해 주세요.'});if(r.players.length>=2)return cb({error:'두 자리가 찼어요. 선생님이 AI를 제거하면 참가할 수 있어요.'});
          p={id:secret().slice(0,10),key:secret(),name:clean(d?.name),gender:'boy',ready:false};r.players.push(p);}
        if(p.socket&&p.socket!==s.id){const old=ns.sockets.get(p.socket);if(old){old.leave(r.code);old.data.playerId=null;old.emit('closed','다른 기기에서 접속했습니다.');}}
        p.socket=s.id;s.data.playerId=p.id;s.data.host=false;
      }
      s.data.code=r.code;s.join(r.code);r.touched=Date.now();cb({ok:true,code:r.code,host,id:p?.id||null,key:host?r.key:p.key});publish(r);
    });
    s.on('command',(d,cb=()=>{})=>{
      const r=rooms.get(s.data.code);if(!r)return cb({error:'방이 종료됐어요.'});r.touched=Date.now();
      const host=s.data.host&&r.host===s.id,p=r.players.find(p=>p.id===s.data.playerId&&p.socket===s.id);let error='';
      if(d?.type==='close'&&host){cancel(r);ns.to(r.code).emit('closed','방을 닫았습니다.');rooms.delete(r.code);return cb({ok:true});}
      if(d?.type==='addAI'&&host&&!r.game){if(r.players.length>=2)error='두 자리가 모두 찼어요.';else addAI(r);}
      else if(d?.type==='kick'&&host&&!r.game){const target=r.players.find(a=>a.id===d.id);if(target&&target.id!==s.data.playerId){if(target.socket){const old=ns.sockets.get(target.socket);if(old){old.leave(r.code);old.data.playerId=null;old.emit('closed','대기실에서 나왔습니다.');}}r.players=r.players.filter(a=>a!==target);}else error='이 플레이어는 내보낼 수 없어요.';}
      else if(d?.type==='swap'&&host&&!r.game&&r.players.length===2){r.players.reverse();}
      else if(d?.type==='pause'&&host&&r.game?.status==='playing'){r.paused=!r.paused;if(r.paused){clearTimeout(timers.get(r.code));timers.delete(r.code);}}
      else if(d?.type==='aiLevel'&&host&&!r.game){const target=r.players.find(a=>a.id===d.id&&a.ai);if(!target||!['easy','hard'].includes(d.level))error='AI와 난이도를 다시 선택해 주세요.';else target.aiLevel=d.level;}
      else if(d?.type==='timer'&&host&&!r.game){r.turnLimit=(r.turnLimit??TURN_LIMIT)?0:TURN_LIMIT;}
      else if(d?.type==='gender'&&!r.game){const target=r.players.find(a=>a.id===(d.id||p?.id));if(!['boy','girl'].includes(d.gender)||!target||!(target===p||(host&&target.ai)))error='내 캐릭터만 바꿀 수 있어요.';else target.gender=d.gender;}
      else if(d?.type==='ready'&&p&&!r.game){p.ready=!p.ready;}
      else if(d?.type==='name'&&p&&!r.game){p.name=clean(d.name);}
      else if(d?.type==='start'&&host&&!r.game){if(r.players.length!==2||r.players.some(a=>!a.ready||(!a.ai&&!a.socket)))error='두 명이 모두 준비하면 시작할 수 있어요.';else r.game=Q.create(r.players.map(({id,name,gender,ai,aiLevel})=>({id,name,gender,ai:!!ai,...(ai?{aiLevel:aiLevel||'easy'}:{})})));}
      else if(d?.type==='reset'&&(host||(p&&r.game?.status==='won'))){cancel(r);r.game=null;r.paused=false;r.players.forEach(a=>a.ready=!!a.ai||r.solo);}
      else if(p&&r.game&&r.paused)error='선생님이 잠깐 멈췄어요. 다시 시작하면 이어서 해요.';
      else if(p&&r.game){const i=r.game.players.findIndex(a=>a.id===p.id);error=Q.action(r.game,i,d);}
      else error='지금 할 수 없는 행동이에요.';
      cb({ok:!error,error});publish(r);
    });
    s.on('disconnect',()=>{const r=rooms.get(s.data.code);if(!r)return;if(r.host===s.id)r.host=null;const p=r.players.find(p=>p.socket===s.id);if(p)p.socket=null;publish(r);});
  });
  const timer=setInterval(()=>{for(const [code,r] of rooms)if(!r.host&&r.players.every(p=>p.ai||!p.socket)&&Date.now()-r.touched>3600000){cancel(r);rooms.delete(code);}},60000);timer.unref();
  return rooms;
}
module.exports={attach};
