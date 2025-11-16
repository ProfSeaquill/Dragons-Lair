// story.js
// Dragon’s Lair — narrative scaffolding + dialogue
// Import into main flow and call getDialogueFor(wave, "entry"|"defeat")
// to retrieve an ordered list of { speaker, text, mood?, portrait?, sfx?, speed? }.

// =========================
// Public API
// =========================
export const BOSS_SCHEDULE = {
  5: 'mordred',
  10: 'kay',
  15: 'palamedes',
  20: 'gawain',
  25: 'percival',
  30: 'bors',
  35: 'tristan',
  40: 'galahad',
  45: 'bedivere',
  50: 'lancelot',
  51: 'arthur',
};

export function isBossLevel(wave) {
  return BOSS_SCHEDULE[wave] != null;
}

export function getBossId(wave) {
  return BOSS_SCHEDULE[wave] || null;
}

// event: "entry" | "defeat"
// returns: Array<Line>
export function getDialogueFor(wave, event) {
  const id = getBossId(wave);
  if (!id) return [];

  // Update world state before composing lines (off-screen collapse escalates).
  tickWorldState(wave);

  // Build token bag for substitutions (e.g., {DRAGON_NAME})
  const tokens = buildTokens(wave);

  // Compose lines based on event + verbosity rules.
  const lines = composeDialogue(id, wave, event, tokens);

  // Post-process: token substitution, pacing metadata
  return lines.map(resolveTokens(tokens));
}

// Optional: If you want to show off-screen state in the UI (e.g., next to wave)
// you can read this for flavor tooltips or subtle HUD lines.
export function getOffscreenSynopsis() {
  return WORLD.offscreenNotes.slice(-1)[0] || null;
}

// =========================
// Narrative Configuration
// =========================

// Dragon identity + reveal cadence
const DRAGON = {
  canonicalName: 'Caerdrake', // pick one; you can change anytime
  titles: ['The Last Ember', 'Winged General', 'Pendragon’s Shadow'],
  // Reveal beats:
  nameRevealedAt: 20,   // Gawain (Lv. 20)
  titlesRevealedAt: 10, // Kay (Lv. 10)
};

// Verbosity ramp — how “talkative” the dragon becomes
const VERBOSITY = {
  dragonRepliesStart: 25,     // first short replies
  fullConversationsStart: 45, // multi-exchange
};

// Off-screen Camelot collapse — phase gates for flavor + tone
const PHASES = [
  { at: 1,   label: 'Hunt',        msg: 'Rumors spread: a “beast” lairs in the mountains.' },
  { at: 10,  label: 'Recognition', msg: 'Whispers from Camelot: it may be their dragon.' },
  { at: 25,  label: 'Retrieval',   msg: 'Envoys fail; knights sent to retrieve their weapon.' },
  { at: 40,  label: 'Crisis',      msg: 'Fronts falter; fires light distant coasts.' },
  { at: 50, label: 'Desperation', msg: 'Only legends remain to stand between Camelot and ruin.' },
  { at: 51, label: 'The King',    msg: 'Arthur rides, not to conquer, but to plead.' },
];

// Minimal, safe “moods” for your textbox portraits/animations if you want
const MOOD = {
  knight: { neutral: 'k_neutral', stern: 'k_stern', sorrow: 'k_sorrow', holy: 'k_holy' },
  dragon: { terse: 'd_terse', bitter: 'd_bitter', weary: 'd_weary', solemn: 'd_solemn' },
};

// Optional SFX/typing speed hints for your typewriter effect
const TYPE = {
  short: { sfx: 'blip', speed: 28 },
  normal: { sfx: 'blip', speed: 22 },
  slow: { sfx: 'blip', speed: 16 },
};

// =========================
// World State (off-screen)
// =========================
const WORLD = {
  phaseIdx: 0,
  offscreenNotes: [PHASES[0].msg],
  // You can hang additional flags as needed.
};

// Advance phase notes as waves pass
function tickWorldState(wave) {
  const idx = Math.max(0, PHASES.map(p => p.at <= wave).lastIndexOf(true));
  if (idx > WORLD.phaseIdx) {
    WORLD.phaseIdx = idx;
    WORLD.offscreenNotes.push(PHASES[idx].msg);
  }
}

// =========================
// Token Builder & Resolver
// =========================
function buildTokens(wave) {
  const nameVisible = wave >= DRAGON.nameRevealedAt;
  const titlesVisible = wave >= DRAGON.titlesRevealedAt;
  return {
    DRAGON_NAME: nameVisible ? DRAGON.canonicalName : '…',
    DRAGON_TITLES: titlesVisible ? DRAGON.titles.join(', ') : '…',
  };
}

