// ============================================================
// Containers.js — openable chests with loot tables and a
// town-wide respawn pool.
//
// Lifecycle: loot a chest → it DESPAWNS (mesh, collider, taps all
// gone) and joins the pool. Every `_pool.respawnEveryMinutes`, one
// random pooled chest — chosen across the ENTIRE map — respawns.
// Offline time is caught up on boot, so returning after an hour
// finds the town restocked.
//
// An asset becomes a container via a `container` flag in ASSET_DEFS
// naming its loot table:  chest_wood: { ..., container: 'common' }
//
// data/loot.json:
//   "_pool":  { "respawnEveryMinutes": 3 }
//   "common": { "rolls": [1,3], "entries": [
//     { "item": "coin", "weight": 6, "qty": [2,8] }, ... ] }
//
// State is per-player (localStorage) in this scaffold: you see your
// own chest availability. Server upgrade: a cron Edge Function owns
// the pool in a table, picks the respawn, and realtime-syncs every
// client — then the hunt is shared and rolls are server-side.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const STORAGE_KEY = 'townsquared.chestpool.v1';

const PANEL_CSS = `
  #lootPanel {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(14px, env(safe-area-inset-bottom));
    width: min(320px, calc(100vw - 24px));
    display: none; flex-direction: column; gap: 10px;
    background: rgba(20,16,12,0.9); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.45); border-radius: 12px;
    padding: 14px; z-index: 16;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    backdrop-filter: blur(8px);
  }
  #lootPanel.open { display: flex; }
  #lootPanel .head { display: flex; align-items: baseline; }
  #lootPanel .title {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 15px;
    color: #c9a24b; letter-spacing: 0.05em;
  }
  #lootPanel .close {
    margin-left: auto; background: none; border: none; color: #e9ddc2;
    font-size: 18px; cursor: pointer; opacity: 0.7;
  }
  #lootPanel .lootlist { display: flex; flex-direction: column; gap: 5px; }
  #lootPanel .lootrow {
    display: flex; align-items: center; gap: 8px;
    background: rgba(233,221,194,0.07); border-radius: 8px; padding: 6px 10px;
  }
  #lootPanel .lootrow .icon { font-size: 18px; width: 24px; text-align: center; }
  #lootPanel .lootrow .icon img { width: 22px; height: 22px; object-fit: contain; vertical-align: middle; }
  #lootPanel .lootrow .qty { margin-left: auto; opacity: 0.8; font-weight: 700; }
  #lootPanel .empty { font-style: italic; opacity: 0.7; }
  #lootPanel .take {
    background: rgba(201,162,75,0.25); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.5); border-radius: 8px;
    padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  #lootPanel .take:active { background: rgba(201,162,75,0.45); }
  #chestToast {
    position: fixed; left: 50%; transform: translateX(-50%);
    top: max(70px, calc(env(safe-area-inset-top) + 60px));
    background: rgba(20,16,12,0.85); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.4); border-radius: 18px;
    padding: 7px 16px; font-size: 12px; z-index: 14;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    opacity: 0; transition: opacity 0.4s; pointer-events: none;
  }
  #chestToast.show { opacity: 1; }
`;

export class Containers {
  constructor({ world, registry, camera, inventory, cfg, identity, skills }) {
    this.world = world;
    this.registry = registry;
    this.camera = camera;
    this.inventory = inventory;
    this.skills = skills ?? null;
    this.cfg = cfg ?? {};
    this.identity = identity ?? { id: 'anon' };
    this.serverMode = false;   // becomes true when Supabase connects in init()
    this.supa = null;
    this.tables = {};
    this.poolCfg = { respawnEveryMinutes: 3 };
    this.current = null;   // { rec, loot, key }
    // local pool state (offline fallback): { hidden: {key: ms}, lastRespawnAt: ms }
    this.pool = this._loadPool();
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._buildUI();
  }

