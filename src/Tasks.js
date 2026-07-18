// ============================================================
// Tasks.js — daily profession tasks for gold and town reputation.
//
// Task definitions live in data/tasks.json, keyed by role id.
// Three engine types:
//
//   patrol — visit every point within a time limit. Explicit start
//            (the timer is the challenge); failing resets for retry.
//   gather — ordered checkpoint chain. Steps can `give` items on
//            arrival and `take` (consume) items to proceed, so the
//            baker really carries flour and water to the stall.
//   fish   — stand near the waterline and Cast. Today's target fish
//            is picked deterministically from the date, so every
//            fisherman in town chases the same catch. Junk happens.
//
// Daily reset at local midnight. Rewards: coins into the inventory,
// plus town reputation — a persistent score (localStorage; later a
// Supabase `profiles.reputation` column, incremented server-side by
// the same Edge Function that validates completion).
//
// The current objective gets a gold ring marker in the world and a
// status pill above the inventory button; tap the pill for details,
// Start, and the Cast button.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const STATE_KEY = 'townsquared.task.v1';
const REP_KEY = 'townsquared.rep.v1';

const dayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// deterministic pick from a string seed (today's fish is town-wide)
function seededIndex(seed, n) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return Math.abs(h) % n;
}

const CSS = `
  #taskPill {
    position: fixed; left: 12px; bottom: max(12px, env(safe-area-inset-bottom));
    max-width: min(52vw, 260px);
    background: rgba(20,16,12,0.85); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.4); border-radius: 20px;
    padding: 8px 14px; font-size: 12px; cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: none; align-items: center; gap: 7px; z-index: 15;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #taskPill.show { display: flex; }
  #taskPill .rep { color: #c9a24b; font-weight: 700; flex: none; }
  #taskCard {
    position: fixed; left: 12px; bottom: max(52px, calc(env(safe-area-inset-bottom) + 40px));
    width: min(300px, calc(100vw - 24px));
    background: rgba(20,16,12,0.92); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.45); border-radius: 12px;
    padding: 14px; font-size: 12.5px; z-index: 16;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: none; flex-direction: column; gap: 9px;
  }
  #taskCard.show { display: flex; }
  #taskCard .tname { font-family: 'Cinzel', serif; font-weight: 700; color: #c9a24b; font-size: 15px; }
  #taskCard .tdesc { font-style: italic; opacity: 0.75; }
  #taskCard .objective { background: rgba(233,221,194,0.07); border-radius: 8px; padding: 8px 10px; line-height: 1.4; }
  #taskCard button {
    background: rgba(201,162,75,0.25); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.5); border-radius: 8px;
    padding: 9px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  #taskCard button:disabled { opacity: 0.45; cursor: default; }
  #taskCard .reward { font-size: 11.5px; opacity: 0.7; }
`;

export class Tasks {
  constructor({ world, inventory, roles, skills }) {
    this.world = world;
    this.inventory = inventory;
    this.roles = roles;
    this.skills = skills ?? null;
    this.defs = {};
    this.state = null;      // { day, roleId, status, stepIdx, caught, endsAt, fishId }
    this.rep = +(localStorage.getItem(REP_KEY) ?? 0);
    this._casting = false;
    this._pillText = '';
    this._buildUI();
    this._buildMarker();
  }

  async init() {
    try {
      const res = await fetch('data/tasks.json');
      if (res.ok) this.defs = await res.json();
    } catch { /* no tasks.json — pill stays hidden */ }
    const saved = localStorage.getItem(STATE_KEY);
    if (saved) { try { this.state = JSON.parse(saved); } catch {} }
    this.setRole(this.roles.current);
  }

  get def() {
    return this.state ? this.defs[this.state.roleId] : null;
  }

  setRole(roleId) {
    if (!roleId || !this.defs[roleId]) {
      this.state = null;
      this._save();
      return;
    }
    if (!this.state || this.state.roleId !== roleId || this.state.day !== dayKey()) {
      this._reset(roleId);
    }
  }

  _reset(roleId) {
    const def = this.defs[roleId];
    this.state = {
      day: dayKey(),
      roleId,
      status: def.type === 'patrol' ? 'idle' : 'active',
      stepIdx: 0,
      caught: 0,
      endsAt: null,
      fishId: def.type === 'fish'
        ? def.fishPool[seededIndex(dayKey(), def.fishPool.length)]
        : null,
    };
    this._save();
  }

  _save() {
    if (this.state) localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
    else localStorage.removeItem(STATE_KEY);
  }

