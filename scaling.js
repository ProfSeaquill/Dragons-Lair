// scaling.js — thin compatibility layer
// Wave logic & per-wave enemy stats now live entirely in combat.js.
// The UI's preview panel already calls combat.previewWaveList; this file
// simply forwards a couple of helpers in case any legacy code imports here.

export async function previewWaveList(wave) {
  const mod = await import('./combat.js');
  return (typeof mod.previewWaveList === 'function')
    ? mod.previewWaveList(wave)
    : [];
}

// Optional: a tiny formatter you can use anywhere for quick text previews.
// Returns a string like: "Wave 12: 5 Villagers, 3 Squires, 2 Knights, 1 Hero"
export async function wavePreviewString(wave) {
  const list = await previewWaveList(wave);
  if (!Array.isArray(list) || list.length === 0) return `Wave ${wave}`;

  const counts = {};
  for (const t of list) counts[t] = (counts[t] | 0) + 1;

  const order = ['villager','squire','knight','hero','engineer','kingsguard','boss'];
  const label = {
    villager: 'Villager',
    squire: 'Squire',
    knight: 'Knight',
    hero: 'Hero',
    engineer: 'Engineer',
    kingsguard: "King's Guard",
    boss: 'Knight of the Round Table',
  };

  const parts = [];
  for (const k of order) {
    const n = counts[k] | 0;
    if (!n) continue;
    const name = label[k] || k[0].toUpperCase() + k.slice(1);
    parts.push(`${n} ${name}${n > 1 ? 's' : ''}`);
  }
  return `Wave ${wave}: ${parts.join(', ')}`;
}
