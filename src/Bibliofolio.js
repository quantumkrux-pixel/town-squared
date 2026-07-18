// ============================================================
// Bibliofolio.js — the scattered library of Emberhollow.
//
// Lore books (data/books.json) are placed across the map as small
// floating volumes. Find one, walk to it, and it opens: the lore
// is read, +50 Intellect on first discovery, and the book joins
// your Bibliofolio — the collection panel (📚, or B) where found
// books can be re-read and unfound ones show only a hint.
//
// Collected books stop appearing in your world (per-player).
// Positions, titles, hints, and text are all data — add a book by
// adding an entry to books.json, nothing else.
//
// Persistence: localStorage; Supabase seam = profiles.books jsonb.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const STORAGE_KEY = 'townsquared.books.v1';
const DISCOVERY_XP = 50;

const CSS = `
  #biblioToggle {
    position: fixed; left: 12px; top: max(128px, calc(env(safe-area-inset-top) + 118px));
    width: 44px; height: 44px; border-radius: 10px;
    background: rgba(20,16,12,0.72); color: #c9a24b;
    border: 1px solid rgba(201,162,75,0.35);
    font-size: 19px; cursor: pointer; z-index: 20;
  }
  #biblioToggle.active { background: #c9a24b; color: #1a1512; }
  #biblioPanel {
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, -52%);
    width: min(360px, calc(100vw - 28px));
    max-height: 76vh; overflow-y: auto;
    display: none; flex-direction: column; gap: 8px;
    background: linear-gradient(160deg, rgba(42,33,24,0.97), rgba(26,20,14,0.97));
    border: 2px solid rgba(201,162,75,0.55); border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    padding: 16px; z-index: 19; color: #e9ddc2;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12.5px;
  }
  #biblioPanel.open { display: flex; }
  #biblioPanel h2 {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 17px;
    color: #c9a24b; letter-spacing: 0.08em; text-align: center; margin: 0;
  }
  #biblioPanel .progress { text-align: center; font-size: 11px; opacity: 0.65; margin-bottom: 6px; }
  #biblioPanel .book {
    display: flex; align-items: center; gap: 10px;
    background: rgba(233,221,194,0.06); border-radius: 9px;
    border-left: 3px solid rgba(201,162,75,0.5);
    padding: 9px 12px; cursor: pointer;
  }
  #biblioPanel .book.unfound { border-left-color: rgba(233,221,194,0.15); cursor: default; opacity: 0.7; }
  #biblioPanel .book .btitle { font-weight: 600; }
  #biblioPanel .book.unfound .btitle { font-style: italic; opacity: 0.6; }
  #biblioPanel .book .bhint { font-size: 11px; opacity: 0.55; font-style: italic; }
  #biblioReader {
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: min(400px, calc(100vw - 28px));
    max-height: 80vh; overflow-y: auto;
    display: none; flex-direction: column; gap: 10px;
    background: linear-gradient(165deg, #efe4c8, #ddcda6);
    color: #3a2e1e;
    border: 2px solid rgba(122, 92, 40, 0.7); border-radius: 8px;
    box-shadow: 0 16px 50px rgba(0,0,0,0.6);
    padding: 26px 26px 22px; z-index: 21;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 14px; line-height: 1.65;
  }
  #biblioReader.open { display: flex; }
  #biblioReader .rtitle {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 19px;
    color: #6b4d1c; text-align: center;
  }
  #biblioReader .rauthor { text-align: center; font-style: italic; font-size: 12.5px; opacity: 0.75; margin-top: -4px; }
  #biblioReader .rnew {
    text-align: center; font-family: 'Cinzel', serif; font-size: 11px;
    letter-spacing: 0.15em; color: #8a6420;
  }
  #biblioReader hr { border: none; border-top: 1px solid rgba(107, 77, 28, 0.35); margin: 4px 0; }
  #biblioReader button {
    align-self: center; margin-top: 8px;
    background: #6b4d1c; color: #efe4c8; border: none; border-radius: 8px;
    padding: 9px 26px; font-family: 'Cinzel', serif; font-weight: 700;
    letter-spacing: 0.08em; font-size: 13px; cursor: pointer;
  }
`;

