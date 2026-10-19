// 게임 화면 그리기: 선생님 화면(전체 맵)과 학생 폰(내 캐릭터 중심)이 같이 쓴다.
window.GameRender = (() => {
  const TEAM_COLOR = { red: '#ff4d5e', blue: '#3d8bff' };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 풀숲: 둥근 잎 덩어리를 겹쳐서 그린다 (위치마다 모양이 고정되도록 좌표로 무늬 결정)
  function drawBush(ctx, b) {
    ctx.fillStyle = '#1f6b3a';
    roundRect(ctx, b.x, b.y, b.w, b.h, 18);
    ctx.fill();
    const step = 34;
    for (let y = b.y + 14; y < b.y + b.h; y += step * 0.8) {
      for (let x = b.x + 14; x < b.x + b.w; x += step) {
        const k = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const jitter = (k - Math.floor(k)) * 8;
        ctx.fillStyle = (Math.floor(x + y) / step) % 2 < 1 ? '#2e8b4e' : '#38a35c';
        ctx.beginPath();
        ctx.arc(x + jitter, y, 18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawMap(ctx, world) {
    ctx.fillStyle = '#1d2338';
    ctx.fillRect(0, 0, world.W, world.H);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= world.W; x += 50) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world.H);
    }
    for (let y = 0; y <= world.H; y += 50) {
      ctx.moveTo(0, y);
      ctx.lineTo(world.W, y);
    }
    ctx.stroke();
    // 스폰 구역
    ctx.fillStyle = 'rgba(255,77,94,0.10)';
    ctx.fillRect(0, 0, 220, world.H);
    ctx.fillStyle = 'rgba(61,139,255,0.10)';
    ctx.fillRect(world.W - 220, 0, 220, world.H);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.setLineDash([16, 16]);
    ctx.beginPath();
    ctx.moveTo(world.W / 2, 0);
    ctx.lineTo(world.W / 2, world.H);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const w of world.walls) {
      ctx.fillStyle = '#0a0d18';
      roundRect(ctx, w.x + 4, w.y + 8, w.w, w.h, 8);
      ctx.fill();
      ctx.fillStyle = '#5b4a8a';
      roundRect(ctx, w.x, w.y, w.w, w.h, 8);
      ctx.fill();
      ctx.fillStyle = '#7b68b5';
      roundRect(ctx, w.x, w.y, w.w, Math.min(14, w.h), 6);
      ctx.fill();
    }
    for (const b of world.bushes) drawBush(ctx, b);
  }

  function drawPlayer(ctx, world, p, d, now, isMe) {
    const R = world.PLAYER_R;
    // 필살기 준비 완료: 보라색으로 빛나는 테두리
    if (p.sr) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 150);
      ctx.strokeStyle = `rgba(197,140,255,${0.5 + pulse * 0.5})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, R + 10 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + R * 0.8, R, R * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.hf ? '#ffffff' : TEAM_COLOR[p.t];
    ctx.beginPath();
    ctx.arc(d.x, d.y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = isMe ? 5 : 4;
    ctx.strokeStyle = isMe ? '#ffd84d' : 'rgba(0,0,0,0.35)';
    ctx.stroke();
    // 총구 방향과 눈
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(d.x + p.fx * (R - 2), d.y + p.fy * (R - 2), 8, 0, Math.PI * 2);
    ctx.fill();
    const ex = p.fx * 7;
    const ey = p.fy * 7;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(d.x + ex - p.fy * 7, d.y + ey + p.fx * 7, 5, 0, Math.PI * 2);
    ctx.arc(d.x + ex + p.fy * 7, d.y + ey - p.fx * 7, 5, 0, Math.PI * 2);
    ctx.fill();
    if (p.sh) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(d.x, d.y, R + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(p.n, d.x, d.y - R - 22);
    ctx.fillStyle = isMe ? '#ffd84d' : '#fff';
    ctx.fillText(p.n, d.x, d.y - R - 22);
    const bw = 56;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(d.x - bw / 2, d.y - R - 16, bw, 8);
    ctx.fillStyle = p.hp > 50 ? '#4cdb6a' : p.hp > 25 ? '#ffc93c' : '#ff5555';
    ctx.fillRect(d.x - bw / 2, d.y - R - 16, (bw * p.hp) / world.MAX_HP, 8);
    for (let i = 0; i < world.AMMO_MAX; i++) {
      ctx.fillStyle = i < p.am ? '#ffd84d' : 'rgba(255,255,255,0.15)';
      ctx.fillRect(d.x - bw / 2 + i * (bw / world.AMMO_MAX) + 1, d.y + R + 8, bw / world.AMMO_MAX - 3, 5);
    }
  }

  // 한 화면(캔버스)의 보간 위치와 효과를 들고 있는 장면
  function createScene() {
    const disp = new Map();
    const bulletDisp = new Map();
    let particles = [];
    let floaters = [];
    let waves = [];

    function burst(x, y, color, n, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random() * 0.6);
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, color });
      }
    }

    function fx(ev) {
      if (ev.type === 'hit') burst(ev.x, ev.y, TEAM_COLOR[ev.team], 6, 120);
      if (ev.type === 'super') {
        waves.push({ x: ev.x, y: ev.y, r: ev.r, color: TEAM_COLOR[ev.team], life: 0.5 });
        burst(ev.x, ev.y, '#c58cff', 30, 380);
      }
      if (ev.type === 'kill') {
        burst(ev.x, ev.y, '#ffd84d', 22, 260);
        floaters.push({ x: ev.x, y: ev.y, text: 'KO!', life: 1 });
      }
    }

    function reset() {
      disp.clear();
      bulletDisp.clear();
      particles = [];
      floaters = [];
      waves = [];
    }

    // 서버 위치를 향해 부드럽게 따라가게 한다. 화면이 따라갈 내 위치도 여기서 얻는다
    function smooth(snap, dt) {
      const k = Math.min(1, dt * 18);
      const seen = new Set();
      for (const p of snap.players) {
        seen.add(p.id);
        let d = disp.get(p.id);
        if (!d || Math.hypot(d.x - p.x, d.y - p.y) > 200) {
          d = { x: p.x, y: p.y };
          disp.set(p.id, d);
        }
        d.x += (p.x - d.x) * k;
        d.y += (p.y - d.y) * k;
      }
      for (const id of disp.keys()) if (!seen.has(id)) disp.delete(id);
    }

    // opts.meId: 내 캐릭터 강조, opts.myTeam: 부시에 숨은 우리 팀은 반투명으로 보여줌
    function draw(ctx, world, snap, dt, now, opts = {}) {
      drawMap(ctx, world);

      const me = opts.meId && snap.players.find((p) => p.id === opts.meId);
      if (me && me.al) {
        const d = disp.get(me.id);
        ctx.strokeStyle = 'rgba(255,216,77,0.45)';
        ctx.lineWidth = 6;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(d.x + me.fx * 30, d.y + me.fy * 30);
        ctx.lineTo(d.x + me.fx * 140, d.y + me.fy * 140);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const bseen = new Set();
      for (const [id, x, y, team] of snap.bullets) {
        bseen.add(id);
        let d = bulletDisp.get(id);
        if (!d) {
          d = { x, y };
          bulletDisp.set(id, d);
        }
        d.x += (x - d.x) * Math.min(1, dt * 30);
        d.y += (y - d.y) * Math.min(1, dt * 30);
        ctx.fillStyle = team === 0 ? '#ffb3ba' : '#b3d1ff';
        ctx.shadowColor = team === 0 ? TEAM_COLOR.red : TEAM_COLOR.blue;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      for (const id of bulletDisp.keys()) if (!bseen.has(id)) bulletDisp.delete(id);

      for (const p of snap.players) {
        if (!p.al) continue;
        if (p.hid && p.t !== opts.myTeam) continue; // 숨은 적(큰 화면에선 숨은 모두)은 안 그림
        const d = disp.get(p.id);
        ctx.globalAlpha = !p.c ? 0.35 : p.hid ? 0.45 : p.ib ? 0.75 : 1;
        drawPlayer(ctx, world, p, d, now, p.id === opts.meId);
        ctx.globalAlpha = 1;
      }

      waves = waves.filter((w) => (w.life -= dt) > 0);
      for (const w of waves) {
        const t = 1 - w.life / 0.5;
        ctx.globalAlpha = (1 - t) * 0.25;
        ctx.fillStyle = w.color;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r * (0.3 + 0.7 * t), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#c58cff';
        ctx.lineWidth = 10;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      particles = particles.filter((q) => (q.life -= dt) > 0);
      for (const q of particles) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vx *= 0.92;
        q.vy *= 0.92;
        ctx.globalAlpha = Math.min(1, q.life * 2);
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      floaters = floaters.filter((f) => (f.life -= dt) > 0);
      ctx.font = 'bold 42px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const f of floaters) {
        ctx.globalAlpha = Math.min(1, f.life * 2);
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#000';
        ctx.strokeText(f.text, f.x, f.y - (1 - f.life) * 60);
        ctx.fillStyle = '#ffd84d';
        ctx.fillText(f.text, f.x, f.y - (1 - f.life) * 60);
      }
      ctx.globalAlpha = 1;
    }

    return { fx, reset, smooth, draw, pos: (id) => disp.get(id) };
  }

  return { TEAM_COLOR, createScene };
})();
