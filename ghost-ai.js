// 공개 스냅샷만 읽는 탐사대 AI. 숨겨진 번호·카드 더미·난수는 전달하지 않는다.
const D = require('./public/ghost-data');
function distances(start, blocked = new Set()) {
  const result = { [start]: 0 }, queue = [start];
  while (queue.length) {
    const here = queue.shift();
    if (here !== start && blocked.has(here)) continue;
    for (const next of D.nodes[here].links)
      if (result[next] === undefined) {
        result[next] = result[here] + 1;
        queue.push(next);
      }
  }
  return result;
}
function decide(g) {
  const p = g.players[g.turn];
  if (!p?.ai || ['won', 'lost'].includes(g.phase)) return null;
  if (g.phase === 'roll') return { type: 'roll' };
  const region = g.regions.find(r => r.id === p.node);
  const allies = g.players.filter(o => o.id !== p.id && o.node === p.node);
  const ordered = D.difficulties[g.difficulty || 'hard'].ordered;
  const canTake = r => r.fragment && (!ordered || r.fragment === g.returned + 1);
  if (['act', 'end'].includes(g.phase)) {
    if (g.phase === 'act' && !g.battle && region?.mobs.length && (!region.dark || allies.length))
      return { type: 'battle', helper: allies[0]?.id };
    if (p.node === 'camp' && p.carry && (!ordered || p.carry === g.returned + 1))
      return { type: 'deliver' };
    // 다크라이 속 조각은 협동 해결 후 운반한다.
    if (!p.carry && region && !region.dark && canTake(region)) return { type: 'pickup' };
    return { type: 'end' };
  }
  if (g.phase !== 'move') return null;
  const blocked = new Set(p.carry ? g.regions.filter(r => r.dark).map(r => r.id) : []);
  const from = distances(p.node, blocked);
  const targets = [];
  const add = (node, value, reason) => targets.push({ node, value, reason });
  if (p.carry || g.returned === 8) add('camp', 200, '봉인조각을 캠프로 운반합니다.');
  else {
    const others = g.players.filter(o => o.id !== p.id);
    for (const r of g.regions) {
      const occupants = others.filter(o => o.node === r.id);
      if (r.dark) {
        // 먼저 도착한 AI도 자리를 지켜 다음 친구와 합류한다.
        const closest = [...g.players].sort((a,b) =>
          (distances(a.node)[r.id] ?? 999) - (distances(b.node)[r.id] ?? 999) || a.id.localeCompare(b.id));
        if (occupants.length || closest.slice(0,2).some(o => o.id === p.id))
          add(r.id, occupants.length ? 150 : 95, '다크라이 해결을 도우러 갑니다.');
        continue;
      }
      const reserved = occupants.some(o => !o.carry);
      if (canTake(r)) add(r.id, reserved ? 65 : 125, '발견한 봉인조각을 회수하러 갑니다.');
      if (!r.revealed && (r.hidden || !ordered))
        add(r.id, reserved ? 35 : 80, '아직 확인하지 않은 지역을 탐사합니다.');
      if (r.mobs.length) {
        const field = D.partners[p.partner].zones.includes(Number(r.id.slice(1)));
        add(r.id, (r.mobs.length === 2 ? 115 : 45) + (field ? 8 : 0) - (reserved ? 25 : 0),
          '폭주 포켓몬이 쌓이기 전에 구조하러 갑니다.');
      }
    }
    if (!targets.length) add('camp', 10, '캠프로 돌아가 다음 회수를 기다립니다.');
  }
  targets.sort((a,b) => (b.value - 9*(from[b.node] ?? 999)) - (a.value - 9*(from[a.node] ?? 999)));
  const target = targets[0];
  // 운반자는 다크라이 지역을 통과하는 경로도 피한다.
  const to = distances(target.node, blocked);
  const choices = Object.keys(g.reachable).filter(n => !p.carry || !blocked.has(n) || n === p.node);
  choices.sort((a,b) => (to[a] ?? 999) - (to[b] ?? 999) || g.reachable[a] - g.reachable[b]);
  return { type: 'move', node: choices[0] || p.node, reason: target.reason };
}
module.exports = { decide };