export class Bibliofolio {
  constructor({ world, registry, skills }) {
    this.world = world;
    this.registry = registry;
    this.skills = skills;
    this.books = [];
    this.collected = this._load();      // Set of ids
    this.spawned = new Map();           // id -> mesh (uncollected, live pickups)
    this._editOnly = new Map();         // id -> mesh (collected, editor-arrange-only)
    this._phase = new Map();            // id -> stable float phase (book index, not Map order)
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._cam = null;
    this.open = false;
    this._buildUI();
  }

  setCamera(cam) { this._cam = cam; }

  async init() {
    try {
      const res = await fetch('data/books.json');
      if (res.ok) this.books = await res.json();
    } catch { /* no books — the library stays a rumor */ }

    this._phase = new Map(this.books.map((b, i) => [b.id, i]));

    for (const book of this.books) {
      if (this.collected.has(book.id)) continue;
      const mesh = await this.registry.instance('book_pickup');
      mesh.position.set(book.x, 0, book.z);
      mesh.userData.bookId = book.id;
      this.world.scene.add(mesh);
      this.spawned.set(book.id, mesh);
    }
  }

  /** Gentle float + slow turn — makes them catch the eye. Phase is keyed
   *  to each book's fixed index, not Map insertion order, so a marker's
   *  bob doesn't jump when it's added/removed from editor-mode. */
  update(nowMs) {
    for (const [id, mesh] of this.spawned) this._float(mesh, nowMs, this._phase.get(id) ?? 0);
    for (const [id, mesh] of this._editOnly) this._float(mesh, nowMs, this._phase.get(id) ?? 0);
  }
  _float(mesh, nowMs, i) {
    mesh.position.y = 0.5 + Math.sin(nowMs / 700 + i * 1.7) * 0.12;
    mesh.rotation.y = nowMs / 2400 + i;
  }

  // ---------------- editor mode: arrange ALL books (found or not) ----------------
  /** Editor.js calls this when it opens/closes. Collected books have no
   *  live pickup mesh in play mode, so we spawn arrange-only markers for
   *  them here — ringed, so they read as "already found" while dragging. */
  async setEditMode(on) {
    if (on) {
      for (const book of this.books) {
        if (!this.collected.has(book.id) || this._editOnly.has(book.id)) continue;
        const mesh = await this.registry.instance('book_pickup');
        mesh.position.set(book.x, 0.5, book.z);
        mesh.userData.bookId = book.id;
        this._addFoundRing(mesh);
        this.world.scene.add(mesh);
        this._editOnly.set(book.id, mesh);
      }
    } else {
      for (const mesh of this._editOnly.values()) this.world.scene.remove(mesh);
      this._editOnly.clear();
    }
  }

