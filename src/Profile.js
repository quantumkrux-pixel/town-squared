// ============================================================
// Profile.js — the persistent character.
//
// Bridges the server profiles row and the client systems (Skills,
// Inventory, Bibliofolio, name). On load it HYDRATES those systems
// from the server row; as they change it SAVES back, debounced.
//
// Online:  source of truth is the profiles row (keyed by auth id).
// Offline: everything falls through to the localStorage each system
//          already uses — so the game is identical without a server.
//
// The systems keep their existing toJSON()/loadJSON() seams; this
// just decides where the JSON comes from and goes to.
// ============================================================

const NAME_KEY = 'townsquared.localname.v1';
const SAVE_DEBOUNCE_MS = 1500;

export class Profile {
  constructor({ auth, cfg, skills, inventory, biblio }) {
    this.auth = auth;
    this.cfg = cfg;
    this.skills = skills;
    this.inventory = inventory;
    this.biblio = biblio;
    this.supa = null;
    this.row = null;         // server row (online only)
    this.name = null;
    this.roleId = null;
    this._saveTimer = null;
    this._onName = () => {};
  }

  async init(identity) {
    if (this.auth.online) {
      try {
        const { getSupabase } = await import('./net/supa.js');
        this.supa = await getSupabase(this.cfg);
      } catch { this.supa = null; }
    }

    if (this.supa) {
      // the signup trigger creates the row; fetch it (retry once if the
      // trigger hasn't committed in the same instant as first sign-in)
      let row = await this._fetchRow(identity.id);
      if (!row) { await new Promise(r => setTimeout(r, 400)); row = await this._fetchRow(identity.id); }
      this.row = row;
    }

    if (this.row) {
      this._hydrateFromServer(this.row);
      this.name = this.row.display_name;
    } else {
      // offline (or fetch failed): keep the localStorage-hydrated systems
      // as-is; just resolve a name
      this.name = localStorage.getItem(NAME_KEY) || identity.name;
    }

    if (!this.name) { this.name = identity.name; }
    localStorage.setItem(NAME_KEY, this.name);
    identity.name = this.name;
    return this.name;
  }

  async _fetchRow(id) {
    const { data, error } = await this.supa
      .from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) { console.warn('[Profile] fetch failed', error); return null; }
    return data;
  }

  _hydrateFromServer(row) {
    // only overwrite local state when the server actually has data —
    // a brand-new profile has empty blobs, in which case the localStorage
    // the systems already loaded is the better starting point (and the
    // next save pushes it up)
    if (row.skills && Object.keys(row.skills).length)
      this.skills?.loadJSON(JSON.stringify(row.skills));
    if (row.inventory && Object.keys(row.inventory).length)
      this.inventory?.loadJSON(JSON.stringify(row.inventory));
    if (Array.isArray(row.books) && row.books.length && this.biblio)
      this.biblio.collected = new Set(row.books);
  }

  setName(name) {
    name = (name ?? '').trim().slice(0, 24);
    if (!name) return;
    this.name = name;
    localStorage.setItem(NAME_KEY, name);
    this._onName(name);
    this.save();
  }
  onName(fn) { this._onName = fn; }

  /** Debounced push of the whole character to the server. Systems call
   *  this (via main wiring) whenever they change. No-op offline. */
  save() {
    if (!this.supa || !this.row) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flush(), SAVE_DEBOUNCE_MS);
  }

  async _flush() {
    if (!this.supa || !this.row) return;
    const payload = {
      display_name: this.name,
      skills: this.skills ? JSON.parse(this.skills.toJSON()) : {},
      inventory: this.inventory ? JSON.parse(this.inventory.toJSON()) : {},
      books: this.biblio ? [...this.biblio.collected] : [],
      gold: this.inventory?.count?.('coin') ?? 0,
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.supa.from('profiles').update(payload).eq('id', this.row.id);
    if (error) console.warn('[Profile] save failed', error);
  }

  /** Force an immediate save (e.g. on page hide). */
  flushNow() { clearTimeout(this._saveTimer); return this._flush(); }
}
