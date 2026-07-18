// ============================================================
// Mirage.js — the magick cave that isn't always there.
//
// Schedule is deterministic town-wide: time divides into cycles
// (default 10 min); in each cycle the cave "exists" for a visible
// window (default 3 min) at a spot chosen deterministically from
// the configured list — same cycle, same spot, same timing for
// every player, zero network.
//
// But it's a MIRAGE: whether it manifests TO YOU each cycle is a
// seeded per-player roll weighted by your Perception skill —
//   chance = chanceBase + perceptionLevel × chancePerPerception
// (capped at chanceMax). Seeded by cycle+playerId, so it's stable
// for the whole window. Sharp-eyed players see it most nights;
// others walk right past the empty air.
//
// Tap it while it's there: walk over, enter, and the whispers
// train Intellect (its only teacher), with a chance of a rune
// shard or stranger things. One claim per appearance.
//
// town.json, top level:
//   "mirage": {
//     "spots": [[-70, 10], [-95, -20], [-60, 28]],
//     "cycleMinutes": 10, "visibleMinutes": 3,
//     "chanceBase": 0.35, "chancePerPerception": 0.05, "chanceMax": 0.9
//   }
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const CLAIM_KEY = 'townsquared.mirage.v1';

function seededFloat(seed) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (Math.abs(h) % 100000) / 100000;
}

const CSS = `
  #mirageToast {
    position: fixed; left: 50%; transform: translateX(-50%);
    top: max(70px, calc(env(safe-area-inset-top) + 60px));
    background: rgba(26, 16, 40, 0.88); color: #d9c9ff;
    border: 1px solid rgba(138, 92, 255, 0.55); border-radius: 18px;
    padding: 8px 18px; font-size: 12.5px; z-index: 14;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-style: italic;
    opacity: 0; transition: opacity 0.6s; pointer-events: none;
  }
  #mirageToast.show { opacity: 1; }
`;

export class Mirage {
  constructor({ world, registry, skills, inventory, identity }) {
    this.world = world;
    this.registry = registry;
    this.skills = skills;
    this.inventory = inventory;
    this.identity = identity;
    this.cfg = null;
    this.mesh = null;
    this._rimMat = null;
    this._visible = false;
    this._cycle = -1;
    this._claimed = +(localStorage.getItem(CLAIM_KEY) ?? -1);
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.toastEl = document.createElement('div');
    this.toastEl.id = 'mirageToast';
    document.body.appendChild(this.toastEl);
  }

  async init() {
    this.cfg = this.world.data?.mirage ?? null;
    if (!this.cfg?.spots?.length) return;
    this.mesh = await this.registry.instance('magick_cave');
    this.mesh.visible = false;
    this.mesh.traverse(o => {
      if (o.name === 'mirage_rim') this._rimMat = o.material;
    });
    this.world.scene.add(this.mesh);
  }

  // ---------------- schedule ----------------
  _timing(nowMs) {
    const cycleMs = (this.cfg.cycleMinutes ?? 10) * 60000;
    const visMs = (this.cfg.visibleMinutes ?? 3) * 60000;
    const cycle = Math.floor(nowMs / cycleMs);
    const tIn = nowMs - cycle * cycleMs;
    return { cycle, tIn, visMs, inWindow: tIn < visMs };
  }

  /** Does the cave manifest to THIS player this cycle? Perception decides. */
  _manifests(cycle) {
    const lvl = this.skills?.level('perception') ?? 1;
    const chance = Math.min(
      this.cfg.chanceMax ?? 0.9,
      (this.cfg.chanceBase ?? 0.35) + lvl * (this.cfg.chancePerPerception ?? 0.05)
    );
    return seededFloat(`mirage:${cycle}:${this.identity.id}`) < chance;
  }

  _spot(cycle) {
    const spots = this.cfg.spots;
    const i = Math.floor(seededFloat(`spot:${cycle}`) * spots.length);
    return spots[Math.min(i, spots.length - 1)];
  }

  update(nowMs) {
    if (!this.mesh || !this.cfg) return;
    const { cycle, tIn, visMs, inWindow } = this._timing(nowMs);
    const show = inWindow && this._manifests(cycle);

    if (show && !this._visible) {
      const [x, z] = this._spot(cycle);
      this.mesh.position.set(x, 0, z);
      this._visible = true;
      this._cycle = cycle;
      this.mesh.visible = true;
      this._toast('A strange shimmer rises somewhere beyond the town…');
    } else if (!show && this._visible) {
      this._visible = false;
      this.mesh.visible = false;
    }
    if (!this._visible) return;

    // emerge over 1.5s, dissolve over the last 8s of the window
    const t = tIn / 1000;
    const remain = (visMs - tIn) / 1000;
    let s = 1;
    if (t < 1.5) s = t / 1.5;
    else if (remain < 8) s = Math.max(0.001, remain / 8);
    const ease = s * s * (3 - 2 * s); // smoothstep
    this.mesh.scale.setScalar(0.2 + 0.8 * ease);

    // the rim breathes
    if (this._rimMat) {
      this._rimMat.emissiveIntensity = 0.9 + Math.sin(nowMs / 260) * 0.45;
    }
  }

  // ---------------- interaction ----------------
  /** Is the tap on the (currently manifested) cave? */
  pick(clientX, clientY) {
    if (!this._visible || !this.mesh) return false;
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera ?? this._cam);
    return this._raycaster.intersectObject(this.mesh, true).length > 0;
  }
  setCamera(camera) { this._cam = camera; }

  get position() { return this.mesh?.position; }
  get isVisible() { return this._visible; }

  /** Player has walked into the mouth. */
  enter() {
    if (!this._visible) return;
    if (this._claimed === this._cycle) {
      this._toast('The cave is silent now. It has given what it will give.');
      return;
    }
    this._claimed = this._cycle;
    localStorage.setItem(CLAIM_KEY, String(this._cycle));

    this.skills?.addXp('intellect', 25);
    this.skills?.addXp('luck', 8);
    const r = Math.random();
    if (r < 0.35) {
      this.inventory?.add('rune_shard', 1);
      this._toast('✦ The whispers sharpen your mind — and press a rune shard into your palm.');
    } else if (r < 0.5) {
      this.inventory?.add('mysterious_key', 1);
      this._toast('✦ The whispers sharpen your mind — and something cold and key-shaped is in your pocket.');
    } else {
      const coins = 5 + ((Math.random() * 8) | 0);
      this.inventory?.add('coin', coins);
      this._toast(`✦ The whispers sharpen your mind — and ${coins} coins that weren't there before.`);
    }
  }

  _toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), 4200);
  }
}
