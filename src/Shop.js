// ============================================================
// Shop.js — buying things from townsfolk.
//
// Shops are data (data/shops.json): an NPC names a `shop` id in
// town.json, the shop lists what it stocks. Adding a merchant is a
// JSON edit, not a code change.
//
// Prices shown here are for DISPLAY. The real price list lives in
// the buy_item RPC — the server charges what the server says, so a
// tampered client can shout any number it likes and still pay full.
// ============================================================

const CSS = `
  #shopPanel {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(14px, env(safe-area-inset-bottom));
    width: min(340px, calc(100vw - 24px));
    max-height: 62vh; overflow-y: auto;
    display: none; flex-direction: column; gap: 8px;
    background: rgba(20,16,12,0.93); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.45); border-radius: 12px;
    padding: 14px; z-index: 17;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    backdrop-filter: blur(8px);
  }
  #shopPanel.open { display: flex; }
  #shopPanel .shead { display: flex; align-items: baseline; gap: 8px; }
  #shopPanel .stitle {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 15px;
    color: #c9a24b; letter-spacing: 0.05em;
  }
  #shopPanel .sgold { margin-left: auto; font-size: 12px; opacity: 0.8; }
  #shopPanel .sclose {
    background: none; border: none; color: #e9ddc2;
    font-size: 18px; cursor: pointer; opacity: 0.7; margin-left: 6px;
  }
  #shopPanel .sgreet { font-size: 12.5px; font-style: italic; opacity: 0.75; }
  #shopPanel .sitem {
    display: flex; align-items: center; gap: 10px;
    background: rgba(233,221,194,0.06); border-radius: 9px; padding: 8px 11px;
  }
  #shopPanel .sitem .sicon { font-size: 18px; width: 24px; text-align: center; }
  #shopPanel .sitem .sicon img { width: 22px; height: 22px; object-fit: contain; vertical-align: middle; }
  #shopPanel .sitem .sname { font-weight: 600; }
  #shopPanel .sitem .sdesc { font-size: 11px; opacity: 0.6; }
  #shopPanel .sitem button {
    margin-left: auto; background: rgba(201,162,75,0.24); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.5); border-radius: 8px;
    padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
    white-space: nowrap;
  }
  #shopPanel .sitem button:active { background: rgba(201,162,75,0.45); }
  #shopPanel .sitem button:disabled { opacity: 0.4; cursor: default; }
  #shopPanel .sowned { margin-left: auto; font-size: 11px; opacity: 0.55; font-style: italic; }
`;

export class Shop {
  constructor({ server, inventory, onSay }) {
    this.server = server;
    this.inventory = inventory;
    this.onSay = onSay ?? (() => {});
    this.shops = {};
    this.current = null;
    this._buildUI();
  }

  async init() {
    try {
      const res = await fetch('data/shops.json');
      if (res.ok) this.shops = await res.json();
    } catch { /* no shops.json — merchants have nothing to sell */ }
  }

  has(shopId) { return !!this.shops[shopId]; }

  open(shopId) {
    const shop = this.shops[shopId];
    if (!shop) return false;
    this.current = shopId;
    this.panel.classList.add('open');
    this._render();
    return true;
  }

  close() {
    this.current = null;
    this.panel.classList.remove('open');
  }

  async _buy(itemId, shownPrice) {
    const { data, error } = await this.server.supa.rpc('buy_item', {
      p_item: itemId, p_price: shownPrice,
    });
    if (error || data?.error) {
      const msg = data?.error === 'not enough gold' ? 'Come back when your purse is heavier.'
        : data?.error === 'you already own one' ? 'You have one already. One is plenty.'
        : (data?.error ?? 'The stall is closed just now.');
      this.onSay(msg);
      return;
    }
    await this.server.reload();
    const name = this.inventory.itemDefs[itemId]?.name ?? itemId;
    this.onSay(`${name} — that'll be ${data.paid} coin. Pleasure doing business.`);
    this._render();
  }

  _iconHTML(icon) {
    return (icon ?? '❔').includes('.')
      ? `<img src="${icon}" alt="">` : (icon ?? '❔');
  }

  _render() {
    const shop = this.shops[this.current];
    if (!shop) return;
    const gold = this.inventory.count('coin');

    const rows = (shop.stock ?? []).map(entry => {
      const def = this.inventory.itemDefs[entry.item] ?? { name: entry.item };
      const owned = this.inventory.count(entry.item);
      const isTool = def.stack === 1;
      const ownsTool = isTool && owned > 0;
      const canAfford = gold >= entry.price;
      return `<div class="sitem">
        <span class="sicon">${this._iconHTML(def.icon)}</span>
        <span>
          <div class="sname">${def.name ?? entry.item}</div>
          <div class="sdesc">${def.desc ?? ''}</div>
        </span>
        ${ownsTool
          ? `<span class="sowned">owned</span>`
          : `<button data-buy="${entry.item}" data-price="${entry.price}" ${canAfford ? '' : 'disabled'}>${entry.price} 🪙</button>`}
      </div>`;
    }).join('');

    this.panel.innerHTML = `
      <div class="shead">
        <span class="stitle">${shop.title ?? 'Wares'}</span>
        <span class="sgold">🪙 ${gold}</span>
        <button class="sclose" data-act="close">✕</button>
      </div>
      <div class="sgreet">${shop.greeting ?? ''}</div>
      ${rows}`;
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.panel = document.createElement('div');
    this.panel.id = 'shopPanel';
    document.body.appendChild(this.panel);
    this.panel.addEventListener('click', e => {
      const buyEl = e.target.closest('[data-buy]');
      if (buyEl) { this._buy(buyEl.dataset.buy, +buyEl.dataset.price); return; }
      if (e.target.closest('[data-act="close"]')) this.close();
    });
  }
}
