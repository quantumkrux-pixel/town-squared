// ============================================================
// MapView.js — the town map, drawn from data.
//
// Not a render of the 3D scene: a stylized 2D canvas built from
// the same world data everything else uses — ground bounds, roads,
// the water (with its real jagged coastline curve), sand, every
// placement, plus LIVE markers: you (gold arrow), NPCs, other
// players, visible chests, the active task objective, and the
// magick cave — but only while it manifests to YOU (the map is no
// sharper than your eyes).
//
// TAP THE MAP TO TRAVEL: converts back to world coords and sets
// your move target, then closes.
//
// Marker colors: heuristics by asset name, overridable per asset
// with `mapColor: '#hex'` in ASSET_DEFS.
// Toggle: 🗺 button or M.
// ============================================================

const CSS = `
  #mapToggle {
    position: fixed; right: 18px; top: max(74px, calc(env(safe-area-inset-top) + 64px));
    width: 44px; height: 44px; border-radius: 10px;
    background: rgba(20,16,12,0.72); color: #c9a24b;
    border: 1px solid rgba(201,162,75,0.35);
    font-size: 19px; cursor: pointer; z-index: 20;
  }
  #mapToggle.active { background: #c9a24b; color: #1a1512; }
  #mapPanel {
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: min(580px, calc(100vw - 24px));
    display: none; flex-direction: column; gap: 8px;
    background: linear-gradient(160deg, rgba(42,33,24,0.97), rgba(26,20,14,0.97));
    border: 2px solid rgba(201,162,75,0.55); border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    padding: 12px; z-index: 18;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #mapPanel.open { display: flex; }
  #mapPanel .maphead { display: flex; align-items: baseline; color: #e9ddc2; }
  #mapPanel .maptitle {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 15px;
    color: #c9a24b; letter-spacing: 0.08em;
  }
  #mapPanel .maphint { font-size: 11px; opacity: 0.6; margin-left: 10px; }
  #mapPanel .mapclose {
    margin-left: auto; background: none; border: none; color: #e9ddc2;
    font-size: 18px; cursor: pointer; opacity: 0.7;
  }
  #mapCanvas { width: 100%; border-radius: 8px; display: block; cursor: crosshair; }
`;

