# Dragon’s Lair — Idle Tower Defense  
**One-Page Design (v0.10)**

**Project**: vanilla ES modules (browser), 2D canvas + WebGL lighting  
**Repo**: `combat.js`, `index.html`, `lighting-webgl.js`, `main.js`, `pathing.js`, `render.js`, `state.js`, `ui.js`, `upgrades.js` (+ JSON configs)  
**Status**: Phases 1–3 complete (evented UI, config load, tests/CI)

---

## Table of Contents
1. [Vision & Fantasy](#vision--fantasy)  
2. [Core Loop](#core-loop)  
3. [Systems](#systems)  
4. [Content & Tuning (Config)](#content--tuning-config)  
5. [UX & UI](#ux--ui)  
6. [Tech Notes](#tech-notes)  
7. [Difficulty Curve](#difficulty-curve)  
8. [Success Criteria](#success-criteria)  
9. [Risks & Mitigations](#risks--mitigations)  
10. [Roadmap Snapshot](#roadmap-snapshot)

---

## Vision & Fantasy
Be a smug dragon defending your lair. Funnel intruders with walls (bones), roast lines of enemies with flame, and time big crowd-control bursts. Low friction “one more wave” feel; idles fine but rewards attention.

## Core Loop
1. **Shape** – Place/remove **edge-walls** to steer paths (cost: bones). Entry ↔ Exit can **never** be fully blocked.  
2. **Fight** – Start wave; dragon auto-breathes; **Claw** auto-melee on adjacency; use **Gust / Roar / Stomp** on cooldown.  
3. **Reward** – Earn **gold** (upgrades) + **bones** (walls & heal).  
4. **Progress** – Buy upgrades, optionally auto-start the next wave.

## Systems
- **Pathing & Build**
  - Grid with edge walls; last wall segment that would sever Entry↔Exit is refused.
  - Enemies **keep straight** in corridors; choose junctions via distance field.
- **Combat**
  - **Flame**: passes through enemies by default; **range** = tiles traveled; burn DoT; shielded enemies can block.  
  - **Claw**: **passive** adjacent melee; upgradeable damage/cooldown.  
  - **Abilities** (active): **Gust** (push), **Roar** (stun), **Stomp** (slow); cooldowns from config.
- **Economy**
  - **Gold** from kills → upgrades.
  - **Bones** for walls & heal (**1 bone = 1 HP** by default).
  - Auto-start toggle for waves.
- **Upgrades**
  - Catalog is data-driven (`upgrades.json` array **or** map).  
  - Examples: `fire_rate_*`, `fire_dmg_*`, `burn_dot_*`, **`flame_range_*`**, `claw_dmg_*`, `claw_speed_*`, and the three abilities (mark with `"type":"ability"` for Use buttons).

## Content & Tuning (Config)
- Config files loaded at boot and merged with safe defaults:
  - `tuning.json` → magnitudes for flame/claw/abilities + economy (`wallCostBones=1`, `healCostBone=1`).  
  - `enemies.json` → per-type stats (hp, speed, gold, tags like `shielded`).  
  - `waves.json` → ordered waves (type, count, cadence).  
  - `upgrades.json` → upgrade catalog.
- Defaults live in `DEFAULT_CFG` (in `state.js`) so the game runs even if JSONs are empty/missing.

## UX & UI
- HUD: Wave, HP, Gold, Bones, Auto-start.  
- **Upgrades panel**: Buy buttons for all; **Use** buttons only for `gust/roar/stomp`.  
- Build help text draws live from config (wall cost).  
- **(Phase 4)** Debug overlay toggle: FPS, enemies alive, cooldowns, connectivity flag, etc.

## Tech Notes
- **Architecture**: vanilla ES modules; UI emits `CustomEvent`s, `main.js` listens:
  - `dl-start-wave`, `dl-heal`, `dl-auto-start`, `dl-save`, `dl-load`, `dl-upgrade-buy`, …
- **Rendering**: 2D scene canvas → WebGL lighting pass; lights capped to shader budget.  
- **Saving**: `saveState/loadState` in `state.js` (v2 with autosave/versioning planned).  
- **CI & Tests**: GitHub Actions (`.github/workflows/ci.yml`), Node 20, tests in `/tests`, `npm test` runs `node --test`.  
- **Invariants under test**: cannot fully block Entry↔Exit; gap detection; “keep straight in corridor.”

## Difficulty Curve
- Early: gentle counts, low shield frequency.  
- Mid: faster spawns, mixed elites, more burn resistance.  
- Boss every _N_ waves: more HP, a mechanic (e.g., shield aura/torch bearer).  
- Active ability timing yields mastery spikes; auto-start supports idle flow.

## Success Criteria
- ~60 FPS on desktop; no GC spikes during waves.  
- 90% of new players reach Wave 5; Wave 10 requires ~2–3 upgrades.  
- No pathing softlocks (tests enforce); config swaps don’t break UI.

## Risks & Mitigations
- **Wall exploits** → disallow full blocks (done) + tests.  
- **Ability spam** → cfg cooldowns; immunity windows if needed.  
- **Balance drift** → move magnitudes to `tuning.json`; add headless sims later.  
- **Perf regressions** → object reuse & HUD diffing (Phase 9).

## Roadmap Snapshot
- **P4** Debug Overlay → **P5** Waves/Enemies JSON → **P6** tuning knobs → **P7** autosave/versioning → **P8** telemetry → **P9** perf pass.  
- Optional next: onboarding, bosses polish, PWA, content tools, achievements.

---
_Last updated: v0.10_