  _addFoundRing(mesh) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.38, 20),
      new THREE.MeshBasicMaterial({ color: 0xc9a24b, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.42; // sits near ground under the floating book
    mesh.add(ring);
  }

  /** All currently-visible markers (uncollected + edit-only), for the
   *  editor's raycaster while it's active. */
  editPickables() {
    return [...this.spawned.values(), ...this._editOnly.values()];
  }

  /** Editor-facing pick result: same {isBook, data, obj} shape World uses
   *  for placements, so Editor's generic drag code needs almost no
   *  book-specific branching. `data` IS the book object — dragging writes
   *  x/z straight onto it, so no separate sync step is needed at export. */
  recordForEdit(object3d) {
    let o = object3d;
    while (o && !o.userData.bookId) o = o.parent;
    if (!o) return null;
    const book = this.books.find(b => b.id === o.userData.bookId);
    return book ? { isBook: true, data: book, obj: o } : null;
  }

  /** Editor calls this after writing data.x/data.z during a drag. */
  applyTransform(rec) {
    rec.obj.position.x = rec.data.x;
    rec.obj.position.z = rec.data.z;
  }

  /** Current book positions/text, for the editor's export button. */
  serializeBooks() {
    return this.books;
  }

  // ---------------- world interaction ----------------
  pick(clientX, clientY) {
    if (!this.spawned.size || !this._cam) return null;
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this._cam);
    const hit = this._raycaster.intersectObjects([...this.spawned.values()], true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.bookId) o = o.parent;
    return o ? this.books.find(b => b.id === o.userData.bookId) : null;
  }

  positionOf(book) {
    return this.spawned.get(book.id)?.position ?? null;
  }

  collect(book) {
    if (this.collected.has(book.id)) return;
    const mesh = this.spawned.get(book.id);
    if (mesh) { this.world.scene.remove(mesh); this.spawned.delete(book.id); }
    this.collected.add(book.id);
    this._save();
    this.skills?.addXp('intellect', DISCOVERY_XP);
    this._read(book, true);
    if (this.open) this._renderPanel();
  }

  // ---------------- UI ----------------
  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'biblioToggle';
    this.toggleBtn.textContent = '📚';
    this.toggleBtn.title = 'Bibliofolio (B)';
    document.body.appendChild(this.toggleBtn);
    // custom button art: drop an image at assets/ui/biblio-icon.png and
    // it replaces the emoji automatically (same pattern as the inventory
    // button and the player portrait)
    {
      const img = new Image();
      img.onload = () => {
        this.toggleBtn.innerHTML =
          `<img src="${img.src}" alt="Bibliofolio" style="width:70%;height:70%;object-fit:contain;">`;
      };
      img.src = 'assets/ui/biblio-icon.png';
    }
    this.toggleBtn.addEventListener('click', () => this.setOpen(!this.open));
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'KeyB') this.setOpen(!this.open);
      if (e.code === 'Escape') { this.reader.classList.remove('open'); if (this.open) this.setOpen(false); }
    });

    this.panel = document.createElement('div');
    this.panel.id = 'biblioPanel';
    document.body.appendChild(this.panel);
    this.panel.addEventListener('click', e => {
      const el = e.target.closest('[data-book]');
      if (!el) return;
      const book = this.books.find(b => b.id === el.dataset.book);
      if (book && this.collected.has(book.id)) this._read(book, false);
    });

    this.reader = document.createElement('div');
    this.reader.id = 'biblioReader';
    document.body.appendChild(this.reader);
    this.reader.addEventListener('click', e => {
      if (e.target.dataset?.act === 'close') this.reader.classList.remove('open');
    });
  }

  setOpen(on) {
    this.open = on;
    this.panel.classList.toggle('open', on);
    this.toggleBtn.classList.toggle('active', on);
    if (on) this._renderPanel();
  }

  _renderPanel() {
    const found = this.books.filter(b => this.collected.has(b.id)).length;
    this.panel.innerHTML = `
      <h2>BIBLIOFOLIO</h2>
      <div class="progress">${found} of ${this.books.length} volumes recovered</div>
      ${this.books.map(b => this.collected.has(b.id)
        ? `<div class="book" data-book="${b.id}">📖<div><div class="btitle">${b.title}</div><div class="bhint">${b.author ?? ''}</div></div></div>`
        : `<div class="book unfound">📕<div><div class="btitle">— unrecovered —</div><div class="bhint">${b.hint ?? 'No one remembers where this one lies.'}</div></div></div>`
      ).join('')}`;
  }

  _read(book, isNew) {
    this.reader.innerHTML = `
      ${isNew ? `<div class="rnew">✦ VOLUME RECOVERED · +${DISCOVERY_XP} INTELLECT ✦</div>` : ''}
      <div class="rtitle">${book.title}</div>
      ${book.author ? `<div class="rauthor">${book.author}</div>` : ''}
      <hr>
      ${(book.text ?? []).map(p => `<p>${p}</p>`).join('')}
      <button data-act="close">Close the book</button>`;
    this.reader.classList.add('open');
  }

  // ---------------- persistence ----------------
  _load() {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []); }
    catch { return new Set(); }
  }
  _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.collected]));
  }
}
