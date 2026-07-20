// ============================================================
// Friends.js — friends list + direct messages.
//
// Panel (👥 or F): your accepted friends (with online dots),
// incoming requests to accept, and a name search to send new
// requests. Tap a friend to open a chat thread; messages deliver
// in realtime via the messages table subscription.
//
// All gated behind auth + the 09_friends_chat.sql schema. Offline,
// the button is hidden — there's no one to befriend.
// ============================================================

const CSS = `
  #friendsToggle {
    position: fixed; right: 12px; bottom: max(216px, calc(env(safe-area-inset-bottom) + 204px));
    width: 44px; height: 44px; border-radius: 10px;
    background: rgba(20,16,12,0.72); color: #c9a24b;
    border: 1px solid rgba(201,162,75,0.35);
    font-size: 19px; cursor: pointer; z-index: 20;
  }
  #friendsToggle.active { background: #c9a24b; color: #1a1512; }
  #friendsToggle .badge {
    position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px;
    background: #a8503c; color: #fff; border-radius: 8px; font-size: 10px;
    line-height: 16px; text-align: center; padding: 0 3px; display: none;
  }
  #friendsToggle .badge.show { display: block; }
  #friendsPanel {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -52%);
    width: min(360px, calc(100vw - 28px)); max-height: 76vh;
    display: none; flex-direction: column; gap: 10px;
    background: linear-gradient(160deg, rgba(42,33,24,0.97), rgba(26,20,14,0.97));
    border: 2px solid rgba(201,162,75,0.55); border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    padding: 16px; z-index: 19; color: #e9ddc2;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12.5px;
  }
  #friendsPanel.open { display: flex; }
  #friendsPanel h2 { font-family: 'Cinzel', serif; font-weight: 700; font-size: 16px;
    color: #c9a24b; letter-spacing: 0.07em; text-align: center; margin: 0; }
  #friendsPanel .sec { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.1em;
    opacity: 0.6; margin-top: 4px; }
  #friendsPanel .frow, #friendsPanel .rrow {
    display: flex; align-items: center; gap: 9px;
    background: rgba(233,221,194,0.06); border-radius: 9px; padding: 8px 11px;
  }
  #friendsPanel .frow { cursor: pointer; }
  #friendsPanel .fdot { width: 8px; height: 8px; border-radius: 50%; background: #5a6650; flex: none; }
  #friendsPanel .fdot.on { background: #7fae6a; box-shadow: 0 0 6px #7fae6a; }
  #friendsPanel .fname { font-weight: 600; }
  #friendsPanel .funread { margin-left: auto; background: #a8503c; color: #fff;
    border-radius: 8px; font-size: 10px; padding: 1px 7px; }
  #friendsPanel .btn {
    background: rgba(201,162,75,0.22); color: #e9ddc2; border: 1px solid rgba(201,162,75,0.45);
    border-radius: 7px; padding: 6px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer;
  }
  #friendsPanel .btn.mini { margin-left: auto; }
  #friendsPanel .search { display: flex; gap: 6px; }
  #friendsPanel input {
    flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(201,162,75,0.3);
    border-radius: 7px; padding: 8px 10px; color: #e9ddc2; font-size: 12.5px;
  }
  #friendsPanel .close { position: absolute; top: 12px; right: 14px;
    background: none; border: none; color: #e9ddc2; font-size: 18px; cursor: pointer; opacity: 0.7; }

  /* chat thread */
  #chatPanel {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(360px, calc(100vw - 28px)); height: min(70vh, 520px);
    display: none; flex-direction: column;
    background: linear-gradient(160deg, rgba(42,33,24,0.98), rgba(26,20,14,0.98));
    border: 2px solid rgba(201,162,75,0.55); border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6); z-index: 22; color: #e9ddc2;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px;
  }
  #chatPanel.open { display: flex; }
  #chatPanel .chead { display: flex; align-items: center; gap: 10px;
    padding: 12px 14px; border-bottom: 1px solid rgba(201,162,75,0.3); }
  #chatPanel .chead .cname { font-family: 'Cinzel', serif; font-weight: 700; color: #c9a24b; }
  #chatPanel .cback { background: none; border: none; color: #e9ddc2; font-size: 18px; cursor: pointer; }
  #chatLog { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
  #chatLog .msg { max-width: 78%; padding: 7px 11px; border-radius: 12px; line-height: 1.4; }
  #chatLog .msg.them { background: rgba(233,221,194,0.1); align-self: flex-start; border-bottom-left-radius: 3px; }
  #chatLog .msg.me { background: rgba(201,162,75,0.28); align-self: flex-end; border-bottom-right-radius: 3px; }
  #chatForm { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid rgba(201,162,75,0.3); }
  #chatForm input { flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(201,162,75,0.3);
    border-radius: 8px; padding: 9px 12px; color: #e9ddc2; font-size: 13px; }
  #chatForm button { background: #c9a24b; color: #1a1512; border: none; border-radius: 8px;
    padding: 9px 16px; font-weight: 700; cursor: pointer; }
`;

