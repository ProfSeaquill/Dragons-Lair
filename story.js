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
      K('palamedes', 'I do not look forward to listening to that pig’s arse Kay for eternity. Goodbye, wyrmbrother.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.20 — Gawain: name reveal (reverent, angry)
function gawain(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ 
    K('gawain', `It’s truly you. I confess, when I was asked to bring you back, I did not believe it. Will you come home, {DRAGON_NAME}? You are missed.`, 'k_stern', 'slow'),
    D('Gawain...leave this place.', 'd_bitter', 'short'),
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
      K('bors', 'As a citizen of Camelot, you--,', 'k_neutral', 'normal'),
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
      D('I do not desire conversation, Tristan.', 'd_bitter', 'normal'),
      K('tristan', 'Of course. And I was not sent here to converse. Camelot needs you, Sir. Our enemies have grown bold as word of your absence grows.', 'k_stern', 'normal'),
      D('Camelot is no longer a concern of mine.', 'd_bitter', 'normal'),
      K('tristan', 'But... Sir, may I ask why?', 'k_sorrow', 'slow'),
      D('I owe you no answers, Tristan. Come if you must.', 'd_bitter', 'normal'),
      K('tristan', 'Ah. So it is.', 'k_sorrow', 'slow'),
    ];
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('tristan', 'You preferred to die than to defend your homeland. Why?', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('tristan', 'Your shadow once meant hope. I wish for those days return, though I will not be here to see them. Goodbye, Sir.', 'k_sorrow', 'normal'),
      D('Rest well, Tristan.', 'd_weary', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.40 — Galahad: holy condemnation
function galahad(wave, event, talk, convo, T) {
  if (event === 'entry') {
    return [ 
      K('galahad', 'Cargarax. Even these cave walls cannot hide your sins from the Lord. Repent or be purged.', 'k_holy', 'normal'),
      D('You have always been tiresome, young Galahad.', 'd_bitter', 'normal'),
      K('galahad', 'It is not I that tires you, but the weight of your sins. How many innocents have you slain? How many of Camelot’s own have perished in your foul flames?', 'k_sorrow', 'slow'),
      D('Words are words, boy. A true knight speaks with his blade.', 'd_bitter', 'normal'),
      K('galahad', 'On this we agree.', 'k_sorrow', 'slow'),
    ];
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('galahad', 'I will pray for your soul. But I fear it may be too late.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('galahad', 'I thought your fires cleansing before. When you fought on our side. You betrayed our king and our god. Why?', 'k_holy', 'normal'),
      D('There are things that can only be understood with time, boy. They cannot be explained.', 'd_bitter', 'normal'),
      K('galahad', 'Am I dying? Sir Car, is this the end of my life?', 'k_sorrow', 'slow'),
      D('There is no death for those who have salvation. Tonight you dine in heaven, young Galahad. Be brave and rest well.', 'd_bitter', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.45 — Bedivere: weary reflection; dragon begins fuller replies
function bedivere(wave, event, talk, convo, T) {
  if (event === 'entry') {
    const lines = [
      K('bedivere', 'Old friend—-if friend I may still call you—-Camelot is poorer without your laughter to shake her walls.', 'k_sorrow', 'slow'),
      D('Your flatulence should be a fine substitute, Sir.', 'd_weary', 'normal'),
      K('bedivere', 'Ha! So what is this? You have slain your own brothers. Even Galahad?', 'k_sorrow', 'slow'),
      D('He was a quick study. But just as quick to folly. I gave him a quick death.', 'd_bitter', 'normal'),
      K('bedivere', 'And will you do the same for me? A quick death?', 'k_sorrow', 'slow'),
      D('If I must', 'd_bitter', 'normal'),
      K('bedivere', 'This is madness, Sir. We have fought all my life to protect Camelot. She needs us now, more than ever. Come with me--whatever grievance you have can be discussed.', 'k_sorrow', 'slow'),
      D('Not this grievance, Sir. Not this time.', 'd_bitter', 'normal'),
      K('bedivere', 'I see. Ha! We are no longer young, the two of us--but you age like a dragon, you cheating prick.', 'k_sorrow', 'slow'),
      K('bedivere', 'Still, if my old bones will carry me to you, I promise you a sporting fight. Prepare yourself.', 'k_sorrow', 'slow'),
    ];
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('bedivere', 'Two old soldiers like us ought to be ensconced in wines and good meat. Not this. Never this. ', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('bedivere', 'You recall that battle? When I lost my arm?', 'k_sorrow', 'normal'),
      D('I do', 'd_solemn', 'normal'),
      K('bedivere', 'I thought that day would be my last. But your flames cauterized the wound. And now this is how I end. Ha!', 'k_sorrow', 'normal'),
      D('Rest well, Sir Bedivere. Old friend.', 'd_solemn', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.50 — Lancelot: speaks on entry; full conversation
function lancelot(wave, event, talk, convo, T) {
  if (event === 'entry') {
    const lines = [
      K('lancelot', 'Hail, Sir {DRAGON_NAME}.', 'k_sorrow', 'slow'),
      D('Sir Lancelot.', 'd_solemn', 'normal'),
      K('lancelot', 'You know I have never borne you any ill will. But you have slain our brothers and doomed our kingdom. Our king no loger sleeps, and our queen...', 'k_sorrow', 'normal'),
      D('Arthur is no longer my concern. Nor Lady Gwen.', 'd_solemn', 'normal'),
      K('lancelot', 'You say that so firmly. What has happened, wrymbrother? Please, let us end this peacefully.', 'k_sorrow', 'normal'),
      D('When Arthur wanted peace, he sent Kay. You are not here for peace.', 'd_solemn', 'normal'),
      K('lancelot', 'True words. But I would not rather slay a friend.', 'k_sorrow', 'normal'),
      D('Then think of me as an enemy.', 'd_solemn', 'normal'),
      K('lancelot', 'I will try. But...', 'k_sorrow', 'normal'),
      D('Go on.', 'd_solemn', 'normal'),
      K('lancelot', 'It is just... you are so large. We do not have a grave plot prepared. Do you have a burial tradition among dragons that you would like me to observe?', 'k_sorrow', 'normal'),
      D('The ever thoughtful, Sir Lancelot.', 'd_solemn', 'normal'),
    ];
    return lines;
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('lancelot', 'I expected more of a challenge, to be true. Rest well, wyrmbrother.', 'k_stern', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('lancelot', 'I have never tasted defeat before. I find it does not suit my palate.', 'k_sorrow', 'slow'),
      D('You fought well, Sir. Worthy of your fame.', 'd_solemn', 'normal'),
      K('lancelot', 'Yet here I lie bleeding. Is this how so many of my foes have felt?', 'k_sorrow', 'slow'),
      D('I too find naked. So perhaps.', 'd_solemn', 'normal'),
      K('lancelot', 'Hahaha--oh. Thank you, Sir Cargarax. But please, Arthur needs you. Camelot needs you. Would you promise a dying knight that you will again serve our cause', 'k_sorrow', 'slow'),
      D('You are a true knight, Sir Lancelot. Rest well.', 'd_solemn', 'normal'),
    ].filter(Boolean);
  }

  return [];
}

// Lv.51 — Arthur: existential plea; tragic philosophy clash
function arthur(wave, event, talk, convo, T) {
  if (event === 'entry') {
    const lines = [
      K('arthur', 'When Lancelot did not return, I had to come myself.', 'k_stern', 'slow'),
      D('And who presides over Camelot in your absence?', 'd_bitter', 'normal'),
      K('arthur', 'Ha! Would that there was anything to preside over. Much of Camelot has fallen, Car.', 'k_stern', 'normal'), 
      K('arthur', 'Between you slaying our knights and our enemies encroaching on our lands, our might is laughable.', 'k_stern', 'normal'),
      D('So you have fled?', 'd_solemn', 'slow'),
      K('arthur', 'Were I a sensible king, I would. One of those kings from history who bears the crown as fashion and not burden. But instead, I still have hope. That you will return.', 'k_stern', 'slow'),
      D('I wil not.', 'd_bitter', 'normal'),
      K('arthur', 'Do you hate me so? I am a flawed man--even at times a weak one--but I do not believe myself a cruel one.', 'k_stern', 'slow'),
      D('It is not you, Art. It is Camelot.', 'd_bitter', 'normal'),
      K('arthur', 'If Camelot has offended you, I will have her apologize at once...', 'k_stern', 'slow'),
      D('How many wars did we fight together? Did I fight for your father and grandfather?', 'd_bitter', 'normal'),
      K('arthur', 'Many. We are in your debt forever, Car. I know this.', 'k_stern', 'slow'),
      D('And how many more will I fight?', 'd_bitter', 'normal'),
      K('arthur', 'All knights retire, friend. You need not fight. Your presence alone will deter our foes, allow us to rebuild.', 'k_stern', 'slow'),
      D('You misunderstand. I did not fight because I was violent. I fought because Camelot was violent.', 'd_bitter', 'normal'),
      D('Where one foe ended, another began, an endless wave of boys and men dying in my flames.', 'd_bitter', 'normal'),
      D('I came here knowing what would happen to Camelot in my absence. I desired it.', 'd_bitter', 'normal'),
      K('arthur', 'You... desired the end of Camelot? The end of me and Gwen and Bedivere and Galahad? All your friends and brothers? The end of that?', 'k_stern', 'slow'),
      D('There is no other way.', 'd_bitter', 'normal'),
      K('arthur', 'There is always another way. That is why I am here. I still have faith in you, Car, though you seem to have lost your faith in me.', 'k_stern', 'slow'),
      D('I have faith in you, Art. My faith is that you will always be a good man and a good king. Good kings must often do cruel things.', 'd_bitter', 'normal'),
      K('arthur', '...', 'k_stern', 'slow'),
      K('arthur', 'I wish you were wrong, friend. But what I must now do proves you right. For Camelot.', 'k_stern', 'slow'),
      D('For peace.', 'd_bitter', 'normal'),
    ];
    return lines;
  }

  if (event === 'victory') {
    // Boss wins, dragon dies
    return [
      K('arthur', 'I will have to lie about this day. To deter our foes. I will say that fifty of my best knight slayed you.', 'k_stern', 'normal'),
      D('I know.', 'd_bitter', 'normal'),
      K('arthur', 'Is this the peace you wanted?', 'k_stern', 'normal'),
      D('It is the peace I must accept.', 'd_bitter', 'normal'),
      K('arthur', 'I hate you for this, friend. I will never forgive you.', 'k_stern', 'normal'),
      D('I made peace with that possibility when I left Camelot. Good luck, Art. Send my love to Lady Gwen.', 'd_bitter', 'normal'),
    ].filter(Boolean);
  }

  if (event === 'defeat') {
    return [
      K('arthur', 'All I wanted was your presence. Not your servitude. Just your warmth by my side would have been enough.', 'k_sorrow', 'slow'),
      D('Enough to continue a thing that must end.', 'd_solemn', 'slow'),
      K('arthur', 'And you think when Camelot ends, there will not be another? You think this will end the cruelty of man?', 'k_stern', 'normal'),
      D('No. Only the cruelty I have partaken in. Let the sun set on Camelot, Art. Let the hands of other men stain history in blood.', 'd_bitter', 'normal'),
      K('arthur', 'I can feel it.', 'k_stern', 'normal'),
      D('Feel what?', 'd_solemn', 'slow'),
      K('arthur', 'Peace.', 'k_stern', 'normal'),
      K('arthur', 'Goodbye, Car.', 'k_stern', 'normal'),
      D('Rest well, my king.', 'd_solemn', 'slow'),
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
