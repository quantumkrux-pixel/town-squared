// ============================================================
// StonePuzzle.js — the daily draw at the stone circle.
//
// Six stones, six numbered sockets. Each UTC day the circle picks a
// new secret order FOR YOU, and you get two guesses at it. 720
// possible orders, so a day is roughly a 1-in-360 shot. Come back
// tomorrow for a fresh order.
//
// The order lives only on the server (13_stone_lottery.sql, no
// select policy) and a guess returns yes or no — nothing positional,
// which would collapse the odds.
//
// Guess right and the six wake together, and someone turns up to
// make a great deal of noise about it.
//
// Interaction: click a stone for its menu, lift it, drag it into a
// socket. Socket one wakes first. Your arrangement is local working
// state; only the submitted order is sent.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const LAYOUT_KEY = 'townsquared.stonelayout.v1';
const RING_RADIUS = 3.6;     // sockets sit this far from the circle's centre
const AREA_RADIUS = 9;       // you may drag a stone this far from centre
const SNAP_DIST   = 1.6;     // release within this of a socket to seat it

const CSS = `
  #stonesToggle {
    position: fixed; left: 12px; top: max(180px, calc(env(safe-area-inset-top) + 170px));
    width: 44px; height: 44px; border-radius: 10px;
    background: rgba(20,16,12,0.72); color: #c9a24b;
    border: 1px solid rgba(201,162,75,0.35);
    font-size: 19px; cursor: pointer; z-index: 20; display: none;
  }
  #stonesToggle.show { display: block; }
  #stonesToggle.active { background: #c9a24b; color: #1a1512; }
  #stonesToggle .cbadge {
    position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px;
    background: #7a5cae; color: #fff; border-radius: 8px; font-size: 10px;
    line-height: 16px; text-align: center; padding: 0 3px;
  }

  /* right-click-style context menu on a stone */
  #stoneMenu {
    position: fixed; display: none; flex-direction: column; min-width: 150px;
    background: rgba(24,18,28,0.97); color: #e2dcf0;
    border: 1px solid rgba(138,92,255,0.5); border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.55);
    padding: 5px; z-index: 40; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
  }
  #stoneMenu.open { display: flex; }
  #stoneMenu .mtitle {
    font-family: 'Cinzel', serif; font-size: 12px; color: #b9a0f0;
    letter-spacing: 0.08em; padding: 6px 10px 7px; border-bottom: 1px solid rgba(138,92,255,0.25);
  }
  #stoneMenu button {
    background: none; border: none; color: #e2dcf0; text-align: left;
    padding: 9px 11px; border-radius: 7px; cursor: pointer; font-size: 12.5px;
  }
  #stoneMenu button:hover { background: rgba(138,92,255,0.22); }
  #stoneMenu button:disabled { opacity: 0.35; cursor: default; }

  #drawPanel {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -52%);
    width: min(360px, calc(100vw - 28px)); max-height: 76vh; overflow-y: auto;
    display: none; flex-direction: column; gap: 8px;
    background: linear-gradient(160deg, rgba(38,30,44,0.97), rgba(24,18,28,0.97));
    border: 2px solid rgba(138,92,255,0.45); border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    padding: 16px; z-index: 19; color: #e2dcf0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12.5px;
  }
  #drawPanel.open { display: flex; }
  #drawPanel h2 {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 16px;
    color: #b9a0f0; letter-spacing: 0.08em; text-align: center; margin: 0;
  }
  #drawPanel .sub { text-align: center; font-size: 11px; opacity: 0.6; margin-top: -4px; }
  #drawPanel .clue {
    background: rgba(226,220,240,0.07); border-radius: 9px;
    border-left: 3px solid rgba(138,92,255,0.55); padding: 9px 12px; line-height: 1.5;
  }
  #drawPanel .clue .src { display: block; font-size: 10.5px; opacity: 0.5; margin-top: 3px; font-style: italic; }
  #drawPanel .unfound {
    background: rgba(226,220,240,0.04); border-radius: 9px;
    border-left: 3px solid rgba(226,220,240,0.12); padding: 9px 12px;
    opacity: 0.55; font-style: italic;
  }
  #drawPanel .solved {
    text-align: center; font-family: 'Cinzel', serif; color: #b9a0f0;
    letter-spacing: 0.08em; padding: 6px;
  }

  #stoneBar {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(14px, env(safe-area-inset-bottom));
    width: min(340px, calc(100vw - 24px));
    display: none; flex-direction: column; gap: 9px;
    background: rgba(24,18,28,0.94); color: #e2dcf0;
    border: 1px solid rgba(138,92,255,0.45); border-radius: 12px;
    padding: 13px; z-index: 17;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px; backdrop-filter: blur(8px);
  }
  #stoneBar.open { display: flex; }
  #stoneBar .shead { display: flex; align-items: baseline; }
  #stoneBar .stitle {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 15px;
    color: #b9a0f0; letter-spacing: 0.05em;
  }
  #stoneBar .sclose {
    margin-left: auto; background: none; border: none; color: #e2dcf0;
    font-size: 18px; cursor: pointer; opacity: 0.7;
  }
  #stoneBar .seq { display: flex; gap: 5px; justify-content: center; }
  #stoneBar .slot {
    flex: 1; height: 42px; border-radius: 8px;
    background: rgba(0,0,0,0.3); border: 1px solid rgba(138,92,255,0.3);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-size: 10px; color: #b9a0f0; gap: 1px;
  }
  #stoneBar .slot.filled { background: rgba(138,92,255,0.22); border-color: rgba(138,92,255,0.65); }
  #stoneBar .slot .n { font-family: 'Cinzel', serif; font-size: 11px; opacity: 0.6; }
  #stoneBar .slot .s { font-weight: 600; font-size: 10.5px; }
  #stoneBar .hint { font-size: 11.5px; opacity: 0.7; text-align: center; line-height: 1.4; }
  #stoneBar .row { display: flex; gap: 6px; }
  #stoneBar button.act {
    flex: 1; background: rgba(138,92,255,0.22); color: #e2dcf0;
    border: 1px solid rgba(138,92,255,0.5); border-radius: 8px;
    padding: 10px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  #stoneBar button.act:disabled { opacity: 0.4; cursor: default; }
  #hostPanel {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(16px, env(safe-area-inset-bottom));
    width: min(400px, calc(100vw - 24px));
    display: none; flex-direction: column; gap: 10px;
    background: linear-gradient(160deg, rgba(48,26,58,0.98), rgba(28,16,34,0.98));
    border: 2px solid rgba(201,162,75,0.7); border-radius: 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,0.6);
    padding: 16px 18px; z-index: 30; color: #f0e6d2;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px; line-height: 1.55;
  }
  #hostPanel.open { display: flex; }
  #hostPanel .hname {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 12px;
    color: #c9a24b; letter-spacing: 0.16em;
  }
  #hostPanel .hline { font-size: 14px; }
  #hostPanel .hnext {
    align-self: flex-end; background: #c9a24b; color: #1a1512; border: none;
    border-radius: 8px; padding: 9px 20px; font-family: 'Cinzel', serif;
    font-weight: 700; letter-spacing: 0.06em; font-size: 13px; cursor: pointer;
  }
  #stoneToast {
    position: fixed; left: 50%; transform: translateX(-50%);
    top: max(70px, calc(env(safe-area-inset-top) + 60px));
    background: rgba(26,16,40,0.9); color: #d9c9ff;
    border: 1px solid rgba(138,92,255,0.55); border-radius: 18px;
    padding: 9px 18px; font-size: 12.5px; z-index: 15; max-width: min(340px, 90vw);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    text-align: center; line-height: 1.45;
    opacity: 0; transition: opacity 0.5s; pointer-events: none;
  }
  #stoneToast.show { opacity: 1; }
`;

