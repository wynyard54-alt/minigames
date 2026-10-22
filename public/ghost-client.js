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
    lastRoll = "";
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
    socket.timeout(6000).emit("command", { type, ...extra }, (err, r) => {
      busy = false;
      text(
        "error",
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
    busy = false;
  });
  socket.on("closed", (s) => {
    text("error", s);
    room = null;
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
    if (!room.game) return lobby();
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
    text("phaseTitle", titles[g.phase]);
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
    $("dice").replaceChildren();
    const stamp = g.round + ":" + g.turn + ":" + g.roll + ":" + g.dice.join();
    $("dice").title = "✦ 일반 구조 성공 · ◆ 다크라이 해결 성공 · — 빗나감";
    const vals = g.dice.length
      ? g.dice.map((v) => (v < 2 ? "✦" : v === 2 ? "◆" : "—"))
      : g.roll
        ? [g.roll]
        : [];
    vals.forEach((v) => {
      const d = document.createElement("div");
      d.className = "die-space";
      d.setAttribute("aria-label", "주사위 결과 " + v);
      const cube = document.createElement("div");
      cube.className = "die-cube" + (stamp !== lastRoll ? " rolling" : "");
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
      $("dice").append(d);
    });
    lastRoll = stamp;
    $("card").replaceChildren();
    if (g.card !== null && g.phase === "card") {
      $("card").append(image("card-" + g.card + ".webp", "출현 카드"));
      const cap = document.createElement("p");
      cap.textContent =
        g.card === 30
          ? "다시 섞기 · 추가 출현 없음"
          : D.regions[Math.floor(g.card / 3)].name +
            " · 폭주 " +
            D.regions[Math.floor(g.card / 3)].mobs[g.card % 3];
      $("card").append(cap);
    }
    $("actions").replaceChildren();
    const add = (label, type, extra = {}) =>
      $("actions").append(button(label, () => command(type, extra), !mine));
    if (g.phase === "roll") add("🎲 이동 주사위 던지기", "roll");
    if (g.phase === "card") add("확인 · 이동하기", "confirm");
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
    drawBoard(g, mine);
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
  function drawBoard(g, mine) {
    $("board").classList.toggle("moving", g.phase === "move");
    $("nodes").replaceChildren();
    $("pieces").replaceChildren();
    $("roads").replaceChildren();
    Object.values(D.nodes).forEach((n) => {
      n.links.forEach((to) => {
        if (n.id > to) return;
        const other = D.nodes[to],
          l = document.createElementNS("http://www.w3.org/2000/svg", "line");
        for (const [k, v] of Object.entries({
          x1: n.x,
          y1: n.y,
          x2: other.x,
          y2: other.y,
        }))
          l.setAttribute(k, v);
        $("roads").append(l);
      });
      const available =
        mine && g.phase === "move" && Object.hasOwn(g.reachable, n.id);
      const b = button(
        n.id === "camp"
          ? "캠프"
          : n.id.startsWith("r")
            ? n.id.slice(1) + " " + n.name
            : "",
        () => command("move", { node: n.id }),
        !available,
      );
      b.className =
        "node" +
        (n.id.startsWith("r") || n.id === "camp" ? " region" : "") +
        (available ? " available" : "");
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
      el.style.left = n.x + "%";
      el.style.top = n.y + 3 + "%";
      r.mobs.forEach((name) => {
        if (mobs[name]) el.append(image(mobs[name], name, "mob"));
      });
      if (r.dark) el.append(image("darkrai.webp", "다크라이", "darkrai"));
      if (r.fragment || r.hidden) {
        const badge = document.createElement("span");
        badge.className = "fragment";
        badge.append(
          image(
            r.hidden ? "seal-back.webp" : "seal-" + r.fragment + ".webp",
            r.hidden ? "미확인 봉인조각" : "봉인조각 " + r.fragment,
          ),
        );
        if (!r.hidden) badge.append(document.createTextNode(r.fragment));
        el.append(badge);
      }
      $("pieces").append(el);
    });
    g.players.forEach((p, i) => {
      const n = D.nodes[p.node];
      const group = g.players.filter((o) => o.node === p.node),
        j = group.findIndex((o) => o.id === p.id);
      const im = image(
        pawn(p),
        p.name,
        "pawn" + (i === g.turn ? " active" : ""),
      );
      im.style.left = n.x + (j - (group.length - 1) / 2) * 4 + "%";
      im.style.top = n.y + 2 + (j % 2) * 3 + "%";
      $("pieces").append(im);
    });
  }
  fetch(A + "mobs.json")
    .then((r) => r.json())
    .then((d) => {
      mobs = d;
      render();
    });
})();
