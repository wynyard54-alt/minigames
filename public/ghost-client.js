/* 화면은 서버 상태를 표시하고, 선택한 행동만 보낸다. */
(() => {
  const $ = (id) => document.getElementById(id),
    D = GhostData,
    params = new URLSearchParams(location.search),
    host = params.get("host") === "1";
  const socket = io("/ghost"),
    A = "assets/ghost/";
  const revealFlights = new Set();
  let room = null,
    me = null,
    mobs = {},
    busy = false,
    presentationKey = null,
    revealVersion = 0,
    revealing = false,
    previousRollKey = null,
    previousBattleKey = null,
    selectedHelper = null,
    lastTurnKey = null,
    turnToastTimer = null;
  const get = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  };
  const put = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  };
  const text = (id, s) => ($(id).textContent = s);
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  const image = (src, alt, cls) => {
    const im = document.createElement("img");
    im.src = A + src;
    im.alt = alt;
    im.className = cls || "";
    return im;
  };
  const pawn = (p) => `${D.partners[p.partner].color}-${p.stage || 0}.webp`;
  const command = (type, extra = {}) => {
    if (busy || !socket.connected) return;
    busy = true;
    $("outcomeBack").disabled = true;
    socket.timeout(6000).emit("command", { type, ...extra }, (err, r) => {
      busy = false;
      $("outcomeBack").disabled = !socket.connected;
      text(
        "error",
        err ? "연결이 지연되고 있어요. 다시 눌러주세요." : r.error || "",
      );
      if ($("outcome").open)
        text(
          "outcomeError",
          err ? "연결이 지연되고 있어요. 다시 눌러주세요." : r.error || "",
        );
    });
  };
  function fieldDescription(partner) {
    return partner.zones.length
      ? partner.zones.map((id) => D.regions[id - 1].name).join("·") +
          "에서 필드효과로 구출 찬스 ×2"
      : "모든 지역에서 20% 확률로 추가공격 찬스";
  }
  const guide = $("partnerFieldGuide");
  guide.append(
    document.createTextNode(
      "일반 구조 공격이 실패하면 유리한 지역에서 추가공격을 1회 더 합니다(구출 찬스 ×2). 진화 후에도 동일하며, 다크라이 배틀에는 적용되지 않습니다.",
    ),
  );
  D.partners.forEach((partner) => {
    const line = document.createElement("span");
    line.className = "field-guide-line";
    line.textContent =
      partner.names.join("·") + ": " + fieldDescription(partner);
    guide.append(line);
  });
  function button(label, fn, disabled = false) {
    const b = document.createElement("button");
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = fn;
    return b;
  }
  function join(d) {
    socket.emit("join", d, (r) => {
      if (r.error) {
        text("error", r.error);
        if (host) {
          put("gh:host", null);
          text(
            "error",
            r.error + " 게임 선택으로 돌아가 새 방을 만들어주세요.",
          );
        } else show("join", true);
        return;
      }
      me = r;
      put("gh:" + r.code + (host ? ":host" : ""), r);
      text("error", "");
    });
  }
  socket.on("connect", () => {
    text("connection", "연결됨");
    busy = false;
    const code = params.get("room");
    if (host) {
      const saved = get("gh:host");
      if (saved) {
        join({ ...saved, host: true });
      } else
        socket.emit("create", {}, (r) => {
          me = { ...r, host: true };
          put("gh:host", r);
          put("gh:" + r.code + ":host", me);
        });
    } else {
      const saved = code && get("gh:" + code);
      if (saved) join({ ...saved, code });
      else show("join", true);
    }
  });
  socket.on("disconnect", () => {
    text("connection", "재연결 중…");
    $("outcomeBack").disabled = true;
    busy = false;
  });
  socket.on("closed", (s) => {
    text("error", s);
    room = null;
    closeOutcome();
    cancelReveal();
    document.body.classList.remove("playing");
    show("game", false);
    show("lobby", false);
    show("join", !host);
    put("gh:host", null);
    if (host) location.href = "/";
  });
  $("code").value = params.get("room") || "";
  $("name").value = get("mg:name") || "";
  $("joinForm").onsubmit = (e) => {
    e.preventDefault();
    const code = $("code").value.trim();
    params.set("room", code);
    history.replaceState(null, "", "?" + params);
    put("mg:name", $("name").value);
    join({ code, name: $("name").value });
  };
  $("ready").onclick = () => {
    sfx("beep");
    command("ready");
  };
  $("start").onclick = () => command("start");
  $("close").onclick = () => {
    if (confirm("방을 닫고 게임 선택으로 돌아갈까요?")) command("close");
  };
  $("skip").onclick = () => {
    if (confirm("현재 친구의 남은 행동을 건너뛸까요?")) command("skip");
  };
  $("reset").onclick = () => {
    if (confirm("진행 중인 탐사를 끝내고 대기실로 돌아갈까요?"))
      command("reset");
  };
  $("outcomeBack").onclick = () => command("reset");
  $("outcome").addEventListener("cancel", (event) => event.preventDefault());
  let qrCode = "";
  async function qr(code) {
    if (qrCode === code) return;
    qrCode = code;
    let ips = [];
    try {
      const r = await fetch("/api/lan");
      ips = (await r.json()).ips || [];
    } catch {}
    const urls = [
      location.origin,
      ...ips.map(
        (ip) => location.protocol + "//" + ip + ":" + (location.port || 80),
      ),
    ];
    $("address").replaceChildren();
    [...new Set(urls)].forEach((url) => {
      const o = document.createElement("option");
      o.value = url;
      o.textContent = url;
      $("address").append(o);
    });
    if (["localhost", "127.0.0.1"].includes(location.hostname) && ips.length)
      $("address").selectedIndex = 1;
    const update = () => {
      const url = $("address").value + "/ghost.html?room=" + code;
      $("qr").src = "/api/qr?text=" + encodeURIComponent(url);
      text("joinUrl", url);
    };
    $("address").onchange = update;
    update();
  }
  socket.on("update", (r) => {
    const before = room?.game;
    room = r;
    prepareEffects(before, r.game);
    render();
    soundFromChange(before, r.game);
  });

  // ---------- 효과음 ----------
  // 폰은 화면을 한 번 터치해야 소리를 낼 수 있다
  const sfx = (name, vol, gap) => window.GameSound && GameSound.play(name, vol, gap);
  const later = (ms, fn) => setTimeout(fn, ms);
  ["pointerdown", "keydown"].forEach((ev) =>
    addEventListener(ev, () => window.GameSound && GameSound.unlock(), { capture: true }),
  );
  const renderMute = () => text("muteBtn", window.GameSound && GameSound.isMuted() ? "🔇" : "🔊");
  $("muteBtn").onclick = () => {
    GameSound.setMuted(!GameSound.isMuted());
    renderMute();
  };
  renderMute();
  // 두 칸 사이의 가장 짧은 길 (말이 한 칸씩 걸어가는 경로)
  function pathBetween(from, to) {
    const prev = { [from]: null },
      q = [from];
    while (q.length) {
      const n = q.shift();
      if (n === to) break;
      for (const m of D.nodes[n].links) if (!(m in prev)) (prev[m] = n), q.push(m);
    }
    if (!(to in prev)) return [from, to];
    const path = [];
    for (let n = to; n !== null; n = prev[n]) path.unshift(n);
    return path;
  }

  // ---------- 지도 연출: 말 걷기, 출현 말 탁 놓기, 다크라이, 경고, 구조, 진화 ----------
  const STEP_MS = 190; // 말이 한 칸 가는 시간
  const fxState = { walks: new Map(), drops: new Map() };
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 연출 끝날 즈음(주사위·카드 공개 뒤) 시각
  function revealEnd(a, b) {
    const rolled = b.roll !== null && (a.roll !== b.roll || a.turn !== b.turn || a.round !== b.round);
    const battled = b.battle && JSON.stringify(a.battle) !== JSON.stringify(b.battle);
    if (calm()) return 0;
    return rolled ? 1150 : battled ? (b.battle.extra ? 1900 : 1000) : 0;
  }
  const pawnPos = (node) => {
    const n = D.nodes[node];
    return { x: n.pawnX ?? n.x, y: n.pawnY ?? n.y };
  };
  const clusterPos = (node) => {
    const n = D.nodes[node];
    return { x: n.encounterX ?? n.x, y: n.encounterY ?? n.y };
  };
  // 지도 위 잠깐 보였다 사라지는 효과 (다시 그려도 지워지지 않는 별도 층)
  function fxEl(cls, pos, html) {
    const el = document.createElement("div");
    el.className = "fx " + cls;
    el.style.left = pos.x + "%";
    el.style.top = pos.y + "%";
    if (html) el.innerHTML = html;
    $("fxLayer").append(el);
    return el;
  }
  function prepareEffects(a, b) {
    if (!a || !b || calm()) return;
    const now = performance.now(),
      after = revealEnd(a, b);
    // 말 걷기
    b.players.forEach((p, i) => {
      const q = a.players[i];
      if (q && q.id === p.id && q.node !== p.node) {
        const path = pathBetween(q.node, p.node);
        fxState.walks.set(p.id, { path, start: now, dur: (path.length - 1) * STEP_MS });
      }
    });
    b.regions.forEach((r, i) => {
      const o = a.regions[i];
      // 새로 나온 폭주 포켓몬: 카드 공개 뒤 위에서 '탁' 놓인다
      for (let k = o.mobs.length; k < r.mobs.length; k++) fxState.drops.set(r.id + ":" + k, now + after);
      if (r.dark && !o.dark) {
        fxState.drops.set(r.id + ":dark", now + after);
        later(after, () => {
          const board = $("board");
          board.classList.remove("quake");
          void board.offsetWidth;
          board.classList.add("quake");
          later(1300, () => board.classList.remove("quake"));
        });
      } else if (!r.dark && o.mobs.length < 2 && r.mobs.length === 2)
        later(after + 420, () => {
          // 한 마리만 더 오면 다크라이: 한 번 경고
          const w = fxEl("danger", clusterPos(r.id), "<b>⚠ 위험!</b>");
          later(2800, () => w.remove());
        });
      // 구조 성공: 사라진 포켓몬을 잠깐 그대로 두었다가 몬스터볼로 쏙
      const gone = [...o.mobs];
      r.mobs.forEach((m) => gone.splice(gone.indexOf(m), 1));
      if (b.battle?.success && (gone.length || (o.dark && !r.dark))) captureFx(r.id, gone, o.dark && !r.dark, after, b);
    });
    // 진화
    b.players.forEach((p, i) => {
      const q = a.players[i];
      if (!q || q.id !== p.id || (p.stage || 0) <= (q.stage || 0)) return;
      later(after + 700, () => {
        const pos = pawnPos(p.node);
        const el = fxEl("evolve", pos, "<i></i><b></b>");
        const name = D.partners[p.partner].names[p.stage],
          last = name.charCodeAt(name.length - 1) - 0xac00,
          ro = last < 0 || last % 28 === 0 || last % 28 === 8 ? "로" : "으로"; // 받침 있으면 '으로'
        el.querySelector("b").textContent = name + ro + " 진화!";
        later(2200, () => el.remove());
      });
    });
  }
  function captureFx(node, names, dark, after, b) {
    const pos = clusterPos(node);
    const pics = names.map((n) => mobs[n]).filter(Boolean);
    if (dark) pics.unshift("darkrai.webp");
    // 결과가 나오기 전까지 사라진 포켓몬을 원래 자리에 그대로 보여 준다
    const holder = fxEl("capture", pos);
    pics.forEach((src) => holder.append(image(src, "", dark && src === "darkrai.webp" ? "cap-dark" : "cap-mob")));
    later(after, () => {
      holder.classList.add("go");
      const ball = fxEl("ball", { x: pos.x, y: pos.y - 2 }, "<i class=\"pokeball-icon\"></i>");
      const rescuer = b.battle.participants?.[0];
      const who = rescuer && b.players.find((o) => o.id === rescuer.id);
      const to = who ? pawnPos(who.node) : pos;
      later(650, () => {
        holder.remove();
        ball.animate(
          [
            { left: pos.x + "%", top: pos.y - 2 + "%" },
            { left: (pos.x + to.x) / 2 + "%", top: Math.min(pos.y, to.y) - 9 + "%" },
            { left: to.x + "%", top: to.y - 4 + "%", opacity: 0.2 },
          ],
          { duration: 520, easing: "ease-in", fill: "forwards" },
        );
        const t = fxEl("float", { x: pos.x, y: pos.y - 6 });
        t.textContent = "+" + (dark ? 3 : names.length) + " 구조!";
        later(560, () => ball.remove());
        later(1400, () => t.remove());
      });
    });
  }
  // drawBoard 안에서: 걷는 중인 말, 막 놓이는 포켓몬에 움직임 붙이기
  function animatePiece(piece, p, finalX, finalY) {
    const w = fxState.walks.get(p.id);
    if (!w) return;
    const t = performance.now() - w.start;
    if (t >= w.dur + 200) return fxState.walks.delete(p.id);
    const frames = w.path.map((id, k) => {
      const pt = k === w.path.length - 1 ? { x: finalX, y: finalY } : k === 0 ? pawnPos(id) : D.nodes[id];
      return { left: pt.x + "%", top: pt.y + "%" };
    });
    piece.animate(frames, { duration: Math.max(1, w.dur), easing: "linear" }).currentTime = Math.min(t, w.dur);
    const img = piece.querySelector(".pawn");
    if (w.dur && t < w.dur)
      img.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(-16%)" }, { transform: "translateY(0)" }],
        { duration: STEP_MS, iterations: w.path.length - 1, easing: "ease-out" },
      ).currentTime = t;
    // 도착: '탁' 하고 살짝 눌렸다가 돌아온다
    const land = img.animate(
      [{ transform: "scale(1.14, 0.82)" }, { transform: "scale(0.96, 1.05)" }, { transform: "scale(1)" }],
      { duration: 200, easing: "ease-out" },
    );
    land.currentTime = t - w.dur;
  }
  function animateDrop(img, key) {
    const start = fxState.drops.get(key);
    if (start === undefined) return;
    const t = performance.now() - start;
    if (t > 600) return fxState.drops.delete(key);
    img.animate(
      [
        { transform: "translateY(-140%) scale(1.1)", opacity: 0 },
        { transform: "translateY(0) scale(1.18, 0.78)", opacity: 1, offset: 0.65 },
        { transform: "translateY(0) scale(0.95, 1.06)", offset: 0.85 },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: 460, easing: "ease-in", fill: "backwards" },
    ).currentTime = t;
    if (t < 300) later(300 - t, () => img.isConnected && puff(img));
  }
  // 포켓몬이 놓일 때 발밑 먼지
  function puff(img) {
    const b = $("board").getBoundingClientRect(),
      r = img.getBoundingClientRect();
    const el = fxEl("dust", { x: ((r.left + r.width / 2 - b.left) / b.width) * 100, y: ((r.bottom - b.top) / b.height) * 100 });
    later(500, () => el.remove());
  }
  // 서버 상태가 바뀐 내용을 보고 소리를 낸다 (모든 기기에서 같은 순간에)
  function soundFromChange(a, b) {
    if (!a || !b) return;
    const rolled = b.roll !== null && (a.roll !== b.roll || a.turn !== b.turn || a.round !== b.round);
    const battled = b.battle && JSON.stringify(a.battle) !== JSON.stringify(b.battle);
    // 주사위·카드 공개 연출이 끝날 즈음 결과 소리를 낸다
    const after = rolled ? 1150 : battled ? (b.battle.extra ? 1900 : 1000) : 0;
    const darkNew = b.regions.some((r, i) => r.dark && !a.regions[i].dark);
    const mobsNew = b.regions.reduce((s, r) => s + r.mobs.length, 0) > a.regions.reduce((s, r) => s + r.mobs.length, 0);
    if (rolled && b.card === 30) later(after - 300, () => sfx("cardFlip"));
    if (darkNew) later(after, () => sfx("darkrai"));
    else if (mobsNew && rolled) later(after, () => sfx("mobAppear"));
    if (battled) later(after, () => sfx(b.battle.success ? "rescue" : "miss"));
    // 말 이동: 옮긴 칸 수만큼 (최대 6번) '톡톡'
    b.players.forEach((p, i) => {
      const q = a.players[i];
      if (!q || q.id !== p.id) return;
      if (q.node !== p.node) {
        const n = Math.max(1, pathBetween(q.node, p.node).length - 1);
        for (let k = 1; k <= n; k++) later(k * STEP_MS - 40, () => sfx("step", k === n ? 1.2 : 0.8));
      }
      if (!q.carry && p.carry) later(150, () => sfx("pickup"));
      if (q.carry && !p.carry) later(150, () => sfx(b.returned > a.returned ? "deliver" : "drop"));
      if ((p.stage || 0) > (q.stage || 0)) later(after + 700, () => sfx("evolve"));
    });
    if (!["won", "lost"].includes(a.phase) && ["won", "lost"].includes(b.phase))
      later(after + 500, () => sfx(b.phase === "won" ? "win" : "lose"));
  }
  function render() {
    if (!room) return;
    show("join", false);
    show("lobby", !room.game);
    show("game", !!room.game);
    text("roomCode", room.code);
    document.body.classList.toggle("playing", !!room.game);
    document.body.classList.toggle("student", !host);
    if (!room.game) {
      cancelReveal();
      presentationKey =
        previousRollKey =
        previousBattleKey =
        lastTurnKey =
          null;
      selectedHelper = null;
      closeOutcome();
      show("turnToast", false);
      $("rulesLobby").append($("rulesBox")); // 기다리는 동안 읽을 수 있게 대기실에도
      return lobby();
    }
    $("rulesHome").after($("rulesBox"));
    game();
  }
  function lobby() {
    show("qrArea", host);
    show("start", host);
    show("close", host);
    show("ready", !host);
    if (host) {
      qr(room.code);
      $("joinHere").href = "ghost.html?room=" + room.code;
    }
    $("people").replaceChildren();
    room.players.forEach((p) => {
      // 팀 슈팅 대기실처럼 이름 칸: 파트너 그림 + 이름 + 상태 (준비하면 초록)
      const el = document.createElement("div");
      el.className =
        "person" + (p.ready ? " ready" : "") + (p.connected ? "" : " away");
      el.append(image(D.partners[p.partner].color + "-0.webp", ""));
      const label = document.createElement("span");
      label.textContent = p.name + (p.id === me?.id ? " (나)" : "");
      const state = document.createElement("small");
      state.textContent = !p.connected
        ? "연결 끊김"
        : (p.ready ? "✔ 준비 · " : "") + D.partners[p.partner].names[0];
      label.append(state);
      el.append(label);
      if (host)
        el.append(
          button("내보내기", () => {
            if (confirm(p.name + "님을 내보낼까요?"))
              command("kick", { id: p.id });
          }),
        );
      $("people").append(el);
    });
    $("start").disabled =
      room.players.length < 1 ||
      room.players.some((p) => !p.ready || !p.connected);
    const mine = room.players.find((p) => p.id === me?.id);
    text("ready", mine?.ready ? "준비 취소" : "준비!");
    $("ready").classList.toggle("done", !!mine?.ready);
    text("myName", mine?.name || "");
    text("peopleCount", room.players.length + " / 6명");
    text(
      "readyCount",
      room.players.length
        ? "준비 " +
            room.players.filter((p) => p.ready).length +
            " / " +
            room.players.length +
            "명"
        : "학생을 기다리는 중…",
    );
    $("choices").replaceChildren();
    if (!host)
      D.partners.forEach((p, i) => {
        const b = button(
          p.names[0],
          () => {
            sfx("select");
            command("partner", { partner: i });
          },
          room.players.some((o) => o.id !== me?.id && o.partner === i),
        );
        b.className = "choice" + (mine?.partner === i ? " selected" : "");
        b.prepend(image(p.color + "-0.webp", p.names[0]));
        $("choices").append(b);
      });
  }
  function game() {
    const g = room.game,
      p = g.players[g.turn],
      mine = p.id === me?.id,
      ended = ["won", "lost"].includes(g.phase);
    text(
      "turn",
      ended
        ? g.phase === "won"
          ? "봉인 성공!"
          : "탐사 종료"
        : p.name + "의 차례 · " + g.round + "라운드",
    );
    renderGauges(g);
    show("hostControls", host);
    const titles = {
      roll: "이동 주사위",
      card: "출현 카드 확인",
      move: "이동할 곳 선택",
      act: "지역 행동",
      end: "배틀 결과",
      won: "기라티나가 평온을 되찾았어요!",
      lost: g.lossReason
        ? "봉인조각 회수 불가 · 탐사 종료"
        : "다크라이가 6곳을 장악했어요",
    };
    text(
      "phaseTitle",
      (!host && !ended ? (mine ? "내 차례 · " : p.name + "의 차례 · ") : "") +
        titles[g.phase],
    );
    $("turnPanel").classList.toggle("my-turn", mine && !ended);
    $("skip").disabled = ended;
    const instructions = {
      roll: "주사위를 던져요!",
      card: g.roll === 6 ? "6! 이번엔 출현 없음" : "카드 지역에 폭주 포켓몬 등장!",
      move: "빛나는 칸을 눌러 이동 (최대 " + g.moves + "칸, 제자리도 OK)",
      act: "배틀하거나 조각을 챙기고 차례를 마쳐요.",
      end: "결과 확인! 다음 친구에게 차례를 넘겨요.",
      won: "여덟 조각을 모은 탐사대와 파트너들이 힘을 합쳐 기라티나의 폭주를 막았습니다.",
      lost:
        g.lossReason ||
        "구조한 포켓몬들은 안전하게 보호됐어요. 새로운 탐사로 다시 도전해요.",
    };
    text(
      "instruction",
      (mine || host || ended ? "" : p.name + "의 차례예요 · ") +
        instructions[g.phase],
    );
    const own = g.players.find((o) => o.id === me?.id);
    text(
      "myCarry",
      own
        ? own.carry
          ? "◈ 봉인조각 " + own.carry + "번 운반 중"
          : "운반 중인 조각 없음"
        : "",
    );
    $("myCarry").classList.toggle("loaded", !!own?.carry);
    renderTable(g);
    updateTurnNotice(g, mine, ended);
    $("actions").replaceChildren();
    const add = (label, type, extra = {}) =>
      $("actions").append(button(label, () => command(type, extra), !mine));
    if (g.phase === "roll") add("🎲 이동 주사위 던지기", "roll");

    const r = g.regions.find((r) => r.id === p.node);
    if (g.phase === "act") {
      if (r?.mobs.length) {
        const helpers = g.players.filter(
          (o) => o.node === p.node && o.id !== p.id,
        );
        let select;
        if (helpers.length) {
          select = document.createElement("select");
          select.setAttribute("aria-label", "함께 배틀할 친구");
          helpers.forEach((o) => {
            const opt = document.createElement("option");
            opt.value = o.id;
            opt.textContent = o.name + "와 함께";
            select.append(opt);
          });
          select.value = helpers.some((o) => o.id === selectedHelper)
            ? selectedHelper
            : helpers[0].id;
          select.onchange = () => {
            selectedHelper = select.value;
            renderTable(g);
          };
          $("actions").append(select);
        }
        $("actions").append(
          button(
            r.dark ? "다크라이 해결하기" : "폭주 포켓몬 구조하기",
            () => command("battle", { helper: select?.value }),
            !mine || (r.dark && !helpers.length),
          ),
        );
      }
      if (r?.fragment && !p.carry)
        add("봉인조각 " + r.fragment + "번 가져가기", "pickup");
      if (r && !r.fragment && p.carry) add("봉인조각 내려놓기", "drop");
      if (p.node === "camp" && p.carry) add("봉인조각 반납", "deliver");
    }
    if (["act", "end"].includes(g.phase)) add("차례 마치기 →", "end");
    if (revealing)
      $("actions")
        .querySelectorAll("button,select")
        .forEach((el) => (el.disabled = true));
    if (revealing)
      text(
        "instruction",
        g.battle
          ? "구조 주사위 결과를 확인하고 있어요…"
          : "주사위와 출현 카드를 확인한 뒤 바로 이동합니다…",
      );
    drawBoard(g, mine && !revealing);
    renderOutcome(g);
    $("team").replaceChildren();
    g.players.forEach((o, i) => {
      const el = document.createElement("div");
      el.className = "member";
      el.append(image(pawn(o), o.name));
      const d = document.createElement("div");
      d.textContent =
        (i === g.turn ? "▶ " : "") +
        o.name +
        " · " +
        D.partners[o.partner].names[o.stage];
      const sm = document.createElement("small");
      sm.textContent =
        "구조 " +
        o.rescues +
        "마리" +
        (o.carry ? " · 조각 " + o.carry + "번" : "") +
        (o.rescues >= 6 ? " · 이동 +1" : "");
      sm.classList.toggle("loaded", !!o.carry);
      d.append(sm);
      const field = document.createElement("small");
      field.className = "partner-field";
      field.textContent = fieldDescription(D.partners[o.partner]);
      field.title =
        "일반 구조 공격 실패 시 추가공격 1회. 다크라이 배틀에는 적용되지 않습니다.";
      d.append(field);
      el.append(d);
      $("team").append(el);
    });
    text("dexCount", g.dex.length + "/21");
    $("dex").replaceChildren();
    g.dex.forEach((n) => {
      const el = document.createElement("div");
      if (mobs[n]) el.append(image(mobs[n], n));
      el.append(document.createTextNode(n + " ✓"));
      $("dex").append(el);
    });
    $("log").replaceChildren();
    g.log
      .slice()
      .reverse()
      .forEach((s) => {
        const li = document.createElement("li");
        li.textContent = s;
        $("log").append(li);
      });
  }
  function cancelReveal() {
    revealVersion++;
    revealing = false;
    for (const flight of revealFlights) {
      flight.animation.cancel();
      flight.element.remove();
    }
    revealFlights.clear();
    $("revealDice").style.visibility = "";
    // 같은 공개 무대를 재사용하므로 지난 비행의 transform도 반드시 지운다.
    $("revealDice")
      .getAnimations({ subtree: true })
      .forEach((animation) => animation.cancel());
    show("reveal", false);
    $("tableTray").classList.remove("revealing");
    $("revealDice").replaceChildren();
    $("revealCard").replaceChildren();
    text("revealNote", "");
  }
  const combatSymbol = (value) =>
    value < 2 ? "몬스터볼" : value === 2 ? "다크라이" : "빗나감";
  function makeDie(v, owner) {
    const unit = document.createElement("div");
    unit.className = "die-unit";
    unit.dataset.owner = owner.id;
    unit.dataset.face = typeof v === "number" ? "이동" : v;
    const other = !host && owner.id !== me?.id;
    unit.classList.toggle("other-die", other);
    unit.setAttribute("aria-label", owner.name + "님의 주사위 결과 " + v);
    if (other) unit.setAttribute("aria-disabled", "true");
    const d = document.createElement("div");
    d.className = "die-space";
    const cube = document.createElement("div");
    cube.className = "die-cube";
    cube.setAttribute("aria-hidden", "true");
    // 입체감을 SVG 한 장으로 그려 모바일의 3D 합성·투영 왜곡을 피한다.
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 84 84");
    svg.setAttribute("focusable", "false");
    const shape = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs))
        el.setAttribute(key, value);
      svg.append(el);
      return el;
    };
    shape("ellipse", {
      cx: 43,
      cy: 77,
      rx: 30,
      ry: 4,
      fill: "#061322",
      opacity: ".25",
    });
    shape("path", {
      d: "M12 19 L24 7 Q26 5 30 5 H72 Q79 5 79 12 V60 Q79 64 75 67 L63 76 Z",
      fill: "#9aa7b7",
      stroke: "#6e7e93",
      "stroke-width": 1.5,
    });
    shape("path", {
      d: "M12 19 L24 7 Q26 5 30 5 H72 Q76 5 78 8 L64 22 Z",
      fill: "#fafbf4",
      stroke: "#d9dedf",
      "stroke-width": 1,
    });
    shape("rect", {
      x: 7,
      y: 17,
      width: 58,
      height: 59,
      rx: 11,
      fill: "#dce1e4",
      stroke: "#8c9aaa",
      "stroke-width": 1.5,
    });
    shape("path", {
      d: "M18 20 H54 Q62 20 62 29 V60 Q60 45 48 34 Q34 22 16 24 Z",
      fill: "#fffef8",
      opacity: ".72",
    });
    shape("path", {
      d: "M10 55 V64 Q10 73 20 73 H52",
      fill: "none",
      stroke: "#bdc7d0",
      "stroke-width": 2,
    });
    shape("circle", { cx: 35, cy: 11, r: 1.6, fill: "#8794a5" });
    shape("circle", { cx: 49, cy: 11, r: 1.6, fill: "#8794a5" });
    shape("ellipse", { cx: 72, cy: 36, rx: 1.5, ry: 2.4, fill: "#5c6f86" });
    shape("ellipse", { cx: 72, cy: 49, rx: 1.5, ry: 2.4, fill: "#5c6f86" });
    if (v === "몬스터볼") {
      shape("circle", {
        cx: 36,
        cy: 47,
        r: 19,
        fill: "#fffdfa",
        stroke: "#263443",
        "stroke-width": 2.2,
      });
      shape("path", { d: "M17 47 A19 19 0 0 1 55 47 Z", fill: "#e84c50" });
      shape("path", {
        d: "M17 47 H55",
        stroke: "#263443",
        "stroke-width": 2.8,
      });
      shape("circle", {
        cx: 36,
        cy: 47,
        r: 6,
        fill: "#fffdfa",
        stroke: "#263443",
        "stroke-width": 2.4,
      });
      shape("circle", {
        cx: 36,
        cy: 47,
        r: 2.8,
        fill: "#f1f3ed",
        stroke: "#a3adb1",
        "stroke-width": 0.7,
      });
    } else if (v === "다크라이") {
      const icon = shape("svg", {
        x: 13,
        y: 23,
        width: 46,
        height: 46,
        viewBox: "85 0 270 260",
      });
      const picture = document.createElementNS(ns, "image");
      picture.setAttribute("href", A + "darkrai.webp");
      picture.setAttribute("width", "420");
      picture.setAttribute("height", "420");
      icon.append(picture);
    } else if (v !== "빗나감") {
      const result = shape("text", {
        x: 36,
        y: 48,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        fill: "#21334c",
        "font-size": typeof v === "number" ? 30 : 28,
        "font-family": "system-ui, sans-serif",
        "font-weight": 800,
      });
      result.textContent = v;
    }
    cube.append(svg);
    d.append(cube);
    unit.append(d);
    const label = document.createElement("small");
    label.textContent = owner.id === me?.id ? "내 주사위" : owner.name + "님";
    unit.append(label);
    return unit;
  }
  function renderTable(g) {
    const p = g.players[g.turn],
      region = g.regions.find((r) => r.id === p.node);
    const key = JSON.stringify([
      g.round,
      g.turn,
      g.roll,
      g.card,
      g.phase,
      p.node,
      g.dice,
      g.battle,
      selectedHelper,
    ]);
    if (key === presentationKey) return;
    const rollKey = [g.round, g.turn, g.roll].join(":");
    const battleKey = g.battle
      ? JSON.stringify([g.round, g.turn, g.dice, g.battle])
      : null;
    const animate =
      presentationKey !== null &&
      ((g.roll !== null && rollKey !== previousRollKey) ||
        (g.battle && battleKey !== previousBattleKey));
    presentationKey = key;
    previousRollKey = rollKey;
    previousBattleKey = battleKey;
    cancelReveal();
    $("dice").replaceChildren();
    text("battleNote", "");
    $("dice").title =
      "몬스터볼: 일반 구조 성공 · 다크라이: 다크라이 해결 성공 · 빈 면: 빗나감";
    if (g.battle) {
      g.battle.participants.forEach((owner, i) => {
        const extra = g.battle.extra?.id === owner.id ? g.battle.extra : null;
        $("dice").append(
          makeDie(combatSymbol(extra ? extra.value : g.dice[i]), owner),
        );
      });
      if (g.battle.extra) {
        const extra = g.battle.extra;
        const i = g.battle.participants.findIndex((o) => o.id === extra.id);
        text(
          "battleNote",
          extra.reason +
            " " +
            combatSymbol(g.dice[i]) +
            " → " +
            combatSymbol(extra.value),
        );
      }
    } else if (g.phase === "act" && region?.mobs.length) {
      const helpers = g.players.filter(
        (o) => o.node === p.node && o.id !== p.id,
      );
      const helper = helpers.find((o) => o.id === selectedHelper) || helpers[0];
      [p, ...(helper ? [helper] : [])].forEach((owner) =>
        $("dice").append(makeDie("?", owner)),
      );
      text(
        "battleNote",
        helper ? "각자 주사위 1개 · 최대 2명 협동" : "내 구조 주사위 1개",
      );
    } else if (g.roll !== null) $("dice").append(makeDie(g.roll, p));
    else $("dice").textContent = "주사위를 기다리는 중";
    $("card").replaceChildren();
    const face = g.card !== null;
    $("card").append(
      image(
        face ? "card-" + g.card + ".webp" : "card-back.webp",
        face ? "출현 카드" : "출현 카드 뒷면",
        "card-mini",
      ),
    );
    const caption = document.createElement("p");
    caption.textContent = face
      ? g.card === 30
        ? "다시 섞기 · 추가 출현 없음"
        : D.regions[Math.floor(g.card / 3)].name +
          " · 폭주 " +
          D.regions[Math.floor(g.card / 3)].mobs[g.card % 3]
      : g.roll === 6
        ? "6! 출현 카드 없음"
        : "주사위를 던지면 공개돼요";
    $("card").append(caption);
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches)
      playReveal(g, face && !g.battle);
  }
  async function flyTo(el, target) {
    const from = el.getBoundingClientRect(),
      to = target.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) return;
    // 비행용 복제본만 움직인다. 결과 칸과 공개 무대에는 transform을 남기지 않는다.
    const carrier = document.createElement("div");
    carrier.className = "reveal-flight";
    carrier.classList.toggle("other-flight", !!el.closest(".other-die"));
    carrier.setAttribute("aria-hidden", "true");
    Object.assign(carrier.style, {
      left: from.left + "px",
      top: from.top + "px",
      width: from.width + "px",
      height: from.height + "px",
    });
    carrier.style.setProperty(
      "--die-size",
      getComputedStyle(el).getPropertyValue("--die-size"),
    );
    const clone = el.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.remove("rolling");
    clone
      .querySelectorAll(".rolling")
      .forEach((el) => el.classList.remove("rolling"));
    Object.assign(clone.style, {
      width: from.width + "px",
      height: from.height + "px",
      maxWidth: "none",
      maxHeight: "none",
      visibility: "visible",
      transform: "none",
      margin: "0",
    });
    carrier.append(clone);
    document.body.append(carrier);
    el.style.visibility = "hidden";
    const scale = Math.min(to.width / from.width, to.height / from.height);
    const dx = to.left + (to.width - from.width * scale) / 2 - from.left,
      dy = to.top + (to.height - from.height * scale) / 2 - from.top;
    const animation = carrier.animate(
      [
        { transform: "translate(0,0) scale(1)" },
        { transform: `translate(${dx}px,${dy}px) scale(${scale})` },
      ],
      { duration: 460, easing: "cubic-bezier(.3,.05,.2,1)", fill: "forwards" },
    );
    const flight = { element: carrier, animation };
    revealFlights.add(flight);
    await animation.finished.catch(() => {});
    revealFlights.delete(flight);
    carrier.remove();
  }
  async function flyDice() {
    const sources = Array.from($("revealDice").querySelectorAll(".die-unit"));
    const targets = Array.from($("dice").querySelectorAll(".die-unit"));
    const flights = sources.map((source) => {
      const target = targets.find(
        (el) => el.dataset.owner === source.dataset.owner,
      );
      return target
        ? flyTo(
            source.querySelector(".die-cube"),
            target.querySelector(".die-cube"),
          )
        : Promise.resolve();
    });
    $("revealDice").style.visibility = "hidden";
    await Promise.all(flights);
  }
  async function playReveal(g, withCard) {
    const version = ++revealVersion;
    const current = () => version === revealVersion;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    revealing = true;
    if (!host && g.players[g.turn].id === me?.id)
      $("board").scrollIntoView({ block: "start", behavior: "instant" });
    $("tableTray").classList.add("revealing");
    if (g.battle)
      $("revealDice").replaceChildren(
        ...g.battle.participants.map((owner, i) =>
          makeDie(combatSymbol(g.dice[i]), owner),
        ),
      );
    else
      $("revealDice").replaceChildren(
        ...Array.from($("dice").children, (el) => el.cloneNode(true)),
      );
    $("revealDice")
      .querySelectorAll(".die-cube")
      .forEach((el) => el.classList.add("rolling"));
    show("reveal", true);
    sfx("diceRoll");
    await wait(900);
    if (!current()) return;
    sfx("diceLand");
    if (g.battle?.extra) {
      const extra = g.battle.extra,
        owner = g.battle.participants.find((o) => o.id === extra.id);
      text("revealNote", extra.reason);
      const die = Array.from($("revealDice").children).find(
        (el) => el.dataset.owner === extra.id,
      );
      const replacement = makeDie(combatSymbol(extra.value), owner);
      replacement.querySelector(".die-cube").classList.add("rolling");
      die.replaceWith(replacement);
      sfx("diceRoll");
      await wait(900);
      if (!current()) return;
      sfx("diceLand");
    }
    if (withCard) {
      // 뒷면이 먼저 나오고 가로로 '휙' 뒤집혀 앞면 (입체 회전 없이 가로 크기만 바꿔 폰에서도 안 깨짐)
      const front = "assets/ghost/card-" + g.card + ".webp";
      const im = image("card-back.webp", "출현 카드", "reveal-card");
      const pre = new Image();
      pre.src = front;
      $("revealCard").append(im);
      await Promise.race([Promise.all([im.decode(), pre.decode()]).catch(() => {}), wait(500)]);
      if (!current()) return;
      await im
        .animate(
          [
            { opacity: 0, transform: "translateY(-12%) scale(.85)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: 220, easing: "ease-out" },
        )
        .finished.catch(() => {});
      if (!current()) return;
      sfx("cardFlip");
      await im.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: 130, easing: "ease-in" }).finished.catch(() => {});
      if (!current()) return;
      im.src = front;
      await im
        .animate(
          [
            { transform: "scaleX(0)" },
            { transform: "scaleX(1.08) scaleY(1.04)", offset: 0.7 },
            { transform: "scaleX(1)" },
          ],
          { duration: 220, easing: "ease-out" },
        )
        .finished.catch(() => {});
      if (!current()) return;
    }
    await flyDice();
    if (!current()) return;
    if (withCard) {
      await wait(600);
      if (!current()) return;
      await flyTo(
        $("revealCard").firstElementChild,
        $("card").querySelector("img"),
      );
      if (!current()) return;
    }
    cancelReveal();
    render();
  }
  function closeOutcome() {
    if ($("outcome").open) $("outcome").close();
    text("outcomeError", "");
  }
  function renderOutcome(g) {
    const ended = ["won", "lost"].includes(g.phase);
    if (!ended || revealing) {
      closeOutcome();
      return;
    }
    text("outcomeTitle", g.phase === "won" ? "탐사 성공" : "탐사 실패");
    text(
      "outcomeText",
      g.phase === "won"
        ? "탐사대와 파트너들의 협력으로 기라티나가 평온을 되찾았습니다."
        : g.lossReason ||
            "다크라이가 6곳을 장악했습니다. 대기실에서 다시 도전해요.",
    );
    $("outcomeBack").disabled = busy || !socket.connected;
    if (!$("outcome").open) $("outcome").showModal();
  }
  function updateTurnNotice(g, mine, ended) {
    text(
      "turnStatus",
      ended
        ? "탐사가 종료되었습니다"
        : mine
          ? "내 차례"
          : g.players[g.turn].name + "님 플레이를 기다리는 중",
    );
    $("turnStatus").classList.toggle("own-turn", mine && !ended);
    const key = g.round + ":" + g.turn;
    if (ended) {
      clearTimeout(turnToastTimer);
      show("turnToast", false);
      return;
    }
    if (key === lastTurnKey) return;
    lastTurnKey = key;
    clearTimeout(turnToastTimer);
    show("turnToast", false);
    if (mine && !host) {
      sfx("myTurn");
      show("turnToast", true);
      turnToastTimer = setTimeout(() => show("turnToast", false), 1800);
    }
  }
  // 진행 상황: 봉인조각 8칸, 다크라이 6칸
  function renderGauges(g) {
    const box = $("progress");
    box.replaceChildren();
    const gems = document.createElement("span");
    gems.className = "gauge gems";
    gems.title = "봉인 " + g.returned + "/8";
    for (let i = 1; i <= 8; i++) {
      const s = seal(i <= g.returned ? i : null);
      s.classList.add("gauge-gem");
      s.classList.toggle("off", i > g.returned);
      gems.append(s);
    }
    const darks = document.createElement("span");
    darks.className = "gauge darks";
    const n = g.regions.filter((r) => r.dark).length;
    darks.title = "다크라이 " + n + "/6 (6곳이면 패배)";
    for (let i = 1; i <= 6; i++) {
      const im = image("darkrai.webp", "", "gauge-dark");
      im.classList.toggle("on", i <= n);
      darks.append(im);
    }
    const label = (t) => {
      const el = document.createElement("small");
      el.textContent = t;
      return el;
    };
    gems.prepend(label("봉인"));
    darks.prepend(label("다크라이"));
    box.append(gems, darks);
  }
  function seal(number) {
    const el = document.createElement("span");
    el.className = "seal-token";
    el.setAttribute("role", "img");
    el.setAttribute(
      "aria-label",
      number ? "봉인조각 " + number + "번" : "미확인 봉인조각",
    );
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 28");
    svg.setAttribute("aria-hidden", "true");
    [
      ["12,1 23,10 17,25 7,25 1,10", "#528c86"],
      ["12,1 17,10 7,10", "#b9d4b2"],
      ["1,10 7,10 12,25 7,25", "#8fb9a3"],
      ["7,10 17,10 12,25", "#71b2a7"],
    ].forEach(([points, fill]) => {
      const p = document.createElementNS(ns, "polygon");
      p.setAttribute("points", points);
      p.setAttribute("fill", fill);
      svg.append(p);
    });
    el.append(svg);
    const label = document.createElement("b");
    label.textContent = number ?? "?";
    el.append(label);
    return el;
  }
  function drawBoard(g, mine) {
    $("board").classList.toggle("moving", g.phase === "move");
    $("nodes").replaceChildren();
    $("pieces").replaceChildren();
    Object.values(D.nodes).forEach((n) => {
      const available =
        mine && g.phase === "move" && Object.hasOwn(g.reachable, n.id);
      const b = button("", () => command("move", { node: n.id }), !available);
      b.className =
        "node" +
        (n.id.startsWith("r") || n.id === "camp" ? " region" : "") +
        (available ? " available" : "");
      b.dataset.node = n.id;
      b.style.left = n.x + "%";
      b.style.top = n.y + "%";
      b.title = n.name + (available ? " · " + g.reachable[n.id] + "칸" : "");
      b.setAttribute("aria-label", b.title);
      $("nodes").append(b);
    });
    g.regions.forEach((r) => {
      const n = D.nodes[r.id];
      const el = document.createElement("div");
      el.className = "cluster";
      el.style.left = n.encounterX + "%";
      el.style.top = n.encounterY + "%";
      r.mobs.forEach((name, k) => {
        if (!mobs[name]) return;
        const im = image(mobs[name], name, "mob");
        el.append(im);
        animateDrop(im, r.id + ":" + k);
      });
      if (r.dark) {
        const dk = image("darkrai.webp", "다크라이", "darkrai");
        el.append(dk);
        animateDrop(dk, r.id + ":dark");
      }
      if (r.fragment || r.hidden) {
        const gem = seal(r.hidden ? null : r.fragment);
        gem.classList.add("map-seal");
        gem.style.left = n.sealX + "%";
        gem.style.top = n.sealY + "%";
        $("pieces").append(gem);
      }
      $("pieces").append(el);
    });
    g.players.forEach((p, i) => {
      const n = D.nodes[p.node];
      const group = g.players.filter((o) => o.node === p.node),
        j = group.findIndex((o) => o.id === p.id);
      const piece = document.createElement("div");
      piece.className = "player-piece" + (i === g.turn ? " active" : "");
      piece.dataset.player = p.id;
      const size = n.id.startsWith("r") || n.id === "camp" ? 11 : 8;
      piece.style.width = size + "%";
      piece.style.height = size + "%";
      const x =
        (n.pawnX ?? n.x) + ((j % 3) - (Math.min(group.length, 3) - 1) / 2) * 4;
      const y = (n.pawnY ?? n.y) + Math.floor(j / 3) * 2.5;
      const fx = Math.max(size / 2 + 0.5, Math.min(100 - size / 2 - 0.5, x)),
        fy = Math.min(100 - size * 0.15 - 0.5, y);
      piece.style.left = fx + "%";
      piece.style.top = fy + "%";
      piece.append(image(pawn(p), p.name, "pawn"));
      if (p.carry) {
        const badge = seal(p.carry);
        badge.classList.add("carry-badge");
        badge.title = p.name + " · 봉인조각 " + p.carry + "번 운반 중";
        piece.append(badge);
      }
      $("pieces").append(piece);
      animatePiece(piece, p, fx, fy);
    });
  }
  function settleReveal() {
    if (!revealing) return;
    cancelReveal();
    render();
  }
  // 주소창 높이·화면 회전이 바뀌면 잘못된 옛 좌표로 날리지 않고 결과 자리에 정착한다.
  window.addEventListener("resize", settleReveal);
  window.visualViewport?.addEventListener("resize", settleReveal);
  const settleFlying = () => {
    if (revealFlights.size) settleReveal();
  };
  window.addEventListener("scroll", settleFlying, { passive: true });
  window.visualViewport?.addEventListener("scroll", settleFlying, {
    passive: true,
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) settleReveal();
  });
  if (window.ResizeObserver)
    new ResizeObserver((entries) => {
      document.body.style.setProperty(
        "--turn-height",
        entries[0].target.getBoundingClientRect().height + 16 + "px",
      );
    }).observe($("turnPanel"));
  fetch(A + "mobs.json")
    .then((r) => r.json())
    .then((d) => {
      mobs = d;
      render();
    });
})();
