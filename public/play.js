(() => {
  const socket = io({ transports: ['websocket', 'polling'] }); // 웹소켓을 먼저 시도 (느린 방식은 막힐 때만)
  const $ = (id) => document.getElementById(id);
  const TEAM_NAME = { red: '빨강팀', blue: '파랑팀' };
  const TEAM_COLOR = GameRender.TEAM_COLOR;

  const params = new URLSearchParams(location.search);
  let code = (params.get('room') || '').replace(/\D/g, '').slice(0, 4);
  let me = null; // { id, key, name }
  let lobby = null;
  let joined = false;
  let ammoMax = 3;
  let world = null;
  let view = null; // 서버가 보내 주는 내 주변 화면

  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
    document.body.classList.toggle('playing', id === 'pad');
  }

  const store = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {}
    },
  };

  // ---------- 입장 ----------
  $('codeInput').value = code;
  $('nameInput').value = store.get('mg:name') || '';
  if (code) setTimeout(() => $('nameInput').focus(), 100);

  function join(name) {
    const saved = store.get('mg:player:' + code);
    socket.emit('player:join', { code, name, id: saved && saved.id, key: saved && saved.key }, (res) => {
      if (!res.ok) {
        joined = false;
        store.del('mg:player:' + code);
        $('joinError').textContent = res.error;
        show('join');
        return;
      }
      joined = true;
      me = { id: res.id, key: res.key, name: res.name };
      ammoMax = res.world.AMMO_MAX;
      world = res.world;
      store.set('mg:player:' + code, me);
      $('myName').textContent = res.name;
      $('joinError').textContent = '';
      buildAmmo();
      keepAwake();
      if (res.inGame) show('pad');
      else show('lobby');
    });
  }

  $('joinForm').onsubmit = (e) => {
    e.preventDefault();
    code = $('codeInput').value.replace(/\D/g, '').slice(0, 4);
    const name = $('nameInput').value.trim();
    if (code.length !== 4) return ($('joinError').textContent = '방 번호 4자리를 입력해 주세요.');
    if (!name) return ($('joinError').textContent = '이름을 입력해 주세요.');
    store.set('mg:name', name);
    history.replaceState(null, '', '?room=' + code);
    join(name);
  };

  socket.on('connect', () => {
    // 와이파이가 잠깐 끊겼다 돌아온 경우 자동 재입장
    if (joined && me) join(me.name);
    else if (code && store.get('mg:player:' + code)) join(store.get('mg:name'));
  });

  socket.on('kicked', (info) => {
    joined = false;
    store.del('mg:player:' + code);
    const reason = info && info.reason;
    $('byeMsg').textContent =
      reason === 'room-closed' ? '방이 닫혔어요.' : reason === 'other-device' ? '다른 창에서 접속했어요.' : '선생님이 방에서 내보냈어요.';
    show('bye');
  });
  $('rejoinBtn').onclick = () => show('join');

  // ---------- 대기실 ----------
  socket.on('lobby', (data) => {
    lobby = data;
    if (!joined || !me) return;
    const mine = data.players.find((p) => p.id === me.id);
    if (!mine) return;
    for (const b of document.querySelectorAll('.team-btn')) {
      const team = b.dataset.team;
      const members = data.players.filter((p) => p.team === team);
      // 꽉 찬 팀은 고를 수 없다 (AI가 있으면 AI와 자리를 바꾼다)
      const full = members.length >= data.teamMax && !members.some((p) => p.bot) && mine.team !== team;
      $(team === 'red' ? 'pickRed' : 'pickBlue').textContent = full ? '꽉 찼어요' : `${members.length} / ${data.teamMax}명`;
      b.disabled = full;
      b.classList.toggle('selected', team === mine.team);
    }
    document.body.dataset.team = mine.team;
    $('readyBtn').classList.toggle('on', mine.ready);
    $('readyBtn').textContent = mine.ready ? '준비 완료 ✓' : '준비!';
    const ready = data.players.filter((p) => p.ready).length;
    $('lobbyInfo').textContent = `준비 ${ready} / ${data.players.length}명`;
    if (data.state === 'lobby') show('lobby');
  });

  for (const b of document.querySelectorAll('.team-btn')) {
    b.onclick = () => socket.emit('player:team', b.dataset.team);
  }
  $('readyBtn').onclick = () => {
    const mine = lobby && lobby.players.find((p) => p.id === me.id);
    socket.emit('player:ready', !(mine && mine.ready));
  };
  $('leaveBtn').onclick = () => {
    socket.emit('player:leave');
    joined = false;
    store.del('mg:player:' + code);
    show('join');
  };

  // ---------- 게임 ----------
  let hintTimer = 0;
  socket.on('game:start', (data) => {
    if (!joined) return;
    world = data.world;
    view = null;
    scene.reset();
    pred.active = false;
    $('pFeed').innerHTML = '';
    resetSticks();
    show('pad');
    // 조작 안내 글씨는 잠깐 보여 주고 흐리게
    document.body.classList.remove('started');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => document.body.classList.add('started'), 7000);
  });

  function fmtTime(t) {
    const s = Math.ceil(t);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function buildAmmo() {
    $('ammo').innerHTML = '';
    for (let i = 0; i < ammoMax; i++) $('ammo').appendChild(document.createElement('i'));
  }

  socket.on('view', (v) => {
    if (!v || !joined) return;
    view = v;
    scene.push(v);
    reconcile(v);
    renderFeed(v.feed);
    const s = v.me;
    if ($('pad').classList.contains('hidden')) show('pad');
    document.body.dataset.team = s.team;
    $('sRed').textContent = s.score.red;
    $('sBlue').textContent = s.score.blue;
    $('pTimer').textContent = s.phase === 'countdown' ? '준비' : fmtTime(s.timer);
    $('hpFill').style.width = (100 * s.hp) / s.maxHp + '%';
    $('hpFill').style.background = s.hp > 50 ? '#4cdb6a' : s.hp > 25 ? '#ffc93c' : '#ff5555';
    const pips = $('ammo').children;
    for (let i = 0; i < pips.length; i++) {
      const fill = i < s.ammo ? 1 : i === s.ammo ? s.reload : 0;
      pips[i].style.setProperty('--fill', fill);
    }
    $('kd').textContent = `${s.kills}킬 ${s.deaths}데스 ${s.assists}어시 · ${s.points}점`;
    superReady = s.alive && s.charge >= s.superMax;
    $('superBtn').classList.toggle('ready', superReady);
    $('superBtn').style.setProperty('--p', s.charge / s.superMax);
    $('superTxt').textContent = superReady ? '준비 완료!' : `${s.charge}/${s.superMax}`;
    $('bushBadge').classList.toggle('hidden', !(s.alive && s.inBush));
    $('bushBadge').textContent = s.hidden ? '🌿 부시에 숨는 중' : '🌿 부시 안 (지금은 보여요)';
    $('deadOverlay').classList.toggle('hidden', s.alive);
    $('respawnTxt').textContent = Math.ceil(s.respawn) + '초 후 부활';
    $('padCountdown').classList.toggle('hidden', s.phase !== 'countdown');
    $('padCd').textContent = Math.ceil(s.timer);
  });

  // ---------- 내 폰의 게임 화면 ----------
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  const scene = GameRender.createScene(110); // 초당 15번 받으므로 0.11초 늦게, 사이를 이어서 보여 준다

  // ---------- 통신 지연 측정 ----------
  let rtt = 150; // 왕복 시간(ms). 측정 전에는 대략값
  function measurePing() {
    if (!socket.connected) return;
    const t0 = performance.now();
    socket.emit('ping2', 0, () => {
      const sample = performance.now() - t0;
      rtt = rtt * 0.7 + sample * 0.3;
      const ms = Math.round(rtt);
      const slow = socket.io.engine && socket.io.engine.transport.name !== 'websocket';
      const el = $('net');
      el.textContent = `📶 ${ms}ms${slow ? ' (느린 연결)' : ''}`;
      el.className = 'pad-net ' + (ms < 120 && !slow ? 'good' : ms < 250 ? 'ok' : 'bad');
    });
  }
  setInterval(measurePing, 2000);
  socket.on('connect', measurePing);

  // ---------- 내 캐릭터 미리 움직이기(예측) ----------
  // 서버 답을 기다리지 않고 조이스틱대로 바로 움직이고, 서버 위치와 어긋나면 조금씩 맞춘다
  const pred = { x: 0, y: 0, fx: 1, fy: 0, active: false };
  const hist = []; // 최근 내 예측 위치 기록 {t, x, y}
  const corr = { x: 0, y: 0 }; // 아직 덜 맞춘 차이

  function predictStep(dt, now) {
    const s = view && view.me;
    const srv = view && view.players.find((p) => p.id === me.id);
    if (!s || !srv || s.phase !== 'playing' || !s.alive) {
      pred.active = false;
      hist.length = 0;
      return;
    }
    if (!pred.active) {
      Object.assign(pred, { x: srv.x, y: srv.y, fx: srv.fx, fy: srv.fy, active: true });
      corr.x = corr.y = 0;
    }
    GameEngine.moveFighter(pred, input.mx, input.my, dt);
    if (input.mx || input.my) {
      const l = Math.hypot(input.mx, input.my);
      pred.fx = input.mx / l;
      pred.fy = input.my / l;
    }
    const k = Math.min(1, dt * 6);
    const cx = corr.x * k;
    const cy = corr.y * k;
    corr.x -= cx;
    corr.y -= cy;
    pred.x += cx;
    pred.y += cy;
    for (const h of hist) {
      h.x += cx;
      h.y += cy;
    }
    hist.push({ t: now, x: pred.x, y: pred.y });
    while (hist.length && hist[0].t < now - 1500) hist.shift();
  }

  // 서버가 알려 준 내 위치는 대략 왕복 시간만큼 예전의 나다. 그때의 예측 위치와 비교해서 차이를 맞춘다
  function reconcile(v) {
    const srv = v.players.find((p) => me && p.id === me.id);
    if (!srv || !pred.active || !hist.length) return;
    const t = performance.now() - rtt;
    let h = hist[0];
    for (const e of hist) {
      if (e.t > t) break;
      h = e;
    }
    const ex = srv.x - h.x;
    const ey = srv.y - h.y;
    if (Math.hypot(ex, ey) > 150) {
      Object.assign(pred, { x: srv.x, y: srv.y });
      corr.x = corr.y = 0;
      hist.length = 0;
      return;
    }
    corr.x = ex;
    corr.y = ey;
  }
  const cam = { x: 0, y: 0, s: 1, ready: false };
  socket.on('fx', (ev) => scene.fx(ev));

  let feedKey = '';
  function renderFeed(feed) {
    const key = feed.map((f) => f.t).join(',');
    if (key === feedKey) return;
    feedKey = key;
    $('pFeed').innerHTML = feed
      .slice()
      .reverse()
      .map(
        (f) =>
          `<li><b style="color:${TEAM_COLOR[f.killerTeam] || '#fff'}">${esc(f.killer)}</b> ➜ ` +
          `<b style="color:${TEAM_COLOR[f.victimTeam]}">${esc(f.victim)}</b></li>`
      )
      .join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function resizeView() {
    const dpr = Math.min(2, window.devicePixelRatio || 1); // 오래된 폰도 버벅이지 않게 최대 2배
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return dpr;
  }

  // 내 캐릭터를 따라가는 카메라. 화면이 넓으면 맵 전체가 들어오게
  function updateCamera(target) {
    const cw = innerWidth;
    const ch = innerHeight;
    const fit = Math.min(cw / world.W, ch / world.H);
    const s = Math.max(fit, Math.min(cw, ch) / 620);
    const vw = cw / s;
    const vh = ch / s;
    const x = vw >= world.W ? (world.W - vw) / 2 : Math.max(0, Math.min(world.W - vw, target.x - vw / 2));
    const y = vh >= world.H ? (world.H - vh) / 2 : Math.max(-40 / s, Math.min(world.H - vh, target.y - vh / 2));
    const k = cam.ready ? 0.15 : 1;
    cam.x += (x - cam.x) * k;
    cam.y += (y - cam.y) * k;
    cam.s = s;
    cam.ready = true;
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    requestAnimationFrame(frame);
    if (!view || !world || !me || $('pad').classList.contains('hidden')) return;
    const dpr = resizeView();
    predictStep(dt, now);
    const cur = scene.update(now);
    const mine = pred.active ? pred : cur && cur.players.find((p) => p.id === me.id);
    if (mine) updateCamera(mine);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(cam.s * dpr, 0, 0, cam.s * dpr, -cam.x * cam.s * dpr, -cam.y * cam.s * dpr);
    scene.draw(ctx, world, dt, now, { meId: me.id, myTeam: view.me.team, me: pred.active ? pred : null });
  }
  requestAnimationFrame(frame);

  function buzz(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern); // 아이폰은 지원하지 않음
  }
  function flash(cls) {
    document.body.classList.remove(cls);
    void document.body.offsetWidth;
    document.body.classList.add(cls);
  }
  socket.on('ev', (ev) => {
    if (ev.type === 'damaged') {
      buzz(40);
      flash('flash-hit');
    } else if (ev.type === 'dead') {
      buzz([120, 60, 200]);
    } else if (ev.type === 'superReady') {
      buzz([40, 40, 40, 40, 80]);
      flash('flash-kill');
    } else if (ev.type === 'kill') {
      buzz([30, 40, 30]);
      flash('flash-kill');
    }
  });

  socket.on('game:over', (r) => {
    if (!joined) return;
    resetSticks();
    const w = $('pWinner');
    w.textContent = r.winner === 'draw' ? '무승부!' : `${TEAM_NAME[r.winner]} 승리!`;
    w.style.color = r.winner === 'draw' ? '#fff' : TEAM_COLOR[r.winner];
    $('pScore').innerHTML = `<span style="color:${TEAM_COLOR.red}">${r.score.red}</span> : <span style="color:${TEAM_COLOR.blue}">${r.score.blue}</span>`;
    const rank = r.players.findIndex((p) => p.id === me.id);
    const mine = r.players[rank];
    $('pMine').textContent = mine ? `나: ${mine.kills}킬 ${mine.deaths}데스 ${mine.assists}어시 · ${mine.points}점 · 전체 ${rank + 1}등` : '';
    show('result');
  });

  // ---------- 조이스틱 ----------
  const STICK_R = 60;
  const input = { mx: 0, my: 0, firing: false };
  const stick = { el: $('stickL'), id: null, ox: 0, oy: 0 };
  const firePointers = new Set();
  const keys = new Set();

  function placeStick(s, x, y) {
    s.el.style.left = x + 'px';
    s.el.style.top = y + 'px';
    s.el.classList.remove('hidden');
    s.el.firstElementChild.style.transform = 'translate(-50%,-50%)';
  }

  function stickVec(s, x, y) {
    let dx = x - s.ox;
    let dy = y - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx = (dx / d) * STICK_R;
      dy = (dy / d) * STICK_R;
    }
    s.el.firstElementChild.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    return { x: dx / STICK_R, y: dy / STICK_R, m: Math.min(1, d / STICK_R) };
  }

  const moveZone = $('moveZone');
  moveZone.addEventListener('pointerdown', (e) => {
    if (stick.id !== null) return;
    e.preventDefault();
    stick.id = e.pointerId;
    stick.ox = e.clientX;
    stick.oy = e.clientY;
    moveZone.setPointerCapture(e.pointerId);
    placeStick(stick, e.clientX, e.clientY);
  });
  moveZone.addEventListener('pointermove', (e) => {
    if (stick.id !== e.pointerId) return;
    e.preventDefault();
    const v = stickVec(stick, e.clientX, e.clientY);
    input.mx = v.m > 0.1 ? v.x : 0;
    input.my = v.m > 0.1 ? v.y : 0;
    sendInput();
  });
  function moveEnd(e) {
    if (stick.id !== e.pointerId) return;
    stick.id = null;
    stick.el.classList.add('hidden');
    input.mx = input.my = 0;
    sendInput(true);
  }
  moveZone.addEventListener('pointerup', moveEnd);
  moveZone.addEventListener('pointercancel', moveEnd);

  // 발사: 오른쪽 아무 데나 누르고 있으면 연사 (서버가 탄약/쿨타임을 관리)
  const fireZone = $('fireZone');
  function setFiring() {
    input.firing = firePointers.size > 0 || keys.has(' ');
    $('fireBtn').classList.toggle('on', input.firing);
    sendInput(true);
  }
  fireZone.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#superBtn')) return;
    e.preventDefault();
    fireZone.setPointerCapture(e.pointerId);
    firePointers.add(e.pointerId);
    setFiring();
  });
  for (const ev of ['pointerup', 'pointercancel']) {
    fireZone.addEventListener(ev, (e) => {
      firePointers.delete(e.pointerId);
      setFiring();
    });
  }

  // 필살기
  let superReady = false;
  function useSuper() {
    if (!superReady) return;
    socket.emit('super');
    buzz([60, 30, 120]);
  }
  $('superBtn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    useSuper();
  });

  function resetSticks() {
    stick.id = null;
    stick.el.classList.add('hidden');
    firePointers.clear();
    keys.clear();
    Object.assign(input, { mx: 0, my: 0, firing: false });
    $('fireBtn').classList.remove('on');
  }

  let lastSent = '';
  let lastSentAt = 0;
  function sendInput(force) {
    const now = performance.now();
    const msg = JSON.stringify(input);
    if (!force && (msg === lastSent || now - lastSentAt < 40)) return;
    lastSent = msg;
    lastSentAt = now;
    socket.volatile.emit('input', input);
  }
  // 패킷이 유실되어도 서버 입력이 굳지 않도록 주기적으로 다시 보냄
  setInterval(() => {
    if (joined && !$('pad').classList.contains('hidden')) {
      lastSentAt = 0;
      lastSent = '';
      sendInput();
    }
  }, 250);

  // PC에서 시험해 볼 때: WASD/방향키 이동, 스페이스 발사(누르고 있으면 연사)
  function keyInput() {
    if (stick.id !== null) return;
    const x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const y = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    const l = Math.hypot(x, y) || 1;
    input.mx = x / l;
    input.my = y / l;
    sendInput(true);
  }
  addEventListener('keydown', (e) => {
    if ($('pad').classList.contains('hidden') || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ') e.preventDefault();
    if (k === 'e' || k === 'shift') return useSuper();
    keys.add(k);
    if (k === ' ') setFiring();
    else keyInput();
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if ($('pad').classList.contains('hidden')) return;
    if (k === ' ') setFiring();
    else keyInput();
  });

  // 게임 중 화면 꺼짐 방지 (지원하는 브라우저만)
  let wakeLock = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && joined) keepAwake();
  });

  // 핀치 확대/더블탭 확대 막기 (iOS Safari)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
})();
