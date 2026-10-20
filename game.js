// 서버에서 돌아가는 팀 슈팅 게임 로직. 화면 그리기는 호스트(프로젝터) 브라우저가 담당한다.

const W = 1600;
const H = 900;
const PLAYER_R = 22;
const SPEED = 260; // px/s
const BULLET_SPEED = 900;
const BULLET_RANGE = 560;
const BULLET_DMG = 25;
const MAX_HP = 100;
const AMMO_MAX = 3;
const RELOAD_TIME = 0.9; // 탄창 교체 시간(초): 다 쏘면 이 시간 뒤에 한 번에 꽉 찬다
const FIRE_COOLDOWN = 0.28;
const TAP_HOLD = 0.35; // 발사 버튼을 아주 짧게 '톡' 눌러도(누름·뗌이 한꺼번에 도착해도) 이 시간 안에 한 발은 꼭 나가게 기억
const RESPAWN_TIME = 3;
const SPAWN_SHIELD = 1.5;
// 체력은 우리 팀 리젠구역(스폰 구역) 안에서만 회복된다
const SPAWN_ZONE_W = 220; // 맵 양 끝 리젠구역의 너비
const REGEN_DELAY = 1; // 리젠구역에서 맞은 뒤 이 시간(초)이 지나야 회복 시작
const REGEN_RATE = 35; // hp/s
const MATCH_TIME = 120;
const COUNTDOWN = 3;
const TEAMS = ['red', 'blue'];
const ASSIST_ANGLE = 0.35; // 바라보는 방향 ±20° 안의 적은 자동으로 맞춰 준다
const SUPER_HITS = 5; // 총알을 이만큼 맞히면 필살기 충전
const SUPER_RADIUS = 210;
const SUPER_DMG = 45;
const REVEAL_RANGE = 130; // 부시 안에 있어도 적이 이만큼 가까우면 보인다
const REVEAL_TIME = 1; // 쏘거나 맞으면 이 시간(초) 동안 부시 밖으로 드러난다
const VIEW_RANGE_X = 1100; // 폰 화면에 보낼 범위 (내 위치 기준, 화면보다 넉넉하게)
const VIEW_RANGE_Y = 800;

// 왼쪽 절반의 벽만 정의하고 점대칭으로 오른쪽을 만든다 → 양 팀이 공평한 맵
const HALF_WALLS = [
  { x: 330, y: 150, w: 60, h: 220 },
  { x: 330, y: 600, w: 220, h: 50 },
  { x: 600, y: 110, w: 200, h: 50 },
  { x: 560, y: 400, w: 50, h: 140 },
  { x: 760, y: 380, w: 80, h: 140 },
];
const WALLS = [];
for (const w of HALF_WALLS) {
  WALLS.push(w);
  const m = { x: W - w.x - w.w, y: H - w.y - w.h, w: w.w, h: w.h };
  if (m.x !== w.x || m.y !== w.y) WALLS.push(m);
}

// 부시(풀숲): 들어가면 큰 화면에서 사라진다. 벽과 마찬가지로 점대칭
const HALF_BUSHES = [
  { x: 420, y: 230, w: 120, h: 90 },
  { x: 240, y: 700, w: 160, h: 80 },
  { x: 640, y: 560, w: 110, h: 110 },
  { x: 700, y: 0, w: 200, h: 70 },
];
const BUSHES = [];
for (const b of HALF_BUSHES) {
  BUSHES.push(b, { x: W - b.x - b.w, y: H - b.y - b.h, w: b.w, h: b.h });
}

function inHomeZone(f) {
  return f.team === 'red' ? f.x <= SPAWN_ZONE_W : f.x >= W - SPAWN_ZONE_W;
}

function inBush(x, y) {
  for (const b of BUSHES) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  }
  return false;
}

const SPAWNS = {
  red: [{ x: 90, y: 450 }, { x: 90, y: 300 }, { x: 90, y: 600 }, { x: 170, y: 220 }, { x: 170, y: 680 }, { x: 170, y: 450 }],
  blue: [{ x: W - 90, y: 450 }, { x: W - 90, y: 600 }, { x: W - 90, y: 300 }, { x: W - 170, y: 680 }, { x: W - 170, y: 220 }, { x: W - 170, y: 450 }],
};