function numberSprite(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(185,160,240,0.95)';
  x.font = 'bold 84px Cinzel, Georgia, serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0.9,
  }));
  spr.scale.set(0.9, 0.9, 1);
  return spr;
}

export class StonePuzzle {
  constructor({ world, registry, server, camera }) {
    this.world = world;
    this.registry = registry;
    this.server = server;
    this.camera = camera;
    this.stones = new Map();    // symbol -> { rec, home:{x,z}, slot:int|null }
    this.slots = [];            // [{x,z,marker}] index 0..5 → sockets 1..6
    this.state = null;
    this.dragging = null;       // symbol being dragged
    this.center = { x: 0, z: 0 };
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
    this._buildUI();
  }

  get isDragging() { return !!this.dragging; }

  async init() {
    for (const rec of this.world.placed) {
      const sym = this.registry.defs[rec.data.asset]?.stone;
      if (sym && rec.obj) {
        this.stones.set(sym, { rec, home: { x: rec.data.x, z: rec.data.z }, slot: null });
      }
    }
    if (this.stones.size === 0) return;

    // the clearing's centre is the middle of wherever you placed the stones
    let sx = 0, sz = 0;
    for (const s of this.stones.values()) { sx += s.home.x; sz += s.home.z; }
    this.center = { x: sx / this.stones.size, z: sz / this.stones.size };
    this._buildSockets();
    this._restoreLayout();

    await this.refresh();
    this.toggleBtn.classList.add('show');
  }

