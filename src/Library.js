// ============================================================
// Library.js — the Book of Names.
//
// A pedestal in the library's inner room holds a great book and a
// feather quill. The door is barred to everyone except those who
// have woken the stone circle (profiles.library_access, set by the
// lottery win — the server checks it, not this file).
//
// Signing writes your name into hall_of_names, which is public-read
// and never pruned. One line per winner, kept indefinitely.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const CSS = `
  #bookPanel {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 28px)); max-height: 78vh; overflow-y: auto;
    display: none; flex-direction: column; gap: 12px;
    background: linear-gradient(165deg, #efe4c8, #ddcda6);
    color: #3a2e1e;
    border: 2px solid rgba(122, 92, 40, 0.75); border-radius: 8px;
    box-shadow: 0 16px 50px rgba(0,0,0,0.6);
    padding: 26px 26px 22px; z-index: 25;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 14px; line-height: 1.6;
  }
  #bookPanel.open { display: flex; }
  #bookPanel .btitle {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 20px;
    color: #6b4d1c; text-align: center; letter-spacing: 0.06em;
  }
  #bookPanel .bsub { text-align: center; font-style: italic; font-size: 12.5px; opacity: 0.7; margin-top: -8px; }
  #bookPanel hr { border: none; border-top: 1px solid rgba(107,77,28,0.35); margin: 2px 0; }
  #bookPanel .sig {
    display: flex; align-items: baseline; gap: 8px;
    padding: 5px 2px; border-bottom: 1px dotted rgba(107,77,28,0.25);
  }
  #bookPanel .sig .n { font-family: 'Cinzel', serif; font-weight: 700; font-size: 15px; }
  #bookPanel .sig .t { font-style: italic; opacity: 0.72; font-size: 12.5px; }
  #bookPanel .sig .d { margin-left: auto; font-size: 11px; opacity: 0.5; }
  #bookPanel .empty { text-align: center; font-style: italic; opacity: 0.6; padding: 10px; }
  #bookPanel .barred { text-align: center; font-style: italic; opacity: 0.75; }
  #bookPanel button {
    align-self: center; background: #6b4d1c; color: #efe4c8; border: none;
    border-radius: 8px; padding: 11px 26px; font-family: 'Cinzel', serif;
    font-weight: 700; letter-spacing: 0.08em; font-size: 13px; cursor: pointer;
  }
  #bookPanel .close {
    position: absolute; top: 10px; right: 14px; background: none; color: #6b4d1c;
    font-size: 20px; padding: 0; cursor: pointer;
  }
`;

export class Library {
  constructor({ world, registry, server, camera, stones }) {
    this.world = world;
    this.registry = registry;
    this.server = server;
    this.camera = camera;
    this.stones = stones;      // for the access/title state
    this.pedestals = [];       // placement records
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._buildUI();
  }

  async init() {
    for (const rec of this.world.placed) {
      if (rec.data.asset === 'pedestal_book' && rec.obj) this.pedestals.push(rec);
    }
  }

  pick(clientX, clientY) {
    if (!this.pedestals.length) return null;
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hit = this._raycaster.intersectObjects(this.pedestals.map(r => r.obj), true)[0];
    if (!hit) return null;
    for (const rec of this.pedestals) {
      let o = hit.object;
      while (o) { if (o === rec.obj) return rec; o = o.parent; }
    }
    return null;
  }

  async open() {
    this.panel.classList.add('open');
    this.panel.innerHTML = '<div class="empty">The pages are still settling…</div>';
    const [{ data: names }, state] = await Promise.all([
      this.server.supa.rpc('get_hall_of_names'),
      this.server.supa.rpc('get_stone_daily').then(r => r.data),
    ]);
    this._names = names ?? [];
    this._state = state ?? {};
    this._render();
  }

  close() { this.panel.classList.remove('open'); }

  async _sign() {
    const { data, error } = await this.server.supa.rpc('sign_the_book');
    if (error || data?.error) {
      this._render(data?.error ?? 'The quill will not take your hand.');
      return;
    }
    const { data: names } = await this.server.supa.rpc('get_hall_of_names');
    this._names = names ?? [];
    this._state.has_signed = true;
    this._render();
  }

  _render(msg) {
    const canSign = this._state?.library_access && !this._state?.has_signed;
    const rows = this._names.length
      ? this._names.map(s => `
          <div class="sig">
            <span class="n">${s.name}</span>
            <span class="t">${s.title ?? ''}</span>
            <span class="d">${new Date(s.at).toLocaleDateString()}</span>
          </div>`).join('')
      : '<div class="empty">No one has signed. The page is very white.</div>';

    this.panel.innerHTML = `
      <button class="close" data-act="close">✕</button>
      <div class="btitle">THE BOOK OF NAMES</div>
      <div class="bsub">Those who woke the circle, kept here as long as there is a here.</div>
      <hr>
      ${rows}
      <hr>
      ${msg ? `<div class="barred">${msg}</div>` : ''}
      ${canSign ? '<button data-act="sign">Take up the quill</button>'
        : this._state?.has_signed
          ? '<div class="barred">Your name is already in these pages.</div>'
          : '<div class="barred">The quill is heavy, and will not lift for you.</div>'}`;
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.panel = document.createElement('div');
    this.panel.id = 'bookPanel';
    document.body.appendChild(this.panel);
    this.panel.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.close();
      if (act === 'sign') this._sign();
    });
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') this.close();
    });
  }
}