  async init() {
    try {
      const res = await fetch('data/loot.json');
      if (res.ok) {
        const data = await res.json();
        if (data._pool) this.poolCfg = { ...this.poolCfg, ...data._pool };
        delete data._pool;
        this.tables = data;
      }
    } catch { /* no loot tables — chests will read as empty */ }

    // ---- server mode: shared world state via Supabase ----
    try {
      const { getSupabase } = await import('./net/supa.js');
      this.supa = await getSupabase(this.cfg);
    } catch { this.supa = null; }

    if (this.supa) {
      this.serverMode = true;
      // current availability for the whole town
      const { data } = await this.supa.from('chests').select('key,is_available');
      for (const row of data ?? []) this._applyServerRow(row, false);
      this.world.refreshColliders();

      // live updates: someone loots → despawn; cron respawns → reappear + toast
      this.supa.channel('chests-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chests' },
          payload => {
            const row = payload.new;
            if (row?.key) this._applyServerRow(row, true);
          })
        .subscribe();
    } else {
      // ---- offline fallback: the local pool, as before ----
      this._applyHiddenToWorld();
      this._catchUpRespawns();
    }
  }

  /** Apply one server row to the world. `live` = came from realtime. */
  _applyServerRow(row, live) {
    const rec = this._recForKey(row.key);
    if (!rec) return;
    const wasVisible = rec.obj.visible;
    rec.obj.visible = !!row.is_available;
    if (live) {
      this.world.refreshColliders();
      if (!wasVisible && row.is_available) {
        this._toast('Somewhere in town, a chest has been restocked…');
      }
    }
  }

  _intervalMs() {
    return (this.poolCfg.respawnEveryMinutes ?? 3) * 60000;
  }

  /** Which loot table (if any) a placement's asset carries. */
  _tableFor(rec) {
    return this.registry.defs[rec.data.asset]?.container ?? null;
  }

  /** Stable identity for a chest: type + position. */
  _keyFor(rec) {
    return `${rec.data.asset}@${rec.data.x},${rec.data.z}`;
  }

  _recForKey(key) {
    return this.world.placed.find(r => this._tableFor(r) && this._keyFor(r) === key) ?? null;
  }

  // ---------------- pool lifecycle ----------------
  _applyHiddenToWorld() {
    // prune keys whose chest no longer exists (map edits), hide the rest
    for (const key of Object.keys(this.pool.hidden)) {
      const rec = this._recForKey(key);
      if (!rec) { delete this.pool.hidden[key]; continue; }
      rec.obj.visible = false;
    }
    this.world.refreshColliders();
    this._savePool();
  }

  _despawn(rec, key) {
    rec.obj.visible = false;
    this.world.refreshColliders();
    this.pool.hidden[key] = Date.now();
    this._savePool();
  }

  _respawnRandom() {
    const keys = Object.keys(this.pool.hidden);
    if (!keys.length) return false;
    const key = keys[(Math.random() * keys.length) | 0];
    const rec = this._recForKey(key);
    delete this.pool.hidden[key];
    if (rec) {
      rec.obj.visible = true;
      this.world.refreshColliders();
      this._toast('Somewhere in town, a chest has been restocked…');
    }
    this._savePool();
    return true;
  }

  _catchUpRespawns() {
    const now = Date.now();
    const interval = this._intervalMs();
    if (!this.pool.lastRespawnAt) this.pool.lastRespawnAt = now;
    let ticks = Math.floor((now - this.pool.lastRespawnAt) / interval);
    while (ticks-- > 0) {
      this.pool.lastRespawnAt += interval;
      if (!this._respawnRandom()) { this.pool.lastRespawnAt = now; break; }
    }
    this._savePool();
  }

  /** Call from the main loop: the respawn scheduler (offline mode only —
   *  in server mode, pg_cron owns respawn timing). */
  update(nowMs) {
    if (this.serverMode) return;
    if (nowMs - this.pool.lastRespawnAt < this._intervalMs()) return;
    this.pool.lastRespawnAt = nowMs;
    this._respawnRandom(); // pool may be empty — the tick just passes
    this._savePool();
  }

  // ---------------- picking / opening ----------------
  /** Raycast for a VISIBLE container placement at the tap point. */
  pick(clientX, clientY) {
    const pickables = this.world.placed
      .filter(rec => this._tableFor(rec) && rec.obj.visible)
      .map(rec => rec.obj);
    if (!pickables.length) return null;
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hit = this._raycaster.intersectObjects(pickables, true)[0];
    return hit ? this.world.recordFor(hit.object) : null;
  }

  async open(rec) {
    if (!rec.obj.visible) return; // despawned between tap and open

    if (this.serverMode) {
      const key = this._keyFor(rec);
      try {
        const { data, error } = await this.supa.functions.invoke('open-chest', {
          body: { chestKey: key, asset: rec.data.asset, playerId: this.identity.id },
        });
        if (error) throw error;
        if (data?.beaten) {
          this._toast('Someone got here first. The hinges are still warm.');
          return;
        }
        // claimed: the realtime event will hide it for everyone, but hide
        // locally right away so it feels instant
        rec.obj.visible = false;
        this.world.refreshColliders();
        this.current = { rec, loot: data?.loot ?? [], key };
        this._show(rec, this.current.loot);
      } catch (err) {
        console.warn('[Containers] open-chest failed, falling back to local roll', err);
        this._openLocal(rec);
      }
      return;
    }
    this._openLocal(rec);
  }

  _openLocal(rec) {
    const table = this.tables[this._tableFor(rec)];
    const loot = table ? this._roll(table) : [];
    this.current = { rec, loot, key: this._keyFor(rec) };
    this._show(rec, loot);
  }

  _roll(table) {
    const [rMin, rMax] = table.rolls ?? [1, 1];
    const rolls = rMin + Math.floor(Math.random() * (rMax - rMin + 1));
    const totalWeight = table.entries.reduce((n, e) => n + e.weight, 0);
    const out = new Map();
    for (let i = 0; i < rolls; i++) {
      let pick = Math.random() * totalWeight;
      for (const e of table.entries) {
        pick -= e.weight;
        if (pick <= 0) {
          const [qMin, qMax] = e.qty ?? [1, 1];
          const qty = qMin + Math.floor(Math.random() * (qMax - qMin + 1));
          out.set(e.item, (out.get(e.item) ?? 0) + qty);
          break;
        }
      }
    }
    return [...out].map(([id, qty]) => ({ id, qty }));
  }

  _takeAll() {
    if (!this.current) return;
    // In server mode the items were ALREADY granted by the open-chest
    // function (authoritative) and arrive via the inventory's realtime
    // feed — adding here too would double-count. Only grant locally when
    // offline. Perception/luck XP likewise route through the server when
    // authoritative (see skills wiring); offline they apply locally.
    if (!this.serverMode) {
      for (const { id, qty } of this.current.loot) this.inventory.add(id, qty);
      this.skills?.addXp('perception', 10);
      if (this.current.loot.some(l => l.id === 'mysterious_key')) this.skills?.addXp('luck', 40);
      this._despawn(this.current.rec, this.current.key);
    }
    this.current = null;
    this.close();
  }

  close() {
    this.panel.classList.remove('open');
    this.current = null;
  }

  // ---------------- UI ----------------
  _show(rec, loot) {
    const name = rec.data.asset.replace(/_/g, ' ');
    let body;
    if (!loot.length) {
      body = `<div class="empty">Nothing but dust and disappointment.</div>
        <button class="take" data-act="take">Close it up</button>`;
    } else {
      const defs = this.inventory.itemDefs;
      body = `<div class="lootlist">${loot.map(l => {
        const def = defs[l.id] ?? { name: l.id, icon: '❔' };
        const icon = (def.icon ?? '❔').includes('.')
          ? `<img src="${def.icon}" alt="">` : (def.icon ?? '❔');
        return `<div class="lootrow"><span class="icon">${icon}</span><span>${def.name ?? l.id}</span><span class="qty">×${l.qty}</span></div>`;
      }).join('')}</div>
      <button class="take" data-act="take">Take all</button>`;
    }
    this.panel.innerHTML = `
      <div class="head">
        <span class="title">${name}</span>
        <button class="close" data-act="close">✕</button>
      </div>
      ${body}`;
    this.panel.classList.add('open');
  }

  _toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), 3200);
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    this.panel = document.createElement('div');
    this.panel.id = 'lootPanel';
    document.body.appendChild(this.panel);
    this.panel.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'take') this._takeAll();
      if (act === 'close') this.close();
    });
    this.toastEl = document.createElement('div');
    this.toastEl.id = 'chestToast';
    document.body.appendChild(this.toastEl);
  }

  // ---------------- persistence ----------------
  _loadPool() {
    try {
      const p = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (p && typeof p === 'object') return { hidden: p.hidden ?? {}, lastRespawnAt: p.lastRespawnAt ?? 0 };
    } catch { /* fall through */ }
    return { hidden: {}, lastRespawnAt: 0 };
  }
  _savePool() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pool));
  }
}
