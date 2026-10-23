/* 쿼리도 공용 판정: 브라우저는 미리보기, 서버가 실제 행동을 확정한다. */
(function(root){
  const inside=(r,c)=>Number.isInteger(r)&&Number.isInteger(c)&&r>=0&&r<9&&c>=0&&c<9;
  const same=(a,b)=>a.r===b.r&&a.c===b.c;
  function blocked(s,a,b){
    if(!inside(b.r,b.c)||Math.abs(a.r-b.r)+Math.abs(a.c-b.c)!==1)return true;
    return s.walls.some(w=>a.r!==b.r
      ?w.o==='h'&&w.r===Math.min(a.r,b.r)&&(a.c===w.c||a.c===w.c+1)
      :w.o==='v'&&w.c===Math.min(a.c,b.c)&&(a.r===w.r||a.r===w.r+1));
  }
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  function moves(s,i){
    const p=s.players[i],other=s.players[1-i],out=[];
    for(const [dr,dc] of dirs){
      const a={r:p.r+dr,c:p.c+dc};if(blocked(s,p,a))continue;
      if(!same(a,other)){out.push({...a,jump:false});continue;}
      const behind={r:a.r+dr,c:a.c+dc};
      if(!blocked(s,a,behind)){out.push({...behind,jump:true,via:{r:a.r,c:a.c}});continue;}
      for(const [yr,xc] of [[dc,dr],[-dc,-dr]]){
        const side={r:a.r+yr,c:a.c+xc};
        if(!blocked(s,a,side))out.push({...side,jump:true,via:{r:a.r,c:a.c}});
      }
    }
    return out.filter((m,k)=>out.findIndex(n=>same(m,n))===k);
  }
  function distance(s,i,start=s.players[i]){
    const goal=i===0?0:8,q=[{...start,d:0}],seen=new Set([start.r*9+start.c]);
    while(q.length){const a=q.shift();if(a.r===goal)return a.d;
      for(const [dr,dc] of dirs){const b={r:a.r+dr,c:a.c+dc};const key=b.r*9+b.c;
        if(!blocked(s,a,b)&&!seen.has(key)){seen.add(key);q.push({...b,d:a.d+1});}
      }
    }return Infinity;
  }
  function wallError(s,w){
    if(!w||!['h','v'].includes(w.o)||!Number.isInteger(w.r)||!Number.isInteger(w.c)||w.r<0||w.r>7||w.c<0||w.c>7)return '벽은 두 칸 사이의 틈에 놓아 주세요.';
    if(s.walls.some(a=>a.o===w.o?(a.o==='h'?a.r===w.r&&Math.abs(a.c-w.c)<=1:a.c===w.c&&Math.abs(a.r-w.r)<=1):a.r===w.r&&a.c===w.c))return '다른 벽과 겹치거나 교차할 수 없어요.';
    const view={...s,walls:[...s.walls,w]};
    if(!Number.isFinite(distance(view,0))||!Number.isFinite(distance(view,1)))return '두 진영 모두 도착할 길이 남아 있어야 해요.';
    return '';
  }
  function create(players,first=0){return {players:players.map((p,i)=>({...p,r:i===0?8:0,c:4,remaining:10})),walls:[],turn:first,status:'playing',winner:null,revision:0,lastAction:null};}
  function action(s,i,req){
    if(s.status!=='playing'||s.turn!==i)return '지금은 내 차례가 아니에요.';
    if(!req||typeof req!=='object')return '행동을 다시 선택해 주세요.';
    const p=s.players[i];let last;
    if(req.type==='move'){
      const move=moves(s,i).find(m=>m.r===req.r&&m.c===req.c);if(!move)return '그 칸으로 이동할 수 없어요.';
      last={kind:'move',side:i,from:{r:p.r,c:p.c},to:{r:move.r,c:move.c},jump:move.jump,via:move.via||null};p.r=move.r;p.c=move.c;
      if(p.r===(i===0?0:8)){s.status='won';s.winner=i;}
    }else if(req.type==='wall'){
      if(p.remaining<=0)return '남은 벽이 없어요.';
      const error=wallError(s,req.wall);if(error)return error;
      const w={o:req.wall.o,r:req.wall.r,c:req.wall.c};s.walls.push(w);p.remaining--;last={kind:'wall',side:i,wall:w};
    }else return '알 수 없는 행동이에요.';
    s.revision++;s.lastAction={...last,id:s.revision};if(s.status==='playing')s.turn=1-i;return '';
  }
  // 벽으로 늘어나는 거리와 내 이동 이득을 비교하는 가벼운 서버 AI.
  function chooseAI(s){
    if(s.status!=='playing')return null;const i=s.turn,j=1-i,goal=i===0?0:8,options=moves(s,i);
    const win=options.find(m=>m.r===goal);if(win)return {type:'move',r:win.r,c:win.c};
    const evaluate=view=>distance(view,j)-distance(view,i)-(moves(view,j).some(m=>m.r===(j===0?0:8))?1000:0);
    let best=null,score=-Infinity;
    for(const m of options){const v={...s,players:s.players.map((p,k)=>k===i?{...p,r:m.r,c:m.c}:p)};const n=evaluate(v);
      if(n>score){score=n;best={type:'move',r:m.r,c:m.c};}}
    if(s.players[i].remaining>0)for(const o of ['h','v'])for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      const w={o,r,c};if(wallError(s,w))continue;const n=evaluate({...s,walls:[...s.walls,w]})-.4;
      if(n>score+.01){score=n;best={type:'wall',wall:w};}
    }return best;
  }
  const api={inside,blocked,moves,distance,wallError,create,action,chooseAI};
  if(typeof module!=='undefined')module.exports=api;else root.Quoridor=api;
})(typeof window==='undefined'?globalThis:window);
