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
    // 리젠구역: 우리 팀만 체력이 회복되는 곳
    const zw = world.SPAWN_ZONE_W;
    ctx.fillStyle = 'rgba(255,77,94,0.12)';
    ctx.fillRect(0, 0, zw, world.H);
    ctx.fillStyle = 'rgba(61,139,255,0.12)';
    ctx.fillRect(world.W - zw, 0, zw, world.H);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(zw, 0);
    ctx.lineTo(zw, world.H);
    ctx.moveTo(world.W - zw, 0);
    ctx.lineTo(world.W - zw, world.H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (const y of [world.H * 0.25, world.H * 0.75]) {
      ctx.fillText('✚ 회복', zw / 2, y);
      ctx.fillText('✚ 회복', world.W - zw / 2, y);
    }
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
    // 리젠구역에서 회복 중: 초록 십자가 위로 떠오른다
    if (p.hl) {
      const t = (now / 700) % 1;
      ctx.globalAlpha *= 1 - t;
      ctx.fillStyle = '#4cdb6a';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✚', d.x + R, d.y - R * 0.3 - t * 26);
      ctx.globalAlpha /= Math.max(0.01, 1 - t);
    }
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

  // 한 화면(캔버스)의 장면: 서버 상태를 모아 두었다가 delay만큼 늦게, 사이를 이어서 부드럽게 보여 준다.
  // 서버 소식이 들쭉날쭉 도착해도 끊기지 않게 하는 방법(보간)이다.
  // minDelay: 연결이 아주 좋을 때 기다리는 시간(ms). 소식이 들쭉날쭉하면 그만큼 자동으로 늘린다
  function createScene(minDelay = 100) {
    const MAX_DELAY = 450;
    const EXTRAPOLATE_MS = 250; // 소식이 끊겨도 이만큼은 가던 방향으로 계속 움직인다
    const buffer = []; // 서버 시각(st) 순서의 상태들
    let offset = null; // 서버 시각 - 내 시각 (가장 빨리 도착한 소식 기준)
    let delay = minDelay; // 지금 기다리는 시간
    let targetDelay = minDelay;
    const lateness = []; // 최근 소식들이 가장 빠른 소식보다 얼마나 늦었는지(ms)
    const shown = new Map(); // 화면에 그린 위치 (갑자기 튀지 않도록 한 번 더 부드럽게)
    let lastUpdate = 0;
    let current = null; // 지금 그릴 상태
    let pendingFx = [];
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

    // 효과도 화면과 같은 만큼 늦게 보여 줘야 총알이 닿는 순간과 맞는다
    function fx(ev) {
      pendingFx.push({ ev, t: performance.now() + delay });
    }

    function playFx(ev) {
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
      buffer.length = 0;
      lateness.length = 0;
      shown.clear();
      delay = targetDelay = minDelay;
      offset = null;
      current = null;
      pendingFx = [];
      particles = [];
      floaters = [];
      waves = [];
    }

    function push(snap) {
      const now = performance.now();
      const sample = snap.st - now;
      // 늦게 온 소식은 기준을 끌어내리지 않고, 기준은 아주 천천히만 낮춘다
      offset = offset === null ? sample : Math.max(sample, offset - 1);
      lateness.push(offset - sample);
      if (lateness.length > 60) lateness.shift();
      // 소식 간격 + 늦게 오는 정도(상위 10%)만큼 기다리면 대부분 끊기지 않는다
      const sorted = [...lateness].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      const prev = buffer[buffer.length - 1];
      const gap = prev ? Math.min(200, snap.st - prev.st) : 66;
      targetDelay = Math.max(minDelay, Math.min(MAX_DELAY, gap * 1.3 + p90));
      buffer.push(snap);
      while (buffer.length > 2 && buffer[1].st < snap.st - 1500) buffer.shift();
    }

    // 다른 캐릭터를 부드럽게 따라가게 한다. 부활처럼 멀리 바뀐 경우만 바로 옮긴다
    function follow(players, dt) {
      const k = Math.min(1, dt * 15);
      const seen = new Set();
      const out = players.map((p) => {
        seen.add(p.id);
        let d = shown.get(p.id);
        if (!d || Math.hypot(d.x - p.x, d.y - p.y) > 250) {
          d = { x: p.x, y: p.y };
          shown.set(p.id, d);
        } else {
          d.x += (p.x - d.x) * k;
          d.y += (p.y - d.y) * k;
        }
        return { ...p, x: d.x, y: d.y };
      });
      for (const id of shown.keys()) if (!seen.has(id)) shown.delete(id);
      return out;
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    // 지금 그릴 상태를 만든다: 두 서버 상태 사이를 시간 비율로 섞는다
    function update(now) {
      if (!buffer.length) return null;
      const dt = lastUpdate ? Math.min(0.1, (now - lastUpdate) / 1000) : 0;
      lastUpdate = now;
      delay += (targetDelay - delay) * Math.min(1, dt * 2); // 기다리는 시간은 천천히 바꾼다
      const rt = now + offset - delay;
      let i = buffer.length - 1;
      while (i > 0 && buffer[i].st > rt) i--;
      let s0 = buffer[i];
      let s1 = buffer[i + 1];
      if (s0.st > rt) s1 = null;
      // 다음 소식이 아직 안 왔으면: 마지막 두 소식의 움직임으로 조금 더 앞을 내다본다
      let extrapolate = false;
      if (!s1 && i > 0) {
        s1 = s0;
        s0 = buffer[i - 1];
        extrapolate = true;
      }
      if (!s1) {
        current = { ...s0, players: follow(s0.players, dt) };
        return current;
      }
      const span = s1.st - s0.st || 1;
      const ahead = extrapolate ? Math.min(rt, s1.st + EXTRAPOLATE_MS) : rt;
      const t = Math.max(0, extrapolate ? (ahead - s0.st) / span : Math.min(1, (rt - s0.st) / span));
      // 앞을 내다볼 때는 최신 소식(s1)의 정보(체력 등)를 쓰고 위치만 이어서 계산한다
      const base = extrapolate ? s1 : s0;
      const other = extrapolate ? s0 : s1;
      const mix = (a, b) => (extrapolate ? lerp(b, a, t) : lerp(a, b, t)); // a: base, b: other
      const otherP = new Map(other.players.map((p) => [p.id, p]));
      const players = base.players.map((p) => {
        const q = otherP.get(p.id);
        if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 200) return p; // 부활처럼 순간이동한 경우는 섞지 않음
        return { ...p, x: mix(p.x, q.x), y: mix(p.y, q.y) };
      });
      const otherB = new Map(other.bullets.map((b) => [b[0], b]));
      const bullets = base.bullets.map((b) => {
        const q = otherB.get(b[0]);
        return q ? [b[0], mix(b[1], q[1]), mix(b[2], q[2]), b[3]] : b;
      });
      current = { ...base, players: follow(players, dt), bullets };
      return current;
    }

    // opts.meId: 내 캐릭터 강조, opts.myTeam: 부시에 숨은 우리 팀은 반투명으로 보여줌,
    // opts.me: 폰이 미리 움직여 둔 내 위치·방향 {x, y, fx, fy}
    function draw(ctx, world, dt, now, opts = {}) {
      drawMap(ctx, world);
      if (!current) return;
      const snap = current;
      const at = (p) => (opts.me && p.id === opts.meId ? opts.me : p);

      const me = opts.meId && snap.players.find((p) => p.id === opts.meId);
      if (me && me.al) {
        const d = at(me);
        ctx.strokeStyle = 'rgba(255,216,77,0.45)';
        ctx.lineWidth = 6;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(d.x + d.fx * 30, d.y + d.fy * 30);
        ctx.lineTo(d.x + d.fx * 140, d.y + d.fy * 140);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 총알 (그림자 흐림 효과는 폰에서 무거워서 반투명 원 두 개로 빛을 흉내 낸다)
      for (const [, x, y, team] of snap.bullets) {
        ctx.fillStyle = team === 0 ? 'rgba(255,77,94,0.35)' : 'rgba(61,139,255,0.35)';
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = team === 0 ? '#ffb3ba' : '#b3d1ff';
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const p of snap.players) {
        if (!p.al) continue;
        if (p.hid && p.t !== opts.myTeam) continue; // 숨은 적(큰 화면에선 숨은 모두)은 안 그림
        const d = at(p);
        ctx.globalAlpha = !p.c ? 0.35 : p.hid ? 0.45 : p.ib ? 0.75 : 1;
        drawPlayer(ctx, world, d === p ? p : { ...p, fx: d.fx, fy: d.fy }, d, now, p.id === opts.meId);
        ctx.globalAlpha = 1;
      }

      const ready = pendingFx.filter((f) => f.t <= now);
      if (ready.length) {
        pendingFx = pendingFx.filter((f) => f.t > now);
        for (const f of ready) playFx(f.ev);
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

    return { fx, reset, push, update, draw };
  }

  return { TEAM_COLOR, createScene };
})();
