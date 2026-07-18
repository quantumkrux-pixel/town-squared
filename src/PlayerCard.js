// ============================================================
// PlayerCard.js — the character portrait and details panel.
//
// A circular portrait sits top-left (under the compass). Click it
// for the character sheet: name, profession, reputation, gold,
// total level and strongest skills, with quick links to the full
// Skills and Inventory panels.
//
// ── YOUR ARTWORK ───────────────────────────────────────────
//   assets/ui/portrait.png  ← auto-detected; a square image,
//   shown cropped in a circle. Until it exists, the portrait
//   shows the character's initial in Cinzel on parchment.
// ============================================================

const CSS = `
  #portraitBtn {
    position: fixed; left: 12px; top: max(64px, calc(env(safe-area-inset-top) + 54px));
    width: 52px; height: 52px; border-radius: 50%;
    background: rgba(20,16,12,0.8); color: #c9a24b;
    border: 2px solid rgba(201,162,75,0.55);
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 22px;
    cursor: pointer; z-index: 20; padding: 0; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  #portraitBtn img { width: 100%; height: 100%; object-fit: cover; }
  #portraitBtn.active { border-color: #c9a24b; box-shadow: 0 0 10px rgba(201,162,75,0.5); }
  #playerCard {
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, -52%);
    width: min(320px, calc(100vw - 28px));
    display: none; flex-direction: column; gap: 10px;
    background: linear-gradient(160deg, rgba(42,33,24,0.97), rgba(26,20,14,0.97));
    border: 2px solid rgba(201,162,75,0.55); border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    padding: 16px; z-index: 19; color: #e9ddc2;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12.5px;
  }
  #playerCard.open { display: flex; }
  #playerCard .pc-head { display: flex; align-items: center; gap: 12px; }
  #playerCard .pc-portrait {
    width: 62px; height: 62px; border-radius: 50%; flex: none;
    border: 2px solid rgba(201,162,75,0.55); overflow: hidden;
    background: #d9c9a8; color: #6b5330;
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 26px;
    display: flex; align-items: center; justify-content: center;
  }
  #playerCard .pc-portrait img { width: 100%; height: 100%; object-fit: cover; }
  #playerCard .pc-name {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 16px; color: #c9a24b;
  }
  #playerCard .pc-role { font-size: 11.5px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.07em; }
  #playerCard .pc-close {
    margin-left: auto; align-self: flex-start;
    background: none; border: none; color: #e9ddc2; font-size: 18px; cursor: pointer; opacity: 0.7;
  }
  #playerCard .pc-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  #playerCard .pc-stat {
    background: rgba(233,221,194,0.06); border-radius: 9px; padding: 8px 10px;
    display: flex; flex-direction: column; gap: 1px;
  }
  #playerCard .pc-stat .v { font-family: 'Cinzel', serif; font-weight: 700; color: #c9a24b; font-size: 15px; }
  #playerCard .pc-stat .k { font-size: 10.5px; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.06em; }
  #playerCard .pc-skills { display: flex; flex-direction: column; gap: 4px; }
  #playerCard .pc-skillrow { display: flex; gap: 8px; align-items: center;
    background: rgba(233,221,194,0.05); border-radius: 8px; padding: 5px 10px; }
  #playerCard .pc-skillrow .lv { margin-left: auto; color: #c9a24b; font-weight: 700; }
  #playerCard .pc-links { display: flex; gap: 6px; }
  #playerCard .pc-links button {
    flex: 1; background: rgba(201,162,75,0.22); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.45); border-radius: 8px;
    padding: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
`;

export class PlayerCard {
  constructor({ identity, roles, skills, tasks, inventory, skillsPanel, inventoryPanel }) {
    this.identity = identity;
    this.roles = roles;
    this.skills = skills;
    this.tasks = tasks;
    this.inventory = inventory;
    this.skillsPanel = skillsPanel;       // Skills instance (for setOpen)
    this.inventoryPanel = inventoryPanel; // Inventory instance (for setOpen)
    this.open = false;
    this._portraitHTML = this._initialHTML();
    this._buildUI();
    this._probeArt();
  }

  _initial() {
    return (this.identity.name ?? '?').trim().charAt(0).toUpperCase();
  }
  _initialHTML() { return this._initial(); }

  _probeArt() {
    const img = new Image();
    img.onload = () => {
      this._portraitHTML = `<img src="${img.src}" alt="">`;
      this.btn.innerHTML = this._portraitHTML;
      if (this.open) this._render();
    };
    img.src = 'assets/ui/portrait.png';
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.btn = document.createElement('button');
    this.btn.id = 'portraitBtn';
    this.btn.title = `${this.identity.name} (C)`;
    this.btn.innerHTML = this._portraitHTML;
    document.body.appendChild(this.btn);
    this.btn.addEventListener('click', () => this.setOpen(!this.open));
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'KeyC') this.setOpen(!this.open);
      if (e.code === 'Escape' && this.open) this.setOpen(false);
    });

    this.panel = document.createElement('div');
    this.panel.id = 'playerCard';
    document.body.appendChild(this.panel);
    this.panel.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.setOpen(false);
      if (act === 'skills') { this.setOpen(false); this.skillsPanel?.setOpen(true); }
      if (act === 'inventory') { this.setOpen(false); this.inventoryPanel?.setOpen(true); }
    });
  }

  setOpen(on) {
    this.open = on;
    this.panel.classList.toggle('open', on);
    this.btn.classList.toggle('active', on);
    if (on) this._render();
  }

  _render() {
    const roleDef = this.roles?.currentDef;
    const rep = this.tasks?.rep ?? 0;
    const gold = this.inventory?.count('coin') ?? 0;

    // total level + top three skills
    const ids = Object.keys(this.skills?.defs ?? {});
    const levels = ids.map(id => [id, this.skills.level(id)]);
    const total = levels.reduce((n, [, l]) => n + l, 0);
    const top = levels.sort((a, b) => b[1] - a[1]).slice(0, 3);

    this.panel.innerHTML = `
      <div class="pc-head">
        <div class="pc-portrait">${this._portraitHTML}</div>
        <div>
          <div class="pc-name">${this.identity.name}</div>
          <div class="pc-role">${roleDef ? `${roleDef.icon ?? ''} ${roleDef.name}` : 'No profession yet'}</div>
        </div>
        <button class="pc-close" data-act="close">✕</button>
      </div>
      <div class="pc-stats">
        <div class="pc-stat"><span class="v">⭐ ${rep}</span><span class="k">Reputation</span></div>
        <div class="pc-stat"><span class="v">🪙 ${gold}</span><span class="k">Gold</span></div>
        <div class="pc-stat"><span class="v">${total}</span><span class="k">Total level</span></div>
        <div class="pc-stat"><span class="v">${this.roles?.current ? '✓' : '—'}</span><span class="k">Employed</span></div>
      </div>
      <div class="pc-skills">
        ${top.map(([id, lvl]) => {
          const def = this.skills.defs[id];
          return `<div class="pc-skillrow">${this.skills._iconHTML(def.icon)} ${def.name}<span class="lv">Lv ${lvl}</span></div>`;
        }).join('')}
      </div>
      <div class="pc-links">
        <button data-act="skills">All skills</button>
        <button data-act="inventory">Inventory</button>
      </div>`;
  }
}
