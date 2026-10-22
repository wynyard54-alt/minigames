/* 화면은 서버 상태를 표시하고, 선택한 행동만 보낸다. */
(() => {
  const $ = (id) => document.getElementById(id),
    D = GhostData,
    params = new URLSearchParams(location.search),
    host = params.get("host") === "1";
  const socket = io("/ghost"),
    A = "assets/ghost/";
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
  $("ready").onclick = () => command("ready");
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
    room = r;
    render();
  });
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
      return lobby();
    }
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
      const el = document.createElement("div");
      el.className = "person";
      el.textContent =
        p.name +
        " · " +
        D.partners[p.partner].names[0] +
        " · " +
        (!p.connected ? "연결 끊김" : p.ready ? "준비 완료" : "선택 중");
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
    text("ready", mine?.ready ? "준비 취소" : "준비하기");
    $("choices").replaceChildren();
    if (!host)
      D.partners.forEach((p, i) => {
        const b = button(
          p.names[0],
          () => command("partner", { partner: i }),
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
    text(
      "progress",
      "봉인 " +
        g.returned +
        "/8 · 다크라이 " +
        g.regions.filter((r) => r.dark).length +
        "/6",
    );
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
      roll: "주사위를 던지면 출현 카드를 먼저 확인합니다.",
      card:
        g.roll === 6
          ? "6이 나와 출현 카드를 뽑지 않습니다."
          : "카드의 지역에 폭주 포켓몬이 출현했습니다.",
      move:
        g.moves +
        "칸 이내의 빛나는 칸을 선택하세요. 현재 위치를 선택해 머물 수도 있어요.",
      act: "배틀하거나 봉인조각을 회수한 뒤 차례를 마치세요.",
      end: "결과를 확인한 뒤 다음 친구에게 차례를 넘겨주세요.",
      won: "여덟 조각을 모은 탐사대와 파트너들이 힘을 합쳐 기라티나의 폭주를 막았습니다.",
      lost:
        g.lossReason ||
        "구조한 포켓몬들은 안전하게 보호됐어요. 새로운 탐사로 다시 도전해요.",
    };
    text(
      "instruction",
      (mine || host || ended ? "" : p.name + "의 행동을 기다리는 중. ") +
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
  const combatSymbol = (value) => (value < 2 ? "✦" : value === 2 ? "◆" : "—");
  function makeDie(v, owner) {
    const unit = document.createElement("div");
    unit.className = "die-unit";
    unit.dataset.owner = owner.id;
    const other = !host && owner.id !== me?.id;
    unit.classList.toggle("other-die", other);
    unit.setAttribute("aria-label", owner.name + "님의 주사위 결과 " + v);
    if (other) unit.setAttribute("aria-disabled", "true");
    const d = document.createElement("div");
    d.className = "die-space";
    const cube = document.createElement("div");
    cube.className = "die-cube";
    cube.setAttribute("aria-hidden", "true");
    let faces;
    if (typeof v === "number") {
      const rest = [1, 2, 3, 4, 5, 6].filter((n) => n !== v && n !== 7 - v);
      faces = [
        v,
        7 - v,
        rest[0],
        7 - rest[0],
        rest.find((n) => n !== rest[0] && n !== 7 - rest[0]),
        0,
      ];
      faces[5] = 7 - faces[4];
    } else if (v === "?") {
      faces = ["?", "—", "✦", "—", "◆", "✦"];
    } else {
      const rest = ["✦", "✦", "◆", "—", "—", "—"];
      rest.splice(rest.indexOf(v), 1);
      faces = [v, ...rest];
    }
    faces.forEach((value, index) => {
      const face = document.createElement("span");
      face.className = "die-face face-" + index;
      face.textContent = value;
      if (value === "◆") face.style.color = "#ba274d";
      if (value === "✦") face.style.color = "#2476a8";
      cube.append(face);
    });
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
    $("dice").title = "✦ 일반 구조 성공 · ◆ 다크라이 해결 성공 · — 빗나감";
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
    if (!from.width || !to.width) return;
    const animation = el.animate(
      [
        { transform: "translate(0,0) scale(1)" },
        {
          transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${to.width / from.width},${to.height / from.height})`,
        },
      ],
      { duration: 480, easing: "cubic-bezier(.3,.05,.2,1)", fill: "forwards" },
    );
    await animation.finished.catch(() => {});
  }
  async function playReveal(g, withCard) {
    const version = ++revealVersion;
    const current = () => version === revealVersion;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    revealing = true;
    if (!host && g.players[g.turn].id === me?.id)
      $("board").scrollIntoView({ block: "start", behavior: "smooth" });
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
    await wait(900);
    if (!current()) return;
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
      await wait(900);
      if (!current()) return;
    }
    if (withCard) {
      const im = image("card-" + g.card + ".webp", "출현 카드", "reveal-card");
      $("revealCard").append(im);
      await im.animate(
        [
          { opacity: 0, transform: "scale(.6) rotateY(-55deg)" },
          { opacity: 1, transform: "scale(1) rotateY(0)" },
        ],
        { duration: 300, easing: "cubic-bezier(.2,.9,.25,1.2)" },
      ).finished;
      if (!current()) return;
    }
    await flyTo($("revealDice"), $("dice"));
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
      show("turnToast", true);
      turnToastTimer = setTimeout(() => show("turnToast", false), 1800);
    }
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
      r.mobs.forEach((name) => {
        if (mobs[name]) el.append(image(mobs[name], name, "mob"));
      });
      if (r.dark) el.append(image("darkrai.webp", "다크라이", "darkrai"));
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
      piece.style.left =
        Math.max(size / 2 + 0.5, Math.min(100 - size / 2 - 0.5, x)) + "%";
      piece.style.top = Math.min(100 - size * 0.15 - 0.5, y) + "%";
      piece.append(image(pawn(p), p.name, "pawn"));
      if (p.carry) {
        const badge = seal(p.carry);
        badge.classList.add("carry-badge");
        badge.title = p.name + " · 봉인조각 " + p.carry + "번 운반 중";
        piece.append(badge);
      }
      $("pieces").append(piece);
    });
  }
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
