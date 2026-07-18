// ============================================================
// Interactions.js — click a townsperson, get a details panel.
//
// NPC data (name, role, dialogue, interactions) comes from town.json.
// The panel renders whatever `interactions` array an NPC declares:
//
//   "interactions": ["talk", "trade", "quest"]
//
// Built-in actions: "talk" cycles the NPC's dialogue lines. Everything
// else is routed to `onAction(actionId, npc)` — the hook where real
// systems (shop UI, quest log) plug in later. Unknown action ids just
// work: add "gossip" to an NPC's list and it appears as a button.
//
// The selected NPC gets a gold marker ring that follows them (they
// keep walking their route — the town doesn't stop for you).
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const ACTION_LABELS = {
  talk: '💬 Talk',
  trade: '🪙 Trade',
  quest: '📜 Ask for work',
  follow: '👣 Follow',
};

const PANEL_CSS = `
  #npcPanel {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(14px, env(safe-area-inset-bottom));
    width: min(340px, calc(100vw - 24px));
    display: none; flex-direction: column; gap: 10px;
    background: rgba(20,16,12,0.88); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.4); border-radius: 12px;
    padding: 14px; z-index: 15;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    backdrop-filter: blur(8px);
  }
  #npcPanel.open { display: flex; }
  #npcPanel .head { display: flex; align-items: baseline; gap: 8px; }
  #npcPanel .name {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 16px;
    color: #c9a24b; letter-spacing: 0.04em;
  }
  #npcPanel .role { font-size: 11px; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.08em; }
  #npcPanel .close {
    margin-left: auto; background: none; border: none; color: #e9ddc2;
    font-size: 18px; cursor: pointer; opacity: 0.7; padding: 0 2px;
  }
  #npcPanel .speech {
    background: rgba(233,221,194,0.07);
    border-left: 2px solid rgba(201,162,75,0.5);
    border-radius: 0 8px 8px 0;
    padding: 8px 10px; font-style: italic; line-height: 1.45;
    min-height: 20px;
  }
  #npcPanel .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  #npcPanel .actions button {
    flex: 1 1 30%;
    background: rgba(233,221,194,0.08); color: #e9ddc2;
    border: 1px solid rgba(233,221,194,0.2); border-radius: 8px;
    padding: 9px 6px; font-size: 12.5px; cursor: pointer;
    white-space: nowrap;
  }
  #npcPanel .actions button:active { background: rgba(201,162,75,0.3); }
  #npcPanel .chatrow { display: flex; gap: 6px; }
  #npcPanel .chatrow input {
    flex: 1; background: rgba(233,221,194,0.08); color: #e9ddc2;
    border: 1px solid rgba(233,221,194,0.25); border-radius: 8px;
    padding: 9px 10px; font-size: 13px; outline: none;
  }
  #npcPanel .chatrow input:focus { border-color: rgba(201,162,75,0.6); }
  #npcPanel .chatrow button {
    background: rgba(201,162,75,0.25); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.5); border-radius: 8px;
    padding: 0 14px; font-size: 14px; cursor: pointer;
  }
  #npcPanel .chatrow button:disabled { opacity: 0.45; }
`;

export class Interactions {
  constructor({ world, camera, scene, roles, brain, skills }) {
    this.world = world;
    this.camera = camera;
    this.roles = roles ?? null;
    this.brain = brain ?? null;
    this.skills = skills ?? null;
    this._talkXpAt = new Map();   // npc -> last speechcraft grant (ms)
    this.current = null;          // selected npc record
    this._pendingJoin = null;     // npc awaiting switch confirmation
    this._dialogueIdx = new Map(); // npc -> next line index
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    // Plug real game systems in here. Called for every non-"talk" action.
    this.onAction = (actionId, npc) => {
      this._say(`(${ACTION_LABELS[actionId] ?? actionId} isn't wired up yet — hook it in Interactions.onAction.)`);
    };

    this._buildMarker(scene);
    this._buildUI();
  }

  // ---------- picking (called from main's tap handler) ----------
  /** Returns the tapped NPC, or null. */
  pick(clientX, clientY) {
    this._pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hit = this._raycaster.intersectObjects(this.world.npcPickables, true)[0];
    return hit ? this.world.npcFor(hit.object) : null;
  }

