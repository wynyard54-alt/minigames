/* 지도 연결과 카드 구성: 서버와 화면이 같은 자료를 사용한다. */
(function (root) {
  const regions = [
    ["화산 기슭", ["나인테일", "찌르꼬", "돈크로우"], 14, 12],
    ["사막", ["나인테일", "한카리아스", "돈크로우"], 27, 40],
    ["동굴", ["한카리아스", "삐딱구리", "트리토돈"], 38, 10],
    ["돌산", ["사마자르", "앱솔", "잠만보"], 66, 12],
    ["설원", ["글레이시아", "포푸니라", "눈쓰개"], 90, 17],
    ["숲", ["리피아", "가디안", "엘레이드"], 74, 48],
    ["언덕", ["파치리스", "피카츄", "찌르버드"], 27, 64],
    ["바다", ["갸라도스", "밀로틱", "트리토돈"], 10, 88],
    ["강 하구", ["삐딱구리", "파치리스", "플로젤"], 35, 85],
    ["풀밭", ["잠만보", "찌르버드", "피카츄"], 75, 76],
  ].map(([name, mobs, x, y], i) => ({ id: "r" + (i + 1), name, mobs, x, y }));
  const partners = [
    {
      color: "green",
      names: ["모부기", "수풀부기", "토대부기"],
      zones: [8, 9],
    },
    { color: "red", names: ["불꽃숭이", "파이숭이", "초염몽"], zones: [5, 6] },
    { color: "blue", names: ["팽도리", "팽태자", "엠페르트"], zones: [1, 2] },
    { color: "orange", names: ["리오르", "루카리오"], zones: [3, 4] },
    { color: "yellow", names: ["꼬링크", "럭시오", "렌트라"], zones: [7, 10] },
    { color: "purple", names: ["고오스", "고우스트", "팬텀"], zones: [] },
  ];
  const nodes = {
    camp: { id: "camp", name: "베이스캠프", x: 74, y: 92, links: [] },
  };
  regions.forEach((r) => (nodes[r.id] = { ...r, links: [] }));
  const link = (a, b) => {
    nodes[a].links.push(b);
    nodes[b].links.push(a);
  };
  for (let i = 0; i < 12; i++) {
    const id = "v" + i;
    nodes[id] = { id, name: "이동 칸", x: 53, y: 23 + i * 6, links: [] };
    if (i) link("v" + (i - 1), id);
  }
  for (let i = 0; i < 8; i++) {
    const id = "h" + i;
    nodes[id] = { id, name: "이동 칸", x: 5 + i * 6, y: 75, links: [] };
    if (i) link("h" + (i - 1), id);
  }
  link("h7", "v9");
  for (let i = 0; i < 6; i++) {
    const id = "t" + i;
    nodes[id] = { id, name: "이동 칸", x: 16 + i * 6, y: 23, links: [] };
    if (i) link("t" + (i - 1), id);
  }
  link("t5", "v0");
  for (let i = 0; i < 3; i++) {
    const id = "l" + i;
    nodes[id] = { id, name: "이동 칸", x: 5 + i * 6, y: 35, links: [] };
    if (i) link("l" + (i - 1), id);
  }
  link("l2", "t0");
  link("r1", "l1");
  link("r2", "l0");
  [
    ["camp", "v11"],
    ["r1", "t0"],
    ["r2", "v4"],
    ["r3", "t3"],
    ["r4", "v0"],
    ["r5", "t5"],
    ["r6", "v5"],
    ["r7", "h3"],
    ["r8", "h0"],
    ["r9", "h5"],
    ["r10", "v9"],
    ["r1", "r3"],
    ["r3", "r4"],
    ["r4", "r5"],
    ["r2", "r7"],
    ["r6", "r10"],
    ["r8", "r9"],
  ].forEach(([a, b]) => link(a, b));
  const data = { regions, partners, nodes };
  if (typeof module !== "undefined") module.exports = data;
  else root.GhostData = data;
})(typeof window === "undefined" ? globalThis : window);
