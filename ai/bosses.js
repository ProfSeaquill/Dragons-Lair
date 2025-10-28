// ai/bosses.js — boss naming + behavior registry from story.BOSS_SCHEDULE
import { BOSS_SCHEDULE } from '../story.js';

// --- Normalize BOSS_SCHEDULE into a quick lookup by wave ---
// Supports any of the following shapes:
// 1) Array of { wave, key?, name }                       e.g. [{ wave:10, key:"kingsguard", name:"Sir Aegis" }]
// 2) Object of wave->string                              e.g. { "10": "Sir Aegis", "20":"Galahad" }
// 3) Object of wave->{ key?, name }                      e.g. { "10": { key:"kingsguard", name:"Sir Aegis" } }
// 4) Object of wave->Array<string|{key?,name}>           e.g. { "50":[ "Merlin", {key:"round3",name:"Percival"} ] }  // multi-boss wave (future-proof)
function slugKeyFromName(name) {
  return String(name || 'boss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SCHEDULE_BY_WAVE = new Map();

(function normalize() {
  if (Array.isArray(BOSS_SCHEDULE)) {
    for (const entry of BOSS_SCHEDULE) {
      if (!entry || typeof entry !== 'object') continue;
      const wave = Number(entry.wave);
      if (!Number.isFinite(wave)) continue;
      const name = entry.name ?? entry.title ?? entry.n ?? entry.display ?? '';
      const key  = entry.key  ?? slugKeyFromName(name);
      const rec  = { key, name: String(name || key) };
      const prev = SCHEDULE_BY_WAVE.get(wave);
      if (prev) {
        // allow multi-boss waves later
        SCHEDULE_BY_WAVE.set(wave, Array.isArray(prev) ? [...prev, rec] : [prev, rec]);
      } else {
        SCHEDULE_BY_WAVE.set(wave, rec);
      }
    }
    return;
  }

  if (BOSS_SCHEDULE && typeof BOSS_SCHEDULE === 'object') {
    for (const waveStr of Object.keys(BOSS_SCHEDULE)) {
      const wave = Number(waveStr);
      if (!Number.isFinite(wave)) continue;
      const val = BOSS_SCHEDULE[waveStr];

      const toRec = (v) => {
        if (typeof v === 'string') {
          const name = v;
          return { key: slugKeyFromName(name), name };
        }
        if (v && typeof v === 'object') {
          const name = v.name ?? v.title ?? v.n ?? v.display ?? '';
          const key  = v.key  ?? slugKeyFromName(name);
          return { key, name: String(name || key) };
        }
        return null;
      };

      if (Array.isArray(val)) {
        const list = val.map(toRec).filter(Boolean);
        if (list.length) SCHEDULE_BY_WAVE.set(wave, list.length === 1 ? list[0] : list);
      } else {
        const rec = toRec(val);
        if (rec) SCHEDULE_BY_WAVE.set(wave, rec);
      }
    }
  }
})();

// --- Public helpers ---
export function getBossInfoForWave(waveNum) {
  // Returns null, a single {key,name}, or an array of such for multi-boss waves
  return SCHEDULE_BY_WAVE.get(Number(waveNum)) || null;
}

// Default (no-op) AI hooks; override per boss key in BEHAVIOR.
const DefaultBossAI = {
  onSpawn(e, gs) { /* no-op for now */ },
  update(e, dt, gs) { /* generic boss behavior later */ },
  onDeath(e, gs) { /* no-op */ },
};

// Registry: add per-boss behaviors here over time.
const BEHAVIOR = Object.create(null);
// Example (commented):
// BEHAVIOR["kingsguard"] = {
//   onSpawn(e, gs) { e.armor = (e.armor ?? 0) + 2; },
//   update(e, dt, gs) { /* shield bash */ },
//   onDeath(e, gs) { /* drop unique loot */ },
// };

export function attachBossIdentityAndAI(e, bossRec) {
  if (!bossRec) return e;
  e.isBoss  = true;
  e.bossKey = bossRec.key;
  e.name    = bossRec.name || bossRec.key;
  e.aiBoss  = BEHAVIOR[bossRec.key] || DefaultBossAI;
  if (e.aiBoss.onSpawn) e.aiBoss.onSpawn(e, e.gs);
  return e;
}

export function tickBossAI(e, dt, gs) {
  if (e?.isBoss && e.aiBoss?.update) e.aiBoss.update(e, dt, gs);
}

export function bossDisplayNameForWave(waveNum) {
  const rec = getBossInfoForWave(waveNum);
  if (!rec) return null;
  if (Array.isArray(rec)) return rec.map(r => r.name || r.key).join(' & ');
  return rec.name || rec.key;
}