function resolveTokens(tokens) {
  return (line) => {
    const replaced = { ...line };
    replaced.text = line.text
      .replaceAll('{DRAGON_NAME}', tokens.DRAGON_NAME)
      .replaceAll('{DRAGON_TITLES}', tokens.DRAGON_TITLES);
    return replaced;
  };
}

// =========================
// Dialogue Library
// =========================

// Helper: speaker shorthands
const K = (id, text, mood='k_neutral', type='normal') =>
  ({ speaker: id, text, mood, ...TYPE[type] });
const D = (text, mood='d_terse', type='normal') =>
  ({ speaker: 'dragon', text, mood, ...TYPE[type] });

// Compose per boss + event, layering verbosity rules
function composeDialogue(id, wave, event, T) {
  const dragonTalks = wave >= VERBOSITY.dragonRepliesStart;
  const fullConvo   = wave >= VERBOSITY.fullConversationsStart;

  // Common intros/outros if you want a consistent wrapper:
  // We’ll keep lines focused per boss for now.
  switch (id) {
    case 'mordred':    return mordred(wave, event, dragonTalks, fullConvo, T);
    case 'kay':        return kay(wave, event, dragonTalks, fullConvo, T);
    case 'palamedes':  return palamedes(wave, event, dragonTalks, fullConvo, T);
    case 'gawain':     return gawain(wave, event, dragonTalks, fullConvo, T);
    case 'percival':   return percival(wave, event, dragonTalks, fullConvo, T);
    case 'bors':       return bors(wave, event, dragonTalks, fullConvo, T);
    case 'tristan':    return tristan(wave, event, dragonTalks, fullConvo, T);
    case 'galahad':    return galahad(wave, event, dragonTalks, fullConvo, T);
    case 'bedivere':   return bedivere(wave, event, dragonTalks, fullConvo, T);
    case 'lancelot':   return lancelot(wave, event, dragonTalks, fullConvo, T);
    case 'arthur':     return arthur(wave, event, dragonTalks, fullConvo, T);
    default: return [];
  }
}

// ============ Boss Beats ============

// Lv.5 — Mordred: first recognition (short, cryptic)
function mordred(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ K('mordred', '…You.', 'k_stern', 'short') ];
  }
  // defeat
  return [
    K('mordred', 'I thought you a beast. Now I remember the fear you carried ahead of Camelot’s banners.', 'k_stern', 'normal'),
    talk ? D('I carry it still.', 'd_terse', 'short') : null,
  ].filter(Boolean);
}

// Lv.10 — Kay: titles revealed, sarcastic edge
function kay(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ K('kay', `Look at you—{DRAGON_TITLES} skulking in a cave. Seneschal says hello.`, 'k_neutral', 'normal') ];
  }
  return [
    K('kay', 'Arthur fed a kingdom on your fire. Now we choke on smoke without it.', 'k_stern', 'normal'),
    talk ? D('I won’t be your hearth again.', 'd_bitter', 'short') : null,
  ].filter(Boolean);
}

// Lv.15 — Palamedes: outsider rebuke
function palamedes(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [
      K('palamedes', 'I was never theirs. Still, I stood the wall you abandoned.', 'k_stern', 'normal'),
      talk ? D('And how many villages did that wall cast into shadow?', 'd_bitter', 'short') : null,
    ].filter(Boolean);
  }
  return [
    K('palamedes', 'Like me, you were always apart. Unlike me, you fled.', 'k_stern', 'normal'),
    talk ? D('I chose to stop burning what I swore to protect.', 'd_terse', 'normal') : null,
  ].filter(Boolean);
}

// Lv.20 — Gawain: name reveal (reverent, angry)
function gawain(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ K('gawain', `Name yourself… No. I remember. {DRAGON_NAME}.`, 'k_stern', 'slow') ];
  }
  return [
    K('gawain', `You carried our standard to Rome and back. And then dropped it here.`, 'k_stern', 'normal'),
    talk ? D('I dropped it before it crushed another child.', 'd_bitter', 'normal') : null,
  ].filter(Boolean);
}

// Lv.25 — Percival: naïve awe + gratitude
function percival(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ K('percival', 'You saved me once. I was small. You were… vast.', 'k_neutral', 'normal') ];
  }
  return [
    K('percival', 'I thought heroes never tired. I was wrong.', 'k_sorrow', 'normal'),
    talk ? D('I am not a hero. Only a fire that learned what it burns.', 'd_weary', 'normal') : null,
  ].filter(Boolean);
}

