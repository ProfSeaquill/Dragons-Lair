import { CFG } from './config.js';

export function initMemory(e) {
  e.mem ??= { visited: new Map(), lastForget: 0 };
}

export function markVisited(e, tileId, now) {
  e.mem.visited.set(tileId, now);
}

export function visitedScore(e, tileId, now) {
  const t = e.mem.visited.get(tileId);
  if (t == null) return 0;
  const age = now - t;
  const fade = Math.min(1, age / CFG.VISITED_DECAY_SEC);
  // recent visit -> full penalty, old visit -> tiny penalty
  return CFG.VISITED_PENALTY * (1 - fade);
}
