// 고스트헌터: 모든 주사위·카드·이동·승패 판정은 서버에서만 처리한다.
const crypto = require("crypto");
const { decide } = require("./ghost-ai");
const D = require("./public/ghost-data");
function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
class Expedition {
  constructor(players, rng = Math.random, difficulty = "hard") {
    this.rng = rng;
    this.difficulty = Object.hasOwn(D.difficulties, difficulty) ? difficulty : "hard";
    this.returnedFragments = [];
    this.players = players.map((p) => ({
      ...p,
      node: "camp",
      rescues: 0,
      carry: null,
    }));
    this.turn = 0;
    this.phase = "roll";
    this.moves = 0;
    this.roll = null;
    this.card = null;
    this.dice = [];
    this.battle = null;
    this.log = [
      this.difficulty === "easy"
        ? "쉬움: 봉인조각 8개를 순서에 상관없이 회수하세요."
        : "어려움: 봉인조각 8개를 순서대로 회수하세요.",
    ];
    this.dex = [];
    this.returned = 0;
    this.round = 1;
    this.regions = D.regions.map((r) => ({
      id: r.id,
      mobs: [],
      dark: false,
      fragment: null,
      revealed: false,
    }));
    const locations = shuffle([...Array(10).keys()], rng).slice(0, 8);
    locations.forEach((r, i) => (this.regions[r].fragment = i + 1));
    this.deck = shuffle([...Array(31).keys()], rng);
    this.discard = [];
  }
  get active() {
    return this.players[this.turn];
  }
  stage(p) {
    return p.partner === 3
      ? p.rescues >= 6
        ? 1
        : 0
      : p.rescues >= 6
        ? 2
        : p.rescues >= 3
          ? 1
          : 0;
  }
  final(p) {
    return p.rescues >= 6;
  }
  note(s) {
    this.log.push(s);
    if (this.log.length > 35) this.log.shift();
  }
  region(node) {
    return this.regions.find((r) => r.id === node);
  }
  rescue(region, count, participants) {
    const names = region.mobs.splice(0, count);
    this.dex = [...new Set([...this.dex, ...names])];
    participants.forEach((p) => (p.rescues += names.length));
    region.dark = false;
    this.note(
      names.join("·") + " 구조! 참여 파트너의 구조 기록 +" + names.length,
    );
  }
  draw() {
    if (!this.deck.length)
      this.deck = shuffle(this.discard.splice(0), this.rng);
    const c = this.deck.pop();
    this.card = c;
    this.discard.push(c);
    if (c === 30) {
      this.deck = shuffle([...this.deck, ...this.discard], this.rng);
      this.discard = [];
      this.note("다시 섞기! 출현 없이 카드 더미를 모두 섞습니다.");
      return;
    }
    let index = Math.floor(c / 3);
    const name = D.regions[index].mobs[c % 3];
    for (let i = 0; i < 10; i++) {
      const region = this.regions[index];
      if (!region.dark) {
        region.mobs.push(name);
        if (region.mobs.length === 3) {
          region.dark = true;
          this.note(D.regions[index].name + "에 다크라이 출현!");
        } else this.note(D.regions[index].name + "에 폭주 " + name + " 출현");
        break;
      }
      index = (index + 1) % 10;
    }
    if (this.regions.filter((r) => r.dark).length >= 6) {
      this.phase = "lost";
      this.note("다크라이가 6곳을 장악했습니다. 다음 탐사에서 다시 도전해요.");
    }
    this.checkSoloLoss();
  }
  checkSoloLoss() {
    if (this.players.length !== 1 || ["won", "lost"].includes(this.phase))
      return;
    const blocked = this.regions.find(
      (r) =>
        r.dark &&
        (r.fragment || (this.active.node === r.id && this.active.carry)),
    );
    if (!blocked) return;
    this.phase = "lost";
    this.lossReason =
      D.nodes[blocked.id].name +
      "의 봉인조각을 회수할 수 없어 탐사를 종료합니다. 1인 플레이에서는 다크라이를 해결할 수 없어요.";
    this.note(this.lossReason);
  }
  reachable() {
    const p = this.active;
    if (this.phase !== "move") return {};
    const r = this.region(p.node);
    if (r && r.dark && p.carry) return { [p.node]: 0 };
    const dist = { [p.node]: 0 },
      q = [p.node];
    while (q.length) {
      const a = q.shift();
      if (dist[a] >= this.moves) continue;
      const here = this.region(a);
      if (a !== p.node && here && here.dark && p.carry) continue;
      for (const b of D.nodes[a].links)
        if (dist[b] === undefined) {
          dist[b] = dist[a] + 1;
          q.push(b);
        }
    }
    return dist;
  }
  action(id, req) {
    if (
      !req ||
      typeof req !== "object" ||
      this.active.id !== id ||
      ["won", "lost"].includes(this.phase)
    )
      return "지금은 내 차례가 아니에요.";
    const p = this.active,
      r = this.region(p.node);
    if (req.type === "roll" && this.phase === "roll") {
      this.roll = 1 + Math.floor(this.rng() * 6);
      this.moves = this.roll + (this.final(p) ? 1 : 0);
      this.card = null;
      this.dice = [];
      this.battle = null;
      this.phase = "move";
      this.note(
        p.name +
          " 이동 주사위 " +
          this.roll +
          (this.final(p) ? " + 진화 보너스 1" : ""),
      );
      if (this.roll !== 6) this.draw();
      return;
    }
    if (req.type === "move" && this.phase === "move") {
      if (!Object.hasOwn(this.reachable(), req.node))
        return "그곳까지 이동할 수 없어요.";
      const distances = this.reachable();
      let step = req.node;
      const path = [step];
      while (step !== p.node) {
        step = D.nodes[step].links.find(
          (n) =>
            distances[n] === distances[step] - 1 &&
            !(n !== p.node && p.carry && this.region(n)?.dark),
        );
        path.push(step);
      }
      for (const node of path) {
        const visited = this.region(node);
        if (visited && !visited.revealed) {
          visited.revealed = true;
          if (visited.fragment)
            this.note("봉인조각 " + visited.fragment + "번 발견!");
        }
      }
      p.node = req.node;
      this.phase = "act";
      this.checkSoloLoss();
      return;
    }
    if (!["act", "move", "end"].includes(this.phase))
      return "먼저 주사위와 출현 카드를 확인하세요.";
    if (req.type === "pickup") {
      if (!r || !r.fragment || p.carry) return "가져갈 봉인조각이 없어요.";
      p.carry = r.fragment;
      r.fragment = null;
      r.revealed = true;
      // 배틀 결과를 유지해 줍기 후 재공격할 수 없게 한다.
      if (this.phase !== "end") this.phase = "act";
      return;
    }
    if (req.type === "drop") {
      if (!r || r.fragment || !p.carry)
        return "빈 지역에서 조각을 내려놓을 수 있어요.";
      r.fragment = p.carry;
      r.revealed = true;
      p.carry = null;
      this.checkSoloLoss();
      return;
    }
    if (req.type === "deliver") {
      if (p.node !== "camp" || !p.carry)
        return "봉인조각을 들고 베이스캠프에서 반납하세요.";
      if (D.difficulties[this.difficulty].ordered && p.carry !== this.returned + 1)
        return "베이스캠프에서 " + (this.returned + 1) + "번 조각부터 반납하세요.";
      const fragment = p.carry;
      this.returnedFragments.push(fragment);
      this.returned++;
      p.carry = null;
      this.note(fragment + "번 봉인조각 반납!");
      this.checkWin();
      return;
    }
    if (req.type === "battle" && this.phase === "act" && !this.battle) {
      if (!r || !r.mobs.length) return "이곳에는 폭주 포켓몬이 없어요.";
      const allies = this.players.filter(
        (o) => o.node === p.node && o.id !== p.id,
      );
      let team = [p];
      if (allies.length) {
        const helper = allies.find((o) => o.id === req.helper) || allies[0];
        team.push(helper);
      }
      if (r.dark && team.length < 2)
        return "다크라이는 두 명이 함께 있어야 해결할 수 있어요.";
      this.dice = team.map(() => Math.floor(this.rng() * 6));
      this.battle = {
        participants: team.map((o) => ({ id: o.id, name: o.name })),
        dark: !!r.dark,
        extra: null,
        success: false,
      };
      const wins = () => this.dice.some((d) =>
        D.combatSymbol(d, this.difficulty) === (r.dark ? "다크라이" : "몬스터볼"));
      let success = wins();
      if (!success && !r.dark) {
        const eligible = D.partners[p.partner].zones.includes(
          Number(r.id.slice(1)),
        );
        const chance = p.partner === 5 && this.rng() < 0.2;
        if (eligible || chance) {
          this.note(eligible ? "필드효과, 추가공격!" : "랜덤 공격 찬스!");
          const extra = Math.floor(this.rng() * 6);
          this.battle.extra = {
            id: p.id,
            value: extra,
            reason: eligible ? "필드효과, 추가공격!" : "랜덤 공격 찬스!",
          };
          success = D.combatSymbol(extra, this.difficulty) === "몬스터볼";
        }
      }
      this.battle.success = success;
      if (success) this.rescue(r, r.dark ? 3 : 1, team);
      else this.note("이번 공격은 빗나갔어요. 함께 다시 도전해요.");
      this.phase = "end";
      return;
    }
    if (req.type === "end") {
      this.next();
      return;
    }
    return "지금 할 수 없는 행동이에요.";
  }
  checkWin() {
    // 8개를 모두 반납하는 순간 승리 (캠프에 전원 모일 때까지 기다리지 않음 — 사용자 지정)
    if (this.returned === 8) {
      this.phase = "won";
      this.note(
        "여덟 조각의 봉인이 완성되었습니다! 파트너들의 협력으로 기라티나가 평온을 되찾았습니다.",
      );
    }
  }
  next() {
    this.checkWin();
    if (this.phase === "won") return;
    this.turn = (this.turn + 1) % this.players.length;
    if (!this.turn) this.round++;
    this.phase = "roll";
    this.moves = 0;
    this.roll = null;
    this.card = null;
    this.dice = [];
    this.battle = null;
  }
  snapshot() {
    return {
      players: this.players.map((p) => ({ ...p, stage: this.stage(p) })),
      turn: this.turn,
      phase: this.phase,
      difficulty: this.difficulty,
      returnedFragments: [...this.returnedFragments],
      lossReason: this.lossReason || null,
      moves: this.moves,
      roll: this.roll,
      card: this.card,
      dice: this.dice,
      battle: this.battle,
      regions: this.regions.map((r) => ({
        ...r,
        fragment: r.revealed ? r.fragment : null,
        hidden: !r.revealed && !!r.fragment,
      })),
      returned: this.returned,
      dex: this.dex,
      round: this.round,
      log: this.log,
      remaining: this.deck.length,
      reachable: this.reachable(),
    };
  }
}
function attach(io) {
  const ns = io.of("/ghost"),
    rooms = new Map();
  const secret = () => crypto.randomBytes(16).toString("hex");
  const clean = (s) =>
    String(s || "")
      .replace(/[<>\x00-\x1f]/g, "")
      .trim()
      .slice(0, 10) || "트레이너";
  // 방마다 한 번만 예약하고, 리셋·닫기·차례 넘김 때 지난 예약을 취소한다.
  const aiTimers = new Map();
  const cancelAI = (r) => {
    clearTimeout(aiTimers.get(r.code));
    aiTimers.delete(r.code);
  };
  const scheduleAI = (r) => {
    if (aiTimers.has(r.code)) return;
    const g = r.game;
    if (!g?.active.ai || ["won", "lost"].includes(g.phase) ||
        (!r.host && !r.players.some(p => !p.ai && p.socket))) return;
    const phase = g.phase, active = g.active.id, round = g.round;
    const delay = phase === "move" ? 3000 : phase === "end" ? 2400 : 1400;
    const timer = setTimeout(() => {
      aiTimers.delete(r.code);
      if (rooms.get(r.code) !== r || r.game !== g || g.active.id !== active ||
          g.phase !== phase || g.round !== round) return;
      if (!r.host && !r.players.some(p => !p.ai && p.socket)) return;
      const req = decide(g.snapshot());
      if (!req) return;
      if (req.reason) g.note(g.active.name + ": " + req.reason);
      if (req.type === "end") g.next();
      else {
        const error = g.action(active, req);
        if (error) { g.note(g.active.name + ": 다음 차례에 다시 시도합니다."); g.next(); }
      }
      publish(r);
    }, delay);
    timer.unref();
    aiTimers.set(r.code, timer);
  };
  const publish = (r) => {
    ns.to(r.code).emit("update", {
      code: r.code,
      difficulty: r.difficulty,
      players: r.players.map(({ key, socket, ...p }) => ({
        ...p,
        connected: !!p.ai || !!socket,
      })),
      game: r.game ? r.game.snapshot() : null,
    });
    scheduleAI(r);
  };
  ns.on("connection", (s) => {
    s.on("create", (_, cb) => {
      let code;
      do {
        code = String(1000 + crypto.randomInt(9000));
      } while (rooms.has(code));
      const r = {
        code,
        key: secret(),
        host: s.id,
        players: [],
        game: null,
        difficulty: "hard",
        touched: Date.now(),
      };
      rooms.set(code, r);
      s.data.code = code;
      s.data.host = true;
      s.join(code);
      cb({ ok: true, code, key: r.key });
      publish(r);
    });
    s.on("join", (d, cb) => {
      const r = rooms.get(String(d?.code));
      if (!r) return cb({ error: "방을 찾을 수 없어요." });
      if (d.host && d.key !== r.key)
        return cb({ error: "선생님 방 복구 정보가 만료됐어요." });
      const host = d.host && d.key === r.key;
      let p;
      if (!host) {
        p = r.players.find((p) => !p.ai && p.id === d.id && p.key === d.key);
        if (!p) {
          if (r.game)
            return cb({
              error: "탐사가 시작됐어요. 다음 탐사를 기다려주세요.",
            });
          if (r.players.length >= 6)
            return cb({ error: "최대 6명까지 참가할 수 있어요." });
          const used = r.players.map((p) => p.partner);
          p = {
            id: secret().slice(0, 10),
            key: secret(),
            name: clean(d.name),
            partner: [0, 1, 2, 3, 4, 5].find((i) => !used.includes(i)),
            ready: false,
          };
          r.players.push(p);
        }
        if (p.socket && p.socket !== s.id) {
          const old = ns.sockets.get(p.socket);
          if (old) {
            old.leave(r.code);
            old.data.id = null;
            old.emit("closed", "다른 기기에서 접속했습니다.");
          }
        }
        p.socket = s.id;
        s.data.id = p.id;
      } else {
        r.host = s.id;
        s.data.host = true;
      }
      s.data.code = r.code;
      s.join(r.code);
      r.touched = Date.now();
      cb({
        ok: true,
        code: r.code,
        id: p?.id,
        key: host ? r.key : p.key,
        host,
      });
      publish(r);
    });
    s.on("command", (d, cb = () => {}) => {
      const r = rooms.get(s.data.code);
      if (!r) return cb({ error: "방이 종료됐어요." });
      r.touched = Date.now();
      const host = r.host === s.id && s.data.host;
      const p = r.players.find((p) => p.id === s.data.id && p.socket === s.id);
      let error;
      if (d?.type === "close" && host) {
        ns.to(r.code).emit("closed", "선생님이 방을 닫았습니다.");
        cancelAI(r);
        rooms.delete(r.code);
        return cb({ ok: true });
      }
      if (d?.type === "addAI" && host && !r.game) {
        if (r.players.length >= 6) error = "최대 6명까지 참가할 수 있어요.";
        else {
          const partner = D.partners.findIndex((_, i) => !r.players.some(p => p.partner === i));
          r.players.push({ id: secret().slice(0, 10), ai: true,
            name: "AI " + D.partners[partner].names[0], partner, ready: true });
        }
      } else if (d?.type === "difficulty" && host && !r.game) {
        if (!Object.hasOwn(D.difficulties, d.difficulty)) error = "난이도를 다시 선택해 주세요.";
        else if (r.difficulty !== d.difficulty) {
          r.difficulty = d.difficulty;
          r.players.forEach((p) => (p.ready = !!p.ai));
        }
      } else if (d?.type === "start" && host && !r.game) {
        if (
          r.players.length < 1 ||
          r.players.some((p) => !p.ready || (!p.ai && !p.socket))
        )
          error = "1~6명이 모두 준비하면 시작할 수 있어요.";
        else
          r.game = new Expedition(
            r.players.map(({ id, name, partner, ai }) => ({ id, name, partner, ai: !!ai })),
            Math.random,
            r.difficulty,
          );
      } else if (
        d?.type === "reset" &&
        (host || (p && r.game && ["won", "lost"].includes(r.game.phase)))
      ) {
        cancelAI(r);
        r.game = null;
        r.players.forEach((p) => (p.ready = !!p.ai));
      } else if (d?.type === "kick" && host && !r.game) {
        const target = r.players.find((p) => p.id === d.id);
        if (target) {
          if (target.socket) {
            const old = ns.sockets.get(target.socket);
            if (old) {
              old.leave(r.code);
              old.data.id = null;
              old.emit("closed", "선생님이 대기실에서 내보냈습니다.");
            }
          }
          r.players = r.players.filter((p) => p !== target);
        }
      } else if (
        d?.type === "skip" &&
        host &&
        r.game &&
        !["won", "lost"].includes(r.game.phase)
      ) {
        cancelAI(r);
        r.game.note("선생님이 자리를 비운 플레이어의 차례를 넘겼습니다.");
        r.game.next();
      } else if (p && !r.game && d?.type === "partner") {
        if (
          !Number.isInteger(d.partner) ||
          !D.partners[d.partner] ||
          r.players.some((o) => o !== p && o.partner === d.partner)
        )
          error = "다른 친구가 선택한 파트너예요.";
        else {
          p.partner = d.partner;
          p.ready = false;
        }
      } else if (p && !r.game && d?.type === "ready") p.ready = !p.ready;
      else if (p && r.game) {
        if (
          d?.type === "end" &&
          r.game.phase === "end" &&
          r.game.active.id === p.id
        )
          r.game.next();
        else error = r.game.action(p.id, d);
      } else error = "지금 할 수 없는 행동이에요.";
      cb({ ok: !error, error });
      publish(r);
    });
    s.on("disconnect", () => {
      const r = rooms.get(s.data.code);
      if (!r) return;
      if (r.host === s.id) r.host = null;
      const p = r.players.find((p) => p.socket === s.id);
      if (p) p.socket = null;
      publish(r);
    });
  });
  const timer = setInterval(() => {
    for (const [code, r] of rooms)
      if (
        !r.host &&
        r.players.every((p) => !p.socket) &&
        Date.now() - r.touched > 3600000
      )
        { cancelAI(r); rooms.delete(code); }
  }, 60000);
  timer.unref();
  return rooms;
}
module.exports = { Expedition, attach };
