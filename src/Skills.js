// ============================================================
// Skills.js — accrued skill levels, trained by play.
//
// Definitions live in data/skills.json. XP arrives through
// skills.addXp(id, amount) from anywhere in the game:
//
//   fishing     ← every catch (Tasks.cast)
//   cooking     ← completing the morning bake (Tasks)
//   perception  ← opening chests (Containers)
//   endurance   ← distance walked (main loop) + patrols
//   strength    ← completing patrols (Tasks)
//   speechcraft ← talking with townsfolk (Interactions)
//   luck        ← rare finds (Containers)
//   intellect / guile ← hooks ready, sources to come
//
// Curve: xp to reach the NEXT level = round(80 · level^1.4) —
// level 1→2 costs 80xp, 5→6 costs ~763, 10→11 costs ~2010.
// Level-ups toast. Panel: the ⚔ button (right side) or K.
//
// Persistence: localStorage; the Supabase seam is toJSON()/loadJSON()
// → a profiles.skills jsonb column, same as inventory.
// ============================================================

const STORAGE_KEY = 'townsquared.skills.v1';

export function xpToNext(level) {
  return Math.round(80 * Math.pow(level, 1.4));
}

const CSS = `
  #skillsToggle {
    position: fixed; right: 12px; bottom: max(116px, calc(env(safe-area-inset-bottom) + 104px));
    width: 44px; height: 44px; border-radius: 10px;
    background: rgba(20,16,12,0.72); color: #c9a24b;
    border: 1px solid rgba(201,162,75,0.35);
    font-size: 19px; cursor: pointer; z-index: 20;
  }
  #skillsToggle.active { background: #c9a24b; color: #1a1512; }
  #skillsPanel {
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, -52%);
    width: min(440px, calc(100vw - 28px));
    max-height: 74vh; overflow-y: auto;
    display: none; flex-direction: column; gap: 8px;
    background: linear-gradient(160deg, rgba(42,33,24,0.96), rgba(26,20,14,0.96));
    border: 2px solid rgba(201,162,75,0.55); border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    padding: 16px; z-index: 18; color: #e9ddc2;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12.5px;
  }
  #skillsPanel.open { display: flex; }
  #skillsPanel .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  }
  #skillsPanel h2 {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 17px;
    color: #c9a24b; letter-spacing: 0.08em; text-align: center; margin: 0 0 4px;
  }
  #skillsPanel .skill {
    display: grid; grid-template-columns: 28px 1fr auto; align-items: center;
    gap: 4px 10px; padding: 7px 9px;
    background: rgba(233,221,194,0.06); border-radius: 9px;
  }
  #skillsPanel .skill .icon { font-size: 18px; grid-row: span 2; }
  #skillsPanel .skillicon, #skillsToast .skillicon {
    width: 20px; height: 20px; object-fit: contain; vertical-align: -4px;
  }
  #skillsPanel .skill .sname { font-weight: 600; }
  #skillsPanel .skill .lvl {
    font-family: 'Cinzel', serif; font-weight: 700; color: #c9a24b; font-size: 14px;
  }
  #skillsPanel .skill .bar {
    grid-column: 2 / 4; height: 5px;
    background: rgba(0,0,0,0.35); border-radius: 3px; overflow: hidden;
  }
  #skillsPanel .skill .bar > div {
    height: 100%; background: linear-gradient(90deg, #8a6d2f, #c9a24b);
    border-radius: 3px; transition: width 0.35s ease;
  }
  #skillsToast {
    position: fixed; left: 50%; transform: translateX(-50%);
    top: max(110px, calc(env(safe-area-inset-top) + 100px));
    background: rgba(20,16,12,0.88); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.5); border-radius: 18px;
    padding: 8px 18px; font-size: 12.5px; z-index: 14;
    font-family: 'Cinzel', serif; font-weight: 700; letter-spacing: 0.04em;
    opacity: 0; transition: opacity 0.4s; pointer-events: none;
  }
  #skillsToast.show { opacity: 1; }
`;