  // ---------- panel ----------
  open(npc) {
    this.current = npc;
    this._pendingJoin = null;
    this.marker.visible = true;

    const actions = (npc.interactions ?? ['talk'])
      .map(id => `<button data-action="${id}">${this._label(id, npc)}</button>`)
      .join('');

    const chatRow = this.brain?.enabled ? `
      <div class="chatrow">
        <input type="text" maxlength="200" placeholder="Say something to ${npc.name.split(' ')[0]}…">
        <button data-action="__send">➤</button>
      </div>` : '';

    this.panel.innerHTML = `
      <div class="head">
        <span class="name">${npc.name}</span>
        <span class="role">${npc.role ?? ''}</span>
        <button class="close" data-action="__close">✕</button>
      </div>
      <div class="speech">…</div>
      <div class="actions">${actions}</div>
      ${chatRow}
    `;
    this.panel.classList.add('open');
    const input = this.panel.querySelector('.chatrow input');
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._sendChat();
      e.stopPropagation(); // don't trigger game hotkeys while typing
    });
    this._doAction('talk'); // greet immediately
  }

  async _sendChat() {
    const npc = this.current;
    const input = this.panel.querySelector('.chatrow input');
    const btn = this.panel.querySelector('[data-action="__send"]');
    const line = input?.value.trim();
    if (!npc || !line || !this.brain?.enabled || this.brain.busy) return;

    input.value = '';
    input.disabled = true; if (btn) btn.disabled = true;
    this._say('…');

    const reply = await this.brain.say(npc, line, partial => this._say(partial));
    if (reply === null) {
      // graceful fallback to canned lines if the function is unreachable
      this._doAction('talk');
    } else {
      this.skills?.addXp('speechcraft', 6); // real conversation trains harder
    }
    input.disabled = false; if (btn) btn.disabled = false;
    input.focus();
  }

  _label(id, npc) {
    if (id === 'join' && npc.grantsRole && this.roles) {
      const role = this.roles.def(npc.grantsRole);
      if (!role) return ACTION_LABELS[id] ?? id;
      return this.roles.current === npc.grantsRole
        ? `✓ Your calling`
        : `${role.icon ?? '📜'} Become a ${role.name}`;
    }
    return ACTION_LABELS[id] ?? id;
  }

  close() {
    this.current = null;
    this.panel.classList.remove('open');
    this.marker.visible = false;
  }

  _doAction(id) {
    const npc = this.current;
    if (!npc) return;
    if (id === '__close') return this.close();
    if (id === '__send') return this._sendChat();
    if (id === 'talk') {
      const lines = npc.dialogue?.length ? npc.dialogue : ['...'];
      const i = this._dialogueIdx.get(npc) ?? 0;
      this._say(lines[i % lines.length]);
      this._dialogueIdx.set(npc, i + 1);
      // a little Speech-Craft per townsperson, at most once a minute each
      const last = this._talkXpAt.get(npc) ?? 0;
      if (Date.now() - last > 60000) {
        this._talkXpAt.set(npc, Date.now());
        this.skills?.addXp('speechcraft', 4);
      }
      return;
    }
    if (id === 'join' && npc.grantsRole && this.roles) {
      return this._handleJoin(npc);
    }
    this.onAction(id, npc);
  }

  _handleJoin(npc) {
    const roleId = npc.grantsRole;
    const role = this.roles.def(roleId);
    if (!role) return this._say('(That trade isn\u2019t defined in data/roles.json.)');

    if (this.roles.current === roleId) {
      this._say(`You already serve as a ${role.name}. Back to work with you.`);
      return;
    }
    // switching professions costs a confirming second tap
    const prev = this.roles.currentDef;
    if (prev && this._pendingJoin !== npc) {
      this._pendingJoin = npc;
      this._say(`Leave the ${prev.name}'s life behind? Tap again if you mean it.`);
      return;
    }
    this._pendingJoin = null;
    this.roles.join(roleId);
    this._say(npc.joinDialogue ?? `Welcome to the trade. You're a ${role.name} now — act like it.`);
    // refresh the button label to "Your calling"
    const btn = this.panel.querySelector('[data-action="join"]');
    if (btn) btn.textContent = this._label('join', npc);
  }

  _say(text) {
    const el = this.panel.querySelector('.speech');
    if (el) el.textContent = `“${text}”`;
  }

  // ---------- selection marker ----------
  _buildMarker(scene) {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.6, 24),
      new THREE.MeshBasicMaterial({ color: 0xc9a24b, transparent: true, opacity: 0.9, depthWrite: false })
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.marker);
  }

  /** Call every frame — keeps the ring under the (still-walking) NPC. */
  update(nowMs) {
    if (!this.current) return;
    const p = this.current.mesh.position;
    this.marker.position.set(p.x, 0.06, p.z);
    // gentle pulse
    const s = 1 + Math.sin(nowMs / 300) * 0.07;
    this.marker.scale.setScalar(s);
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    this.panel = document.createElement('div');
    this.panel.id = 'npcPanel';
    document.body.appendChild(this.panel);

    this.panel.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn) this._doAction(btn.dataset.action);
    });
  }
}