// 개인 점수: 킬 +3, 어시스트 +1, 데스 -2, 0점 아래로는 내려가지 않음 (팀 점수는 킬 수 그대로)
const POINTS = { kill: 3, assist: 1, death: -2 };
function points(f) {
  return Math.max(0, f.kills * POINTS.kill + f.assists * POINTS.assist + f.deaths * POINTS.death);
}

// 등수: 점수 → 킬 → 어시 → 데스 적은 순
function rankOrder(a, b) {
  return b.points - a.points || b.kills - a.kills || b.assists - a.assists || a.deaths - b.deaths;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function circleRectPush(p, r, rect) {
  const cx = clamp(p.x, rect.x, rect.x + rect.w);
  const cy = clamp(p.y, rect.y, rect.y + rect.h);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  if (d2 > 0) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.y = cy + (dy / d) * r;
  } else {
    // 중심이 벽 안쪽에 들어간 경우: 가장 가까운 면으로 밀어낸다
    const left = p.x - rect.x;
    const right = rect.x + rect.w - p.x;
    const top = p.y - rect.y;
    const bottom = rect.y + rect.h - p.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) p.x = rect.x - r;
    else if (m === right) p.x = rect.x + rect.w + r;
    else if (m === top) p.y = rect.y - r;
    else p.y = rect.y + rect.h + r;
  }
}

function pointInWall(x, y) {
  for (const w of WALLS) {
    if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return true;
  }
  return x < 0 || x > W || y < 0 || y > H;
}

// 선분 AB와 점 C 사이의 최단거리 제곱
function segDist2(ax, ay, bx, by, cx, cy) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((cx - ax) * abx + (cy - ay) * aby) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = ax + abx * t - cx;
  const py = ay + aby * t - cy;
  return px * px + py * py;
}

