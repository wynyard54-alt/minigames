(() => {
  const socket = io({ transports: ['websocket', 'polling'] }); // 웹소켓을 먼저 시도 (느린 방식은 막힐 때만)
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

  function createRoom(mode) {
    socket.emit('host:create', { mode }, (res) => {
      room = res;
      saveRoom();
      enterLobby();
    });
  }
  $('createBtn').onclick = () => createRoom('battle');
  $('createArenaBtn').onclick = () => createRoom('arena');

  $('backHomeBtn').onclick = () => {
    if (!room) return;
    if (lobby && lobby.players.some(p => !p.bot) &&
        !confirm('방을 닫고 게임 선택으로 돌아갈까요? 들어온 학생들은 다시 입장해야 해요.')) return;
    const button = $('backHomeBtn');
    button.disabled = true;
    $('backHomeError').textContent = '';
    socket.timeout(5000).emit('host:close', (err, res) => {
      button.disabled = false;
      if (err || !res || !res.ok) {
        $('backHomeError').textContent = '방을 닫지 못했어요. 연결을 확인하고 다시 눌러 주세요.';
        return;
      }
      room = lobby = world = null;
      try { sessionStorage.removeItem('mg:host'); } catch {}
      document.body.classList.remove('mode-arena');
      $('qr').removeAttribute('src');
      show('home');
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

  async function joinUrl(currentRoom) {
    let base = location.origin;
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    if (local) {
      try {
        const info = await (await fetch('/api/lan')).json();
        if (info.ips.length) {
          let saved = null;
          try {
            saved = localStorage.getItem('mg:lan');
          } catch {}
          const ip = info.ips.includes(saved) ? saved : info.ips[0];
          base = `http://${ip}:${location.port || info.port}`;
          showLanPicker(info.list, ip);
        } else {
          $('lanWarn').textContent = '네트워크에 연결되어 있지 않아요. 와이파이나 핫스팟에 연결해 주세요.';
          $('lanWarn').classList.remove('hidden');
        }
      } catch {}
    }
    return `${base}/play.html?room=${currentRoom.code}`;
  }

  // 노트북에 네트워크 장치가 여러 개면(VPN 등) 학생이 접속할 주소를 고를 수 있게 한다
  function showLanPicker(list, current) {
    const warn = $('lanWarn');
    warn.classList.remove('hidden');
    warn.innerHTML = '학생 폰이 이 컴퓨터와 같은 와이파이(또는 핫스팟)에 연결되어 있어야 해요.';
    if (list.length < 2) return;
    const sel = document.createElement('select');
    sel.className = 'lan-pick';
    sel.setAttribute('aria-label', '학생이 접속할 주소');
    for (const x of list) {
      const o = document.createElement('option');
      o.value = x.address;
      o.textContent = `${x.address} (${x.name})`;
      o.selected = x.address === current;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      try {
        localStorage.setItem('mg:lan', sel.value);
      } catch {}
      enterLobby();
    };
    const label = document.createElement('div');
    label.className = 'lan-label';
    label.textContent = 'QR이 안 되면 다른 주소를 골라 보세요:';
    warn.append(label, sel);
  }

  async function enterLobby() {
    const currentRoom = room;
    if (!currentRoom) return;
    $('backHomeError').textContent = '';
    $('roomCode').textContent = room.code;
    $('cornerCode').textContent = room.code;
    const url = await joinUrl(currentRoom);
    if (room !== currentRoom) return;
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
    // 배틀 아레나는 개인전: 팀·AI 버튼을 숨기고 참가자를 한 목록으로 보여 준다
    const arena = lobby.mode === 'arena';
    document.body.classList.toggle('mode-arena', arena);
    $('redTitle').textContent = arena ? '참가자' : '빨강팀';
    for (const team of ['red', 'blue']) {
      const list = arena ? (team === 'red' ? players.filter((p) => !p.bot) : []) : players.filter((p) => p.team === team);
      $(team + 'Count').textContent = arena ? `${list.length}명` : `${list.length} / ${lobby.teamMax}명`;
      $(team + 'List').innerHTML = list
        .map(
          (p) =>
            `<li data-id="${p.id}" class="${p.bot ? 'bot' : p.ready ? 'ready' : ''} ${p.connected ? '' : 'off'}">` +
            `<span class="pname">${esc(p.name)}</span>` +
            `<span class="badge">${p.bot ? '🤖 AI' : p.connected ? (p.ready ? '준비 완료' : '대기') : '연결 끊김'}</span></li>`
        )
        .join('');
    }
    const humans = players.filter((p) => !p.bot);
    const ready = humans.filter((p) => p.ready).length;
    const total = humans.length;
    const bots = players.length - total;
    $('startBtn').disabled = players.length === 0;
    $('readyInfo').textContent =
      (total === 0 ? '학생을 기다리는 중…' : `준비 완료 ${ready} / ${total}명`) + (bots ? ` · AI ${bots}명` : '');
    $('clearBotsBtn').disabled = bots === 0;
    const count = (t) => players.filter((p) => p.team === t).length;
    $('addRedBot').disabled = count('red') >= lobby.teamMax;
    $('addBlueBot').disabled = count('blue') >= lobby.teamMax;
    $('startBtn').textContent = total > 0 && ready === total ? '게임 시작!' : '게임 시작';
    $('startBtn').classList.toggle('pulse', total > 0 && ready === total);
  }

  for (const team of ['red', 'blue']) {
    $(team + 'List').onclick = (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const name = li.querySelector('.pname').textContent;
      if (li.classList.contains('bot') || confirm(`${name} 학생을 내보낼까요?`)) socket.emit('host:kick', li.dataset.id);
    };
  }

  $('shuffleBtn').onclick = () => socket.emit('host:shuffle');
  // AI로 맞출 팀당 인원 (1~8, 마지막에 고른 값 기억)
  let botSize = 4;
  try {
    botSize = Number(localStorage.getItem('mg:botSize')) || 4;
  } catch {}
  function setBotSize(n) {
    const max = (lobby && lobby.teamMax) || 8;
    botSize = Math.max(1, Math.min(max, n));
    $('sizeVal').textContent = botSize;
    $('sizeDown').disabled = botSize <= 1;
    $('sizeUp').disabled = botSize >= max;
    try {
      localStorage.setItem('mg:botSize', String(botSize));
    } catch {}
  }
  setBotSize(botSize);
  $('sizeDown').onclick = () => setBotSize(botSize - 1);
  $('sizeUp').onclick = () => setBotSize(botSize + 1);
  $('fillBotsBtn').onclick = () => socket.emit('host:bots', { action: 'fill', size: botSize });
  $('addRedBot').onclick = () => socket.emit('host:bots', { action: 'add', team: 'red' });
  $('addBlueBot').onclick = () => socket.emit('host:bots', { action: 'add', team: 'blue' });
  $('clearBotsBtn').onclick = () => socket.emit('host:bots', { action: 'clear' });

  function startGame() {
    const players = lobby ? lobby.players : [];
    const notReady = players.filter((p) => !p.ready).length;
    if (notReady > 0 && !confirm(`아직 준비 안 한 학생이 ${notReady}명 있어요. 그래도 시작할까요?`)) return;
    if (lobby && lobby.mode === 'arena') return socket.emit('host:start');
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
  const scene = GameRender.createScene(80); // 큰 화면은 초당 30번 받으므로 0.08초만 늦게 보여 준다
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
    scene.push(s);
    if ($('game').classList.contains('hidden')) {
      show('game'); // 경기 중에 새로고침한 경우
      resize();
    }
  });

  socket.on('fx', (ev) => {
    scene.fx(ev);
    if (ev.type === 'kill') GameSound.play('kill', 0.6, 80);
    if (ev.type === 'super') GameSound.play('boom', 0.7);
  });

  // 큰 화면 소리: 카운트다운, KO, 필살기, 경기 종료만 (총소리는 각자 폰에서)
  for (const ev of ['pointerdown', 'click', 'keydown']) document.addEventListener(ev, () => GameSound.unlock(), true);
  function renderMute() {
    $('muteBtn').textContent = GameSound.isMuted() ? '🔇 소리 꺼짐' : '🔊 소리';
  }
  $('muteBtn').onclick = () => {
    GameSound.setMuted(!GameSound.isMuted());
    renderMute();
  };
  renderMute();
  let lastCd = null;

  socket.on('game:over', (result) => {
    GameSound.play('win');
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
      const n = Math.ceil(snap.timer);
      if (n !== lastCd) GameSound.play('beep');
      lastCd = n;
      cd.textContent = n;
      cd.classList.remove('hidden');
    } else {
      if (lastCd !== null) GameSound.play('go');
      lastCd = null;
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
    scene.update(now);
    scene.draw(ctx, world, dt, now); // 큰 화면은 모두가 보므로 부시에 숨은 사람은 안 그림

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
  // ---------- 배틀 아레나: 실시간 순위표 ----------
  const arenaClock = { endAt: 0, startAt: 0 };
  let arenaCd = null;
  socket.on('arena:start', (a) => {
    const now = performance.now();
    arenaClock.startAt = now + a.startIn;
    arenaClock.endAt = now + Math.max(0, a.startIn) + a.duration;
    $('ahCode').textContent = room ? room.code : '';
    $('ahList').innerHTML = '';
    arenaCd = null;
    show('arenaHost');
  });
  socket.on('arena:board', (b) => {
    if ($('arenaHost').classList.contains('hidden')) return;
    const best = Math.max(1, ...b.players.map((p) => p.score));
    const medal = ['🥇', '🥈', '🥉'];
    $('ahList').innerHTML = b.players
      .map(
        (p, i) =>
          `<li class="${p.done ? (p.survived ? 'clear' : 'out') : ''}">` +
          `<span class="ah-rank">${medal[i] || i + 1}</span>` +
          `<span class="ah-name">${esc(p.name)}</span>` +
          `<span class="ah-bar"><i style="width:${(100 * p.score) / best}%"></i></span>` +
          `<span class="ah-hp">${p.done && !p.survived ? '💀 탈락' : '❤️'.repeat(p.hp)}</span>` +
          `<span class="ah-score">${p.score}</span></li>`
      )
      .join('');
  });
  socket.on('arena:over', (r) => {
    GameSound.play('win');
    renderResult(r);
    show('result');
  });
  $('ahStop').onclick = () => {
    if (confirm('경기를 지금 끝낼까요?')) socket.emit('host:stop');
  };
  // 시간·단계·카운트다운은 선생님 화면이 직접 센다
  setInterval(() => {
    if ($('arenaHost').classList.contains('hidden')) return;
    const now = performance.now();
    const cd = $('ahCd');
    if (now < arenaClock.startAt) {
      const n = Math.ceil((arenaClock.startAt - now) / 1000);
      if (n !== arenaCd) GameSound.play('beep');
      arenaCd = n;
      cd.textContent = n;
      cd.classList.remove('hidden');
    } else {
      if (arenaCd !== null) GameSound.play('go');
      arenaCd = null;
      cd.classList.add('hidden');
    }
    const left = Math.max(0, arenaClock.endAt - now) / 1000;
    $('ahTime').textContent = fmtTime(left);
    $('ahTime').classList.toggle('urgent', left > 0 && left <= 10);
    const elapsed = Math.max(0, now - arenaClock.startAt) / 1000;
    $('ahLevel').textContent = `${Math.min(5, Math.floor(elapsed / 20) + 1)}단계`;
  }, 200);

  function renderResult(r) {
    $('pointsHint').classList.toggle('hidden', r.mode === 'arena');
    if (r.mode === 'arena') return renderArenaResult(r);
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

  // 배틀 아레나 결과: 1등 크게, 2·3등은 그 아래, 전체 순위표
  function renderArenaResult(r) {
    const [first, second, third] = r.players;
    const w = $('winner');
    w.style.color = '#ffd84d';
    w.textContent = first ? `🏆 ${first.name}` : '경기 끝!';
    $('finalScore').textContent = first ? `${first.score}점` : '';
    $('mvp').innerHTML = [second && `🥈 ${esc(second.name)} ${second.score}점`, third && `🥉 ${esc(third.name)} ${third.score}점`]
      .filter(Boolean)
      .join(' &nbsp; ');
    $('board').innerHTML =
      '<tr><th>순위</th><th>이름</th><th>점수</th><th>처치</th><th>결과</th></tr>' +
      r.players
        .slice(0, 16)
        .map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td><b>${p.score}</b></td><td>${p.kills}</td><td>${p.survived ? '생존' : '탈락'}</td></tr>`)
        .join('');
  }

  if (!loadRoom()) show('home');
})();
