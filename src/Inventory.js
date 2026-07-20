// ============================================================
// Inventory.js — player inventory with your own panel artwork.
//
// ── YOUR ARTWORK GOES HERE ─────────────────────────────────
//   assets/ui/inventory-panel.png   ← the panel backdrop
//   assets/ui/items/<anything>.png  ← optional item icons
//
// The panel PNG is used at its natural aspect ratio, so author it
// at whatever proportions you like (something around 4:3–1:1 reads
// well on mobile). The slot grid is overlaid INSIDE it, positioned
// by the ART.gridInset percentages below — tweak those four numbers
// until the grid sits inside your art's frame/border. Item detail
// (name, description, Use/Drop) renders in a separate strip below
// the panel, so your art only needs to frame the grid.
//
// If the PNG doesn't exist yet, a styled fallback panel renders —
// everything works before the art lands.
//
// Item types live in data/items.json. An item's "icon" can be an
// emoji ("🥐") or an image path ("assets/ui/items/bread.png").
//
// API (main.js / game systems):
//   inv.add('bread', 2)      → true if it fit
//   inv.remove('bread', 1)   → true if removed
//   inv.count('bread')       → number held
//   inv.onUse = (id, def) => { ... }   ← hook for consumables etc.
//
// Persistence: localStorage for now (survives reloads). The
// toJSON()/loadJSON() pair is the seam for moving this into a
// Supabase `inventories` table keyed by user id later.
// ============================================================

const ART = {
  usePanelArt: false, // ← set true when your PNG is in place
  panelImage: 'assets/ui/inventory-panel.png',
  // Where the slot grid sits inside the panel image, as % of panel size.
  // Tune these to match your artwork's frame.
  gridInset: { top: 14, right: 9, bottom: 14, left: 9 },
  cols: 5,
  rows: 4,
  fallbackAspect: 0.82, // height/width used until (or unless) the PNG loads
};

const STORAGE_KEY = 'townsquared.inventory.v1';

const PANEL_CSS = `
  #invToggle {
    position: fixed; right: 12px; bottom: max(64px, calc(env(safe-area-inset-bottom) + 52px));
    width: 44px; height: 44px; border-radius: 10px;
    background: rgba(20,16,12,0.72); color: #c9a24b;
    border: 1px solid rgba(201,162,75,0.35);
    font-size: 20px; cursor: pointer; z-index: 20;
    backdrop-filter: blur(6px);
  }
  #invToggle.active { background: #c9a24b; color: #1a1512; }
  #invWrap {
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, -52%);
    width: min(380px, calc(100vw - 28px));
    display: none; flex-direction: column; gap: 8px;
    z-index: 18;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #invWrap.open { display: flex; }
  #invPanel {
    position: relative; width: 100%;
    background-size: 100% 100%; background-repeat: no-repeat;
  }
  #invPanel.fallback {
    background: linear-gradient(160deg, rgba(42,33,24,0.96), rgba(26,20,14,0.96));
    border: 2px solid rgba(201,162,75,0.55);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  }
  #invPanel .grid {
    position: absolute; display: grid; gap: 5px;
  }
  #invPanel .slot {
    background: rgba(0,0,0,0.28);
    border: 1px solid rgba(233,221,194,0.16);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; cursor: pointer; position: relative;
    aspect-ratio: 1; overflow: hidden;
    -webkit-tap-highlight-color: transparent;
  }
  #invPanel .slot img { width: 78%; height: 78%; object-fit: contain; }
  #invPanel .slot.selected { border-color: #c9a24b; box-shadow: 0 0 8px rgba(201,162,75,0.5) inset; }
  #invPanel .slot .qty {
    position: absolute; right: 3px; bottom: 1px;
    font-size: 10px; font-weight: 700; color: #e9ddc2;
    text-shadow: 0 1px 2px #000;
  }
  #invDetail {
    background: rgba(20,16,12,0.88); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.4); border-radius: 10px;
    padding: 10px 12px; font-size: 12.5px;
    display: flex; flex-direction: column; gap: 6px;
    backdrop-filter: blur(8px);
  }
  #invDetail .iname { font-family: 'Cinzel', serif; font-weight: 700; color: #c9a24b; font-size: 14px; }
  #invDetail .idesc { font-style: italic; opacity: 0.85; line-height: 1.4; }
  #invDetail .irow { display: flex; gap: 6px; }
  #invDetail .irow button {
    flex: 1; background: rgba(233,221,194,0.08); color: #e9ddc2;
    border: 1px solid rgba(233,221,194,0.2); border-radius: 8px;
    padding: 8px; font-size: 12.5px; cursor: pointer;
  }
  #invDetail .irow button:active { background: rgba(201,162,75,0.3); }
`;

