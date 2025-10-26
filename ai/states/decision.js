// ai/states/decision.js
import { CFG } from '../config.js';
import { getJxnMem, recordOutcome, pushJunction, planBacktrackTo } from '../memory.js';
import { junctionId } from '../topology.js';
import { isDeadEnd, isJunction, isCorridor } from '../perception.js';
import * as state from '../../state.js';

function nowMs(gs){ return (gs?.time?.nowMs ?? (gs?.time?.now*1000) ?? performance.now()); }

function inDragonCell(gs, x, y) {
  const cells = state.dragonCells(gs);
  for (const c of cells) if (c.x === x && c.y === y) return true;
  return false;
}

export function enter(e, gs) {
  e.speedMul = 0; e.stateT = 0;
  // Randomized micro delay (ms → sec when comparing with stateT)
  const ms = CFG.JXN_THINK_MS_MIN + Math.random() * (CFG.JXN_THINK_MS_MAX - CFG.JXN_THINK_MS_MIN);
  e._jxnWaitMs = ms;

  // If we arrived here from a previous choice, resolve its outcome now
  if (e.pendingOutcome) {
    const { fromId, dir } = e.pendingOutcome;
    const x = e.tileX|0, y = e.tileY|0;
    let outcome = 'corridor';
    if (inDragonCell(gs, x, y)) outcome = 'dragon';
    else if (isDeadEnd(gs, x, y)) outcome = 'deadend';
    else if (isJunction(gs, x, y)) outcome = 'corridor';
    else if (isCorridor(gs, x, y)) outcome = 'corridor';
    recordOutcome(e, fromId, dir, outcome);
    e.pendingOutcome = null;
  }
}

// Hoisted: wave-scoped group route memo
function _ensureGroupMemo(gs, gid) {
  if (!gs.groupRoutes) gs.groupRoutes = new Map();
  let m = gs.groupRoutes.get(gid);
  if (!m) { m = new Map(); gs.groupRoutes.set(gid, m); }
  return m;
}

export function update(e, gs, dt) {
  e.stateT += dt;
  if (e.stateT * 1000 < (e._jxnWaitMs | 0)) return null;

  // Require topology
  const topo = gs.topology;
  if (!topo || !topo.jxns) { e.speedMul = 1; return 'search'; }

  const id = junctionId(e.tileX | 0, e.tileY | 0);
  const node = topo.jxns.get(id);

  // If not a mapped node (e.g., degree==2), just return to search
  if (!node) { e.speedMul = 1; return 'search'; }

  // Maintain stack
  pushJunction(e, id);

  // Memory for this junction (versioned)
  const mem = getJxnMem(e, id, node.version);

  // If exhausted, backtrack to last stack node with untried exits
  if (mem.exhausted) {
    // find nearest ancestor with untried
    let target = null;
    for (let i = e.jxnStack.length - 2; i >= 0; i--) {
      const jid = e.jxnStack[i];
      const jm = getJxnMem(e, jid, topo.jxns.get(jid)?.version | 0);
      const hasUntried = ['N', 'E', 'S', 'W'].some(k => jm.mask[k] === 0);
      if (hasUntried) { target = jid; break; }
    }
    planBacktrackTo(e, topo, target);
    e.speedMul = 1;
    return 'search';
  }

  // If in a group and a leader has declared a choice at this junction, prefer it
  let leaderDir = null;
  if (e.groupId) {
    const memo = _ensureGroupMemo(gs, e.groupId);
    leaderDir = memo.get(id) || null;
  }

  // Score exits: prefer untried; otherwise by prior outcomes
  const cand = [];
  for (const ex of node.exits) {
    const m = mem.mask[ex.dir];            // 0 untried, 1 tried(de), 2 success
    if (m === 1) continue;                 // hard avoid deadend
    const prior = mem.outcome[ex.dir];     // may be undefined
    const priorScore = CFG.OUTCOME_SCORE[prior || 'room'] ?? 0;
    const untriedBonus = (m === 0) ? 10 : 0; // large bias
    cand.push({ ex, score: untriedBonus + priorScore });
  }

  if (cand.length === 0) {
    // No usable exits recorded (could be single-node pocket). Mark exhausted and backtrack.
    mem.exhausted = true;
    e.speedMul = 1;
    return 'search';
  }

  // Choose best, then apply leader/curiosity rules
  cand.sort((a, b) => b.score - a.score);
  let chosen = cand[0];

  // Curiosity probability is per-enemy and damped by herding (and roar buff if present)
  const baseCur   = Math.max(0, Math.min(1, e.behavior?.curiosity ?? 0.10));
  const herdMul   = Math.max(0, e.behavior?.herding ?? 1);
  const roarHerd  = Number.isFinite(e.herdingBuff) ? e.herdingBuff : 1;
  const pCuriosity = baseCur / Math.max(1e-6, herdMul * roarHerd);

  // Wave-level cap for simultaneous strays
  const alive = (gs.enemiesAlive ?? gs.activeEnemies?.length ?? 1);
  gs._straysCap = Math.max(1, Math.ceil(CFG.STRAYS_CAP_FRACTION * alive));
  gs._straysActive = gs._straysActive || 0;
  const now = (gs?.time?.nowMs ?? (gs?.time?.now * 1000) ?? performance.now());

  // Cull expired stray flag
  if (e.isStray && now >= e.strayUntil) { e.isStray = false; if (gs._straysActive > 0) gs._straysActive--; }

  // Leader suggestion, if present, becomes top candidate (unless hard-marked deadend)
  let leaderPreferred = null;
  if (leaderDir) {
    leaderPreferred = cand.find(c => c.ex.dir === leaderDir) || null;
  }

  // If leader suggested a direction, followers prefer it unless curiosity triggers
  if (leaderPreferred && chosen.ex.dir !== leaderPreferred.ex.dir) {
    const allowStray = gs._straysActive < gs._straysCap;
    const strayRoll = Math.random() < pCuriosity;
    if (!(allowStray && strayRoll && cand.length > 1)) {
      chosen = leaderPreferred; // follow leader
    } else {
      // mark as stray and set timer
      if (!e.isStray) { e.isStray = true; gs._straysActive++; }
      e.strayUntil = now + CFG.STRAY_TIMEOUT_MS;
    }
  } else {
    // No leader suggestion: normal curiosity to second-best
    const allowStray = gs._straysActive < gs._straysCap;
    if (allowStray && Math.random() < pCuriosity && cand.length > 1) {
      chosen = cand[1];
      if (!e.isStray) { e.isStray = true; gs._straysActive++; }
      e.strayUntil = now + CFG.STRAY_TIMEOUT_MS;
    }
  }

  // --- ANCHOR A: publish leader choice + optional trail (AFTER chosen is final; BEFORE commit) ---
  if (e.leader && e.groupId) {
    const memo = _ensureGroupMemo(gs, e.groupId);
    memo.set(id, chosen.ex.dir);

    // Optional: bump success trail along the leader's chosen corridor to help latecomers
    if (Array.isArray(chosen.ex.path)) {
      for (const p of chosen.ex.path) {
        // tiny, fast-decaying hint
        state.GameState && (state.GameState.successTrail?.[p.y]?.[p.x] != null) &&
          (state.GameState.successTrail[p.y][p.x] += 0.35);
      }
    }
  }

  // --- ANCHOR B: record the branch we’re about to test, then COMMIT and leave decision ---
  e.pendingOutcome = { fromId: id, dir: chosen.ex.dir };

  e.path = chosen.ex.path || [];
  e.commitTilesLeft = (chosen.ex.commit | 0);
  e.speedMul = 1;
  return 'search';
}
