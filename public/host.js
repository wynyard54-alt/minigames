(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const TEAM_COLOR = GameRender.TEAM_COLOR;
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
  const scene = GameRender.createScene();
  let snap = null;

  socket.on('game:start', (data) => {
    world = data.world;
    snap = null;
    scene.reset();
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

  socket.on('fx', (ev) => scene.fx(ev));

  socket.on('game:over', (result) => {
    renderResult(result);
    show('result');
  });

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

  let lastFrame = performance.now();
  let lastFeedKey = '';
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    requestAnimationFrame(frame);
    if (!snap || !world || $('game').classList.contains('hidden')) return;

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
    scene.smooth(snap, dt);
    scene.draw(ctx, world, snap, dt, now); // 큰 화면은 모두가 보므로 부시에 숨은 사람은 안 그림

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
