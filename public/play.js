(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const TEAM_NAME = { red: '빨강팀', blue: '파랑팀' };
  const TEAM_COLOR = { red: '#ff4d5e', blue: '#3d8bff' };

  const params = new URLSearchParams(location.search);
  let code = (params.get('room') || '').replace(/\D/g, '').slice(0, 4);
  let me = null; // { id, key, name }
  let lobby = null;
  let joined = false;
  let ammoMax = 3;

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
    $('pickRed').textContent = data.players.filter((p) => p.team === 'red').length + '명';
    $('pickBlue').textContent = data.players.filter((p) => p.team === 'blue').length + '명';
    for (const b of document.querySelectorAll('.team-btn')) b.classList.toggle('selected', b.dataset.team === mine.team);
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
  socket.on('game:start', () => {
    if (!joined) return;
    resetSticks();
    show('pad');
  });

  function fmtTime(t) {
    const s = Math.ceil(t);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function buildAmmo() {
    $('ammo').innerHTML = '';
    for (let i = 0; i < ammoMax; i++) $('ammo').appendChild(document.createElement('i'));
  }

  socket.on('me', (s) => {
    if (!s || !joined) return;
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
    $('kd').textContent = `${s.kills}킬 ${s.deaths}데스`;
    $('deadOverlay').classList.toggle('hidden', s.alive);
    $('respawnTxt').textContent = Math.ceil(s.respawn) + '초 후 부활';
    $('padCountdown').classList.toggle('hidden', s.phase !== 'countdown');
    $('padCd').textContent = Math.ceil(s.timer);
  });

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
    $('pMine').textContent = mine ? `나: ${mine.kills}킬 ${mine.deaths}데스 · 전체 ${rank + 1}등` : '';
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
