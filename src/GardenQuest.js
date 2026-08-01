// ============================================================
// GardenQuest.js — Odell's run of work.
//
// Three deliveries, each gated on a Farming level, ending with the
// timber money. Finish them and the half-built bed behind his rows
// becomes a proper garden bed: better yield, a chance of an extra,
// and half again the experience.
//
// The server owns all of it (14_garden.sql) — this panel only shows
// what deliver_garden_stage() reports.
// ============================================================

const CSS = `
  #questPanel {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(14px, env(safe-area-inset-bottom));
    width: min(340px, calc(100vw - 24px));
    display: none; flex-direction: column; gap: 10px;
    background: rgba(20,16,12,0.93); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.45); border-radius: 12px;
    padding: 14px; z-index: 17;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px; backdrop-filter: blur(8px);
  }
  #questPanel.open { display: flex; }
  #questPanel .qhead { display: flex; align-items: baseline; }
  #questPanel .qtitle {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 15px;
    color: #c9a24b; letter-spacing: 0.05em;
  }
  #questPanel .qclose {
    margin-left: auto; background: none; border: none; color: #e9ddc2;
    font-size: 18px; cursor: pointer; opacity: 0.7;
  }
  #questPanel .qask { font-style: italic; opacity: 0.85; line-height: 1.5; }
  #questPanel .qneed {
    display: flex; align-items: center; gap: 9px;
    background: rgba(233,221,194,0.06); border-radius: 9px; padding: 8px 11px;
  }
  #questPanel .qneed .have { margin-left: auto; font-weight: 700; }
  #questPanel .qneed .have.short { color: #c98b6b; }
  #questPanel .steps { display: flex; gap: 5px; }
  #questPanel .step {
    flex: 1; height: 5px; border-radius: 3px; background: rgba(0,0,0,0.35);
  }
  #questPanel .step.done { background: linear-gradient(90deg, #8a6d2f, #c9a24b); }
  #questPanel button.deliver {
    background: rgba(201,162,75,0.24); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.5); border-radius: 8px;
    padding: 10px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  #questPanel button.deliver:disabled { opacity: 0.4; cursor: default; }
  #questPanel .qdone { text-align: center; font-family: 'Cinzel', serif;
    color: #c9a24b; letter-spacing: 0.06em; padding: 4px; }
`;

export class GardenQuest {
  constructor({ server, inventory, farming, onSay }) {
    this.server = server;
    this.inventory = inventory;
    this.farming = farming;
    this.onSay = onSay ?? (() => {});
    this.state = null;
    this._buildUI();
  }

  async open() {
    this.panel.classList.add('open');
    this.panel.innerHTML = '<div class="qask">Odell wipes his hands…</div>';
    await this.refresh();
  }
  close() { this.panel.classList.remove('open'); }

  async refresh() {
    const { data } = await this.server.supa.rpc('get_garden_quest');
    this.state = data ?? {};
    this._render();
  }

  async _deliver() {
    const { data, error } = await this.server.supa.rpc('deliver_garden_stage');
    if (error || data?.error) {
      this.onSay(data?.error ?? 'Odell shakes his head.');
      return;
    }
    this.onSay(data.said ?? 'Aye. That will do.');
    await this.server.reload();
    await this.refresh();
    if (data.unlocked) {
      await this.farming?.refresh();     // the bed becomes real
      this.onSay('The bed is yours. Rich soil, turned deep. Mind what you put in it.');
    }
  }

  _render() {
    const s = this.state ?? {};
    const stage = s.stage ?? 0;
    const steps = [0, 1, 2].map(i =>
      `<div class="step ${i < stage ? 'done' : ''}"></div>`).join('');

    if (s.unlocked || !s.def) {
      this.panel.innerHTML = `
        <div class="qhead"><span class="qtitle">The Garden Bed</span>
          <button class="qclose" data-act="close">✕</button></div>
        <div class="steps">${steps}</div>
        <div class="qdone">✦ BUILT ✦</div>
        <div class="qask">"It is yours. Do not make me regret the timber."</div>`;
      return;
    }

    const def = s.def;
    const have = this.inventory.count(def.item);
    const gold = this.inventory.count('coin');
    const itemName = this.inventory.itemDefs[def.item]?.name ?? def.item;
    const icon = this.inventory.itemDefs[def.item]?.icon ?? '🌱';
    const levelOk = (s.farming_level ?? 1) >= def.level;
    const goldOk = gold >= (def.gold ?? 0);
    const ready = have >= def.qty && goldOk && levelOk;

    this.panel.innerHTML = `
      <div class="qhead"><span class="qtitle">${def.title}</span>
        <button class="qclose" data-act="close">✕</button></div>
      <div class="steps">${steps}</div>
      <div class="qask">"${def.ask}"</div>
      <div class="qneed"><span>${icon}</span><span>${itemName}</span>
        <span class="have ${have >= def.qty ? '' : 'short'}">${have} / ${def.qty}</span></div>
      ${def.gold ? `<div class="qneed"><span>🪙</span><span>Timber money</span>
        <span class="have ${goldOk ? '' : 'short'}">${gold} / ${def.gold}</span></div>` : ''}
      ${levelOk ? '' : `<div class="qneed"><span>🌾</span><span>Farming level</span>
        <span class="have short">${s.farming_level} / ${def.level}</span></div>`}
      <button class="deliver" data-act="deliver" ${ready ? '' : 'disabled'}>Hand it over</button>`;
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.panel = document.createElement('div');
    this.panel.id = 'questPanel';
    document.body.appendChild(this.panel);
    this.panel.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.close();
      if (act === 'deliver') this._deliver();
    });
  }
}
