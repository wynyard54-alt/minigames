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
  // 좌표는 승인한 지도 원본(1254×1254)의 칸 중심과 문 위치를 직접 측정했다.
  const pct = (n) => (n / 1254) * 100;
  const rooms = [
    // 지역 번호 / 플레이어 / 출현말 / 지역명 오른쪽 봉인조각 (지도 원본 픽셀)
    [68, 80, 125, 310, 250, 208, 272, 161],
    [326, 388, 360, 505, 425, 605, 374, 561],
    [393, 80, 387, 219, 520, 211, 542, 163],
    [690, 80, 730, 252, 866, 265, 880, 172],
    [1066, 152, 1060, 325, 1162, 320, 1183, 205],
    [764, 507, 835, 715, 1060, 727, 1002, 589],
    [69, 748, 225, 859, 480, 849, 371, 798],
    [63, 1038, 135, 1200, 490, 1190, 180, 1115],
    [302, 1031, 350, 1104, 535, 1100, 528, 1045],
    [778, 897, 840, 1015, 1110, 950, 1040, 982],
  ];
  const nodes = {
    camp: {
      id: "camp",
      name: "베이스캠프",
      x: pct(840),
      y: pct(1130),
      pawnX: pct(975),
      pawnY: pct(1200),
      links: [],
    },
  };
  regions.forEach((r, i) => {
    const [x, y, px, py, ex, ey, sx, sy] = rooms[i];
    Object.assign(r, {
      x: pct(x),
      y: pct(y),
      pawnX: pct(px),
      pawnY: pct(py),
      encounterX: pct(ex),
      encounterY: pct(ey),
      sealX: pct(sx),
      sealY: pct(sy),
    });
    nodes[r.id] = { ...r, links: [] };
  });
  const link = (a, b) => {
    nodes[a].links.push(b);
    nodes[b].links.push(a);
  };
  const cells = (prefix, points) =>
    points.forEach(([x, y], i) => {
      const id = prefix + i;
      nodes[id] = { id, name: "이동 칸", x: pct(x), y: pct(y), links: [] };
      if (i) link(prefix + (i - 1), id);
    });
  // 중앙 대로는 숲 입구에서 오른쪽 한 칸 꺾이며, 아래 가로길과 교차한다.
  cells("v", [
    [594, 355],
    [594, 426],
    [594, 498],
    [594, 570],
    [594, 643],
    [667, 643],
    [667, 715],
    [667, 788],
    [667, 868],
    [667, 945],
    [667, 1015],
    [667, 1088],
  ]);
  cells("h", [
    [58, 945],
    [139, 945],
    [214, 945],
    [289, 945],
    [365, 945],
    [441, 945],
    [518, 945],
    [594, 945],
  ]);
  cells("t", [
    [224, 284],
    [298, 284],
    [372, 284],
    [447, 284],
    [521, 284],
    [594, 284],
  ]);
  cells("l", [
    [58, 425],
    [142, 425],
    [224, 425],
    [224, 354],
  ]);
  cells("u", [
    [667, 355],
    [741, 355],
    [814, 355],
    [888, 355],
    [956, 355],
  ]);
  [
    ["h7", "v9"],
    ["t5", "v0"],
    ["l3", "t0"],
    ["v0", "u0"],
    ["camp", "v11"],
    ["r1", "l1"],
    ["r2", "l0"],
    ["r2", "v1"],
    ["r3", "t3"],
    ["r4", "u3"],
    ["r5", "u4"],
    ["r6", "v5"],
    ["r7", "h2"],
    ["r8", "h0"],
    ["r9", "h4"],
    ["r10", "v8"],
    ["r1", "r3"],
    ["r3", "r4"],
    ["r4", "r5"],
    ["r2", "r7"],
    ["r6", "r10"],
    ["r8", "r9"],
  ].forEach(([a, b]) => link(a, b));
  const difficulties = {
    easy: { name: "쉬움", balls: 3, ordered: false },
    hard: { name: "어려움", balls: 2, ordered: true },
  };
  const combatSymbol = (value, difficulty = "hard") => {
    const balls = (difficulties[difficulty] || difficulties.hard).balls;
    return value < balls ? "몬스터볼" : value === balls ? "다크라이" : "빗나감";
  };
  const data = { regions, partners, nodes, difficulties, combatSymbol };
  if (typeof module !== "undefined") module.exports = data;
  else root.GhostData = data;
})(typeof window === "undefined" ? globalThis : window);