export class Inventory {
  constructor(server = null) {
    this.server = server;          // ServerCharacter, or null (offline/local)
    this.itemDefs = {};
    this.slots = new Array(ART.cols * ART.rows).fill(null); // {id, qty} | null
    this.selectedSlot = -1;
    this.open = false;

    // Hook: called when the player hits "Use". Return true to consume one.
    this.onUse = (id, def) => {
      console.log(`[inventory] use ${id} — wire real effects via inventory.onUse`);
      return false;
    };
    // Hook: notify game systems (e.g. toast, sound) on pickup.
    this.onChange = () => {};

    this._buildUI();
  }

  async init() {
    try {
      const res = await fetch('data/items.json');
      if (res.ok) this.itemDefs = await res.json();
    } catch { /* no item defs — inventory still functions */ }

    if (this.server) {
      // authoritative: quantities come from the server; slots are a VIEW
      this.server.onChange(() => this._rebuildFromServer());
      this._rebuildFromServer();
    } else if (!this.loadJSON(localStorage.getItem(STORAGE_KEY))) {
      // offline/local starter kit (unchanged behavior when no server)
      this.add('coin', 12);
      this.add('torch', 1);
    }
    this._render();
  }

  /** Rebuild the slot view from the server's authoritative item map,
   *  respecting per-item stack sizes so the grid still looks right. */
  _rebuildFromServer() {
    this.slots = new Array(ART.cols * ART.rows).fill(null);
    let i = 0;
    for (const [id, qty] of Object.entries(this.server.inventory)) {
      const stack = this.itemDefs[id]?.stack ?? 1;
      let left = qty;
      while (left > 0 && i < this.slots.length) {
        const take = Math.min(left, stack);
        this.slots[i++] = { id, qty: take };
        left -= take;
      }
    }
    this._render();
    this.onChange();
  }

  // ---------------- core API ----------------
  // In SERVER mode, `count` reflects authoritative server quantities and
  // add/remove are LOCAL view-only (used for optimistic display) — real
  // grants happen server-side (open-chest writes items; claim_task grants
  // rewards) and arrive via the server's onChange → _rebuildFromServer.
  // In LOCAL mode they mutate the slots directly, as before.
  count(id) {
    if (this.server) return this.server.count(id);
    return this.slots.reduce((n, s) => n + (s?.id === id ? s.qty : 0), 0);
  }

  add(id, qty = 1) {
    const def = this.itemDefs[id] ?? { stack: 1 };
    let remaining = qty;

    // top up existing stacks first
    for (const s of this.slots) {
      if (!remaining) break;
      if (s?.id === id && s.qty < (def.stack ?? 1)) {
        const take = Math.min(remaining, (def.stack ?? 1) - s.qty);
        s.qty += take; remaining -= take;
      }
    }
    // then empty slots
    for (let i = 0; i < this.slots.length && remaining; i++) {
      if (!this.slots[i]) {
        const take = Math.min(remaining, def.stack ?? 1);
        this.slots[i] = { id, qty: take };
        remaining -= take;
      }
    }
    this._afterChange();
    return remaining === 0;
  }

