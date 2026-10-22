// 실제 소켓으로 권한·재접속·인원·기존 게임 격리를 확인한다.
const assert = require("assert");
const { io } = require("socket.io-client");
const { server, ghostRooms } = require("../server");
const clients = [];
const ack = (s, event, data) =>
  new Promise((resolve, reject) =>
    s.timeout(3000).emit(event, data, (e, r) => (e ? reject(e) : resolve(r))),
  );
const connect = (url) =>
  new Promise((resolve) => {
    const s = io(url, { forceNew: true, transports: ["websocket"] });
    clients.push(s);
    s.on("connect", () => resolve(s));
  });
(async () => {
  try {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + server.address().port;
    const host = await connect(url + "/ghost");
    const r = await ack(host, "create", {});
    assert(r.ok);
    // 0명은 시작 금지, 준비한 1명은 시작 가능.
    const soloHost = await connect(url + "/ghost");
    const soloRoom = await ack(soloHost, "create", {});
    assert((await ack(soloHost, "command", { type: "start" })).error);
    const soloPlayer = await connect(url + "/ghost");
    assert(
      (await ack(soloPlayer, "join", { code: soloRoom.code, name: "혼자" })).ok,
    );
    assert((await ack(soloHost, "command", { type: "start" })).error);
    assert((await ack(soloPlayer, "command", { type: "ready" })).ok);
    assert((await ack(soloHost, "command", { type: "start" })).ok);
    assert((await ack(soloPlayer, "command", { type: "roll" })).ok);
    assert(
      (await ack(soloPlayer, "command", { type: "reset" })).error,
      "학생은 진행 중인 탐사를 초기화할 수 없음",
    );
    ghostRooms.get(soloRoom.code).game.phase = "lost";
    assert((await ack(soloPlayer, "command", { type: "reset" })).ok);
    assert.equal(ghostRooms.get(soloRoom.code).game, null);
    assert.equal(ghostRooms.get(soloRoom.code).players[0].ready, false);
    await ack(soloPlayer, "command", { type: "ready" });
    await ack(soloHost, "command", { type: "start" });
    ghostRooms.get(soloRoom.code).game.phase = "won";
    assert((await ack(soloPlayer, "command", { type: "reset" })).ok);
    assert((await ack(soloHost, "command", { type: "close" })).ok);
    const ps = [];
    for (let i = 0; i < 6; i++) {
      const s = await connect(url + "/ghost");
      const p = await ack(s, "join", { code: r.code, name: "친구" + i });
      assert(p.ok);
      ps.push({ s, p });
    }
    const extra = await connect(url + "/ghost");
    assert((await ack(extra, "join", { code: r.code, name: "일곱" })).error);
    assert((await ack(ps[0].s, "command", { type: "start" })).error);
    assert((await ack(host, "command", { type: "start" })).error);
    assert(
      (await ack(ps[0].s, "command", { type: "partner", partner: 1 })).error,
    );
    for (const { s } of ps)
      assert((await ack(s, "command", { type: "ready" })).ok);
    assert((await ack(host, "command", { type: "start" })).ok);
    assert((await ack(ps[1].s, "command", { type: "roll" })).error);
    let state;
    host.on("update", (r) => (state = r));
    assert((await ack(ps[0].s, "command", { type: "roll" })).ok);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(state.game.phase, "move");
    assert.equal(state.game.players.length, 6);
    assert(state.players.every((p) => !p.key && !p.socket));
    const restored = await connect(url + "/ghost");
    assert((await ack(restored, "join", { ...ps[0].p, code: r.code })).ok);
    assert(
      (await ack(ps[0].s, "command", { type: "move", node: "camp" })).error,
    );
    assert((await ack(restored, "command", { type: "move", node: "camp" })).ok);
    const newHost = await connect(url + "/ghost");
    assert(
      (await ack(newHost, "join", { code: r.code, key: r.key, host: true })).ok,
    );
    assert((await ack(host, "command", { type: "skip" })).error);
    assert((await ack(newHost, "command", { type: "skip" })).ok);
    assert((await ack(newHost, "command", { type: "reset" })).ok);
    assert(
      (await ack(newHost, "command", { type: "kick", id: ps[5].p.id })).ok,
    );
    assert((await ack(extra, "join", { code: r.code, name: "대체" })).ok);
    const battle = await connect(url);
    const old = await ack(battle, "host:create", {});
    assert(old.code);
    assert((await ack(battle, "host:close", {})).ok);
    assert((await ack(newHost, "command", { type: "close" })).ok);
    assert((await ack(extra, "join", { code: r.code })).error);
    console.log("고스트헌터 방·권한·6명 제한·복구·기존 게임 격리 검사 통과");
    clients.forEach((s) => s.disconnect());
    await new Promise((r) => server.close(r));
    process.exit(0);
  } catch (e) {
    console.error(e);
    clients.forEach((s) => s.disconnect());
    server.close();
    process.exit(1);
  }
})();
