const assert = require("assert");
const { Expedition } = require("../ghost");
const D = require("../public/ghost-data");
const team = () => [
  { id: "a", name: "가", partner: 0 },
  { id: "b", name: "나", partner: 3 },
  { id: "c", name: "다", partner: 5 },
];
function run() {
  let g = new Expedition(team(), () => 0.1);
  assert.equal(g.deck.length, 31);
  assert.equal(new Set(g.deck).size, 31);
  const fragments = g.regions.filter((r) => r.fragment);
  assert.equal(fragments.length, 8);
  assert.equal(new Set(fragments.map((r) => r.fragment)).size, 8);
  assert(g.snapshot().regions.every((r) => r.fragment === null));
  const before = JSON.stringify(g.snapshot());
  assert(g.action("b", { type: "roll" }));
  assert.equal(JSON.stringify(g.snapshot()), before);
  g.deck = [0];
  g.action("a", { type: "roll" });
  assert.equal(g.phase, "move");
  assert.equal(g.regions[0].mobs.length, 1);
  assert(g.action("a", { type: "move", node: "r1" }));
  assert.equal(g.active.node, "camp");
  const dest = Object.keys(g.reachable()).find((k) => k !== "camp");
  g.action("a", { type: "move", node: dest });
  assert.equal(g.active.node, dest);
  assert.equal(g.phase, "act");
  assert(g.action("a", { type: "move", node: "camp" }));
  g = new Expedition(team(), () => 0.99);
  g.active.rescues = 6;
  g.action("a", { type: "roll" });
  assert.equal(g.roll, 6);
  assert.equal(g.moves, 7);
  assert.equal(g.deck.length, 31);
  assert.equal(g.card, null);
  g = new Expedition(team(), () => 0.1);
  g.deck = [0, 30];
  g.draw();
  assert.equal(g.card, 30);
  assert.equal(g.deck.length, 2);
  assert.equal(g.discard.length, 0);
  assert(g.regions.every((r) => r.mobs.length === 0));
  g.deck = [0];
  g.regions[0].dark = true;
  g.regions[0].mobs = ["a", "b", "c"];
  g.draw();
  assert.deepEqual(g.regions[1].mobs, ["나인테일"]);
  g = new Expedition(team(), () => 0.4);
  g.phase = "act";
  g.players[0].node = "r1";
  g.regions[0].mobs = ["나인테일", "찌르꼬", "돈크로우"];
  g.regions[0].dark = true;
  assert(g.action("a", { type: "battle" }));
  g.players[1].node = "r1";
  g.players[2].node = "r1";
  g.action("a", { type: "battle", helper: "c" });
  assert.equal(g.dice.length, 2);
  assert.equal(g.regions[0].mobs.length, 0);
  assert.equal(g.players[0].rescues, 3);
  assert.equal(g.players[2].rescues, 3);
  assert.equal(g.players[1].rescues, 0);
  assert.equal(g.stage(g.players[0]), 1);
  g = new Expedition(team(), () => 0.8);
  g.phase = "move";
  g.moves = 6;
  g.active.node = "r1";
  g.active.carry = 1;
  g.regions[0].dark = true;
  assert.deepEqual(g.reachable(), { r1: 0 });
  g.regions[0].dark = false;
  g.regions[0].mobs = ["나인테일"];
  assert(Object.keys(g.reachable()).length > 1);
  // 주사위 실패 후 유리 지역에서는 추가 공격을 한 번만 한다.
  g = new Expedition(team(), () => 0.9);
  g.phase = "act";
  g.active.node = "r8";
  g.regions[7].mobs = ["갸라도스"];
  g.action("a", { type: "battle" });
  assert.equal(g.dice.length, 1);
  assert.equal(g.battle.participants.length, 1);
  assert.equal(g.battle.extra.id, "a");
  assert.equal(g.battle.extra.value, 5);
  assert.equal(g.phase, "end");
  assert.equal(g.regions[7].mobs.length, 1);
  assert(g.action("a", { type: "battle" }));
  // 기본 실패 후 추가공격 성공도 동일한 한 명의 구조로 판정한다.
  g = new Expedition(team(), () => 0.9);
  g.phase = "act";
  g.active.node = "r8";
  g.regions[7].mobs = ["갸라도스"];
  const attackRolls = [0.9, 0.1];
  g.rng = () => attackRolls.shift();
  g.action("a", { type: "battle" });
  assert.deepEqual(g.dice, [5]);
  assert.equal(g.battle.extra.value, 0);
  assert(g.battle.success);
  assert.equal(g.active.rescues, 1);
  assert.equal(g.regions[7].mobs.length, 0);
  // 두 명 협동에서도 각자 한 개, 추가공격은 기존 소유자에게만 붙는다.
  g = new Expedition(team(), () => 0.9);
  g.phase = "act";
  g.active.node = "r8";
  g.players[1].node = "r8";
  g.regions[7].mobs = ["갸라도스"];
  g.action("a", { type: "battle" });
  assert.equal(g.dice.length, 2);
  assert.deepEqual(
    g.battle.participants.map((p) => p.id),
    ["a", "b"],
  );
  assert.equal(g.battle.extra.id, "a");
  g.next();
  assert.equal(g.battle, null);
  assert.equal(g.dice.length, 0);
  // 줍기/배틀 순서를 바꿔도 모두 가능하며, 줍기로 재공격을 열 수 없다.
  for (const first of ["pickup", "battle"]) {
    for (const rng of [0.1, 0.99]) {
      const e = new Expedition(team(), () => rng);
      e.phase = "act"; e.active.node = "r1";
      e.regions[0].mobs = ["가", "나"]; e.regions[0].fragment = 1;
      assert.equal(e.action("a", { type: first }), undefined);
      assert.equal(e.action("a", { type: first === "pickup" ? "battle" : "pickup" }), undefined);
      assert.equal(e.active.carry, 1);
      assert.equal(e.phase, "end");
      assert(e.battle);
      const result = JSON.stringify(e.battle);
      assert(e.action("a", { type: "battle" }), "한 차례 재공격 금지");
      assert.equal(e.action("a", { type: "drop" }), undefined);
      assert.equal(e.action("a", { type: "pickup" }), undefined);
      assert.equal(e.phase, "end");
      assert(e.action("a", { type: "battle" }), "내려놓기/다시 줍기로 공격 횟수 초기화 금지");
      assert.equal(JSON.stringify(e.battle), result);
      assert.equal(e.action("b", { type: "pickup" }), "지금은 내 차례가 아니에요.");
      assert.equal(e.action("a", { type: "end" }), undefined);
      assert.equal(e.turn, 1);
      assert.equal(e.battle, null);
    }
  }
  // 다크라이 해결 직후 같은 차례에 조각 회수.
  g = new Expedition(team(), () => 0.4);
  g.phase = "act"; g.active.node = g.players[1].node = "r1";
  g.regions[0].dark = true; g.regions[0].mobs = ["가", "나", "다"]; g.regions[0].fragment = 1;
  assert.equal(g.action("a", { type: "battle" }), undefined);
  assert(!g.regions[0].dark);
  assert.equal(g.action("a", { type: "pickup" }), undefined);
  assert.equal(g.active.carry, 1);

  // 다크라이 여섯 곳 패배, 조각 순서와 전원 귀환 승리.
  g = new Expedition(team(), () => 0.1);
  for (let i = 0; i < 5; i++) {
    g.regions[i].dark = true;
    g.regions[i].mobs = ["a", "b", "c"];
  }
  g.regions[5].mobs = ["리피아", "가디안"];
  g.deck = [15];
  g.draw();
  assert.equal(g.phase, "lost");
  g = new Expedition(team(), () => 0.1);
  g.phase = "act";
  g.active.carry = 2;
  assert(g.action("a", { type: "deliver" }));
  assert.equal(g.returned, 0);
  g.returned = 7;
  g.active.carry = 8;
  g.players[1].node = "r1";
  g.action("a", { type: "deliver" });
  assert.notEqual(g.phase, "won");
  g.players[1].node = "camp";
  g.action("a", { type: "end" });
  assert.equal(g.phase, "won");
  assert.equal(g.stage({ ...g.players[1], partner: 3, rescues: 3 }), 0);
  assert.equal(g.stage({ ...g.players[1], partner: 3, rescues: 6 }), 1);
  // 난이도마다 주사위 6면을 전부 판정: 쉬움 3/6, 어려움 2/6, 다크라이 각 1/6.
  for (const difficulty of ["easy", "hard"]) {
    let ordinary = 0, darkrai = 0;
    for (let face = 0; face < 6; face++) {
      for (const dark of [false, true]) {
        const e = new Expedition(team(), () => 0.9, difficulty);
        e.phase = "act";
        e.active.node = e.players[1].node = "r1";
        e.regions[0].mobs = dark ? ["가", "나", "다"] : ["가"];
        e.regions[0].dark = dark;
        e.rng = () => (face + 0.1) / 6;
        assert.equal(e.action("a", { type: "battle" }), undefined);
        const expected = D.combatSymbol(face, difficulty) === (dark ? "다크라이" : "몬스터볼");
        assert.equal(e.battle.success, expected);
        if (e.battle.success) dark ? darkrai++ : ordinary++;
      }
    }
    assert.equal(ordinary, difficulty === "easy" ? 3 : 2);
    assert.equal(darkrai, 1);
    const e = new Expedition(team(), () => 0.9, difficulty);
    e.phase = "act"; e.active.node = "r8"; e.regions[7].mobs = ["갸라도스"];
    const rolls = [0.99, 2.1 / 6]; e.rng = () => rolls.shift();
    e.action("a", { type: "battle" });
    assert.equal(e.battle.success, difficulty === "easy", "추가공격에도 선택한 주사위 적용");
  }
  g = new Expedition(team(), () => 0.9, "easy");
  g.phase = "act";
  assert(g.action("a", { type: "deliver" }), "빈손 반납 금지");
  for (const id of [8, 3, 6, 1, 7, 2, 5, 4]) {
    g.active.carry = id;
    assert.equal(g.action("a", { type: "deliver" }), undefined);
    assert(g.log.includes(id + "번 봉인조각 반납!"));
  }
  assert.equal(g.phase, "won");
  assert.equal(g.returned, 8);
  assert.deepEqual(g.snapshot().returnedFragments, [8, 3, 6, 1, 7, 2, 5, 4]);
  assert.equal(g.snapshot().difficulty, "easy");

  // 연결 그래프 전체가 캠프와 연결되어 있으며 문 지름길이 실제로 존재한다.
  const seen = new Set(["camp"]),
    q = ["camp"];
  while (q.length)
    for (const id of D.nodes[q.shift()].links)
      if (!seen.has(id)) {
        seen.add(id);
        q.push(id);
      }
  assert.equal(seen.size, Object.keys(D.nodes).length);
  assert(D.nodes.r1.links.includes("r3"));

  // 지도에 그려진 칸끼리만 이동하며, 방 입구는 실제 문에 연결된다.
  const corridor = Object.values(D.nodes).filter(
    (n) => n.id !== "camp" && !n.id.startsWith("r"),
  );
  assert.equal(corridor.length, 35);
  for (const n of corridor)
    for (const id of n.links) {
      const next = D.nodes[id];
      if (id !== "camp" && !id.startsWith("r"))
        assert(
          (Math.hypot(n.x - next.x, n.y - next.y) * 1254) / 100 < 85,
          "복도 사이 순간이동 연결 금지",
        );
    }
  assert(D.nodes.r4.links.includes("u3"));
  assert(D.nodes.r5.links.includes("u4"));
  assert(D.nodes.r6.links.includes("v5"));
  assert(D.nodes.r10.links.includes("v8"));
  assert(!D.nodes.r1.links.includes("t0"), "문 없는 화산 벽 통과 금지");
  assert(
    D.nodes.v4.x < D.nodes.v5.x && D.nodes.v4.y === D.nodes.v5.y,
    "숲 입구에서 대로가 옆으로 꺾임",
  );
  // 실제 행동 순서로 여덟 조각을 차례대로 운반하고 전원이 귀환한다.
  g = new Expedition(team(), () => 0.99);
  function travel(target) {
    g.action(g.active.id, { type: "roll" });
    const distances = { [target]: 0 },
      todo = [target];
    while (todo.length) {
      const a = todo.shift();
      for (const b of D.nodes[a].links)
        if (distances[b] === undefined) {
          distances[b] = distances[a] + 1;
          todo.push(b);
        }
    }
    const dest = Object.keys(g.reachable()).sort(
      (a, b) => distances[a] - distances[b],
    )[0];
    assert.equal(
      g.action(g.active.id, { type: "move", node: dest }),
      undefined,
    );
  }
  let guard = 0;
  while (g.phase !== "won" && guard++ < 200) {
    const p = g.active;
    const target = p.carry
      ? "camp"
      : g.returned === 8
        ? "camp"
        : g.regions.find((r) => r.fragment === g.returned + 1)?.id || "camp";
    travel(target);
    const r = g.region(p.node);
    if (r?.fragment === g.returned + 1 && !p.carry)
      assert.equal(g.action(p.id, { type: "pickup" }), undefined);
    if (p.node === "camp" && p.carry === g.returned + 1)
      assert.equal(g.action(p.id, { type: "deliver" }), undefined);
    if (g.phase !== "won")
      assert.equal(g.action(p.id, { type: "end" }), undefined);
  }
  assert.equal(g.phase, "won");
  assert.equal(g.returned, 8);
  assert(g.players.every((p) => p.node === "camp"));
  // 1인: 조각 없는 다크라이는 진행, 숨겨진 조각/운반 조각은 회수 불가로 종료.
  const solo = () => new Expedition(team().slice(0, 1), () => 0.4);
  g = solo();
  g.regions[0].fragment = null;
  g.regions[0].mobs = ["나인테일", "찌르꼬"];
  g.deck = [0];
  g.action("a", { type: "roll" });
  assert.equal(g.phase, "move");
  assert(g.regions[0].dark);
  g.phase = "act";
  g.active.node = "r1";
  assert(g.action("a", { type: "battle" }));
  assert(g.regions[0].dark);
  g = solo();
  g.regions[0].fragment = 1;
  g.regions[0].mobs = ["나인테일", "돈크로우"];
  g.deck = [0];
  g.action("a", { type: "roll" });
  assert.equal(g.phase, "lost");
  assert(g.snapshot().lossReason.includes("1인"));
  assert.equal(g.snapshot().regions[0].fragment, null);
  g = solo();
  g.phase = "move";
  g.moves = 6;
  g.active.node = "r3";
  g.active.carry = 1;
  g.regions[0].fragment = null;
  g.regions[0].dark = true;
  g.action("a", { type: "move", node: "r1" });
  assert.equal(g.phase, "lost");
  g = new Expedition(team(), () => 0.4);
  g.regions[0].fragment = 1;
  g.regions[0].mobs = ["나", "다"];
  g.deck = [0];
  g.action("a", { type: "roll" });
  assert.equal(g.phase, "move");
  console.log("고스트헌터 카드·이동·협동·진화·봉인·승패 검사 통과");
}
run();
