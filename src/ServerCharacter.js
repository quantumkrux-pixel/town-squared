// ============================================================
// ServerCharacter.js — the authoritative bridge.
//
// Server-authoritative means the server owns gold, items, and XP.
// This module is the ONLY thing that talks to the authority RPCs
// (claim_task, spend_gold, get_character) and the inventories/
// skill_xp tables. The game systems (Inventory, Skills, Tasks) read
// their state from here and route reward-granting actions through
// here, so the client can never invent a number.
//
// Pattern for player-facing latency: OPTIMISTIC then RECONCILE.
// Show the expected result immediately, fire the server call, and
// correct the display when the authoritative answer returns (or roll
// back on rejection). Reads are authoritative on load; the server's
// realtime feed keeps them fresh if another device plays the same
// account.
// ============================================================

export class ServerCharacter {
  constructor({ auth, cfg }) {
    this.auth = auth;
    this.cfg = cfg;
    this.supa = null;
    this.inventory = {};   // item_id -> qty (authoritative mirror)
    this.skills = {};      // skill_id -> xp
    this.profile = null;   // { display_name, role_id, reputation, ... }
    this._subs = [];
    this._onChange = () => {};
  }

  onChange(fn) { this._onChange = fn; }

  async init() {
    const { getSupabase } = await import('./net/supa.js');
    this.supa = await getSupabase(this.cfg);
    if (!this.supa) throw new Error('ServerCharacter requires a server');
    await this.reload();

    // keep the mirror fresh if the same account is open elsewhere
    const uid = this.auth.user.id;
    this.supa.channel('char-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventories', filter: `user_id=eq.${uid}` },
        () => this._refreshInventory())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'skill_xp', filter: `user_id=eq.${uid}` },
        () => this._refreshSkills())
      .subscribe();
  }

  async reload() {
    const { data, error } = await this.supa.rpc('get_character');
    if (error) { console.warn('[ServerCharacter] load failed', error); return; }
    this.inventory = data.inventory ?? {};
    this.skills = data.skills ?? {};
    this.profile = data.profile ?? null;
    this._onChange();
  }

  async _refreshInventory() {
    const { data } = await this.supa.from('inventories').select('item_id, qty').eq('user_id', this.auth.user.id);
    this.inventory = Object.fromEntries((data ?? []).map(r => [r.item_id, r.qty]));
    this._onChange();
  }
  async _refreshSkills() {
    const { data } = await this.supa.from('skill_xp').select('skill_id, xp').eq('user_id', this.auth.user.id);
    this.skills = Object.fromEntries((data ?? []).map(r => [r.skill_id, r.xp]));
    this._onChange();
  }

  // ---------------- reads ----------------
  count(itemId) { return this.inventory[itemId] ?? 0; }
  gold() { return this.count('coin'); }
  xp(skillId) { return this.skills[skillId] ?? 0; }

  // ---------------- authoritative actions ----------------
  /** Claim today's completed task for a role. Returns {ok,gold,rep} or {error}. */
  async claimTask(roleId) {
    const { data, error } = await this.supa.rpc('claim_task', { p_role: roleId });
    if (error) return { error: error.message };
    if (data?.ok) await this.reload();
    return data;
  }

  /** Spend gold (NPC trades). Returns {ok,gold} or {error}. */
  async spendGold(amount, forWhat) {
    const { data, error } = await this.supa.rpc('spend_gold', { p_amount: amount, p_for: forWhat });
    if (error) return { error: error.message };
    if (data?.ok) await this._refreshInventory();
    return data;
  }
}
