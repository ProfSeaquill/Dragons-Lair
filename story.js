// story.js
// Dragon’s Lair — narrative scaffolding + dialogue
// Import into main flow and call getDialogueFor(wave, event), where:
//   - "entry"   → boss appears
//   - "defeat"  → boss is slain (dragon/player wins this fight)
//   - "victory" → dragon is slain (Camelot wins / game over)
// Returns an ordered list of { speaker, text, mood?, portrait?, sfx?, speed? }.


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
  canonicalName: 'Cargarax', // pick one; you can change anytime
  titles: ['The Last Ember', 'The Calamity from the Clouds', 'Pendragon’s Shadow', 'Car', 'The Hearth of Camelot'],
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
  short: { sfx: 'blip', speed: 35 },
  normal: { sfx: 'blip', speed: 35 },
  slow: { sfx: 'blip', speed: 35 },
};

// =========================
// World State (off-screen)
// =========================
const WORLD = {
  phaseIdx: 0,
  offscreenNotes: [PHASES[0].msg],
  // You can hang additional flags as needed.
  seenEntryWaves: new Set(),
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
    // No dialogue when he first appears
    return [];
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('mordred', 'Another dragon felled, and the world is safer for it.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('mordred', 'Oh! …It’s you.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }
  // Safety fallback (in case of typos)
  return [];
}