export class Friends {
  constructor({ auth, cfg, identity, roster }) {
    this.auth = auth;
    this.cfg = cfg;
    this.identity = identity;
    this.roster = roster;          // () => Set of online user ids (from presence)
    this.supa = null;
    this.friends = [];             // [{ id, display_name, role_id }]
    this.requests = [];            // incoming pending [{ id(fs), requester, display_name }]
    this.unread = new Map();       // friendId -> count
    this.openThread = null;        // friendId currently chatting
    this._names = new Map();       // id -> display_name cache
  }

  async init() {
    if (!this.auth.online) return; // offline: no social layer
    try {
      const { getSupabase } = await import('./net/supa.js');
      this.supa = await getSupabase(this.cfg);
    } catch { this.supa = null; }
    if (!this.supa) return;

    this._buildUI();
    await this.refresh();

    // realtime: incoming messages + friendship changes
    this.supa.channel('social')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient=eq.${this.identity.id}` },
        p => this._onIncoming(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' },
        () => this.refresh())
      .subscribe();
  }

  // ---------------- data ----------------
  async refresh() {
    if (!this.supa) return;
    const uid = this.identity.id;
    const { data: fs } = await this.supa.from('friendships')
      .select('id, requester, addressee, status')
      .or(`requester.eq.${uid},addressee.eq.${uid}`);

    const acceptedIds = [], pending = [];
    for (const f of fs ?? []) {
      if (f.status === 'accepted') {
        acceptedIds.push(f.requester === uid ? f.addressee : f.requester);
      } else if (f.status === 'pending' && f.addressee === uid) {
        pending.push(f);
      }
    }

    // resolve names
    const need = [...new Set([...acceptedIds, ...pending.map(p => p.requester)])];
    if (need.length) {
      const { data: profs } = await this.supa.from('profiles')
        .select('id, display_name, role_id').in('id', need);
      for (const p of profs ?? []) this._names.set(p.id, p.display_name);
      this.friends = acceptedIds.map(id => ({
        id, display_name: this._names.get(id) ?? 'Traveler',
        role_id: profs?.find(p => p.id === id)?.role_id ?? null,
      }));
      this.requests = pending.map(p => ({
        fsId: p.id, requester: p.requester,
        display_name: this._names.get(p.requester) ?? 'Traveler',
      }));
    } else {
      this.friends = []; this.requests = [];
    }
    this._render();
  }

  async sendRequest(addresseeId) {
    await this.supa.from('friendships').insert({ requester: this.identity.id, addressee: addresseeId });
    await this.refresh();
  }
  async accept(fsId) {
    await this.supa.from('friendships').update({ status: 'accepted' }).eq('id', fsId);
    await this.refresh();
  }
  async search(q) {
    const { data } = await this.supa.rpc('find_profiles', { q });
    return data ?? [];
  }

  // ---------------- chat ----------------
  async _openChat(friendId) {
    this.openThread = friendId;
    this.unread.delete(friendId);
    this._renderBadge();
    this.chatName.textContent = this._names.get(friendId) ?? 'Traveler';
    this.chatPanel.classList.add('open');
    const { data } = await this.supa.from('messages')
      .select('sender, recipient, body, created_at')
      .or(`and(sender.eq.${this.identity.id},recipient.eq.${friendId}),and(sender.eq.${friendId},recipient.eq.${this.identity.id})`)
      .order('created_at', { ascending: true }).limit(100);
    this.chatLog.innerHTML = '';
    for (const m of data ?? []) this._appendMsg(m.body, m.sender === this.identity.id);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  async _send(body) {
    body = body.trim();
    if (!body || !this.openThread) return;
    this._appendMsg(body, true); // optimistic
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    const { error } = await this.supa.from('messages')
      .insert({ sender: this.identity.id, recipient: this.openThread, body });
    if (error) this._appendMsg('⚠ not delivered (are you still friends?)', true);
  }

  _onIncoming(msg) {
    if (this.openThread === msg.sender) {
      this._appendMsg(msg.body, false);
      this.chatLog.scrollTop = this.chatLog.scrollHeight;
    } else {
      this.unread.set(msg.sender, (this.unread.get(msg.sender) ?? 0) + 1);
      this._render(); this._renderBadge();
    }
  }

  _appendMsg(body, mine) {
    const el = document.createElement('div');
    el.className = `msg ${mine ? 'me' : 'them'}`;
    el.textContent = body;
    this.chatLog.appendChild(el);
  }

  // ---------------- UI ----------------
  _buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.btn = document.createElement('button');
    this.btn.id = 'friendsToggle';
    this.btn.innerHTML = '👥<span class="badge"></span>';
    this.btn.title = 'Friends (F)';
    document.body.appendChild(this.btn);
    this.badgeEl = this.btn.querySelector('.badge');
    this.btn.addEventListener('click', () => this.setOpen(!this.open));
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'KeyF') this.setOpen(!this.open);
      if (e.code === 'Escape') { this.chatPanel?.classList.remove('open'); if (this.open) this.setOpen(false); }
    });

    this.panel = document.createElement('div');
    this.panel.id = 'friendsPanel';
    document.body.appendChild(this.panel);

    this.chatPanel = document.createElement('div');
    this.chatPanel.id = 'chatPanel';
    this.chatPanel.innerHTML = `
      <div class="chead"><button class="cback">‹</button><span class="cname"></span></div>
      <div id="chatLog"></div>
      <div id="chatForm"><input type="text" placeholder="Message…" maxlength="2000"><button>Send</button></div>`;
    document.body.appendChild(this.chatPanel);
    this.chatName = this.chatPanel.querySelector('.cname');
    this.chatLog = this.chatPanel.querySelector('#chatLog');
    const input = this.chatPanel.querySelector('#chatForm input');
    const sendBtn = this.chatPanel.querySelector('#chatForm button');
    this.chatPanel.querySelector('.cback').addEventListener('click', () => { this.chatPanel.classList.remove('open'); this.openThread = null; });
    const doSend = () => { this._send(input.value); input.value = ''; };
    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', e => { if (e.code === 'Enter') doSend(); });
  }

  setOpen(on) {
    this.open = on;
    this.panel.classList.toggle('open', on);
    this.btn.classList.toggle('active', on);
    if (on) { this.refresh(); }
  }

  _render() {
    if (!this.panel) return;
    const online = this.roster ? this.roster() : new Set();
    const reqHTML = this.requests.length ? `
      <div class="sec">Requests</div>
      ${this.requests.map(r => `
        <div class="rrow"><span class="fname">${r.display_name}</span>
          <button class="btn mini" data-accept="${r.fsId}">Accept</button></div>`).join('')}` : '';

    const friendsHTML = this.friends.length ? this.friends.map(f => {
      const on = online.has(f.id);
      const u = this.unread.get(f.id) ?? 0;
      return `<div class="frow" data-friend="${f.id}">
        <span class="fdot ${on ? 'on' : ''}"></span>
        <span class="fname">${f.display_name}</span>
        ${u ? `<span class="funread">${u}</span>` : ''}
      </div>`;
    }).join('') : `<div class="sec" style="opacity:0.5">No friends yet — add someone below.</div>`;

    this.panel.innerHTML = `
      <button class="close">✕</button>
      <h2>FRIENDS</h2>
      ${reqHTML}
      <div class="sec">Companions</div>
      ${friendsHTML}
      <div class="sec">Add a friend</div>
      <div class="search"><input type="text" placeholder="Search by name…"><button class="btn">Find</button></div>
      <div class="results"></div>`;

    this.panel.querySelector('.close').addEventListener('click', () => this.setOpen(false));
    this.panel.querySelectorAll('[data-friend]').forEach(el =>
      el.addEventListener('click', () => this._openChat(el.dataset.friend)));
    this.panel.querySelectorAll('[data-accept]').forEach(el =>
      el.addEventListener('click', e => { e.stopPropagation(); this.accept(el.dataset.accept); }));

    const sInput = this.panel.querySelector('.search input');
    const results = this.panel.querySelector('.results');
    this.panel.querySelector('.search .btn').addEventListener('click', async () => {
      const found = await this.search(sInput.value.trim());
      results.innerHTML = found.map(p => `
        <div class="rrow"><span class="fname">${p.display_name}</span>
          <button class="btn mini" data-add="${p.id}">Add</button></div>`).join('')
        || '<div class="sec" style="opacity:0.5">No one by that name.</div>';
      results.querySelectorAll('[data-add]').forEach(el =>
        el.addEventListener('click', () => { this.sendRequest(el.dataset.add); el.textContent = 'Sent'; el.disabled = true; }));
    });
  }

  _renderBadge() {
    const total = [...this.unread.values()].reduce((a, b) => a + b, 0)
      + this.requests.length;
    this.badgeEl.textContent = total;
    this.badgeEl.classList.toggle('show', total > 0);
  }
}