export class Skills {
  constructor() {
    this.defs = {};
    this.state = {};        // id -> { xp }
    this.onLevelUp = (id, level) => {};
    this._buildUI();
  }

  async init() {
    try {
      const res = await fetch('data/skills.json');
      if (res.ok) this.defs = await res.json();
    } catch { /* no skills.json — panel stays empty */ }
    this.loadJSON(localStorage.getItem(STORAGE_KEY));
    for (const id of Object.keys(this.defs)) {
      if (!this.state[id]) this.state[id] = { xp: 0 };
    }
  }

  // ---------------- levels ----------------
  level(id) {
    let xp = this.state[id]?.xp ?? 0;
    let lvl = 1;
    while (xp >= xpToNext(lvl)) { xp -= xpToNext(lvl); lvl++; }
    return lvl;
  }

  /** [xp into current level, xp needed for next] */
  progress(id) {
    let xp = this.state[id]?.xp ?? 0;
    let lvl = 1;
    while (xp >= xpToNext(lvl)) { xp -= xpToNext(lvl); lvl++; }
    return [xp, xpToNext(lvl)];
  }

  addXp(id, amount) {
    if (!this.defs[id] || amount <= 0) return;
    const before = this.level(id);
    this.state[id].xp += Math.round(amount);
    const after = this.level(id);
    this._save();
    if (after > before) {
      const def = this.defs[id];
      this._toast(`${this._iconHTML(def.icon)} ${def.name} reached level ${after}!`);
      this.onLevelUp(id, after);
    }
    if (this.panel.classList.contains('open')) this._render();
  }

  // ---------------- persistence ----------------
  toJSON() { return JSON.stringify(this.state); }
  loadJSON(json) {
    if (!json) return false;
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object') { this.state = parsed; return true; }
    } catch { /* fall through */ }
    return false;
  }
  _save() { localStorage.setItem(STORAGE_KEY, this.toJSON()); }

  // ---------------- UI ----------------
  /** An icon can be an emoji ("🍳") or an image path
   *  ("assets/ui/skills/cooking.png") — same rule as items. */
  _iconHTML(icon) {
    return (icon ?? '✦').includes('.')
      ? `<img class="skillicon" src="${icon}" alt="">`
      : (icon ?? '✦');
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'skillsToggle';
    this.toggleBtn.textContent = '⚔';
    this.toggleBtn.title = 'Skills (K)';
    document.body.appendChild(this.toggleBtn);
    this.toggleBtn.addEventListener('click', () => this.setOpen(!this.open));
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return; // not while chatting with NPCs
      if (e.code === 'KeyK') this.setOpen(!this.open);
      if (e.code === 'Escape' && this.open) this.setOpen(false);
    });

    this.panel = document.createElement('div');
    this.panel.id = 'skillsPanel';
    document.body.appendChild(this.panel);

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'skillsToast';
    document.body.appendChild(this.toastEl);
  }

  setOpen(on) {
    this.open = on;
    this.panel.classList.toggle('open', on);
    this.toggleBtn.classList.toggle('active', on);
    if (on) this._render();
  }

  _render() {
    const rows = Object.entries(this.defs).map(([id, def]) => {
      const lvl = this.level(id);
      const [into, need] = this.progress(id);
      const pct = Math.min(100, (into / need) * 100).toFixed(1);
      return `
        <div class="skill" title="${def.desc ?? ''}">
          <span class="icon">${this._iconHTML(def.icon)}</span>
          <span class="sname">${def.name}</span>
          <span class="lvl">Lv ${lvl}</span>
          <div class="bar"><div style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
    this.panel.innerHTML = `<h2>SKILLS</h2><div class="grid">${rows}</div>`;
  }

  _toast(msg) {
    this.toastEl.innerHTML = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), 3400);
  }
}
