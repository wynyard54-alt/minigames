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
  assert.equal(g.phase, "card");
  assert.equal(g.regions[0].mobs.length, 1);
  assert(g.action("a", { type: "move", node: "r1" }));
  g.action("a", { type: "confirm" });
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
  assert.equal(g.dice.length, 2);
  assert.equal(g.phase, "end");
  assert.equal(g.regions[7].mobs.length, 1);
  assert(g.action("a", { type: "battle" }));
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

  // 실제 행동 순서로 여덟 조각을 차례대로 운반하고 전원이 귀환한다.
  g = new Expedition(team(), () => 0.99);
  function travel(target) {
    g.action(g.active.id, { type: "roll" });
    g.action(g.active.id, { type: "confirm" });
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
  assert.equal(g.phase, "card");
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
  assert.equal(g.phase, "card");
  console.log("고스트헌터 카드·이동·협동·진화·봉인·승패 검사 통과");
}
run();
