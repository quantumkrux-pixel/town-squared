// ============================================================
// Editor.js — in-game admin panel for editing the town.
//
// Toggle with the wrench button (bottom-right) or the ` backtick key.
// While active:
//   • Pick an asset in the palette, then tap the ground to place it
//     (stays armed — tap repeatedly to paint trees, Esc to disarm)
//   • Tap any placed object to select it; drag it to move it
//   • Rotate / scale / duplicate / delete via the panel
//   • Export downloads the current world as town.json + copies it
//     to the clipboard — drop it over data/town.json and it's saved
//
// Persistence upgrade path: replace exportJSON() with an upsert to a
// Supabase `placements` table (RLS: only your admin role can write),
// and have World subscribe to that table so edits appear live for
// every player. This class doesn't need to change for that — only
// where serialize() gets sent.
//
// NOTE: this scaffold shows the wrench to everyone. Before going
// public, gate `new Editor(...)` behind a Supabase auth check.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const PANEL_CSS = `
  #editorToggle {
    position: fixed; right: 12px; bottom: max(12px, env(safe-area-inset-bottom));
    width: 44px; height: 44px; border-radius: 10px;
    background: rgba(20,16,12,0.72); color: #c9a24b;
    border: 1px solid rgba(201,162,75,0.35);
    font-size: 20px; cursor: pointer; z-index: 20;
    backdrop-filter: blur(6px);
  }
  #editorToggle.active { background: #c9a24b; color: #1a1512; }
  #editorPanel {
    position: fixed; right: 12px; bottom: 66px;
    width: 232px; max-height: min(70vh, 520px);
    display: none; flex-direction: column; gap: 10px;
    background: rgba(20,16,12,0.85); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.35); border-radius: 10px;
    padding: 12px; z-index: 20;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12.5px;
    backdrop-filter: blur(8px);
    overflow-y: auto;
  }
  #editorPanel.open { display: flex; }
  #editorPanel h2 {
    font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: #c9a24b; margin: 0;
    display: inline;
  }
  #editorPanel details { display: flex; flex-direction: column; gap: 8px; }
  #editorPanel summary { cursor: pointer; list-style-position: inside; margin-bottom: 6px; }
  #editorPanel .model-row { align-items: center; }
  #editorPanel .model-name { flex: 1; text-transform: capitalize; }
  #editorPanel .model-row button { flex: 0 0 auto; padding: 4px 10px; }
  #editorPanel .glb { color: #6fbf6a; font-size: 10px; }
  #editorPanel .rot-slider {
    width: 100%; accent-color: #c9a24b; cursor: pointer;
    touch-action: none;
  }
  #editorPanel .palette {
    display: grid; grid-template-columns: 1fr 1fr; gap: 5px;
  }
  #editorPanel button {
    background: rgba(233,221,194,0.08); color: #e9ddc2;
    border: 1px solid rgba(233,221,194,0.18); border-radius: 6px;
    padding: 6px 4px; font-size: 11.5px; cursor: pointer;
  }
  #editorPanel button:active { background: rgba(201,162,75,0.3); }
  #editorPanel button.armed { background: #c9a24b; color: #1a1512; border-color: #c9a24b; }
  #editorPanel .row { display: flex; gap: 5px; }
  #editorPanel .row button { flex: 1; }
  #editorPanel .sel-name { font-weight: 600; color: #f0c9a0; }
  #editorPanel .danger { border-color: rgba(200,90,80,0.5); color: #e8a49c; }
  #editorPanel label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  #editorPanel .muted { opacity: 0.6; font-size: 11px; line-height: 1.4; }
  @media (max-width: 480px) {
    #editorPanel { left: 12px; width: auto; max-height: 46vh; }
    #editorPanel .palette { grid-template-columns: 1fr 1fr 1fr; }
  }
