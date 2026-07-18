// ============================================================
// Roles.js — player professions.
//
// Role definitions live in data/roles.json. An NPC becomes a
// recruiter by carrying "grantsRole": "<roleId>" in town.json and
// listing "join" in its interactions — the panel then shows a
// "Become a <Role>" button. One role at a time; switching requires
// a confirming second tap (handled in Interactions).
//
// The player's role travels in the network state (the `r` field),
// so everyone in town sees "Name · Baker" on your tag.
//
// Persistence: localStorage now; the upgrade seam is the same as
// inventory — a Supabase `profiles.role` column, written on change,
// read at boot.
// ============================================================

const STORAGE_KEY = 'townsquared.role.v1';

export class Roles {
  constructor() {
    this.defs = {};
    this.current = null;                 // role id or null
    this.onChange = (def, prevDef) => {}; // main.js wires nametag + net updates
  }

  async init() {
    try {
      const res = await fetch('data/roles.json');
      if (res.ok) this.defs = await res.json();
    } catch { /* no roles.json — recruiters just won't offer anything */ }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && this.defs[saved]) this.current = saved;
  }

  def(id) {
    return this.defs[id] ?? null;
  }

  get currentDef() {
    return this.current ? this.def(this.current) : null;
  }

  /** Take up a profession. Returns { ok, prev } — prev is the def left behind. */
  join(id) {
    if (!this.defs[id]) return { ok: false };
    if (this.current === id) return { ok: false, already: true };
    const prev = this.currentDef;
    this.current = id;
    localStorage.setItem(STORAGE_KEY, id);
    this.onChange(this.def(id), prev);
    return { ok: true, prev };
  }
}