export class MapView {
  constructor({ world, registry, player, remotes, mirage, tasks }) {
    this.world = world;
    this.registry = registry;
    this.player = player;
    this.remotes = remotes;
    this.mirage = mirage;
    this.tasks = tasks;
    this.open = false;
    this._buildUI();
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'mapToggle';
    this.toggleBtn.textContent = '🗺';
    this.toggleBtn.title = 'Map (M)';
    document.body.appendChild(this.toggleBtn);
    this.toggleBtn.addEventListener('click', () => this.setOpen(!this.open));
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'KeyM') this.setOpen(!this.open);
      if (e.code === 'Escape' && this.open) this.setOpen(false);
    });

    this.panel = document.createElement('div');
    this.panel.id = 'mapPanel';
    this.panel.innerHTML = `
      <div class="maphead">
        <span class="maptitle">${this.world.data?.name ?? 'THE TOWN'}</span>
        <span class="maphint">tap anywhere to travel there</span>
        <button class="mapclose">✕</button>
      </div>
      <canvas id="mapCanvas"></canvas>`;
    document.body.appendChild(this.panel);
    this.canvas = this.panel.querySelector('#mapCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.panel.querySelector('.mapclose').addEventListener('click', () => this.setOpen(false));

    // tap to travel
    this.canvas.addEventListener('click', e => {
      const r = this.canvas.getBoundingClientRect();
      const wpt = this._toWorld(
        (e.clientX - r.left) * (this.canvas.width / r.width),
        (e.clientY - r.top) * (this.canvas.height / r.height)
      );
      if (!wpt) return;
      this.player.setMoveTarget(new (this.player.pos.constructor)(wpt.x, 0, wpt.z));
      this.setOpen(false);
    });
  }

  setOpen(on) {
    this.open = on;
    this.panel.classList.toggle('open', on);
    this.toggleBtn.classList.toggle('active', on);
    if (on) this._resize();
  }

  _resize() {
    const b = this.world.bounds;
    const worldW = b.maxX - b.minX, worldH = b.maxZ - b.minZ;
    const cssW = Math.min(556, window.innerWidth - 48);
    const cssH = cssW * (worldH / worldW);
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
    this._pad = 6 * dpr;
    this._scale = (this.canvas.width - this._pad * 2) / worldW;
  }

  _toCanvas(x, z) {
    const b = this.world.bounds;
    return [
      this._pad + (x - b.minX) * this._scale,
      this._pad + (z - b.minZ) * this._scale,
    ];
  }
  _toWorld(cx, cz) {
    const b = this.world.bounds;
    const x = b.minX + (cx - this._pad) / this._scale;
    const z = b.minZ + (cz - this._pad) / this._scale;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return null;
    return { x, z };
  }

  _colorFor(assetId) {
    const def = this.registry.defs[assetId];
    if (def?.mapColor) return def.mapColor;
    if (/tree|bush|rose/.test(assetId)) return '#4f7a45';
    if (/rock/.test(assetId)) return '#8a8f94';
    if (/lamp/.test(assetId)) return '#e0b45c';
    if (/chest/.test(assetId)) return '#e6c35a';
    if (/fire/.test(assetId)) return '#e07a3c';
    if (/stall/.test(assetId)) return '#b3543f';
    return '#6e4f33'; // buildings, walls, fences, misc
  }

  /** Redraw — call each frame while open. */
  draw(nowMs) {
    if (!this.open) return;
    const ctx = this.ctx, b = this.world.bounds;
    const W = this.canvas.width, H = this.canvas.height;

    // parchment + ground
    ctx.fillStyle = '#2a2118';
    ctx.fillRect(0, 0, W, H);
    const [gx, gz] = this._toCanvas(b.minX, b.minZ);
    const [gx2, gz2] = this._toCanvas(b.maxX, b.maxZ);
    ctx.fillStyle = '#5c6e46';
    ctx.fillRect(gx, gz, gx2 - gx, gz2 - gz);

    this._drawWater(ctx);
    this._drawRoads(ctx);
    this._drawPlacements(ctx);
    this._drawLive(ctx, nowMs);
  }

  _drawWater(ctx) {
    const w = this.world.water;
    if (!w) return;
    const b = this.world.bounds;
    const ew = w.side === 'east' || w.side === 'west';
    const aMin = ew ? b.minZ : b.minX, aMax = ew ? b.maxZ : b.maxX;

    const shorePts = [];
    for (let s = aMin; s <= aMax; s += 2) {
      shorePts.push([s, w.shore + this.world._coastJag(s)]);
    }
    const edgeCoord = (w.side === 'east') ? b.maxX : (w.side === 'west') ? b.minX
      : (w.side === 'south') ? b.maxZ : b.minZ;

    const toXY = (along, across) => {
      const signed = (w.side === 'west' || w.side === 'north') ? -across : across;
      return ew ? this._toCanvas(signed, along) : this._toCanvas(along, signed);
    };

    // sand band then water polygon
    for (const [fill, offset] of [['#cdb684', -(this.world.data.water.sand?.width ?? 0)], ['#3d6e8f', 0]]) {
      if (fill === '#cdb684' && !this.world.data.water.sand) continue;
      ctx.beginPath();
      shorePts.forEach(([s, sh], i) => {
        const [x, y] = toXY(s, sh + offset);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      const [ex1, ey1] = toXY(aMax, Math.abs(edgeCoord) + 5);
      const [ex2, ey2] = toXY(aMin, Math.abs(edgeCoord) + 5);
      ctx.lineTo(ex1, ey1); ctx.lineTo(ex2, ey2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }

  _drawRoads(ctx) {
    ctx.strokeStyle = '#a08a68';
    ctx.lineCap = 'round';
    for (const r of this.world.data.roads ?? []) {
      const [x1, y1] = this._toCanvas(r.from[0], r.from[1]);
      const [x2, y2] = this._toCanvas(r.to[0], r.to[1]);
      ctx.lineWidth = Math.max(2, r.width * this._scale);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  _drawPlacements(ctx) {
    for (const rec of this.world.placed) {
      if (rec.obj && !rec.obj.visible) continue; // despawned chests stay secret
      const { asset, x, z, rotY, scale } = rec.data;
      const def = this.registry.defs[asset];
      const size = Math.max(3, (def?.footprint ?? 1.5) * (scale ?? 1) * this._scale * 0.7);
      const [cx, cz] = this._toCanvas(x, z);
      ctx.fillStyle = this._colorFor(asset);
      if (/tree|bush|rose|rock|lamp|crate|fire/.test(asset)) {
        ctx.beginPath(); ctx.arc(cx, cz, size / 2.6, 0, Math.PI * 2); ctx.fill();
      } else if (/chest/.test(asset)) {
        ctx.save(); ctx.translate(cx, cz); ctx.rotate(Math.PI / 4);
        ctx.fillRect(-size / 3, -size / 3, size / 1.5, size / 1.5);
        ctx.restore();
      } else {
        ctx.save(); ctx.translate(cx, cz); ctx.rotate(-(rotY ?? 0));
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }
  }

  _drawLive(ctx, nowMs) {
    const dot = (x, z, r, color) => {
      const [cx, cz] = this._toCanvas(x, z);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cz, r, 0, Math.PI * 2); ctx.fill();
    };

    // task objective
    const marker = this.tasks?.marker;
    if (marker?.visible) {
      const [cx, cz] = this._toCanvas(marker.position.x, marker.position.z);
      ctx.strokeStyle = '#c9a24b'; ctx.lineWidth = 2;
      const pulse = 6 + Math.sin(nowMs / 250) * 2;
      ctx.beginPath(); ctx.arc(cx, cz, pulse, 0, Math.PI * 2); ctx.stroke();
    }

    // NPCs
    for (const npc of this.world.npcs) dot(npc.mesh.position.x, npc.mesh.position.z, 4, '#7fae6a');

    // other players
    for (const [, peer] of this.remotes?.peers ?? []) {
      if (peer.mesh) dot(peer.mesh.position.x, peer.mesh.position.z, 4.5, '#e0824a');
    }

    // the mirage — only if it currently manifests to you
    if (this.mirage?.isVisible) {
      const p = this.mirage.position;
      const [cx, cz] = this._toCanvas(p.x, p.z);
      ctx.fillStyle = '#a88cff';
      ctx.save(); ctx.translate(cx, cz);
      ctx.rotate(nowMs / 800);
      for (let i = 0; i < 4; i++) { ctx.fillRect(-1.5, -7, 3, 14); ctx.rotate(Math.PI / 4); }
      ctx.restore();
    }

    // you: gold arrow showing heading. World heading h moves along
    // (sin h, cos h) in (x, z); canvas x→right, z→down, so the canvas
    // angle of that vector is atan2(cos h, sin h).
    const p = this.player.pos, h = this.player.heading;
    const [cx, cz] = this._toCanvas(p.x, p.z);
    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate(Math.atan2(Math.cos(h), Math.sin(h)));
    ctx.fillStyle = '#f5d778';
    ctx.strokeStyle = '#1a1512'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