`;

export class Editor {
  constructor({ world, registry, camera, rig, canvas }) {
    this.world = world;
    this.registry = registry;
    this.camera = camera;
    this.rig = rig;
    this.canvas = canvas;

    this.active = false;
    this.armedAsset = null;   // asset id ready to place
    this.selected = null;     // placement record (or a book record — see setBibliofolio)
    this.bibliofolio = null;  // set via setBibliofolio(); lets books be arranged here too
    this.snap = true;
    this._dragRec = null;
    this._modelMap = {};      // assetId -> exported path (for models.json)
    this._pendingSwapId = null;
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    this._buildHighlight();
    this._buildUI();
    this._bind();
  }

  // ---------------- UI ----------------
  /** Called once from main.js after both exist — lets books be picked,
   *  dragged, and exported through the same editor session. */
  setBibliofolio(biblio) {
    this.bibliofolio = biblio;
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'editorToggle';
    this.toggleBtn.textContent = '🔧';
    this.toggleBtn.title = 'Toggle town editor (`)';
    document.body.appendChild(this.toggleBtn);

    this.panel = document.createElement('div');
    this.panel.id = 'editorPanel';
    document.body.appendChild(this.panel);

    // hidden file input for model swapping
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.glb,.gltf';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', () => this._onModelFile());

    this._renderPanel();
  }

  _renderPanel() {
    const allIds = Object.keys(this.registry.defs);
    // Managed elsewhere: the cave by Mirage.js, books by Bibliofolio.js
    // (see the Books section below). Placing loose copies here would
    // orphan them from the actual lore/mirage data.
    const SYSTEM_MANAGED = new Set(['magick_cave', 'book_pickup']);
    const placeIds = allIds.filter(id => !id.startsWith('char_') && !SYSTEM_MANAGED.has(id));
    const sel = this.selected;

    this.panel.innerHTML = `
      <details open>
        <summary><h2>Place</h2></summary>
        <div class="palette">
          ${placeIds.map(id => `<button data-place="${id}" class="${this.armedAsset === id ? 'armed' : ''}">${id.replace(/_/g, ' ')}</button>`).join('')}
        </div>
        ${this.armedAsset ? `<div class="muted">Tap the ground to place <b>${this.armedAsset}</b>. Esc to stop.</div>` : ''}
      </details>

      <details>
        <summary><h2>Models</h2></summary>
        <div class="muted">Swap any asset for your own .glb — updates every instance live.</div>
        ${allIds.map(id => `
          <div class="row model-row">
            <span class="model-name">${id.replace(/_/g, ' ')}${this.registry.usesModel(id) ? ' <b class="glb">GLB</b>' : ''}</span>
            <button data-swap="${id}">swap</button>
            ${this.registry.usesModel(id) ? `<button data-revert="${id}">✕</button>` : ''}
          </div>`).join('')}
        <button data-act="exportModels">⬇ Export models.json</button>
        <div class="muted">Copy your .glb files into <code>assets/models/</code>, save the export as <code>data/models.json</code>, and they load automatically. Player/remote characters apply after that reload.</div>
      </details>

      <details ${sel ? 'open' : ''}>
        <summary><h2>Selected</h2></summary>
        ${sel && sel.isBook ? `
          <div class="sel-name">📖 ${sel.data.title}</div>
          <div class="muted">${sel.data.author ?? ''}</div>
          <div class="muted">Drag on the map to reposition. Books only move — export below saves it with the rest of the library.</div>
        ` : sel ? `
          <div class="sel-name">${sel.data.asset.replace(/_/g, ' ')}</div>
          <div class="muted">drag it on the map to move</div>
          <div class="row">
            <button data-act="rotl">⟲ 15°</button>
            <button data-act="rotl1">⟲ 1°</button>
            <button data-act="rotr1">⟳ 1°</button>
            <button data-act="rotr">⟳ 15°</button>
          </div>
          <input type="range" data-rot min="0" max="360" step="0.5"
                 value="${this._rotDeg(sel)}" class="rot-slider">
          <div class="muted rot-readout">rotation: ${this._rotDeg(sel)}°</div>
          <div class="row">
            <button data-act="shrink">scale −</button>
            <button data-act="grow">scale +</button>
          </div>
          <div class="row">
            <button data-act="lower">▼ height</button>
            <button data-act="raise">▲ height</button>
          </div>
          <div class="muted">height: ${(sel.data.y ?? 0).toFixed(2)}m</div>
          <div class="row">
            <button data-act="dup">duplicate</button>
            <button data-act="del" class="danger">delete</button>
          </div>
        ` : `<div class="muted">Tap an object or book to select it.</div>`}
      </details>

      <details>
        <summary><h2>Books</h2></summary>
        <div class="muted">All ${this.bibliofolio?.books.length ?? 0} volumes are visible and draggable while the editor is open — collected ones show a faint gold ring so you can tell them apart while arranging.</div>
        <button data-act="exportBooks">⬇ Export books.json</button>
        <div class="muted">Save over <code>data/books.json</code> to persist.</div>
      </details>

      <details open>
        <summary><h2>World</h2></summary>
        <label><input type="checkbox" data-act="snap" ${this.snap ? 'checked' : ''}> snap to 0.5m grid</label>
        <button data-act="export">⬇ Export town.json</button>
        <div class="muted">Save the file over <code>data/town.json</code> to persist. (Also copied to clipboard.)</div>
      </details>
    `;
  }

  // ---------------- model swapping ----------------
  _onModelFile() {
    const file = this.fileInput.files?.[0];
    const id = this._pendingSwapId;
    this.fileInput.value = '';
    if (!file || !id) return;

    const blobUrl = URL.createObjectURL(file);
    this.registry.setUrl(id, blobUrl);
    // Record the path this file SHOULD live at, for the export.
    this._modelMap[id] = 'assets/models/' + file.name;
    this.world.reloadAsset(id).then(() => this._renderPanel());
  }

  _revertModel(id) {
    this.registry.setUrl(id, null);
    delete this._modelMap[id];
    this.world.reloadAsset(id).then(() => this._renderPanel());
  }

  _exportModels() {
    // Prefer recorded assets/models/ paths; keep any non-blob URLs already set.
    const out = { ...this._modelMap };
    for (const [id, def] of Object.entries(this.registry.defs)) {
      if (def.url && !def.url.startsWith('blob:') && !out[id]) out[id] = def.url;
    }
    this._download(JSON.stringify(out, null, 2), 'models.json');
  }

  _download(text, filename) {
    navigator.clipboard?.writeText(text).catch(() => {});
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  _buildHighlight() {
    this.highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.0, 28),
      new THREE.MeshBasicMaterial({ color: 0xc9a24b, transparent: true, opacity: 0.85, depthWrite: false })
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.position.y = 0.05;
    this.highlight.visible = false;
    this.world.scene.add(this.highlight);
  }

  _updateHighlight() {
    if (!this.selected) { this.highlight.visible = false; return; }
    const { data } = this.selected;
    if (this.selected.isBook) {
      this.highlight.scale.setScalar(0.5);
      this.highlight.position.set(data.x, 0.05, data.z);
      this.highlight.visible = true;
      return;
    }
    const r = (this.registry.colliderRadius(data.asset) ?? this.registry.defs[data.asset]?.footprint / 2 ?? 1) * (data.scale ?? 1);
    this.highlight.scale.setScalar(Math.max(0.6, r + 0.3));
    this.highlight.position.set(data.x, 0.05, data.z);
    this.highlight.visible = true;
  }

  // ---------------- events ----------------
  _bind() {
    this.toggleBtn.addEventListener('click', () => this.setActive(!this.active));
    window.addEventListener('keydown', e => {
      if (e.code === 'Backquote') this.setActive(!this.active);
      if (!this.active) return;
      if (e.code === 'Escape') { this.armedAsset = null; this._select(null); this._renderPanel(); }
      if (e.code === 'Delete' || e.code === 'Backspace') this._doAction('del');
      if (e.code === 'KeyR') this._doAction(e.shiftKey ? 'rotl' : 'rotr');
    });

    this.panel.addEventListener('click', e => {
      const t = e.target.closest('[data-place],[data-act],[data-swap],[data-revert]');
      if (!t) return;
      if (t.dataset.place) {
        this.armedAsset = this.armedAsset === t.dataset.place ? null : t.dataset.place;
        this._select(null);
        this._renderPanel();
      } else if (t.dataset.swap) {
        this._pendingSwapId = t.dataset.swap;
        this.fileInput.click();
      } else if (t.dataset.revert) {
        this._revertModel(t.dataset.revert);
      } else if (t.dataset.act) {
        this._doAction(t.dataset.act, t);
      }
    });

    // Rotation slider: update live during drag WITHOUT re-rendering the
    // panel (a re-render would destroy the slider mid-gesture).
    this.panel.addEventListener('input', e => {
      if (!e.target.matches('[data-rot]') || !this.selected) return;
      this.selected.data.rotY = THREE.MathUtils.degToRad(+e.target.value);
      this.world.applyTransform(this.selected);
      const readout = this.panel.querySelector('.rot-readout');
      if (readout) readout.textContent = `rotation: ${(+e.target.value).toFixed(1)}°`;
    });

    // Drag-to-move selected/hit objects. Pointer events cover mouse + touch.
    this.canvas.addEventListener('pointerdown', e => {
      if (!this.active || this.armedAsset) return;
      const rec = this._pickObject(e.clientX, e.clientY);
      if (rec) {
        this._select(rec);
        this._dragRec = rec;
        this.rig.cancelDrag();          // this gesture moves the object, not the camera
        this._renderPanel();
      }
    });
    window.addEventListener('pointermove', e => {
      if (!this._dragRec) return;
      const p = this._groundPoint(e.clientX, e.clientY);
      if (!p) return;
      this._dragRec.data.x = this._snapV(p.x);
      this._dragRec.data.z = this._snapV(p.z);
      if (this._dragRec.isBook) this.bibliofolio.applyTransform(this._dragRec);
      else this.world.applyTransform(this._dragRec);
      this._updateHighlight();
    });
    window.addEventListener('pointerup', () => {
      if (this._dragRec) {
        if (!this._dragRec.isBook) this.world.refreshColliders();
        this._dragRec = null;
      }
    });
  }

  /** main.js calls this from its click/tap handler. Returns true if consumed. */
  handleTap(clientX, clientY) {
    if (!this.active) return false;

    if (this.armedAsset) {
      const p = this._groundPoint(clientX, clientY);
      if (p) this._place(this.armedAsset, p);
      return true;
    }
    // selection happens on pointerdown; a tap on empty ground deselects
    if (!this._pickObject(clientX, clientY)) {
      this._select(null);
      this._renderPanel();
    }
    return true; // editor mode swallows all taps (walking pauses while editing)
  }

  async _place(assetId, point) {
    const data = {
      asset: assetId,
      x: this._snapV(point.x),
      z: this._snapV(point.z),
      rotY: 0,
    };
    const rec = await this.world.addPlacement(data);
    this._select(rec);
    this._renderPanel();
  }

  /** Selected object's rotation as display degrees (0–360, counter-clockwise). */
  _rotDeg(rec) {
    const deg = THREE.MathUtils.radToDeg(rec.data.rotY ?? 0);
    return +((deg % 360 + 360) % 360).toFixed(1);
  }

  _rotateBy(deg) {
    const rec = this.selected;
    if (!rec) return;
    rec.data.rotY = (rec.data.rotY ?? 0) + THREE.MathUtils.degToRad(deg);
    this.world.applyTransform(rec);
    this._renderPanel(); // keeps the slider + readout in sync
  }

  _doAction(act, target) {
    const rec = this.selected;
    // Books only support moving + exporting — no rotate/scale/height/dup/del.
    if (rec?.isBook && !['export', 'exportBooks', 'snap'].includes(act)) return;
    switch (act) {
      case 'rotl':  this._rotateBy(15);  break;
      case 'rotr':  this._rotateBy(-15); break;
      case 'rotl1': this._rotateBy(1);   break;
      case 'rotr1': this._rotateBy(-1);  break;
      case 'grow':   if (rec) { rec.data.scale = +( (rec.data.scale ?? 1) * 1.1 ).toFixed(3); this.world.applyTransform(rec); this.world.refreshColliders(); this._updateHighlight(); } break;
      case 'shrink': if (rec) { rec.data.scale = +( (rec.data.scale ?? 1) / 1.1 ).toFixed(3); this.world.applyTransform(rec); this.world.refreshColliders(); this._updateHighlight(); } break;
      case 'raise': if (rec) { rec.data.y = +(((rec.data.y ?? 0) + 0.1).toFixed(2)); this.world.applyTransform(rec); this._renderPanel(); } break;
      case 'lower': if (rec) { rec.data.y = +(((rec.data.y ?? 0) - 0.1).toFixed(2)); this.world.applyTransform(rec); this._renderPanel(); } break;
      case 'dup':
        if (rec) {
          const src = { ...rec.data };
          this.world.addPlacement({ ...src, x: this._snapV(src.x + 1.5), z: this._snapV(src.z + 1.5) })
            .then(newRec => { this._select(newRec); this._renderPanel(); });
        }
        break;
      case 'del':
        if (rec) {
          this.world.removePlacement(rec);
          this._select(null);
          this._renderPanel();
        }
        break;
      case 'snap':
        this.snap = target.checked;
        break;
      case 'export':
        this._download(JSON.stringify(this.world.serialize(), null, 2), 'town.json');
        break;
      case 'exportModels':
        this._exportModels();
        break;
      case 'exportBooks':
        this._download(JSON.stringify(this.bibliofolio?.serializeBooks() ?? [], null, 2), 'books.json');
        break;
    }
  }

  // ---------------- picking ----------------
  _setPointer(clientX, clientY) {
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
  }

  _pickObject(clientX, clientY) {
    this._setPointer(clientX, clientY);
    const visible = this.world.pickables.filter(o => o.visible);
    const hit = this._raycaster.intersectObjects(visible, true)[0];
    if (hit) return this.world.recordFor(hit.object, hit.instanceId);

    const bookPickables = this.bibliofolio?.editPickables() ?? [];
    if (bookPickables.length) {
      const bhit = this._raycaster.intersectObjects(bookPickables, true)[0];
      if (bhit) return this.bibliofolio.recordForEdit(bhit.object);
    }
    return null;
  }

  _groundPoint(clientX, clientY) {
    this._setPointer(clientX, clientY);
    const hit = this._raycaster.intersectObject(this.world.groundMesh, false)[0];
    return hit ? hit.point : null;
  }

  _snapV(v) {
    return this.snap ? Math.round(v * 2) / 2 : +v.toFixed(2);
  }

  _select(rec) {
    this.selected = rec;
    this._updateHighlight();
  }

  setActive(on) {
    this.active = on;
    this.toggleBtn.classList.toggle('active', on);
    this.panel.classList.toggle('open', on);
    this.bibliofolio?.setEditMode(on);
    if (!on) {
      this.armedAsset = null;
      this._select(null);
      this._dragRec = null;
    }
    this._renderPanel();
  }
}