  /** Six sockets in a ring, numbered — the order is read from these. */
  _buildSockets() {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = this.center.x + Math.cos(a) * RING_RADIUS;
      const z = this.center.z + Math.sin(a) * RING_RADIUS;

      const marker = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.52, 0.72, 24),
        new THREE.MeshBasicMaterial({
          color: 0x8a5cff, transparent: true, opacity: 0.4,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      marker.add(ring);

      const num = numberSprite(i + 1);
      num.position.set(0, 0.9, 0);
      marker.add(num);

      marker.position.set(x, 0, z);
      this.world.scene.add(marker);
      this.slots.push({ x, z, marker, ring });
    }
  }

  async refresh() {
    const { data, error } = await this.server.supa.rpc('get_stone_daily');
    if (error) { console.warn('[Stones] daily state failed', error); return; }
    this.state = data;
    this._renderBadge();
    if (this.bar.classList.contains('open')) this._renderBar();
  }

  // ---------------- picking ----------------
  _ground(clientX, clientY) {
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    return this._raycaster.ray.intersectPlane(this._plane, this._hit) ? this._hit : null;
  }

  pick(clientX, clientY) {
    if (!this.stones.size) return null;
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const objs = [...this.stones.values()].map(s => s.rec.obj);
    const hit = this._raycaster.intersectObjects(objs, true)[0];
    if (!hit) return null;
    for (const [sym, s] of this.stones) {
      let o = hit.object;
      while (o) { if (o === s.rec.obj) return sym; o = o.parent; }
    }
    return null;
  }

  positionOf(sym) { return this.stones.get(sym)?.rec.obj.position ?? null; }

  // ---------------- context menu ----------------
  openMenu(sym, clientX, clientY) {
    if (this.state?.solved) {
      this._toast('The circle is already awake to you. The stones rest.');
      return;
    }
    const s = this.stones.get(sym);
    const name = sym.charAt(0).toUpperCase() + sym.slice(1);
    this.menu.innerHTML = `
      <div class="mtitle">${name.toUpperCase()} STONE</div>
      <button data-m="lift">✋ Lift stone</button>
      <button data-m="home" ${s.slot === null ? 'disabled' : ''}>↩ Return to the edge</button>
      <button data-m="close">Cancel</button>`;
    this.menu.dataset.sym = sym;
    // keep it on screen
    const w = 160, h = 130;
    this.menu.style.left = `${Math.min(clientX, window.innerWidth - w - 10)}px`;
    this.menu.style.top = `${Math.min(clientY, window.innerHeight - h - 10)}px`;
    this.menu.classList.add('open');
  }

  closeMenu() { this.menu.classList.remove('open'); }

