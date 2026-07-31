// ============================================================
// Farming.js — tend the soil.
//
// Plots are `farm_plot` placements in town.json. Each player has
// their own crop state at each shared location (per-player rows in
// the plots table), so nobody harvests your wheat.
//
// Stage is DERIVED, not stored: empty → seeded → harvestable is a
// pure function of seeded_at + grow_hours, exactly like the mirage's
// schedule. That means growth runs in real time whether you're
// logged in or not, and no cron is needed to advance it.
//
// Every mutation is a server RPC (plant_seed / water_plot /
// harvest_plot) — the client renders soil, the server owns crops.
//
// Watering is the skill: each crop wants N waterings spaced at least
// min_gap_h apart. Water too soon and you drown it (counts against
// your yield); water too little and it withers. Yield at harvest =
// care + Farming level + Luck.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const CSS = `
  #farmPanel {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(14px, env(safe-area-inset-bottom));
    width: min(330px, calc(100vw - 24px));
    display: none; flex-direction: column; gap: 10px;
    background: rgba(20,16,12,0.93); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.45); border-radius: 12px;
    padding: 14px; z-index: 17;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    backdrop-filter: blur(8px);
  }
  #farmPanel.open { display: flex; }
  #farmPanel .fhead { display: flex; align-items: baseline; gap: 8px; }
  #farmPanel .ftitle {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 15px;
    color: #c9a24b; letter-spacing: 0.05em;
  }
  #farmPanel .fclose {
    margin-left: auto; background: none; border: none; color: #e9ddc2;
    font-size: 18px; cursor: pointer; opacity: 0.7;
  }
  #farmPanel .fstatus { font-size: 12.5px; opacity: 0.85; line-height: 1.5; }
  #farmPanel .fmeta { font-size: 11.5px; opacity: 0.6; }
  #farmPanel .fbar {
    height: 6px; background: rgba(0,0,0,0.35); border-radius: 3px; overflow: hidden;
  }
  #farmPanel .fbar > div {
    height: 100%; background: linear-gradient(90deg, #6f9c4a, #a8c96a);
    border-radius: 3px; transition: width 0.4s ease;
  }
  #farmPanel .frow { display: flex; gap: 6px; flex-wrap: wrap; }
  #farmPanel button.act {
    flex: 1; min-width: 96px;
    background: rgba(201,162,75,0.24); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.5); border-radius: 8px;
    padding: 10px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  #farmPanel button.act:active { background: rgba(201,162,75,0.45); }
  #farmPanel button.act:disabled { opacity: 0.4; cursor: default; }
  #farmPanel button.harvest {
    background: rgba(111,156,74,0.32); border-color: rgba(168,201,106,0.6);
  }
  #farmPanel .seedrow {
    display: flex; align-items: center; gap: 8px;
    background: rgba(233,221,194,0.06); border-radius: 8px; padding: 7px 10px;
    cursor: pointer;
  }
  #farmPanel .seedrow.locked { opacity: 0.45; cursor: default; }
  #farmPanel .seedrow .sname { font-weight: 600; }
  #farmPanel .seedrow .sqty { margin-left: auto; opacity: 0.7; }
  #farmToast {
    position: fixed; left: 50%; transform: translateX(-50%);
    top: max(70px, calc(env(safe-area-inset-top) + 60px));
    background: rgba(24,32,20,0.9); color: #dbe9c9;
    border: 1px solid rgba(168,201,106,0.5); border-radius: 18px;
    padding: 8px 18px; font-size: 12.5px; z-index: 14;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    opacity: 0; transition: opacity 0.4s; pointer-events: none;
  }
  #farmToast.show { opacity: 1; }