// Lv.10 — Kay: titles revealed, sarcastic edge
function kay(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ 
      K('kay', `Look at you--the Last Ember, the Calamity from the Clouds, Pendragon’s Shadow-skulking alone in a malodorous cave. How ignoble.`, 'k_neutral', 'normal'),
      D('...', 'd_bitter', 'short'),
      K('kay', 'Have you no words for me, turncloak? Very well, then--Let’s be quick about it.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('kay', 'A worthy death for the likes of you. Good riddance.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('kay', 'I should have known this cave would be end my end. But my brothers will come behind me... and it will be your end as well.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.15 — Palamedes: outsider rebuke
function palamedes(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [
      K('palamedes', 'Ah, so the rumors were true. Greetings, wyrmbrother. A bit wet here, no? You have forsaken Camelot’s comforts for this?', 'k_stern', 'normal'),
      D('...', 'd_bitter', 'short'),
      K('palamedes', 'Silence? I am perhaps the only one who can understand how you feel. We are different--me, from a foreign land, you of a foreign species.', 'k_stern', 'normal'),
      K('palamedes', 'But duty knows no land, no species. So I stayed. Had you done the same, this day would not be your last.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('palamedes', 'A shame. Rest well, wyrmbrother.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('palamedes', 'I do not look forward to listening to that pig’s arse Kay for evernity. Goodbye, wyrmbrother.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.20 — Gawain: name reveal (reverent, angry)
function gawain(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ 
    K('gawain', `It’s truly you. I confess, when I was asked to bring you back, I did not believe it. Will you come home, {DRAGON_NAME}? You are missed.`, 'k_stern', 'slow'),
    D('Gawain...leafve this place.', 'd_bitter', 'short'),
    K('gawain', `I will not pretend to understand your decision, but I respect it. We will discuss again after the battle.`, 'k_stern', 'slow'),
    ]
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('gawain', 'I... I admit, I did not believe it would end this way. But at least it is settled.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('gawain', `I remember watching your shadow cross the battlefield when I was a young knight. Seeing the fear in the eyes of the Saxon kings. It was an honor.`, 'k_stern', 'normal'),
      D('You should have heeded my words, Gawain.', 'd_bitter', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.25 — Percival: naïve awe + gratitude
function percival(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ 
      K('percival', 'The Last Ember. You saved me once. I was facing three Babylonians at Andor and your flames fell from the sky. Cooked them in their armor.', 'k_neutral', 'normal'),
      D('Percival...did Arthur send you?', 'd_bitter', 'normal'),
      K('percival', 'Would I be here otherwise? In my estimation, you have thrice over earned the right to live as you want. But tis not my decision.', 'k_stern', 'normal'),
      D('I see.', 'd_bitter', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('percival', 'You saved my life and I ended yours. This life is often unfair.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('percival', 'I would not be alive, but for you. I would not be dead either. So it is.', 'k_sorrow', 'normal'),
      D('You fought well, Sir.', 'd_weary', 'normal')
    ].filter(Boolean);
  }

  return [];
}

// Lv.30 — Bors: cold duty
function bors(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ 
      K('bors', 'The dragon, Cargarax--you stand guilty of many crimes, among them treason and the slaying of the smallfolk you swore to protect. How do you plea?', 'k_stern', 'normal'), 
      D('I am no knight, Bors. I swore no oaths.', 'd_bitter', 'normal'),
      K('bors', 'As a citizen of Camelot, you--,' 'k_neutral', 'normal'),
      D('Nor do I bear citizenship', 'd_bitter', 'normal'),
      K('bors', 'Well then allow me to speak plainly. Return or be ended.', 'k_stern', 'normal'),
      D('I would say the same to you.', 'd_bitter', 'normal'),       
  ];
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('bors', 'Arthur will not be pleased. But Camelot will benefit from this.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('bors', 'Where is your guilt? Camelot weakens while you hide.', 'k_stern', 'normal'),
      D('Camelot weakened while I obeyed. The sun has set on those days.', 'd_bitter', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.35 — Tristan: melancholy
function tristan(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ 
      K('tristan', 'The Hearth of Camelot! It is good to see your scaled face. How is your health?', 'k_sorrow', 'slow'), 
      D('I don'tNor do I bear citizenship', 'd_bitter', 'normal'),
      K('tristan', 'Well then allow me to speak plainly. Return or be ended.', 'k_stern', 'normal'),
      D('I would say the same to you.', 'd_bitter', 'normal'),
    ];
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('tristan', 'Another dragon felled, and the world is safer for it.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('tristan', 'Once your shadow meant hope. Now it is a tombstone across the hills.', 'k_sorrow', 'normal'),
      talk ? D('Then let the hills rest at last.', 'd_weary', 'normal') : null,
    ].filter(Boolean);
  }

  return [];
}

// Lv.40 — Galahad: holy condemnation
function galahad(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ K('galahad', 'Purity does not flee its purpose. Repent or be purged.', 'k_holy', 'normal') ];
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('galahad', 'Another dragon felled, and the world is safer for it.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('galahad', 'You turned your back not on Arthur, but on grace.', 'k_holy', 'normal'),
      talk ? D('Grace did not put out the fires we lit.', 'd_bitter', 'normal') : null,
    ].filter(Boolean);
  }

  return [];
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

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('bedivere', 'Another dragon felled, and the world is safer for it.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('bedivere', 'I returned a sword to still waters once. I cannot return you.', 'k_sorrow', 'normal'),
      D('Then return your king to peace. Tell him: I will not burn for Camelot again.', 'd_solemn', 'normal'),
    ].filter(Boolean);
  }

  return [];
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

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('lancelot', 'Another dragon felled, and the world is safer for it.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('lancelot', 'Forgive me—for failing to forgive you.', 'k_sorrow', 'slow'),
      D('I forgave you long ago. Forgiveness is not a leash.', 'd_solemn', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.51 — Arthur: existential plea; tragic philosophy clash
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

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('arthur', 'Another dragon felled, and the world is safer for it.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('arthur', 'I asked for your shadow, not your servitude.', 'k_sorrow', 'slow'),
      D('Your shadow swallowed kingdoms. Let the sun set on Camelot, my king.', 'd_solemn', 'slow'),
    ].filter(Boolean);
  }

  return [];
}


// =========================
// Boss lifecycle hooks (events from combat.js)
// =========================
//
// combat.js will dispatch:
//   window.dispatchEvent(new CustomEvent('dl-boss-appeared', { detail: { wave, id, type } }));
//   window.dispatchEvent(new CustomEvent('dl-boss-defeated', { detail: { wave, id, type } }));
//
// This section listens for those events, builds the right dialogue using
// getDialogueFor(wave, 'entry' | 'defeat'), and re-emits a single
// 'dl-story-dialog' event for the UI layer to render.

function emitBossDialogue(wave, event) {
  if (!wave) return;
  const lines = getDialogueFor(wave, event);
  if (!lines || !lines.length) return;

  try {
    window.dispatchEvent?.(
      new CustomEvent('dl-story-dialog', {
        detail: { wave, event, lines },
      })
    );
  } catch (_) {}
}

// When the first boss actually spawns on the map
window.addEventListener('dl-boss-appeared', (ev) => {
  const wave = ev?.detail?.wave | 0;
  try {
    WORLD.seenEntryWaves?.add?.(wave);
  } catch (_) {}
  emitBossDialogue(wave, 'entry');
});

// When that boss actually dies (not when the wave ends)
window.addEventListener('dl-boss-defeated', (ev) => {
  const wave = ev?.detail?.wave | 0;
  emitBossDialogue(wave, 'defeat');
});

// When that boss wins
window.addEventListener('dl-boss-victory', (ev) => {
  const wave = ev?.detail?.wave | 0;
  // 👇 NEW: only show victory dialogue if the entry happened for this wave
  if (!WORLD.seenEntryWaves || !WORLD.seenEntryWaves.has?.(wave)) {
    return; // dragon died before boss spawn → no boss victory dialogue
  }
  emitBossDialogue(wave, 'victory');
});

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
