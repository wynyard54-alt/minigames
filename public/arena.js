// 배틀 아레나: 학생 폰에서 각자 하는 100초 서바이벌. 서버에는 점수만 보낸다(지연에 강함).
// 사방에서 몰려오는 적을 자동 조준으로 쏘고, 20초마다 난이도가 올라간다. 아이템 운반 적을 잡으면 아이템이 떨어진다.
window.Arena = (() => {
  const $ = (id) => document.getElementById(id);
  const S = 2400; // 넓은 들판(오픈월드). 화면은 내 캐릭터를 따라 움직인다
  const VIEW = 600; // 화면 짧은 쪽에 보이는 땅 크기. 폰마다 보이는 범위가 비슷하도록 고정
  const FIRE_RANGE = 460; // 이 거리 안의 적만 자동으로 쏜다
  const PLAYER_R = 19;
  const SPEED = 225;
  const BULLET_SPEED = 470;
  const BULLET_LIFE = 1.1;
  const LEVEL_TIME = 20; // 이 시간(초)마다 난이도 한 단계 위로
  // 단계별 난이도: 적 나오는 간격(초), 다가오는 속도 배율, 큰 적 비율, 떼로 몰려오는 확률
  // 가만히 서 있으면 3단계(40초쯤)부터 버티기 힘들게 맞춤 — 움직이고 아이템을 먹어야 끝까지 간다
  const LEVELS = [
    { gap: 0.6, speed: 1.0, big: 0.15, pack: 0 },
    { gap: 0.42, speed: 1.2, big: 0.2, pack: 0.08 },
    { gap: 0.3, speed: 1.4, big: 0.26, pack: 0.14 },
    { gap: 0.22, speed: 1.6, big: 0.32, pack: 0.2 },
    { gap: 0.16, speed: 1.8, big: 0.38, pack: 0.26 },
  ];
  const MAX_ENEMIES = 140; // 폰이 느려지지 않도록 한 번에 있는 적 수 제한
  const CARRIER_CHANCE = 0.09; // 아이템 운반 적이 나올 확률
  const ENEMY = {
    small: { r: 15, hp: 1, speed: 105, score: 10, charge: 9, color: '#ff647f' },
    big: { r: 23, hp: 3, speed: 72, score: 30, charge: 18, color: '#a575ff' },
    carrier: { r: 17, hp: 2, speed: 90, score: 20, charge: 12, color: '#ffc93c' },
  };
  // 아이템: 이름, 그림, 지속 시간(초), 뽑힐 비율
  const ITEMS = {
    power: { icon: '🔥', label: '강한 총알', color: '#ff9850', time: 8, weight: 25 },
    rapid: { icon: '⚡', label: '빠른 연사', color: '#69dfff', time: 8, weight: 25 },
    spread: { icon: '🔱', label: '3갈래 총알', color: '#c6a0ff', time: 8, weight: 20 },
    shield: { icon: '🛡', label: '보호막', color: '#8ce4ff', time: 5, weight: 15 },
    heal: { icon: '❤️', label: '하트 +1', color: '#77efad', time: 0, weight: 15 },
  };
  const SPECIAL_R = 170;
  const MAX_FX = 36;
  const MAX_FLOATERS = 10;

  // 필살기 연속 처치 때도 시각 효과 수를 제한한다. 큰 충격파는 우선 유지한다.
  function effect(f) {
    if (g.fx.length >= MAX_FX) {
      const index = g.fx.findIndex(old => !old.wide);
      if (index < 0) return;
      g.fx.splice(index, 1);
    }
    g.fx.push(f);
  }

  // 캐릭터 그림 (선생님 화면·배틀과 같은 그림)
  const art = new Image();
  let artReady = false;
  art.onload = () => (artReady = true);
  art.src = '/assets/fighters.webp';
  const FIGHTERS = {
    red: { right: [51, 28, 188, 218], left: [294, 27, 191, 219], up: [564, 25, 147, 221], down: [822, 26, 151, 220] },
    blue: { right: [51, 267, 188, 218], left: [294, 266, 191, 219], up: [564, 263, 147, 222], down: [822, 265, 151, 220] },
  };

  // 적은 방향 없는 작은 그림 한 장씩 사용한다. 피격용 흰색 그림도 최초 로딩 때만 만든다.
  const enemyArt = new Image();
  const enemySprites = {};
  enemyArt.onload = () => {
    const boxes = { small: [18, 26, 88, 83], big: [136, 9, 112, 109], carrier: [276, 25, 89, 85] };
    for (const [kind, rect] of Object.entries(boxes)) {
      enemySprites[kind] = [false, true].map(flash => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 64;
        const ctx = cv.getContext('2d');
        ctx.drawImage(enemyArt, ...rect, 0, 0, 64, 64);
        if (flash) {
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fillRect(0, 0, 64, 64);
        }
        return cv;
      });
    }
  };
  enemyArt.src = '/assets/arena-enemies.webp';

  // 작은 바닥 그림을 반사해 이어 붙인다. 경계선 없이 반복하고 카메라 이동에도 땅에 고정된다.
  const groundArt = new Image();
  let groundTile = null;
  const groundPatterns = new WeakMap();
  groundArt.onload = () => {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 512;
    const ctx = tile.getContext('2d');
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        ctx.save();
        ctx.translate(x ? 512 : 0, y ? 512 : 0);
        ctx.scale(x ? -1 : 1, y ? -1 : 1);
        ctx.drawImage(groundArt, 0, 0, 256, 256);
        ctx.restore();
      }
    }
    groundTile = tile;
  };
  groundArt.src = '/assets/arena-ground.webp';

  let g = null; // 지금 판의 상태
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sfx = (name, vol, gap) => window.GameSound && GameSound.play(name, vol, gap);

  // ---------- 조작 ----------
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const keys = new Set();
  function bindControls() {
    const cv = $('arenaCv');
    cv.addEventListener('pointerdown', (e) => {
      if (!g || stick.id !== null) return;
      e.preventDefault();
      stick.id = e.pointerId;
      stick.ox = e.clientX;
      stick.oy = e.clientY;
      stick.x = stick.y = 0;
      cv.setPointerCapture(e.pointerId);
      const el = $('aStick');
      el.style.left = e.clientX + 'px';
      el.style.top = e.clientY + 'px';
      el.classList.remove('hidden');
      el.firstElementChild.style.transform = 'translate(-50%,-50%)';
    });
    cv.addEventListener('pointermove', (e) => {
      if (stick.id !== e.pointerId) return;
      let dx = e.clientX - stick.ox;
      let dy = e.clientY - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > 55) {
        dx = (dx / d) * 55;
        dy = (dy / d) * 55;
      }
      stick.x = d > 6 ? dx / 55 : 0;
      stick.y = d > 6 ? dy / 55 : 0;
      $('aStick').firstElementChild.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const end = (e) => {
      if (stick.id !== e.pointerId) return;
      stick.id = null;
      stick.x = stick.y = 0;
      $('aStick').classList.add('hidden');
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    $('aSpecial').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      special();
    });
    addEventListener('keydown', (e) => {
      if (!g) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        special();
      }
      keys.add(k);
    });
    addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  }
  let bound = false;

  // ---------- 판 시작 ----------
  // startIn: 시작까지 남은 시간(ms, 0 이하면 이미 시작), duration: 끝까지 남은 시간(ms),
  // elapsed: 이미 지나간 경기 시간(ms, 늦게 들어온 경우 난이도를 맞추려고)
  function start(opts) {
    if (!bound) {
      bindControls();
      bound = true;
    }
    stop();
    const now = performance.now();
    g = {
      opts,
      team: opts.team === 'blue' ? 'blue' : 'red',
      startAt: now + Math.max(0, opts.startIn),
      endAt: now + Math.max(0, opts.startIn) + opts.duration,
      elapsed0: Math.max(0, opts.elapsed || 0) / 1000,
      player: { x: S / 2, y: S / 2, hp: 5, dir: 'down', fx: 0, fy: 1 },
      cam: { x: S / 2, y: S / 2 },
      viewR: 600,
      enemies: [],
      bullets: [],
      items: [],
      fx: [],
      floaters: [],
      buffs: { power: 0, rapid: 0, spread: 0, shield: 0 },
      score: 0,
      kills: 0,
      charge: 0,
      inv: 0,
      spawn: 0,
      shoot: 0,
      level: 0,
      lastCd: null,
      done: false,
      last: now,
      lastReport: 0,
      lastHud: -Infinity,
      buffMarkup: null,
    };
    $('aOverlay').classList.add('hidden');
    $('aStick').classList.add('hidden');
    stick.id = null;
    stick.x = stick.y = 0;
    raf = requestAnimationFrame(loop);
  }

  let raf = 0;
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    g = null;
  }

  // ---------- 적 · 총알 · 아이템 ----------
  // 적은 화면 바로 바깥, 내 주변 아무 방향에서 나온다
  function spawnEnemy(L) {
    if (g.enemies.length >= MAX_ENEMIES) return;
    const lv = LEVELS[L];
    const a = rnd(0, Math.PI * 2);
    const n = Math.random() < lv.pack ? 5 : 1; // 가끔 한 방향에서 떼로 몰려온다
    for (let i = 0; i < n; i++) {
      const d = g.viewR + 40 + i * 28;
      const aa = a + rnd(-0.15, 0.15);
      const x = Math.max(-40, Math.min(S + 40, g.player.x + Math.cos(aa) * d));
      const y = Math.max(-40, Math.min(S + 40, g.player.y + Math.sin(aa) * d));
      const roll = Math.random();
      const kind = roll < CARRIER_CHANCE ? 'carrier' : roll < CARRIER_CHANCE + lv.big ? 'big' : 'small';
      const t = ENEMY[kind];
      g.enemies.push({ x, y, kind, r: t.r, hp: t.hp, speed: t.speed * lv.speed * rnd(0.92, 1.08), flash: 0 });
    }
  }

  function nearest() {
    let best = null;
    let bd = Infinity;
    for (const e of g.enemies) {
      const d = Math.hypot(e.x - g.player.x, e.y - g.player.y);
      if (d < bd && d < FIRE_RANGE) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  function fire() {
    const target = nearest();
    if (!target) return;
    const p = g.player;
    const a = Math.atan2(target.y - p.y, target.x - p.x);
    p.fx = Math.cos(a);
    p.fy = Math.sin(a);
    const angles = g.buffs.spread > 0 ? [a - 0.22, a, a + 0.22] : [a];
    const power = g.buffs.power > 0;
    for (const ang of angles) {
      g.bullets.push({ x: p.x, y: p.y, vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED, r: power ? 10 : 7, dmg: power ? 2 : 1, life: BULLET_LIFE, power, rapid: g.buffs.rapid > 0, spread: g.buffs.spread > 0 });
    }
    sfx('shoot', 0.25);
  }

  function dropItem(x, y) {
    let pool = Object.entries(ITEMS);
    if (g.player.hp >= 5) pool = pool.filter(([k]) => k !== 'heal');
    const total = pool.reduce((s, [, v]) => s + v.weight, 0);
    let r = Math.random() * total;
    let type = pool[0][0];
    for (const [k, v] of pool) {
      r -= v.weight;
      if (r <= 0) {
        type = k;
        break;
      }
    }
    g.items.push({ x, y, type, life: 7 });
  }

  function takeItem(it) {
    const def = ITEMS[it.type];
    if (it.type === 'heal') g.player.hp = Math.min(5, g.player.hp + 1);
    else g.buffs[it.type] = def.time;
    float(it.x, it.y - 20, `${def.icon} ${def.label}!`, def.color);
    effect({ x: g.player.x, y: g.player.y, r: 8, max: 42, life: 0.35, color: def.color });
    sfx('superReady', 0.7);
  }

  function kill(e) {
    const t = ENEMY[e.kind];
    g.score += t.score;
    g.kills += 1;
    const before = g.charge;
    g.charge = Math.min(100, g.charge + t.charge);
    if (before < 100 && g.charge >= 100) sfx('superReady');
    effect({ x: e.x, y: e.y, r: 0, max: 24, life: 0.22, color: t.color, burst: true });
    if (e.kind === 'carrier' || (g.enemies.length < 60 && g.kills % 3 === 0)) float(e.x, e.y, '+' + t.score, '#fff');
    if (e.kind === 'carrier') dropItem(e.x, e.y);
    sfx('kill', 0.35, 60);
  }

  function special() {
    if (!g || g.done || !running() || g.charge < 100) return;
    g.charge = 0;
    const p = g.player;
    effect({ x: p.x, y: p.y, r: 0, max: SPECIAL_R, life: 0.45, color: '#c58cff', wide: true });
    for (const e of g.enemies) {
      if (Math.hypot(e.x - p.x, e.y - p.y) < SPECIAL_R + e.r) {
        e.hp -= 5;
        if (e.hp <= 0 && !e.dead) {
          e.dead = true;
          kill(e);
        }
      }
    }
    g.enemies = g.enemies.filter((e) => !e.dead);
    g.score += 5;
    sfx('boom');
  }

  function float(x, y, text, color) {
    if (g.floaters.length >= MAX_FLOATERS) g.floaters.shift();
    g.floaters.push({ x, y, text, color, life: 0.9 });
  }

  const running = () => g && performance.now() >= g.startAt && !g.done;

  // ---------- 매 프레임 ----------
  function loop(now) {
    if (!g) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.04, (now - g.last) / 1000);
    g.last = now;

    // 시작 전 카운트다운
    if (now < g.startAt) {
      const n = Math.ceil((g.startAt - now) / 1000);
      if (n !== g.lastCd) sfx('beep');
      g.lastCd = n;
      $('aOverlay').classList.remove('hidden');
      $('aOverlayText').innerHTML = `<div class="a-cd">${n}</div>앞 화면을 보세요!`;
      draw(now);
      return;
    }
    if (g.lastCd !== null) {
      sfx('go');
      g.lastCd = null;
      $('aOverlay').classList.add('hidden');
    }

    if (!g.done) step(dt, now);
    draw(now);
    hud(now);
  }

  function step(dt, now) {
    const p = g.player;
    const elapsed = g.elapsed0 + (now - g.startAt) / 1000;
    const L = Math.min(LEVELS.length - 1, Math.floor(elapsed / LEVEL_TIME));
    if (L > g.level) g.level = L; // 따로 알리지 않고 몸으로 느끼게
    g.spawn -= dt;
    g.shoot -= dt;
    g.inv -= dt;
    for (const k in g.buffs) if (g.buffs[k] > 0) g.buffs[k] -= dt;
    if (g.spawn <= 0) {
      spawnEnemy(g.level);
      g.spawn = LEVELS[g.level].gap;
    }
    if (g.shoot <= 0) {
      fire();
      g.shoot = g.buffs.rapid > 0 ? 0.15 : 0.32;
    }

    // 이동 (조이스틱 + 키보드)
    let mx = stick.x + (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let my = stick.y + (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    p.x = Math.max(PLAYER_R, Math.min(S - PLAYER_R, p.x + mx * SPEED * dt));
    p.y = Math.max(PLAYER_R, Math.min(S - PLAYER_R, p.y + my * SPEED * dt));
    if (m > 0.1) {
      p.mx = mx;
      p.my = my;
    }

    // 적이 나를 향해 다가오고, 닿으면 하트가 줄어든다
    for (const e of g.enemies) {
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      e.x += Math.cos(a) * e.speed * dt;
      e.y += Math.sin(a) * e.speed * dt;
      if (e.flash > 0) e.flash -= dt;
      if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + PLAYER_R - 3 && g.inv <= 0 && g.buffs.shield <= 0) {
        p.hp -= 1;
        g.inv = 1.2;
        effect({ x: p.x, y: p.y, r: 0, max: 55, life: 0.25, color: '#ff6b6b' });
        if (navigator.vibrate) navigator.vibrate(60);
        sfx(p.hp > 0 ? 'hurt' : 'die');
      }
    }

    for (const b of g.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      for (const e of g.enemies) {
        if (e.dead || Math.hypot(b.x - e.x, b.y - e.y) > b.r + e.r) continue;
        e.hp -= b.dmg;
        e.flash = 0.09;
        if (e.hp > 0) effect({ x: b.x, y: b.y, r: 2, max: 12, life: 0.12, color: '#fff', hit: true });
        b.life = 0;
        sfx('hitEnemy', 0.5, 40);
        if (e.hp <= 0) {
          e.dead = true;
          kill(e);
        }
        break;
      }
    }
    g.enemies = g.enemies.filter((e) => !e.dead);
    g.bullets = g.bullets.filter((b) => b.life > 0);

    for (const it of g.items) {
      it.life -= dt;
      if (Math.hypot(it.x - p.x, it.y - p.y) < PLAYER_R + 16) {
        it.life = 0;
        takeItem(it);
      }
    }
    g.items = g.items.filter((it) => it.life > 0);
    for (const f of g.fx) {
      f.life -= dt;
      f.r += (f.max - f.r) * 0.3;
    }
    g.fx = g.fx.filter((f) => f.life > 0);
    for (const f of g.floaters) f.life -= dt;
    g.floaters = g.floaters.filter((f) => f.life > 0);

    if (p.hp <= 0 || now >= g.endAt) finish(p.hp > 0);
    else if (now - g.lastReport > 500) report(false);
  }

  function report(done) {
    g.lastReport = performance.now();
    if (g.opts.onReport) g.opts.onReport({ score: g.score, kills: g.kills, hp: Math.max(0, g.player.hp), level: g.level + 1, done });
  }

  function finish(survived) {
    g.done = true;
    g.survived = survived;
    report(true);
    $('aOverlay').classList.remove('hidden');
    $('aOverlayText').innerHTML =
      `<div class="a-title">${survived ? '시간 종료! 끝까지 버텼어요 🎉' : '탈락! 아쉬워요'}</div>` +
      `<div class="a-score">${g.score}점</div><div>처치 ${g.kills}마리</div>` +
      `<div class="a-wait" id="aRank">다른 친구들이 끝날 때까지 기다려요</div>`;
    if (g.opts.onEnd) g.opts.onEnd({ score: g.score, kills: g.kills, survived });
  }

  // 서버가 알려 준 내 순위를 끝난 화면에 보여 준다
  function setRank(rank, total) {
    const el = $('aRank');
    if (el && g && g.done) el.textContent = `지금 ${total}명 중 ${rank}등 · 다른 친구들이 끝날 때까지 기다려요`;
  }

  function hud(now) {
    if (now - g.lastHud < 100) return; // 화면 표시는 초당 10번이면 충분하다
    g.lastHud = now;
    $('aScore').textContent = '⭐ ' + g.score;
    $('aTime').textContent = '⏱ ' + Math.max(0, Math.ceil((g.endAt - now) / 1000));
    $('aHearts').textContent = '❤️'.repeat(Math.max(0, g.player.hp)) + '🖤'.repeat(Math.max(0, 5 - g.player.hp));
    $('aLevel').textContent = `${g.level + 1}단계`;
    $('aCharge').textContent = Math.floor(g.charge) + '%';
    $('aSpecial').classList.toggle('ready', g.charge >= 100);
    $('aSpecial').style.setProperty('--p', g.charge / 100);
    const markup = Object.entries(g.buffs)
      .filter(([, t]) => t > 0)
      .map(([k, t]) => {
        const def = ITEMS[k];
        const remaining = Math.max(0, Math.min(1, t / def.time));
        return `<span class="a-buff${t <= 2 ? ' expiring' : ''}" style="--buff-color:${def.color};--remaining:${remaining.toFixed(2)}" aria-label="${def.label} ${Math.ceil(t)}초 남음">${def.icon} ${def.label} <b>${Math.ceil(t)}초</b></span>`;
      }).join('');
    if (markup !== g.buffMarkup) {
      $('aBuffs').innerHTML = markup;
      g.buffMarkup = markup;
    }
  }

  // ---------- 그리기 ----------
  function draw(now) {
    const cv = $('arenaCv');
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = innerWidth;
    const h = innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const s = Math.min(w, h) / VIEW;
    const vw = w / s;
    const vh = h / s;
    // 화면(카메라)은 내 캐릭터를 부드럽게 따라간다
    const cam = g ? g.cam : { x: S / 2, y: S / 2 };
    if (g) {
      const k = 1 - Math.exp(-10 * Math.min(0.05, (now - (g.camT || now)) / 1000));
      g.camT = now;
      cam.x += (g.player.x - cam.x) * (g.done ? 0 : k || 1);
      cam.y += (g.player.y - cam.y) * (g.done ? 0 : k || 1);
      g.viewR = Math.hypot(vw, vh) / 2;
    }
    const x0 = cam.x - vw / 2;
    const y0 = cam.y - vh / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#121626'; // 들판 바깥
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -dpr * s * x0, -dpr * s * y0);

    // 바닥: 보이는 부분만 그린다
    const bx0 = Math.max(0, x0);
    const by0 = Math.max(0, y0);
    const bx1 = Math.min(S, x0 + vw);
    const by1 = Math.min(S, y0 + vh);
    let ground = groundPatterns.get(ctx);
    if (!ground && groundTile) {
      ground = ctx.createPattern(groundTile, 'repeat');
      if (ground) groundPatterns.set(ctx, ground);
    }
    if (ground) {
      ctx.fillStyle = ground;
      ctx.fillRect(bx0, by0, Math.max(0, bx1 - bx0), Math.max(0, by1 - by0));
    } else {
      // 그림이 늦거나 로딩 실패한 경우 기존 바닥으로 계속 플레이한다.
      ctx.fillStyle = '#1d2338';
      ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(bx0 / 80) * 80; x <= bx1; x += 80) {
        ctx.moveTo(x, by0);
        ctx.lineTo(x, by1);
      }
      for (let y = Math.ceil(by0 / 80) * 80; y <= by1; y += 80) {
        ctx.moveTo(bx0, y);
        ctx.lineTo(bx1, y);
      }
      ctx.stroke();
      // 풀·돌 무늬: 움직일 때 넓은 땅을 달리는 느낌이 나도록 (칸마다 정해진 자리)
      for (let cx = Math.floor(bx0 / 160); cx * 160 < bx1; cx++) {
        for (let cy = Math.floor(by0 / 160); cy * 160 < by1; cy++) {
          const h1 = hash(cx, cy);
          const px = cx * 160 + (h1 % 140) + 10;
          const py = cy * 160 + ((h1 >> 8) % 140) + 10;
          if ((h1 >> 16) % 3 === 0) circle(ctx, px, py, 7 + ((h1 >> 4) % 6), 'rgba(255,255,255,0.045)');
          else if ((h1 >> 16) % 3 === 1) {
            ctx.strokeStyle = 'rgba(120,220,150,0.12)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px - 5, py + 4);
            ctx.lineTo(px - 2, py - 5);
            ctx.moveTo(px, py + 4);
            ctx.lineTo(px + 1, py - 7);
            ctx.moveTo(px + 5, py + 4);
            ctx.lineTo(px + 4, py - 4);
            ctx.stroke();
          }
        }
      }
    }
    if (!g) return;
    ctx.save();

    // 아이템 (사라지기 2초 전부터 깜빡임)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of g.items) {
      if (it.life < 2 && Math.floor(now / 120) % 2) continue;
      const bob = Math.sin(now / 200) * 3;
      ctx.fillStyle = 'rgba(255,227,91,0.25)';
      ctx.beginPath();
      ctx.arc(it.x, it.y + bob, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,227,91,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillStyle = '#fff'; // 그림 글자(이모지)가 흐리게 나오지 않도록 불투명 색으로
      ctx.fillText(ITEMS[it.type].icon, it.x, it.y + bob + 1);
    }

    // 적
    for (const e of g.enemies) {
      const t = ENEMY[e.kind];
      if (e.kind === 'carrier') {
        const glow = 0.12 + 0.06 * Math.sin(now / 180);
        ctx.fillStyle = `rgba(255,216,77,${glow})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 7, 0, Math.PI * 2);
        ctx.fill();
      }
      circle(ctx, e.x + 2, e.y + 4, e.r, 'rgba(0,0,0,0.35)');
      const picture = enemySprites[e.kind];
      if (picture) ctx.drawImage(picture[e.flash > 0 ? 1 : 0], e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
      else {
        circle(ctx, e.x, e.y, e.r, e.flash > 0 ? '#ffffff' : t.color);
        circle(ctx, e.x - 5, e.y - 3, 3, '#fff');
        circle(ctx, e.x + 5, e.y - 3, 3, '#fff');
        circle(ctx, e.x - 5, e.y - 3, 1.5, '#23213a');
        circle(ctx, e.x + 5, e.y - 3, 1.5, '#23213a');
      }
      if (e.kind === 'carrier' && !picture) {
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText('🎁', e.x, e.y - e.r - 8);
      }
      if (e.kind === 'big' && e.hp < ENEMY.big.hp) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(e.x - 16, e.y - e.r - 9, 32, 4);
        ctx.fillStyle = '#d8bcff';
        for (let i = 0; i < e.hp; i++) ctx.fillRect(e.x - 15 + i * 10, e.y - e.r - 9, 8, 4);
      }
    }

    // 총알
    for (const b of g.bullets) {
      if (b.rapid) {
        const length = 12 / BULLET_SPEED;
        ctx.strokeStyle = ITEMS.rapid.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(b.x - b.vx * length, b.y - b.vy * length);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      circle(ctx, b.x, b.y, b.r + 2, b.power ? '#ff5a1e' : b.spread ? ITEMS.spread.color : '#f38b1e');
      circle(ctx, b.x, b.y, b.r - 1, '#ffe35b');
    }

    // 나
    const p = g.player;
    const blink = g.inv > 0 && Math.floor(g.inv * 10) % 2;
    if (!blink) drawPlayer(ctx, p, now);

    // 효과
    for (const f of g.fx) {
      ctx.globalAlpha = Math.min(1, f.life * 3);
      ctx.strokeStyle = f.color || '#ffe97b';
      ctx.lineWidth = f.wide ? 8 : f.hit ? 2 : 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.stroke();
      if (f.burst) {
        // 파편 세 개만 짧게 그린다. 입자 객체나 흐림 효과는 만들지 않는다.
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3;
          ctx.moveTo(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r);
          ctx.lineTo(f.x + Math.cos(a) * (f.r + 5), f.y + Math.sin(a) * (f.r + 5));
        }
        ctx.stroke();
      }
    }
    ctx.font = 'bold 18px system-ui, sans-serif';
    for (const f of g.floaters) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const y = f.y - (0.9 - f.life) * 40;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 화면 밖의 🎁 적과 아이템은 가장자리에 작은 표시로 알려 준다
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const marks = g.enemies.filter((e) => e.kind === 'carrier').concat(g.items);
    for (const m of marks) {
      const sx = (m.x - x0) * s;
      const sy = (m.y - y0) * s;
      if (sx > 0 && sx < w && sy > 0 && sy < h) continue;
      const pad = 22;
      const ex = Math.max(pad, Math.min(w - pad, sx));
      const ey = Math.max(pad + 72, Math.min(h - pad, sy));
      circle(ctx, ex, ey, 13, m.type ? 'rgba(255,227,91,0.35)' : 'rgba(255,201,60,0.3)');
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(m.type ? ITEMS[m.type].icon : '🎁', ex, ey + 1);
    }
  }

  // 칸 좌표로 늘 같은 무작위 숫자를 만든다 (바닥 무늬용)
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function circle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 움직이는 방향(없으면 쏘는 방향)에 맞춰 네 방향 그림 중 하나를 고른다
  function drawPlayer(ctx, p, now) {
    const fx = p.mx !== undefined && Math.hypot(stick.x, stick.y) + keys.size > 0 ? p.mx : p.fx;
    const fy = p.mx !== undefined && Math.hypot(stick.x, stick.y) + keys.size > 0 ? p.my : p.fy;
    const vertical = (Math.atan2(Math.abs(fy), Math.abs(fx)) * 180) / Math.PI;
    if (vertical >= 65 || (p.dir === (fy < 0 ? 'up' : 'down') && vertical >= 55)) p.dir = fy < 0 ? 'up' : 'down';
    else if (Math.hypot(fx, fy) > 0.01) p.dir = fx < 0 ? 'left' : 'right';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + PLAYER_R * 0.8, PLAYER_R, PLAYER_R * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    if (g.buffs.shield > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      ctx.save();
      if (g.buffs.shield < 2) ctx.globalAlpha *= 0.45 + pulse * 0.55;
      ctx.fillStyle = `rgba(120,200,255,${0.18 + pulse * 0.12})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_R + 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,220,255,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    // 공격 강화는 짧은 색 띠로만 표시하여 적이 많을 때도 시야를 가리지 않는다.
    const active = ['power', 'rapid', 'spread'].filter(k => g.buffs[k] > 0);
    active.forEach((k, i) => {
      const def = ITEMS[k];
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const start = Math.PI * (0.1 + i * 0.28);
      ctx.arc(p.x, p.y, PLAYER_R + 5, start, start + Math.PI * 0.22 * g.buffs[k] / def.time);
      ctx.stroke();
    });
    if (artReady) {
      const rect = FIGHTERS[g.team][p.dir];
      const height = PLAYER_R * 2.4;
      const width = (height * rect[2]) / rect[3];
      const anchor = p.dir === 'right' ? 0.4 : p.dir === 'left' ? 0.6 : 0.5;
      ctx.drawImage(art, ...rect.map((v) => v * 0.75), p.x - width * anchor, p.y + PLAYER_R * 0.8 - height, width, height);
    } else {
      circle(ctx, p.x, p.y, PLAYER_R, g.team === 'blue' ? '#3d8bff' : '#ff4d5e');
    }
    if (g.charge >= 100) {
      ctx.strokeStyle = `rgba(197,140,255,${0.5 + 0.5 * Math.sin(now / 150)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_R + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // _state: 자동 테스트에서 진행 상황을 확인할 때만 씀
  return { start, stop, setRank, isRunning: () => !!g && !g.done, _state: () => g };
})();