// Lv.30 — Bors: cold duty
function bors(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ K('bors', 'Kingdom before creature. Return, or be ended.', 'k_stern', 'normal') ];
  }
  return [
    K('bors', 'Camelot weakens while you hide.', 'k_stern', 'normal'),
    talk ? D('Camelot weakened while I obeyed.', 'd_bitter', 'normal') : null,
  ].filter(Boolean);
}

// Lv.35 — Tristan: melancholy
function tristan(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ K('tristan', 'Even love cannot argue with ruin. Come back with me.', 'k_sorrow', 'slow') ];
  }
  return [
    K('tristan', 'Once your shadow meant hope. Now it is a tombstone across the hills.', 'k_sorrow', 'normal'),
    talk ? D('Then let the hills rest at last.', 'd_weary', 'normal') : null,
  ].filter(Boolean);
}

// Lv.40 — Galahad: holy condemnation
function galahad(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ K('galahad', 'Purity does not flee its purpose. Repent or be purged.', 'k_holy', 'normal') ];
  }
  return [
    K('galahad', 'You turned your back not on Arthur, but on grace.', 'k_holy', 'normal'),
    talk ? D('Grace did not put out the fires we lit.', 'd_bitter', 'normal') : null,
  ].filter(Boolean);
}

// Lv.45 — Bedivere: weary reflection; dragon begins fuller replies
function bedivere(wave, event, talk, convo, T) {
  if (event === 'entry') {
    const lines = [
      K('bedivere', 'Old friend—if friend I may still call you—Arthur grieves you most of all.', 'k_sorrow', 'slow'),
    ];
    if (convo) lines.push(D('I grieve him too. But grief cannot leash me again.', 'd_weary', 'normal'));
    return lines;
  }
  return [
    K('bedivere', 'I returned a sword to still waters once. I cannot return you.', 'k_sorrow', 'normal'),
    D('Then return your king to peace. Tell him: I will not burn for Camelot again.', 'd_solemn', 'normal'),
  ];
}

// Lv.50 — Lancelot: speaks on entry; full conversation
function lancelot(wave, event, talk, convo, T) {
  if (event === 'entry') {
    const lines = [
      K('lancelot', '{DRAGON_NAME}. I have no hatred left for you—only a duty I fail by loving.', 'k_sorrow', 'slow'),
      D('No hatred remains in me either. Only a line I will not cross again.', 'd_solemn', 'normal'),
      K('lancelot', 'Then meet me at that line. If I fall, let it be knowing I tried to carry you home.', 'k_sorrow', 'normal'),
    ];
    return lines;
  }
  // defeat
  return [
    K('lancelot', 'Forgive me—for failing to forgive you.', 'k_sorrow', 'slow'),
    D('I forgave you long ago. Forgiveness is not a leash.', 'd_solemn', 'normal'),
  ];
}

// Lv.101 — Arthur: existential plea; tragic philosophy clash
function arthur(wave, event, talk, convo, T) {
  if (event === 'entry') {
    const lines = [
      K('arthur', 'I need not command you. Only stand beside me, and the world will sheathe its blades.', 'k_stern', 'slow'),
      D('That is why I left. Your peace is a silence we enforced with fire.', 'd_bitter', 'normal'),
      K('arthur', 'So you choose their victory over ours?', 'k_stern', 'normal'),
      D('No, Arthur. I choose the world over Camelot.', 'd_solemn', 'slow'),
    ];
    return lines;
  }
  // defeat
  return [
    K('arthur', 'I asked for your shadow, not your servitude.', 'k_sorrow', 'slow'),
    D('Your shadow swallowed kingdoms. Let the sun set on Camelot, my king.', 'd_solemn', 'slow'),
  ];
}

// =========================
// Integration Hints
// =========================
//
// 1) Hookup in main/ui:
//    import { isBossLevel, getDialogueFor } from './story.js';
//
//    if (isBossLevel(gs.wave)) {
//      const lines = getDialogueFor(gs.wave, 'entry');
//      showDialogue(lines).then(() => startBossWave());
//    }
//
//    onBossDefeated:
//      const lines = getDialogueFor(gs.wave, 'defeat');
//      showDialogue(lines).then(() => proceed());
//
// 2) Your textbox renderer can iterate lines:
//    for (const line of lines) renderBubble(line.speaker, line.text, { mood: line.mood, sfx: line.sfx, speed: line.speed });
//
// 3) Portrait keys (“mood”) are placeholders; map them to sprites as you like.
//
// 4) Tokens {DRAGON_NAME}/{DRAGON_TITLES} resolve automatically at reveal waves.
//
// 5) To expand: just add more lines in each boss handler; API stays stable.
//
