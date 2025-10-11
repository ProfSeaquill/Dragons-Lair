import { CFG } from './config.js';

export function initMemory(e) {
  // per-enemy junction memory + navigation
  e.jxnMem = new Map();                // jxnId -> { mask:{N,E,S,W}, outcome:{}, version, exhausted? }
  e.jxnStack = [];                     // DFS stack of visited junctionIds
  e.backtrackPath = null;              // [{x,y}, ...]
  e.isStray = false;                   // curiosity divergence flag
  e.strayUntil = 0;                    // ms timestamp
  e.pendingOutcome = null;             // { fromId, dir, toId|null }
}

export function getJxnMem(e, jxnId, ver) {
  let m = e.jxnMem.get(jxnId);
  if (!m) {
    m = { mask:{N:0,E:0,S:0,W:0}, outcome:{}, version:ver|0, exhausted:false };
    e.jxnMem.set(jxnId, m);
  } else if ((m.version|0) !== (ver|0)) {
    // topology changed near this node -> allow re-tests (treat tried as untried once)
    for (const k of ['N','E','S','W']) if (m.mask[k] === 1) m.mask[k] = 0;
    m.exhausted = false;
    m.version = ver|0;
  }
  return m;
}

export function recordOutcome(e, jxnId, dir, outcome) {
  const m = e.jxnMem.get(jxnId);
  if (!m) return;
  const o = outcome || 'deadend';
  m.outcome[dir] = o;
  m.mask[dir] = (o === 'deadend') ? 1 : 2;

  // exhausted if all exits are tried (mask != 0) and none is successful (mask != 2 to a junction/dragon)
  const dirs = ['N','E','S','W'];
  const allTried = dirs.every(d => m.mask[d] !== 0);
  const anySuccess = dirs.some(d => m.mask[d] === 2 && m.outcome[d] !== 'deadend');
  m.exhausted = allTried && !anySuccess;
}

export function nextUntriedDir(mem, exits) {
  // exits: [{dir:'N'|'E'|'S'|'W', to, path:[{x,y}]}]
  for (const ex of exits) if (mem.mask[ex.dir] === 0) return ex.dir;
  return null;
}

export function pushJunction(e, jxnId) {
  const top = e.jxnStack[e.jxnStack.length - 1];
  if (top !== jxnId) e.jxnStack.push(jxnId);
}

export function planBacktrackTo(e, topo, toJxnId) {
  // Build a path from current stack top back to the nearest stack entry with untried exits (or explicit toJxnId)
  if (!topo || !topo.jxns) return;
  const path = [];
  let cur = e.jxnStack[e.jxnStack.length - 1];
  while (e.jxnStack.length) {
    const fromId = cur;
    if (toJxnId && fromId === toJxnId) break;
    // previous stack frame
    const prev = e.jxnStack[e.jxnStack.length - 2];
    if (!prev) break;
    // find edge from prev -> from
    const prevNode = topo.jxns.get(prev);
    const edge = prevNode?.exits?.find(ex => ex.to === fromId);
    if (edge && Array.isArray(edge.path)) {
      // backtrack goes reverse along corridor
      for (let i = edge.path.length - 1; i >= 0; i--) path.push(edge.path[i]);
    }
    e.jxnStack.pop();
    cur = prev;
    if (toJxnId && cur === toJxnId) break;
  }
  e.backtrackPath = path.length ? path : null;
}