// 두 점 사이에 벽이 있는지 (자동조준용, 대략적인 샘플링)
function hasLineOfSight(ax, ay, bx, by) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 15);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointInWall(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

class Match {
  constructor(players, onEvent) {
    // players: [{id, name, team}]
    this.onEvent = onEvent || (() => {});
    this.phase = 'countdown';
    this.timer = COUNTDOWN;
    this.score = { red: 0, blue: 0 };
    this.bullets = [];
    this.bulletSeq = 0;
    this.feed = [];
    this.fighters = new Map();
    for (const p of players) this.addPlayer(p);
  }

  addPlayer(p) {
    if (this.fighters.has(p.id)) return;
    const f = {
      id: p.id,
      name: p.name,
      team: p.team,
      // AI 봇이면 생각 상태를 들고 있다 (사람은 null)
      brain: p.bot ? { think: 0, stuck: 0, side: Math.random() < 0.5 ? 1 : -1, lastX: 0, lastY: 0, mx: 0, my: 0, lane: 150 + Math.random() * 600 } : null,
      x: 0,
      y: 0,
      hp: MAX_HP,
      alive: true,
      respawn: 0,
      shield: SPAWN_SHIELD,
      ammo: AMMO_MAX,
      reload: 0,
      cooldown: 0,
      tapQueue: 0,
      sinceHit: REGEN_DELAY,
      faceX: p.team === 'red' ? 1 : -1,
      faceY: 0,
      input: { mx: 0, my: 0, ax: 0, ay: 0, aiming: false, firing: false },
      kills: 0,
      deaths: 0,
      assists: 0,
      attackers: new Set(), // 이번 목숨 동안 나를 때린 적 (어시스트 계산용)
      charge: 0,
      reveal: 0,
      inBush: false,
      hidden: false,
      connected: true,
      hitFlash: 0,
    };
    this.placeAtSpawn(f);
    this.fighters.set(p.id, f);
  }

  removePlayer(id) {
    this.fighters.delete(id);
  }

  setConnected(id, connected) {
    const f = this.fighters.get(id);
    if (!f) return;
    f.connected = connected;
    if (!connected) f.input = { mx: 0, my: 0, ax: 0, ay: 0, aiming: false, firing: false };
  }

  placeAtSpawn(f) {
    const spots = SPAWNS[f.team];
    // 다른 플레이어와 가장 덜 겹치는 스폰 위치 선택
    let best = spots[0];
    let bestScore = -1;
    for (const s of spots) {
      let minD = Infinity;
      for (const o of this.fighters ? this.fighters.values() : []) {
        if (o === f || !o.alive) continue;
        minD = Math.min(minD, Math.hypot(o.x - s.x, o.y - s.y));
      }
      if (minD > bestScore) {
        bestScore = minD;
        best = s;
      }
    }
    f.x = best.x + (Math.random() - 0.5) * 20;
    f.y = best.y + (Math.random() - 0.5) * 20;
  }

  setInput(id, input) {
    const f = this.fighters.get(id);
    if (!f || !input) return;
    let mx = Number(input.mx) || 0;
    let my = Number(input.my) || 0;
    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    let ax = Number(input.ax) || 0;
    let ay = Number(input.ay) || 0;
    const al = Math.hypot(ax, ay);
    if (al > 0) {
      ax /= al;
      ay /= al;
    }
    if (input.firing && !f.input.firing) f.tapQueue = TAP_HOLD; // 누른 순간을 기억
    f.input = { mx, my, ax, ay, aiming: !!input.aiming && al > 0, firing: !!input.firing };
  }

  fire(id, req) {
    if (this.phase !== 'playing') return;
    const f = this.fighters.get(id);
    if (!f || !f.alive || f.ammo < 1 || f.cooldown > 0) return;
    let dx;
    let dy;
    if (req && req.facing) {
      // 발사 버튼: 바라보는 방향으로 쏘되, 앞쪽 좁은 각도 안의 적은 살짝 보정
      const target = this.assistTarget(f);
      dx = target ? target.x - f.x : f.faceX;
      dy = target ? target.y - f.y : f.faceY;
    } else if (req && req.auto) {
      const target = this.nearestEnemy(f);
      if (target) {
        dx = target.x - f.x;
        dy = target.y - f.y;
      } else {
        dx = f.faceX;
        dy = f.faceY;
      }
    } else {
      dx = Number(req && req.ax) || 0;
      dy = Number(req && req.ay) || 0;
    }
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    dx /= len;
    dy /= len;
    f.faceX = dx;
    f.faceY = dy;
    f.ammo -= 1;
    f.cooldown = FIRE_COOLDOWN;
    f.tapQueue = 0;
    f.shield = 0; // 공격하면 스폰 보호막 해제
    f.reveal = REVEAL_TIME;
    this.bullets.push({
      id: ++this.bulletSeq,
      owner: f.id,
      team: f.team,
      x: f.x + dx * (PLAYER_R + 4),
      y: f.y + dy * (PLAYER_R + 4),
      vx: dx * BULLET_SPEED,
      vy: dy * BULLET_SPEED,
      dist: 0,
    });
  }

  useSuper(id) {
    if (this.phase !== 'playing') return;
    const f = this.fighters.get(id);
    if (!f || !f.alive || f.charge < SUPER_HITS) return;
    f.charge = 0;
    f.shield = 0;
    f.reveal = REVEAL_TIME;
    this.onEvent({ type: 'super', id, x: f.x, y: f.y, team: f.team, r: SUPER_RADIUS });
    for (const o of [...this.fighters.values()]) {
      if (o.team === f.team || !o.alive || !o.connected) continue;
      if (Math.hypot(o.x - f.x, o.y - f.y) <= SUPER_RADIUS + PLAYER_R) this.damage(o, id, SUPER_DMG, true);
    }
  }

  // AI 봇: 보이는 적에게 다가가 쏘고, 체력이 낮으면 후퇴. 사람과 같은 규칙으로 움직이고 쏜다
  botThink(f, dt) {
    const b = f.brain;
    b.think -= dt;
    let target = null;
    let best = Infinity;
    for (const o of this.fighters.values()) {
      if (o.team === f.team || !o.alive || !o.connected || o.hidden) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < best) {
        best = d;
        target = o;
      }
    }
    const sees = target && best < BULLET_RANGE - 40 && hasLineOfSight(f.x, f.y, target.x, target.y);
    if (b.think <= 0) {
      b.think = 0.25 + Math.random() * 0.2;
      const moved = Math.hypot(f.x - b.lastX, f.y - b.lastY);
      b.lastX = f.x;
      b.lastY = f.y;
      if (moved < 8 && (b.mx || b.my)) {
        b.stuck = 0.7; // 벽에 막히면 잠깐 옆으로 돌아간다
        b.side = -b.side;
      }
      // 체력이 낮으면 리젠구역으로 돌아가서 거의 다 찰 때까지 회복한다
      if (f.hp < 35) b.retreat = true;
      else if (f.hp >= 95) b.retreat = false;
      let tx = W / 2;
      let ty = b.lane;
      if (b.retreat) {
        tx = f.team === 'red' ? 90 : W - 90;
        ty = f.y;
      } else if (target) {
        tx = target.x;
        ty = target.y;
      }
      let dx = tx - f.x;
      let dy = ty - f.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      if (sees && !b.retreat) {
        // 적 쪽을 바라보며 비스듬히 다가간다. 가까우면 거의 멈춰서 방향만 맞춘다
        const a = Math.atan2(dy, dx) + b.side * 0.22;
        const speed = best < 220 ? 0.15 : 1;
        b.mx = Math.cos(a) * speed;
        b.my = Math.sin(a) * speed;
        if (Math.random() < 0.2) b.side = -b.side;
      } else if (b.stuck > 0) {
        b.mx = -dy * b.side;
        b.my = dx * b.side;
      } else {
        b.mx = dx;
        b.my = dy;
      }
    }
    b.stuck -= dt;
    if (f.charge >= SUPER_HITS && target && best < SUPER_RADIUS - 10 && Math.random() < dt * 3) this.useSuper(f.id);
    this.setInput(f.id, { mx: b.mx, my: b.my });
    if (sees && f.ammo >= 1 && Math.random() < dt * 2.4) {
      const cos = ((target.x - f.x) * f.faceX + (target.y - f.y) * f.faceY) / best;
      if (Math.acos(clamp(cos, -1, 1)) <= ASSIST_ANGLE) this.fire(f.id, { facing: true });
    }
  }

  assistTarget(f) {
    let best = null;
    let bestScore = Infinity;
    for (const o of this.fighters.values()) {
      if (o.team === f.team || !o.alive || !o.connected || o.hidden) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d > BULLET_RANGE || d === 0) continue;
      const cos = ((o.x - f.x) * f.faceX + (o.y - f.y) * f.faceY) / d;
      const ang = Math.acos(clamp(cos, -1, 1));
      if (ang > ASSIST_ANGLE) continue;
      const score = ang * 400 + d; // 정면에 가깝고 가까운 적 우선
      if (score < bestScore && hasLineOfSight(f.x, f.y, o.x, o.y)) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  nearestEnemy(f) {
    let best = null;
    let bestD = BULLET_RANGE + 60;
    for (const o of this.fighters.values()) {
      if (o.team === f.team || !o.alive || !o.connected || o.hidden) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < bestD && hasLineOfSight(f.x, f.y, o.x, o.y)) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  step(dt) {
    if (this.phase === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'playing';
        this.timer = MATCH_TIME;
        this.onEvent({ type: 'start' });
      }
      return;
    }
    if (this.phase !== 'playing') return;

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
      this.phase = 'over';
      this.onEvent({ type: 'over', result: this.result() });
      return;
    }

    for (const f of this.fighters.values()) if (f.brain && f.alive) this.botThink(f, dt);

    for (const f of this.fighters.values()) {
      if (f.hitFlash > 0) f.hitFlash -= dt;
      if (!f.alive) {
        f.respawn -= dt;
        if (f.respawn <= 0) {
          f.alive = true;
          f.hp = MAX_HP;
          f.ammo = AMMO_MAX;
          f.shield = SPAWN_SHIELD;
          f.sinceHit = REGEN_DELAY;
          this.placeAtSpawn(f);
          this.onEvent({ type: 'respawn', id: f.id });
        }
        continue;
      }
      if (f.shield > 0) f.shield -= dt;
      if (f.reveal > 0) f.reveal -= dt;
      if (f.cooldown > 0) f.cooldown -= dt;
      if (f.tapQueue > 0) f.tapQueue -= dt;
      // 탄창 교체: 한 발씩 차지 않고, 다 쓰면 교체 시간 뒤에 한 번에 꽉 찬다
      if (f.ammo === 0) {
        f.reload += dt;
        if (f.reload >= RELOAD_TIME) {
          f.reload = 0;
          f.ammo = AMMO_MAX;
        }
      } else {
        f.reload = 0;
      }
      f.sinceHit += dt;
      f.healing = inHomeZone(f) && f.sinceHit >= REGEN_DELAY && f.hp < MAX_HP;
      if (f.healing) f.hp = Math.min(MAX_HP, f.hp + REGEN_RATE * dt);

      const { mx, my, ax, ay, aiming } = f.input;
      f.x += mx * SPEED * dt;
      f.y += my * SPEED * dt;
      if (aiming) {
        f.faceX = ax;
        f.faceY = ay;
      } else if (mx || my) {
        const l = Math.hypot(mx, my);
        f.faceX = mx / l;
        f.faceY = my / l;
      }
      if ((f.input.firing || f.tapQueue > 0) && f.ammo >= 1 && f.cooldown <= 0) this.fire(f.id, { facing: true });
      f.x = clamp(f.x, PLAYER_R, W - PLAYER_R);
      f.y = clamp(f.y, PLAYER_R, H - PLAYER_R);
      for (const w of WALLS) circleRectPush(f, PLAYER_R, w); // GameEngine.moveFighter와 같은 규칙
    }

    const keep = [];
    for (const b of this.bullets) {
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      let hit = null;
      for (const o of this.fighters.values()) {
        if (o.team === b.team || !o.alive || !o.connected) continue;
        if (segDist2(b.x, b.y, nx, ny, o.x, o.y) <= PLAYER_R * PLAYER_R) {
          hit = o;
          break;
        }
      }
      if (hit) {
        this.damage(hit, b.owner, BULLET_DMG, false);
        this.onEvent({ type: 'hit', x: hit.x, y: hit.y, team: b.team });
        continue;
      }
      b.x = nx;
      b.y = ny;
      b.dist += BULLET_SPEED * dt;
      if (b.dist > BULLET_RANGE || pointInWall(b.x, b.y)) continue;
      keep.push(b);
    }
    this.bullets = keep;
    this.updateHidden();
  }

  updateHidden() {
    const list = [...this.fighters.values()];
    for (const f of list) {
      f.inBush = f.alive && inBush(f.x, f.y);
      if (!f.inBush || f.reveal > 0) {
        f.hidden = false;
        continue;
      }
      f.hidden = !list.some(
        (o) => o.team !== f.team && o.alive && o.connected && Math.hypot(o.x - f.x, o.y - f.y) < REVEAL_RANGE
      );
    }
  }

  damage(target, ownerId, amount, fromSuper) {
    if (target.shield > 0) return;
    target.hp -= amount;
    target.sinceHit = 0;
    target.hitFlash = 0.15;
    target.reveal = REVEAL_TIME;
    const owner = this.fighters.get(ownerId);
    if (owner && owner.team !== target.team) target.attackers.add(ownerId);
    if (owner && !fromSuper && owner.charge < SUPER_HITS) {
      owner.charge += 1;
      if (owner.charge === SUPER_HITS) this.onEvent({ type: 'superReady', id: ownerId });
    }
    this.onEvent({ type: 'damaged', id: target.id, by: ownerId });
    if (target.hp > 0) return;
    target.hp = 0;
    target.alive = false;
    target.respawn = RESPAWN_TIME;
    target.deaths += 1;
    const killer = owner;
    if (killer) {
      killer.kills += 1;
      this.score[killer.team] += 1;
      // 어시스트: 한 대라도 때린 사람 중 킬한 사람과 같은 팀인 사람
      for (const aid of target.attackers) {
        const a = this.fighters.get(aid);
        if (aid !== ownerId && a && a.team === killer.team) a.assists += 1;
      }
    }
    target.attackers.clear();
    const entry = {
      killer: killer ? killer.name : '?',
      killerTeam: killer ? killer.team : null,
      victim: target.name,
      victimTeam: target.team,
      t: Date.now(),
    };
    this.feed.push(entry);
    if (this.feed.length > 6) this.feed.shift();
    this.onEvent({ type: 'kill', killer: ownerId, victim: target.id, x: target.x, y: target.y });
  }

  result() {
    const list = [...this.fighters.values()].map((f) => ({
      id: f.id,
      name: f.name,
      team: f.team,
      kills: f.kills,
      deaths: f.deaths,
      assists: f.assists,
      points: points(f),
      bot: !!f.brain,
    }));
    list.sort(rankOrder);
    let winner = 'draw';
    if (this.score.red > this.score.blue) winner = 'red';
    else if (this.score.blue > this.score.red) winner = 'blue';
    return { winner, score: { ...this.score }, players: list };
  }

  // 화면에 그릴 플레이어 한 명의 정보
  playerState(f) {
    const r = (v) => Math.round(v);
    return {
      id: f.id,
      n: f.name,
      t: f.team,
      x: r(f.x),
      y: r(f.y),
      hp: r(f.hp),
      al: f.alive,
      rs: f.alive ? 0 : Math.ceil(f.respawn),
      sh: f.shield > 0,
      am: f.ammo,
      fx: Math.round(f.faceX * 100) / 100,
      fy: Math.round(f.faceY * 100) / 100,
      hf: f.hitFlash > 0,
      hid: f.hidden,
      ib: f.inBush,
      sr: f.charge >= SUPER_HITS,
      hl: !!f.healing,
      k: f.kills,
      d: f.deaths,
      as: f.assists,
      pt: points(f),
      c: f.connected,
      bot: !!f.brain,
    };
  }

  bulletState(b) {
    return [b.id, Math.round(b.x), Math.round(b.y), b.team === 'red' ? 0 : 1];
  }

  // 프로젝터 화면용 전체 상태
  snapshot() {
    return {
      phase: this.phase,
      timer: Math.max(0, this.timer),
      score: this.score,
      players: [...this.fighters.values()].map((f) => this.playerState(f)),
      bullets: this.bullets.map((b) => this.bulletState(b)),
      feed: this.feed,
    };
  }

  // 학생 폰 화면용: 내 주변만, 부시에 숨은 적은 빼고 보낸다 (숨은 우리 팀은 보임)
  view(id) {
    const me = this.fighters.get(id);
    if (!me) return null;
    const near = (x, y) => Math.abs(x - me.x) < VIEW_RANGE_X && Math.abs(y - me.y) < VIEW_RANGE_Y;
    const players = [];
    for (const f of this.fighters.values()) {
      if (f !== me && (!near(f.x, f.y) || (f.hidden && f.team !== me.team))) continue;
      players.push(this.playerState(f));
    }
    return {
      me: this.personal(id),
      players,
      // 5번째 값 1 = 내 총알 (폰이 미리 그려 둔 내 총알과 겹치지 않게 숨길 때 씀)
      bullets: this.bullets.filter((b) => near(b.x, b.y)).map((b) => [...this.bulletState(b), b.owner === id ? 1 : 0]),
      feed: this.feed.slice(-3),
    };
  }

  // 각 학생 폰으로 보내는 내 상태
  personal(id) {
    const f = this.fighters.get(id);
    if (!f) return null;
    return {
      phase: this.phase,
      timer: Math.max(0, this.timer),
      score: this.score,
      team: f.team,
      hp: Math.round(f.hp),
      maxHp: MAX_HP,
      ammo: f.ammo,
      reload: f.ammo === 0 ? f.reload / RELOAD_TIME : 1, // 탄창 교체 진행률
      alive: f.alive,
      respawn: f.alive ? 0 : Math.max(0, f.respawn),
      kills: f.kills,
      deaths: f.deaths,
      assists: f.assists,
      points: points(f),
      charge: f.charge,
      superMax: SUPER_HITS,
      hidden: f.hidden,
      inBush: f.inBush,
      healing: !!f.healing,
    };
  }
}