  // ---------------- per-frame ----------------
  update(nowMs, playerPos) {
    const s = this.state, def = this.def;
    if (!s || !def) { this._setPill(''); this.marker.visible = false; return; }

    // daily rollover while playing
    if (s.day !== dayKey()) this._reset(s.roleId);

    let target = null;

    if (def.type === 'patrol' && s.status === 'active') {
      const left = Math.max(0, (s.endsAt - nowMs) / 1000);
      if (left <= 0) {
        s.status = 'idle'; s.stepIdx = 0; this._save();
        this._toast('Too slow — the rounds reset. Try again.');
      } else {
        const [px, pz] = def.points[s.stepIdx];
        target = { x: px, z: pz, r: def.radius };
        if (this._near(playerPos, target)) {
          s.stepIdx++;
          if (s.stepIdx >= def.points.length) this._complete();
          else this._save();
        }
        this._setPill(`🛡️ ${s.stepIdx}/${def.points.length} points · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
      }
    }

    if (def.type === 'gather' && s.status === 'active') {
      const step = def.steps[s.stepIdx];
      target = { x: step.x, z: step.z, r: step.radius };
      if (this._near(playerPos, target)) {
        if (step.take && !step.take.every(id => this.inventory.count(id) > 0)) {
          this._setPill('🌾 Missing ingredients — retrace your steps');
        } else {
          for (const id of step.take ?? []) this.inventory.remove(id, 1);
          if (step.give) this.inventory.add(step.give, 1);
          s.stepIdx++;
          if (s.stepIdx >= def.steps.length) this._complete();
          else { this._save(); this._toast(step.label + ' ✓'); }
        }
      }
      if (s.status === 'active' && s.stepIdx < def.steps.length) {
        this._setPill(`🌾 ${def.steps[s.stepIdx].label}`);
      }
    }

    if (def.type === 'fish' && s.status === 'active') {
      const fishName = this.inventory.itemDefs[s.fishId]?.name ?? s.fishId;
      this._setPill(`🎣 ${fishName}: ${s.caught}/${def.count}`);
      // no world marker for fishing; the coastline is the destination
    }

    if (s.status === 'idle') this._setPill(`🛡️ ${def.name} — tap to start`);
    if (s.status === 'done') this._setPill(`✓ ${def.name} complete`);

    // objective marker
    if (target && s.status === 'active') {
      this.marker.visible = true;
      this.marker.position.set(target.x, 0.06, target.z);
      this.marker.scale.setScalar(1 + Math.sin(nowMs / 280) * 0.08);
    } else {
      this.marker.visible = false;
    }
  }

  _near(pos, t) {
    const dx = pos.x - t.x, dz = pos.z - t.z;
    return dx * dx + dz * dz < t.r * t.r;
  }

  // ---------------- actions ----------------
  start() {
    const s = this.state, def = this.def;
    if (!s || def?.type !== 'patrol' || s.status !== 'idle') return;
    s.status = 'active'; s.stepIdx = 0;
    s.endsAt = Date.now() + def.timeLimitSec * 1000;
    this._save();
    this._renderCard();
  }

  /** Fisherman near the waterline: one cast, one suspenseful wait. */
  cast(playerPos) {
    const s = this.state, def = this.def;
    if (!s || def?.type !== 'fish' || s.status !== 'active' || this._casting) return;
    if (!this.nearWater(playerPos)) return;

    this._casting = true;
    this._renderCard();
    const [minS, maxS] = def.castSeconds ?? [2, 5];
    const wait = (minS + Math.random() * (maxS - minS)) * 1000;

    setTimeout(() => {
      this._casting = false;
      if (Math.random() < (def.junkChance ?? 0.25)) {
        this.inventory.add('old_boot', 1);
        this._toast('…an old boot. The sea mocks you.');
      } else {
        // today's fish bites most often; the rest of the pool fills out the line
        const catchId = Math.random() < 0.6
          ? s.fishId
          : def.fishPool[(Math.random() * def.fishPool.length) | 0];
        this.inventory.add(catchId, 1);
        this.skills?.addXp('fishing', catchId === s.fishId ? 14 : 6);
        if (catchId === s.fishId) {
          s.caught++;
          this._save();
          if (s.caught >= def.count) this._complete();
        }
        const name = this.inventory.itemDefs[catchId]?.name ?? catchId;
        this._toast(`Caught a ${name}!`);
      }
      this._renderCard();
    }, wait);
  }

  nearWater(pos) {
    const w = this.world.water;
    if (!w) return false;
    const maxDist = this.def?.nearWaterM ?? 4;
    const along = (w.side === 'east' || w.side === 'west') ? pos.z : pos.x;
    const waterline = w.shore + this.world._coastJag(along);
    const coord = (w.side === 'east') ? pos.x
      : (w.side === 'west') ? -pos.x
      : (w.side === 'south') ? pos.z : -pos.z;
    return waterline - coord < maxDist;
  }

  _complete() {
    const def = this.def, s = this.state;
    s.status = 'done';
    this._save();
    const r = def.reward ?? {};
    if (r.coin) this.inventory.add('coin', r.coin);
    if (r.rep) {
      this.rep += r.rep;
      localStorage.setItem(REP_KEY, String(this.rep));
    }
    // skill training per task type
    if (def.type === 'patrol') { this.skills?.addXp('endurance', 35); this.skills?.addXp('strength', 35); }
    if (def.type === 'gather') { this.skills?.addXp('cooking', 45); }
    if (def.type === 'fish')   { this.skills?.addXp('fishing', 30); }
    this._toast(`${def.name} complete! +${r.coin ?? 0} gold, +${r.rep ?? 0} reputation`);
    this._renderCard();
  }

  // ---------------- UI ----------------
  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.pill = document.createElement('div');
    this.pill.id = 'taskPill';
    document.body.appendChild(this.pill);
    this.pill.addEventListener('click', () => {
      this.card.classList.toggle('show');
      if (this.card.classList.contains('show')) this._renderCard();
    });

    this.card = document.createElement('div');
    this.card.id = 'taskCard';
    document.body.appendChild(this.card);
    this.card.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'start') this.start();
      if (act === 'cast') this.cast(this._playerPos);
      if (act === 'close') this.card.classList.remove('show');
    });
  }

  /** main.js passes the player position each frame (needed by Cast). */
  trackPlayer(pos) { this._playerPos = pos; }

  _setPill(text) {
    const full = text ? `${text}  ·  ⭐ ${this.rep}` : '';
    if (full === this._pillText) return; // only touch the DOM on change
    this._pillText = full;
    this.pill.classList.toggle('show', !!text);
    if (text) this.pill.innerHTML = `<span>${text}</span><span class="rep">⭐ ${this.rep}</span>`;
  }

  _renderCard() {
    const s = this.state, def = this.def;
    if (!s || !def) { this.card.classList.remove('show'); return; }
    const r = def.reward ?? {};
    let objective = '', action = '';

    if (def.type === 'patrol') {
      objective = s.status === 'done' ? 'Rounds complete. The town sleeps easier.'
        : s.status === 'active' ? `Visit point ${s.stepIdx + 1} of ${def.points.length} — follow the gold ring.`
        : 'Visit every watch-point before time runs out.';
      if (s.status === 'idle') action = `<button data-act="start">Begin the rounds</button>`;
    }
    if (def.type === 'gather') {
      objective = s.status === 'done' ? 'The morning bake is done. Smell that.'
        : def.steps[s.stepIdx].label + ' — follow the gold ring.';
    }
    if (def.type === 'fish') {
      const fishName = this.inventory.itemDefs[s.fishId]?.name ?? s.fishId;
      objective = s.status === 'done' ? 'Quota met. The gulls are furious.'
        : `Today's catch: ${fishName} (${s.caught}/${def.count}). Cast from the shoreline.`;
      if (s.status === 'active') {
        const near = this._playerPos && this.nearWater(this._playerPos);
        action = `<button data-act="cast" ${(!near || this._casting) ? 'disabled' : ''}>
          ${this._casting ? 'Waiting for a bite…' : near ? '🎣 Cast' : 'Get closer to the water'}</button>`;
      }
    }

    this.card.innerHTML = `
      <div style="display:flex"><span class="tname">${def.name}</span>
        <button data-act="close" style="margin-left:auto;background:none;border:none;color:#e9ddc2;font-size:16px;padding:0">✕</button></div>
      <div class="tdesc">${def.desc ?? ''}</div>
      <div class="objective">${objective}</div>
      ${action}
      <div class="reward">Reward: ${r.coin ?? 0} gold · ${r.rep ?? 0} reputation · resets daily</div>`;
    this.card.classList.add('show');
  }

  _toast(msg) {
    // reuse the pill as a transient toast
    this._pillText = ''; // force refresh
    this.pill.classList.add('show');
    this.pill.innerHTML = `<span>${msg}</span>`;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { this._pillText = '__'; }, 2600);
  }

  // ---------------- marker ----------------
  _buildMarker() {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.4, 28),
      new THREE.MeshBasicMaterial({ color: 0xc9a24b, transparent: true, opacity: 0.85, depthWrite: false })
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.world.scene.add(this.marker);
  }
}
