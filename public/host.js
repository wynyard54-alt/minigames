(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const TEAM_COLOR = { red: '#ff4d5e', blue: '#3d8bff' };
  const TEAM_NAME = { red: '빨강팀', blue: '파랑팀' };

  let room = null; // { code, hostKey }
  let lobby = null;
  let world = null;

  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // ---------- 방 만들기 / 복구 ----------
  function saveRoom() {
    try {
      sessionStorage.setItem('mg:host', JSON.stringify(room));
    } catch {}
  }

  function loadRoom() {
    try {
      return JSON.parse(sessionStorage.getItem('mg:host'));
    } catch {
      return null;
    }
  }

  $('createBtn').onclick = () => {
    socket.emit('host:create', null, (res) => {
      room = res;
      saveRoom();
      enterLobby();
    });
  };

  socket.on('connect', () => {
    const saved = room || loadRoom();
    if (!saved) return;
    socket.emit('host:resume', saved, (res) => {
      if (res.ok) {
        room = saved;
        if (res.world) world = res.world;
        if (!lobby || lobby.state !== 'game') enterLobby();
      } else {
        room = null;
        try {
          sessionStorage.removeItem('mg:host');
        } catch {}
        show('home');
      }
    });
  });

  async function joinUrl() {
    let base = location.origin;
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    if (local) {
      try {
        const info = await (await fetch('/api/lan')).json();
        if (info.ips.length) {
          base = `http://${info.ips[0]}:${location.port || info.port}`;
          $('lanWarn').textContent = '학생 폰이 이 컴퓨터와 같은 와이파이에 연결되어 있어야 해요.';
          $('lanWarn').classList.remove('hidden');
        }
      } catch {}
    }
    return `${base}/play.html?room=${room.code}`;
  }

  async function enterLobby() {
    $('roomCode').textContent = room.code;
    $('cornerCode').textContent = room.code;
    const url = await joinUrl();
    $('joinUrl').textContent = url.replace(/^https?:\/\//, '');
    $('qr').src = '/api/qr?text=' + encodeURIComponent(url);
    if (!lobby || lobby.state === 'lobby') show('lobby');
  }

  // ---------- 대기실 ----------
  socket.on('lobby', (data) => {
    lobby = data;
    renderLobby();
    if (data.state === 'lobby') show('lobby');
    if (data.state === 'result' && data.result && $('result').classList.contains('hidden') && $('game').classList.contains('hidden')) {
      renderResult(data.result);
      show('result');
    }
  });

  function renderLobby() {
    const players = lobby.players;
    for (const team of ['red', 'blue']) {
      const list = players.filter((p) => p.team === team);
      $(team + 'Count').textContent = list.length + '명';
      $(team + 'List').innerHTML = list
        .map(
          (p) =>
            `<li data-id="${p.id}" class="${p.ready ? 'ready' : ''} ${p.connected ? '' : 'off'}">` +
            `<span class="pname">${esc(p.name)}</span>` +
            `<span class="badge">${p.connected ? (p.ready ? '준비 완료' : '대기') : '연결 끊김'}</span></li>`
        )
        .join('');
    }
    const ready = players.filter((p) => p.ready).length;
    const total = players.length;
    $('startBtn').disabled = total === 0;
    $('readyInfo').textContent = total === 0 ? '학생을 기다리는 중…' : `준비 완료 ${ready} / ${total}명`;
    $('startBtn').textContent = total > 0 && ready === total ? '게임 시작!' : '게임 시작';
    $('startBtn').classList.toggle('pulse', total > 0 && ready === total);
  }

  for (const team of ['red', 'blue']) {
    $(team + 'List').onclick = (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const name = li.querySelector('.pname').textContent;
      if (confirm(`${name} 학생을 내보낼까요?`)) socket.emit('host:kick', li.dataset.id);
    };
  }

  $('shuffleBtn').onclick = () => socket.emit('host:shuffle');

  function startGame() {
    const players = lobby ? lobby.players : [];
    const notReady = players.filter((p) => !p.ready).length;
    if (notReady > 0 && !confirm(`아직 준비 안 한 학생이 ${notReady}명 있어요. 그래도 시작할까요?`)) return;
    const red = players.filter((p) => p.team === 'red').length;
    const blue = players.filter((p) => p.team === 'blue').length;
    if ((red === 0 || blue === 0) && !confirm('한 팀에 아무도 없어요. 그래도 시작할까요?')) return;
    socket.emit('host:start');
  }

  $('startBtn').onclick = startGame;
  $('againBtn').onclick = () => socket.emit('host:start');
  $('lobbyBtn').onclick = () => socket.emit('host:lobby');
  $('stopBtn').onclick = () => {
    if (confirm('경기를 지금 끝낼까요?')) socket.emit('host:stop');
  };

  // ---------- 게임 화면 ----------
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  let snap = null;
  const disp = new Map(); // 부드럽게 보이도록 보간한 위치
  const bulletDisp = new Map();
  let particles = [];
  let floaters = [];
  let waves = [];

  socket.on('game:start', (data) => {
    world = data.world;
    snap = null;
    disp.clear();
    bulletDisp.clear();
    particles = [];
    floaters = [];
    waves = [];
    $('feed').innerHTML = '';
    show('game');
    resize();
  });

  socket.on('state', (s) => {
    if (lobby && lobby.state !== 'game') return; // 경기 종료 직후 늦게 도착한 패킷 무시
    snap = s;
    if ($('game').classList.contains('hidden')) {
      show('game'); // 경기 중에 새로고침한 경우
      resize();
    }
  });

  socket.on('fx', (ev) => {
    if (ev.type === 'hit') burst(ev.x, ev.y, TEAM_COLOR[ev.team], 6, 120);
    if (ev.type === 'super') {
      waves.push({ x: ev.x, y: ev.y, r: ev.r, color: TEAM_COLOR[ev.team], life: 0.5 });
      burst(ev.x, ev.y, '#c58cff', 30, 380);
    }
    if (ev.type === 'kill') {
      burst(ev.x, ev.y, '#ffd84d', 22, 260);
      floaters.push({ x: ev.x, y: ev.y, text: 'KO!', life: 1 });
    }
  });

  socket.on('game:over', (result) => {
    renderResult(result);
    show('result');
  });

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, color });
    }
  }

  let scale = 1;
  let ox = 0;
  let oy = 0;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    if (!world) return;
    const top = 70; // HUD 공간
    scale = Math.min(innerWidth / world.W, (innerHeight - top - 10) / world.H) * dpr;
    ox = (canvas.width - world.W * scale) / 2;
    oy = top * dpr + (canvas.height - top * dpr - world.H * scale) / 2;
  }
  addEventListener('resize', resize);

  function fmtTime(t) {
    const s = Math.ceil(t);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 풀숲: 둥근 잎 덩어리를 겹쳐서 그린다 (위치마다 모양이 고정되도록 좌표로 무늬 결정)
  function drawBush(b) {
    ctx.fillStyle = '#1f6b3a';
    roundRect(b.x, b.y, b.w, b.h, 18);
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

  let lastFrame = performance.now();
  let lastFeedKey = '';
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    requestAnimationFrame(frame);
    if (!snap || !world || document.getElementById('game').classList.contains('hidden')) return;

    // HUD
    renderBoard(now);
    $('scoreRed').textContent = snap.score.red;
    $('scoreBlue').textContent = snap.score.blue;
    $('timer').textContent = snap.phase === 'countdown' ? '준비' : fmtTime(snap.timer);
    $('timer').classList.toggle('urgent', snap.phase === 'playing' && snap.timer <= 10);
    const cd = $('countdown');
    if (snap.phase === 'countdown') {
      cd.textContent = Math.ceil(snap.timer);
      cd.classList.remove('hidden');
    } else {
      cd.classList.add('hidden');
    }
    const feedKey = snap.feed.map((f) => f.t).join(',');
    if (feedKey !== lastFeedKey) {
      lastFeedKey = feedKey;
      $('feed').innerHTML = snap.feed
        .slice(-5)
        .reverse()
        .map(
          (f) =>
            `<li><b style="color:${TEAM_COLOR[f.killerTeam] || '#fff'}">${esc(f.killer)}</b> ➜ ` +
            `<b style="color:${TEAM_COLOR[f.victimTeam]}">${esc(f.victim)}</b></li>`
        )
        .join('');
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);

    // 바닥
    ctx.fillStyle = '#1d2338';
    ctx.fillRect(0, 0, world.W, world.H);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= world.W; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world.H);
      ctx.stroke();
    }
    for (let y = 0; y <= world.H; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(world.W, y);
      ctx.stroke();
    }
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

    // 벽
    for (const w of world.walls) {
      ctx.fillStyle = '#0a0d18';
      roundRect(w.x + 4, w.y + 8, w.w, w.h, 8);
      ctx.fill();
      ctx.fillStyle = '#5b4a8a';
      roundRect(w.x, w.y, w.w, w.h, 8);
      ctx.fill();
      ctx.fillStyle = '#7b68b5';
      roundRect(w.x, w.y, w.w, Math.min(14, w.h), 6);
      ctx.fill();
    }

    // 부시
    for (const b of world.bushes) drawBush(b);

    // 플레이어 위치 보간
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

    // 조준선
    for (const p of snap.players) {
      if (!p.al || !p.aim) continue;
      const d = disp.get(p.id);
      ctx.strokeStyle = p.t === 'red' ? 'rgba(255,77,94,0.45)' : 'rgba(61,139,255,0.45)';
      ctx.lineWidth = 8;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + p.fx * world.BULLET_RANGE, d.y + p.fy * world.BULLET_RANGE);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 총알
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

    // 플레이어
    const R = world.PLAYER_R;
    for (const p of snap.players) {
      if (!p.al || p.hid) continue; // 부시에 숨은 플레이어는 큰 화면에 그리지 않음
      const d = disp.get(p.id);
      ctx.globalAlpha = !p.c ? 0.35 : p.ib ? 0.75 : 1;
      // 필살기 준비 완료: 보라색으로 빛나는 테두리
      if (p.sr) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 150);
        ctx.strokeStyle = `rgba(197,140,255,${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(d.x, d.y, R + 10 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 그림자
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + R * 0.8, R, R * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      // 몸
      ctx.fillStyle = p.hf ? '#ffffff' : TEAM_COLOR[p.t];
      ctx.beginPath();
      ctx.arc(d.x, d.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
      // 총구 방향
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(d.x + p.fx * (R - 2), d.y + p.fy * (R - 2), 8, 0, Math.PI * 2);
      ctx.fill();
      // 눈
      const ex = p.fx * 7;
      const ey = p.fy * 7;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(d.x + ex - p.fy * 7, d.y + ey + p.fx * 7, 5, 0, Math.PI * 2);
      ctx.arc(d.x + ex + p.fy * 7, d.y + ey - p.fx * 7, 5, 0, Math.PI * 2);
      ctx.fill();
      // 보호막
      if (p.sh) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(d.x, d.y, R + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 이름
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(p.n, d.x, d.y - R - 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.n, d.x, d.y - R - 22);
      // 체력바
      const bw = 56;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(d.x - bw / 2, d.y - R - 16, bw, 8);
      ctx.fillStyle = p.hp > 50 ? '#4cdb6a' : p.hp > 25 ? '#ffc93c' : '#ff5555';
      ctx.fillRect(d.x - bw / 2, d.y - R - 16, (bw * p.hp) / world.MAX_HP, 8);
      // 탄약
      for (let i = 0; i < world.AMMO_MAX; i++) {
        ctx.fillStyle = i < p.am ? '#ffd84d' : 'rgba(255,255,255,0.15)';
        ctx.fillRect(d.x - bw / 2 + i * (bw / world.AMMO_MAX) + 1, d.y + R + 8, bw / world.AMMO_MAX - 3, 5);
      }
      ctx.globalAlpha = 1;
    }

    // 쓰러진 플레이어: 스폰 지점에 부활 카운트
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const deadByTeam = { red: [], blue: [] };
    for (const p of snap.players) if (!p.al) deadByTeam[p.t].push(p);
    for (const team of ['red', 'blue']) {
      deadByTeam[team].forEach((p, i) => {
        const x = team === 'red' ? 110 : world.W - 110;
        const y = world.H - 20 - i * 26; // 위쪽은 킬 로그와 겹치므로 아래에서부터
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(`💀 ${p.n} ${p.rs}`, x, y);
      });
    }

    // 효과
    waves = waves.filter((w) => (w.life -= dt) > 0);
    for (const w of waves) {
      const t = 1 - w.life / 0.5;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = w.color;
      ctx.globalAlpha = (1 - t) * 0.25;
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
  requestAnimationFrame(frame);

  // ---------- 전광판 (킬/데스/어시스트) ----------
  let boardOpen = false;
  try {
    boardOpen = localStorage.getItem('mg:board') === '1';
  } catch {}
  function setBoard(open) {
    boardOpen = open;
    $('livePanel').classList.toggle('hidden', !open);
    $('boardBtn').textContent = open ? '전광판 ▴' : '전광판 ▾';
    $('boardBtn').setAttribute('aria-expanded', String(open));
    try {
      localStorage.setItem('mg:board', open ? '1' : '0');
    } catch {}
    lastBoardAt = 0;
  }
  $('boardBtn').onclick = () => setBoard(!boardOpen);
  addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !$('game').classList.contains('hidden')) {
      e.preventDefault();
      setBoard(!boardOpen);
    }
  });
  let lastBoardAt = 0;
  function renderBoard(now) {
    if (!boardOpen || now - lastBoardAt < 250) return;
    lastBoardAt = now;
    for (const team of ['red', 'blue']) {
      const rows = snap.players
        .filter((p) => p.t === team)
        .sort((a, b) => b.pt - a.pt || b.k - a.k || b.as - a.as || a.d - b.d);
      $(team === 'red' ? 'lbRed' : 'lbBlue').innerHTML = rows
        .map((p) => `<div class="lb-row${p.al ? '' : ' dead'}"><span>${esc(p.n)}</span><span>${p.k}</span><span>${p.d}</span><span>${p.as}</span><b>${p.pt}</b></div>`)
        .join('');
    }
  }
  setBoard(boardOpen);

  // ---------- 결과 ----------
  function renderResult(r) {
    const w = $('winner');
    if (r.winner === 'draw') {
      w.textContent = '무승부!';
      w.style.color = '#fff';
    } else {
      w.textContent = `${TEAM_NAME[r.winner]} 승리!`;
      w.style.color = TEAM_COLOR[r.winner];
    }
    $('finalScore').innerHTML =
      `<span style="color:${TEAM_COLOR.red}">${r.score.red}</span> : <span style="color:${TEAM_COLOR.blue}">${r.score.blue}</span>`;
    const top = r.players[0];
    $('mvp').innerHTML = top && top.points > 0 ? `MVP 🏆 <b style="color:${TEAM_COLOR[top.team]}">${esc(top.name)}</b> (${top.points}점)` : '';
    $('board').innerHTML =
      '<tr><th>순위</th><th>이름</th><th>팀</th><th>킬</th><th>데스</th><th>어시</th><th>점수</th></tr>' +
      r.players
        .slice(0, 10)
        .map(
          (p, i) =>
            `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td style="color:${TEAM_COLOR[p.team]}">${TEAM_NAME[p.team]}</td>` +
            `<td>${p.kills}</td><td>${p.deaths}</td><td>${p.assists}</td><td><b>${p.points}</b></td></tr>`
        )
        .join('');
  }

  if (!loadRoom()) show('home');
})();