  // ---------------- dragging ----------------
  _beginDrag(sym) {
    this.closeMenu();
    this.dragging = sym;
    this._highlightSockets(true);
    this.bar.classList.add('open');
    this._renderBar();
    this._toast('Drag it into a socket. Release to seat it.', 2600);

    const move = e => {
      const p = this._ground(e.clientX, e.clientY);
      if (!p) return;
      // stay inside the clearing
      const dx = p.x - this.center.x, dz = p.z - this.center.z;
      const d = Math.hypot(dx, dz);
      const cx = d > AREA_RADIUS ? this.center.x + (dx / d) * AREA_RADIUS : p.x;
      const cz = d > AREA_RADIUS ? this.center.z + (dz / d) * AREA_RADIUS : p.z;
      const obj = this.stones.get(sym).rec.obj;
      obj.position.x = cx;
      obj.position.z = cz;
      obj.position.y = 0.25;           // lifted, so it reads as carried
      this._markNearest(cx, cz);
    };
    const up = e => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this._endDrag(sym, e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _endDrag(sym, e) {
    const s = this.stones.get(sym);
    const obj = s.rec.obj;
    const nearest = this._nearestSocket(obj.position.x, obj.position.z);

    if (nearest && nearest.dist <= SNAP_DIST) {
      // if another stone sits there, send it back to the edge
      for (const [other, os] of this.stones) {
        if (other !== sym && os.slot === nearest.idx) this._sendHome(other);
      }
      s.slot = nearest.idx;
      const slot = this.slots[nearest.idx];
      obj.position.set(slot.x, 0, slot.z);
    } else {
      this._sendHome(sym);
      this._toast('Not near a socket — the stone settles back.', 2200);
    }

    this.dragging = null;
    this._highlightSockets(false);
    this._saveLayout();
    this._renderBar();
  }

  _sendHome(sym) {
    const s = this.stones.get(sym);
    s.slot = null;
    s.rec.obj.position.set(s.home.x, 0, s.home.z);
  }

  _nearestSocket(x, z) {
    let best = null;
    this.slots.forEach((sl, idx) => {
      const d = Math.hypot(sl.x - x, sl.z - z);
      if (!best || d < best.dist) best = { idx, dist: d };
    });
    return best;
  }

  _markNearest(x, z) {
    const n = this._nearestSocket(x, z);
    this.slots.forEach((sl, i) => {
      const close = n && n.idx === i && n.dist <= SNAP_DIST;
      sl.ring.material.opacity = close ? 0.95 : 0.55;
    });
  }

  _highlightSockets(on) {
    for (const sl of this.slots) sl.ring.material.opacity = on ? 0.55 : 0.4;
  }

  // ---------------- order + submission ----------------
  /** The order as the sockets read it, or null if any socket is empty. */
  currentOrder() {
    const out = new Array(6).fill(null);
    for (const [sym, s] of this.stones) if (s.slot !== null) out[s.slot] = sym;
    return out.every(Boolean) ? out : null;
  }

  clear() {
    for (const sym of this.stones.keys()) this._sendHome(sym);
    this._saveLayout();
    this._renderBar();
  }

  async submit() {
    const order = this.currentOrder();
    if (!order) return;
    if (this._guessesLeft() <= 0) {
      this._toast('The circle has heard you twice today. It draws again at midnight.');
      return;
    }
    const { data, error } = await this.server.supa.rpc('guess_stone_order', { p_order: order });
    if (error || data?.error) {
      this._toast(data?.error ?? 'The stones do not answer.');
      return;
    }
    if (data.spent) {
      await this.refresh();
      this._toast('Twice is all the circle allows in a day.');
      return;
    }
    if (data.correct) {
      await this.refresh();
      await this.server.reload();
      this._celebrate(data);
      return;
    }
    await this.refresh();
    const left = data.guesses_left ?? this._guessesLeft();
    this._toast(left > 0
      ? `Cold. One guess left today.`
      : 'Cold, and that was the second. The circle draws again at midnight.');
    this._renderBar();
  }

  // ---------------- winning ----------------
  /** All six alight, and the town's least likely celebrity arrives. */
  async _celebrate(prize) {
    this.bar.classList.remove('open');
    for (const s of this.stones.values()) {
      s.rec.obj.traverse(o => {
        if (o.name === 'rune_face') o.material.emissiveIntensity = 2.4;
      });
    }
    this._pulse = 0;
    this._glowing = true;
    await this._spawnHost(prize);
  }

  async _spawnHost(prize) {
    // he arrives beside the circle, from nowhere in particular
    if (!this.host) {
      try {
        this.host = await this.registry.instance('char_host');
      } catch { this.host = null; }
      if (this.host) {
        this.host.position.set(this.center.x, 0, this.center.z + RING_RADIUS + 1.6);
        this.host.rotation.y = Math.PI;
        this.world.scene.add(this.host);
      }
    }
    const lines = [
      "WELL. Look who finally read the room — and by 'room' I mean six rocks in a field.",
      "Ohhh, they don't tell you this, but I've been standing behind that hedge for eleven months. ELEVEN. I had a chair brought in.",
      "Seven hundred and twenty arrangements. Two guesses. And you — you absolute weathervane — picked it.",
      "Now. Prizes. I'm contractually obliged to enjoy this part.",
      `FIVE HUNDRED GOLD. Counted twice, because the first count was wrong and I'm not proud of it.`,
      `A TITLE. You are henceforth ${prize.title ?? 'the Stonewaker'}. Wear it. Or don't. It's engraved either way.`,
      "And the key to a room in the library that the librarian insists doesn't exist. It does. She's lying. There's a book in there — sign it, and you're in the record forever.",
      "That's it. That's the whole bit. Go on — the stones want their evening back.",
    ];
    this._hostLines = lines;
    this._hostIdx = 0;
    this._showHostLine();
  }

  _showHostLine() {
    if (this._hostIdx >= this._hostLines.length) { this._dismissHost(); return; }
    const line = this._hostLines[this._hostIdx++];
    this.hostPanel.innerHTML = `
      <div class="hname">THE HERALD OF SMALL MIRACLES</div>
      <div class="hline">${line}</div>
      <button class="hnext">${this._hostIdx >= this._hostLines.length ? 'Thank you?' : 'Go on…'}</button>`;
    this.hostPanel.classList.add('open');
  }

  _dismissHost() {
    this.hostPanel.classList.remove('open');
    if (this.host) { this.world.scene.remove(this.host); this.host = null; }
    this._glowing = false;
    for (const s of this.stones.values()) {
      s.rec.obj.traverse(o => {
        if (o.name === 'rune_face') o.material.emissiveIntensity = 0.35;
      });
    }
    this._toast('\u2726 500 gold, a title, and a key you cannot explain. \u2726', 7000);
  }

  /** Called from the main loop — makes the winning glow breathe. */
  update(nowMs) {
    if (!this._glowing) return;
    const v = 1.8 + Math.sin(nowMs / 180) * 0.9;
    for (const s of this.stones.values()) {
      s.rec.obj.traverse(o => {
        if (o.name === 'rune_face') o.material.emissiveIntensity = v;
      });
    }
  }

  // ---------------- layout persistence (local working state) ----------------
  _saveLayout() {
    const map = {};
    for (const [sym, s] of this.stones) map[sym] = s.slot;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(map));
  }
  _restoreLayout() {
    let map;
    try { map = JSON.parse(localStorage.getItem(LAYOUT_KEY)); } catch { return; }
    if (!map) return;
    for (const [sym, slot] of Object.entries(map)) {
      const s = this.stones.get(sym);
      if (!s || slot === null || slot === undefined) continue;
      s.slot = slot;
      const sl = this.slots[slot];
      if (sl) s.rec.obj.position.set(sl.x, 0, sl.z);
    }
  }

  // ---------------- UI ----------------
  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'stonesToggle';
    this.toggleBtn.innerHTML = '🗿<span class="cbadge">0</span>';
    this.toggleBtn.title = 'Stone circle clues (P)';
    document.body.appendChild(this.toggleBtn);
    this.badgeEl = this.toggleBtn.querySelector('.cbadge');
    this.toggleBtn.addEventListener('click', () => this._toggleDraw());
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'KeyP') this._toggleDraw();
      if (e.code === 'Escape') {
        this.closeMenu();
        this.drawPanel.classList.remove('open');
        this.bar.classList.remove('open');
      }
    });

    this.menu = document.createElement('div');
    this.menu.id = 'stoneMenu';
    document.body.appendChild(this.menu);
    this.menu.addEventListener('click', e => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      const sym = this.menu.dataset.sym;
      if (m === 'lift') this._beginDrag(sym);
      if (m === 'home') { this._sendHome(sym); this._saveLayout(); this._renderBar(); this.closeMenu(); }
      if (m === 'close') this.closeMenu();
    });

    this.drawPanel = document.createElement('div');
    this.drawPanel.id = 'cluePanel';
    document.body.appendChild(this.drawPanel);

    this.bar = document.createElement('div');
    this.bar.id = 'stoneBar';
    document.body.appendChild(this.bar);
    this.bar.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.bar.classList.remove('open');
      if (act === 'clear') this.clear();
      if (act === 'submit') this.submit();
    });

    this.hostPanel = document.createElement('div');
    this.hostPanel.id = 'hostPanel';
    document.body.appendChild(this.hostPanel);
    this.hostPanel.addEventListener('click', e => {
      if (e.target.closest('.hnext')) this._showHostLine();
    });

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'stoneToast';
    document.body.appendChild(this.toastEl);
  }

  _toggleDraw() {
    const open = this.drawPanel.classList.toggle('open');
    this.toggleBtn.classList.toggle('active', open);
    if (open) this._renderDraw();
  }

  _renderBadge() {
    const left = this._guessesLeft();
    this.badgeEl.textContent = this.state?.won_today ? '\u2726' : String(left);
  }

  _guessesLeft() {
    if (this.state?.won_today) return 0;
    return Math.max(0, 2 - (this.state?.guesses_used ?? 0));
  }

  /** Hours until the circle draws a new order (UTC midnight). */
  _hoursToReset() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.max(0, (next - now.getTime()) / 3600000);
  }

  _renderDraw() {
    const left = this._guessesLeft();
    const h = this._hoursToReset();
    const resetIn = h < 1 ? 'within the hour' : `in about ${Math.round(h)} hours`;
    const wins = this.state?.wins_total ?? 0;
    this.drawPanel.innerHTML = `
      <h2>THE DAILY DRAW</h2>
      <div class="sub">The circle chooses a new order each day</div>
      ${this.state?.won_today
        ? '<div class="solved">\u2726 WON TODAY \u2726</div>'
        : `<div class="clue">You have <strong>${left}</strong> ${left === 1 ? 'guess' : 'guesses'} left today.
             <span class="src">A new order is drawn ${resetIn}.</span></div>`}
      <div class="clue">Six stones, six sockets — seven hundred and twenty ways to
        arrange them. Two guesses a day.
        <span class="src">No one has ever claimed the odds were kind.</span></div>
      ${this.state?.title
        ? `<div class="clue">You are known as <strong>${this.state.title}</strong>.
             <span class="src">${wins} ${wins === 1 ? 'win' : 'wins'} at the circle.</span></div>`
        : '<div class="unfound">No title yet. The stones award one to those who guess true.</div>'}
      ${this.state?.library_access && !this.state?.has_signed
        ? '<div class="clue">The library\u2019s inner door is open to you — and the Book waits unsigned.</div>'
        : ''}`;
  }

  _renderBar() {
    const order = new Array(6).fill(null);
    for (const [sym, s] of this.stones) if (s.slot !== null) order[s.slot] = sym;
    const slots = order.map((sym, i) => `
      <div class="slot ${sym ? 'filled' : ''}">
        <span class="n">${i + 1}</span>
        <span class="s">${sym ? sym.charAt(0).toUpperCase() + sym.slice(1) : '—'}</span>
      </div>`).join('');
    const full = order.every(Boolean);
    this.bar.innerHTML = `
      <div class="shead"><span class="stitle">The Stone Circle</span>
        <button class="sclose" data-act="close">✕</button></div>
      <div class="seq">${slots}</div>
      <div class="hint">Click a stone, lift it, and drag it into a socket.
        Socket one wakes first.</div>
      <div class="row">
        <button class="act" data-act="clear">Clear the ring</button>
        <button class="act" data-act="submit" ${full ? '' : 'disabled'}>Wake the circle</button>
      </div>`;
  }

  _toast(msg, ms = 4000) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