`;

const SEEDS = [
  { id: 'seed_wheat',     crop: 'wheat',     grow: 24, waterings: 2, gap: 8,  level: 1 },
  { id: 'seed_herb',      crop: 'herbs',     grow: 36, waterings: 3, gap: 9,  level: 3 },
  { id: 'seed_moonpetal', crop: 'moonpetal', grow: 48, waterings: 4, gap: 10, level: 6 },
];

export class Farming {
  constructor({ world, server, inventory, skills, camera }) {
    this.world = world;
    this.server = server;
    this.inventory = inventory;
    this.skills = skills;
    this.camera = camera;
    this.plots = {};          // plot_key -> server row
    this.recs = new Map();    // plot_key -> world placement record
    this.current = null;      // plot_key of the open panel
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._lastStageCheck = 0;
    this._buildUI();
  }

  static keyFor(rec) {
    return `plot@${rec.data.x},${rec.data.z}`;
  }

  async init() {
    // index every farm plot placed in the world
    for (const rec of this.world.placed) {
      if (rec.data.asset === 'farm_plot' && rec.obj) {
        this.recs.set(Farming.keyFor(rec), rec);
      }
    }
    if (!this.recs.size) return;

    await this.refresh();

    // another device tending the same account
    this.server.supa?.channel('plots-sync')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'plots',
        filter: `user_id=eq.${this.server.auth.user.id}`,
      }, () => this.refresh())
      .subscribe();
  }

  async refresh() {
    const { data, error } = await this.server.supa.rpc('get_plots');
    if (error) { console.warn('[Farming] plot load failed', error); return; }
    this.plots = data ?? {};
    this._applyStages();
    if (this.current) this._renderPanel();
  }

  // ---------------- stage derivation ----------------
  /** empty | seeded | grown — a pure function of elapsed time. */
  stageOf(key) {
    const p = this.plots[key];
    if (!p?.crop) return 'empty';
    const elapsedH = (Date.now() - new Date(p.seeded_at).getTime()) / 3600000;
    return elapsedH >= (p.grow_hours ?? 24) ? 'grown' : 'seeded';
  }

  _applyStages() {
    for (const [key, rec] of this.recs) {
      const stage = this.stageOf(key);
      rec.obj.traverse(o => {
        if (o.name === 'stage_empty')  o.visible = stage === 'empty';
        if (o.name === 'stage_seeded') o.visible = stage === 'seeded';
        if (o.name === 'stage_grown')  o.visible = stage === 'grown';
      });
    }
  }

  /** Cheap: re-derive stages every 30s so a crop ripens on screen. */
  update(nowMs) {
    if (nowMs - this._lastStageCheck < 30000) return;
    this._lastStageCheck = nowMs;
    this._applyStages();
    if (this.current) this._renderPanel();
  }

  // ---------------- interaction ----------------
  pick(clientX, clientY) {
    if (!this.recs.size) return null;
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const objs = [...this.recs.values()].map(r => r.obj);
    const hit = this._raycaster.intersectObjects(objs, true)[0];
    if (!hit) return null;
    for (const [key, rec] of this.recs) {
      let o = hit.object;
      while (o) { if (o === rec.obj) return key; o = o.parent; }
    }
    return null;
  }

  positionOf(key) {
    return this.recs.get(key)?.obj.position ?? null;
  }

  open(key) {
    this.current = key;
    this.panel.classList.add('open');
    this._renderPanel();
  }
  close() {
    this.current = null;
    this.panel.classList.remove('open');
  }

  // ---------------- actions ----------------
  async _plant(seedId) {
    const { data, error } = await this.server.supa.rpc('plant_seed', {
      p_plot: this.current, p_seed: seedId,
    });
    if (error || data?.error) {
      this._toast(data?.error ?? 'The soil refuses.');
      return;
    }
    await this.server.reload();   // the seed left your pack
    await this.refresh();
    this._toast('🌱 Planted. Come back with water.');
  }

  async _water() {
    const { data, error } = await this.server.supa.rpc('water_plot', { p_plot: this.current });
    if (error || data?.error) {
      this._toast(data?.error ?? 'You cannot water that.');
      return;
    }
    await this.refresh();
    await this.server._refreshSkills();
    this._toast(data.drowned
      ? '💧 Too soon — the roots are sodden. Let the soil breathe.'
      : `💧 Watered (${data.water_count} of ${data.wanted}).`);
  }

  async _harvest() {
    const { data, error } = await this.server.supa.rpc('harvest_plot', { p_plot: this.current });
    if (error || data?.error) {
      const left = data?.hours_left;
      this._toast(left != null ? `Not ready — about ${left}h to go.` : (data?.error ?? 'Nothing to harvest.'));
      return;
    }
    await this.server.reload();
    await this.refresh();
    if (data.withered) {
      this._toast('🥀 Withered. The soil forgives; it does not forget.');
    } else {
      const name = this.inventory.itemDefs[data.crop]?.name ?? data.crop;
      this._toast(`🌾 Harvested ${data.yield} × ${name}.`);
    }
  }

  // ---------------- UI ----------------
  _renderPanel() {
    const key = this.current;
    if (!key) return;
    const stage = this.stageOf(key);
    const p = this.plots[key];

    if (stage === 'empty') {
      const lvl = this.skills?.level('farming') ?? 1;
      const rows = SEEDS.map(s => {
        const have = this.inventory.count(s.id);
        const locked = lvl < s.level || have < 1;
        const def = this.inventory.itemDefs[s.id] ?? {};
        const why = lvl < s.level ? `needs Farming ${s.level}` : (have < 1 ? 'none in pack' : '');
        return `<div class="seedrow ${locked ? 'locked' : ''}" ${locked ? '' : `data-seed="${s.id}"`}>
          <span>${def.icon ?? '🌱'}</span>
          <span class="sname">${def.name ?? s.id}</span>
          <span class="sqty">${why || `×${have} · ${s.grow}h`}</span>
        </div>`;
      }).join('');
      this.panel.innerHTML = `
        <div class="fhead"><span class="ftitle">Empty Plot</span>
          <button class="fclose" data-act="close">✕</button></div>
        <div class="fstatus">Turned soil, waiting on a seed.</div>
        ${rows}`;
    } else {
      const cropName = this.inventory.itemDefs[p.crop]?.name ?? p.crop;
      const elapsedH = (Date.now() - new Date(p.seeded_at).getTime()) / 3600000;
      const pct = Math.min(100, (elapsedH / p.grow_hours) * 100);
      const leftH = Math.max(0, p.grow_hours - elapsedH);
      const ready = stage === 'grown';
      const thirst = p.water_count < p.waterings;
      this.panel.innerHTML = `
        <div class="fhead"><span class="ftitle">${ready ? 'Harvestable Plot' : 'Seeded Plot'}</span>
          <button class="fclose" data-act="close">✕</button></div>
        <div class="fstatus">${cropName} — ${ready
          ? 'ripe and ready.'
          : `about ${leftH < 1 ? 'under an hour' : Math.ceil(leftH) + ' hours'} to go.`}</div>
        <div class="fbar"><div style="width:${pct.toFixed(1)}%"></div></div>
        <div class="fmeta">Watered ${p.water_count} of ${p.waterings}${
          p.overwater_count ? ` · drowned ${p.overwater_count}×` : ''}${
          thirst && !ready ? ' · thirsty' : ''}</div>
        <div class="frow">
          <button class="act" data-act="water" ${ready ? 'disabled' : ''}>💧 Water</button>
          <button class="act harvest" data-act="harvest" ${ready ? '' : 'disabled'}>🌾 Harvest</button>
        </div>`;
    }
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.panel = document.createElement('div');
    this.panel.id = 'farmPanel';
    document.body.appendChild(this.panel);
    this.panel.addEventListener('click', e => {
      const seed = e.target.closest('[data-seed]')?.dataset.seed;
      if (seed) { this._plant(seed); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.close();
      if (act === 'water') this._water();
      if (act === 'harvest') this._harvest();
    });

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'farmToast';
    document.body.appendChild(this.toastEl);
  }

  _toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), 3600);
  }
}
