// ui.js v0.4
export function bindUI(gs) {
  const auto = document.getElementById('autoStart');
  if (auto) {
    auto.checked = !!gs.autoStart;
    auto.addEventListener('change', () => {
      gs.autoStart = !!auto.checked;
    });
  }

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => { if (gs.save) gs.save(); });

  const loadBtn = document.getElementById('loadBtn');
  if (loadBtn) loadBtn.addEventListener('click', () => { if (gs.load) gs.load(); });
}

export function renderUI(gs) {
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  setText('wave', gs.wave ?? 1);
  setText('dragonHP', Math.ceil(gs.dragon?.hp ?? 100));
  setText('gold', Math.floor(gs.gold ?? 0));
  setText('bones', Math.floor(gs.bones ?? 0));
}
