// ============================================================
// NpcBrain.js — client side of LLM-powered NPC conversations.
//
// Talks to the npc-chat Edge Function (which holds the API key and
// enforces limits). Maintains a short per-NPC conversation history
// for the session, assembles the persona from the NPC's town.json
// data, and streams the reply token-by-token into a callback.
//
// Enabled automatically when Supabase is configured AND
// CONFIG.NPC_AI.enabled is true. The canned dialogue lines remain
// the free, instant tier one — the LLM is the "converse" escalation.
//
// Memory upgrade path: persist a per-NPC summary to a Supabase
// `npc_memories` table after conversations, and inject it into the
// persona here — Marta remembering yesterday, visible to everyone.
// ============================================================

export class NpcBrain {
  constructor(cfg, identity) {
    this.enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && cfg.NPC_AI?.enabled);
    this.url = `${cfg.SUPABASE_URL}/functions/v1/npc-chat`;
    this.anonKey = cfg.SUPABASE_ANON_KEY;
    this.identity = identity;             // { id, name }
    this.playerRole = '';                 // main.js keeps this fresh
    this.histories = new Map();           // npc.name -> [{role, content}]
    this.busy = false;
  }

  _persona(npc) {
    const voice = (npc.dialogue ?? []).slice(0, 4).map(l => `"${l}"`).join(' ');
    return [
      `Name: ${npc.name}.`,
      npc.role ? `Occupation: ${npc.role}.` : '',
      `Town: Emberhollow — a small fantasy town with a market square, a well, a tavern, a watchtower, and the sea to the east.`,
      npc.grantsRole ? `You can offer the player work in your trade (they join by using the panel button, not through conversation).` : '',
      voice ? `Your speaking voice, by example: ${voice}` : '',
    ].filter(Boolean).join('\n');
  }

  history(npc) {
    if (!this.histories.has(npc.name)) this.histories.set(npc.name, []);
    return this.histories.get(npc.name);
  }

  /** Send the player's line; streams the NPC's reply via onChunk(text).
   *  Resolves with the full reply when the stream ends. */
  async say(npc, playerLine, onChunk) {
    if (!this.enabled || this.busy) return null;
    this.busy = true;

    const history = this.history(npc);
    history.push({ role: 'user', content: playerLine });
    while (history.length > 12) history.shift();

    let reply = '';
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.anonKey}`,
          'apikey': this.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          persona: this._persona(npc),
          messages: history,
          playerId: this.identity.id,
          playerName: this.identity.name,
          playerRole: this.playerRole,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`npc-chat ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        reply += chunk;
        onChunk?.(reply);
      }
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      console.warn('[NpcBrain]', err);
      reply = null; // caller falls back to canned dialogue
      history.pop(); // don't poison history with an unanswered line
    } finally {
      this.busy = false;
    }
    return reply;
  }
}