  remove(id, qty = 1) {
    if (this.count(id) < qty) return false;
    let remaining = qty;
    for (let i = this.slots.length - 1; i >= 0 && remaining; i--) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      const take = Math.min(remaining, s.qty);
      s.qty -= take; remaining -= take;
      if (s.qty <= 0) this.slots[i] = null;
    }
    this._afterChange();
    return true;
  }

  // ---------------- persistence ----------------
  toJSON() {
    return JSON.stringify(this.slots);
  }
  loadJSON(json) {
    if (!json) return false;
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return false;
      this.slots = new Array(ART.cols * ART.rows).fill(null);
      parsed.slice(0, this.slots.length).forEach((s, i) => { if (s?.id) this.slots[i] = s; });
      return true;
    } catch { return false; }
  }
  _afterChange() {
    if (!this.server) localStorage.setItem(STORAGE_KEY, this.toJSON());
    this._render();
    this.onChange();
  }

  // ---------------- UI ----------------
  _buildUI() {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'invToggle';
    this.toggleBtn.textContent = '🎒';
    this.toggleBtn.title = 'Inventory (I)';
    document.body.appendChild(this.toggleBtn);

    // ── YOUR ICON: assets/ui/inventory-icon.png (falls back to 🎒) ──
    const iconImg = new Image();
    iconImg.onload = () => {
      this.toggleBtn.textContent = '';
      Object.assign(this.toggleBtn.style, {
        backgroundImage: `url(${iconImg.src})`,
        backgroundSize: '70% 70%',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      });
    };
    iconImg.src = 'assets/ui/inventory-icon.png';

    this.toggleBtn.addEventListener('click', () => this.setOpen(!this.open));
    window.addEventListener('keydown', e => {
      if (e.code === 'KeyI') this.setOpen(!this.open);
      if (e.code === 'Escape' && this.open) this.setOpen(false);
    });

    this.wrap = document.createElement('div');
    this.wrap.id = 'invWrap';
    this.wrap.innerHTML = `
      <div id="invPanel"><div class="grid"></div></div>
      <div id="invDetail" style="display:none"></div>
    `;
    document.body.appendChild(this.wrap);
    this.panel = this.wrap.querySelector('#invPanel');
    this.grid = this.wrap.querySelector('.grid');
    this.detail = this.wrap.querySelector('#invDetail');

    // position the grid inside the artwork's frame
    const g = ART.gridInset;
    Object.assign(this.grid.style, {
      top: `${g.top}%`, right: `${g.right}%`, bottom: `${g.bottom}%`, left: `${g.left}%`,
      gridTemplateColumns: `repeat(${ART.cols}, 1fr)`,
    });

    // fallback panel by default; flip ART.usePanelArt when your art lands
    this.panel.classList.add('fallback');
    this.panel.style.aspectRatio = `1 / ${ART.fallbackAspect}`;
    if (ART.usePanelArt) {
      const img = new Image();
      img.onload = () => {
        this.panel.style.backgroundImage = `url(${ART.panelImage})`;
        this.panel.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        this.panel.classList.remove('fallback');
      };
      img.src = ART.panelImage; // on error we simply stay on the fallback
    }

    this.grid.addEventListener('click', e => {
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const i = +slot.dataset.i;
      this.selectedSlot = this.selectedSlot === i ? -1 : i;
      this._render();
    });

    this.detail.addEventListener('click', e => {
      const act = e.target.dataset?.act;
      const s = this.slots[this.selectedSlot];
      if (!act || !s) return;
      const def = this.itemDefs[s.id] ?? {};
      if (act === 'use') {
        if (this.onUse(s.id, def)) this.remove(s.id, 1);
      } else if (act === 'drop') {
        this.remove(s.id, 1);
      }
    });
  }

  setOpen(on) {
    this.open = on;
    this.wrap.classList.toggle('open', on);
    this.toggleBtn.classList.toggle('active', on);
    if (!on) { this.selectedSlot = -1; }
    this._render();
  }

  _iconHTML(id) {
    const icon = this.itemDefs[id]?.icon ?? '❔';
    return icon.includes('.') ? `<img src="${icon}" alt="">` : icon;
  }

  _render() {
    if (!this.grid) return;
    this.grid.innerHTML = this.slots.map((s, i) => `
      <div class="slot ${i === this.selectedSlot ? 'selected' : ''}" data-i="${i}">
        ${s ? this._iconHTML(s.id) : ''}
        ${s && s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}
      </div>`).join('');

    const s = this.slots[this.selectedSlot];
    if (s) {
      const def = this.itemDefs[s.id] ?? { name: s.id, desc: '' };
      this.detail.style.display = 'flex';
      this.detail.innerHTML = `
        <span class="iname">${def.name ?? s.id}${s.qty > 1 ? ` ×${s.qty}` : ''}</span>
        <span class="idesc">${def.desc ?? ''}</span>
        <div class="irow">
          <button data-act="use">Use</button>
          <button data-act="drop">Drop one</button>
        </div>`;
    } else {
      this.detail.style.display = 'none';
    }
  }
}