const GameEngine = {
  Match,
  TEAMS,
  POINTS,
  WORLD: { W, H, SPAWN_ZONE_W, PLAYER_R, SPEED, AMMO_MAX, MAX_HP, BULLET_RANGE, BULLET_SPEED, FIRE_COOLDOWN, TAP_HOLD, ASSIST_ANGLE, SUPER_HITS, SUPER_RADIUS, walls: WALLS, bushes: BUSHES },
  // 폰이 내 총알을 서버 답보다 먼저 그려 볼 때 서버와 같은 벽·시야 규칙을 쓴다
  pointInWall,
  hasLineOfSight,
  // 폰에서 내 캐릭터를 미리 움직여 볼 때(예측) 서버와 똑같이 벽에 막히도록 같이 쓴다
  moveFighter(f, mx, my, dt) {
    f.x = clamp(f.x + mx * SPEED * dt, PLAYER_R, W - PLAYER_R);
    f.y = clamp(f.y + my * SPEED * dt, PLAYER_R, H - PLAYER_R);
    for (const w of WALLS) circleRectPush(f, PLAYER_R, w);
  },
};

if (typeof module !== 'undefined') module.exports = GameEngine;
else window.GameEngine = GameEngine; // 브라우저에서 <script src="game.js">로 불러올 때
