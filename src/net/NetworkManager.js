// ============================================================
// NetworkManager.js — multiplayer transport.
//
// Two implementations behind one interface:
//
//   SupabaseNetwork — real multiplayer over Supabase Realtime.
//     • Broadcast channel  : 10Hz position/heading (ephemeral, no DB writes)
//     • Presence           : who's in town, join/leave
//     Persistent world state (plots, buildings, inventory) belongs in
//     Postgres tables behind RLS + table subscriptions — NOT here.
//
//   LocalNetwork — offline stub used when no Supabase keys are set.
//     Simulates one wandering peer so the remote-player interpolation
//     path is exercised without any backend.
//
// createNetwork(config) picks the right one automatically.
// ============================================================

export function createNetwork(cfg, identity) {
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
    return new SupabaseNetwork(cfg, identity);
  }
  console.info('[net] No Supabase keys in config.js — running in offline mode with a simulated peer.');
  return new LocalNetwork(cfg, identity);
}

// ---------------------------------------------------------------
// Shared interface
// ---------------------------------------------------------------
class BaseNetwork {
  constructor(cfg, identity) {
    this.cfg = cfg;
    this.id = identity.id;
    this.name = identity.name;
    // callbacks — main.js assigns these
    this.onPeerState = (id, name, state, tMs) => {};
    this.onPeerLeave = (id) => {};
    this.onStatus = (label, mode) => {};
  }
  async connect() {}
  sendState(state) {}
  peerCount() { return 0; }
  dispose() {}
}

// ---------------------------------------------------------------
// SupabaseNetwork — the real thing
// ---------------------------------------------------------------
export class SupabaseNetwork extends BaseNetwork {
  async connect() {
    const { getSupabase } = await import('./supa.js');
    this.client = await getSupabase(this.cfg);
    this._peers = new Set();

    this.channel = this.client.channel(this.cfg.ROOM, {
      config: {
        broadcast: { self: false },
        presence: { key: this.id },
      },
    });

    // live position updates from other players
    this.channel.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (payload.id === this.id) return;
      this._peers.add(payload.id);
      this.onPeerState(payload.id, payload.name, payload.s, Date.now());
    });

    // presence: authoritative "who is here"
    this.channel.on('presence', { event: 'sync' }, () => {
      const present = new Set(Object.keys(this.channel.presenceState()));
      present.delete(this.id);
      for (const id of this._peers) {
        if (!present.has(id)) {
          this._peers.delete(id);
          this.onPeerLeave(id);
        }
      }
      this._updateStatus();
    });

    await new Promise((resolve, reject) => {
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track({ name: this.name, joined: Date.now() });
          this._updateStatus();
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Realtime channel: ${status}`));
        }
      });
    });
  }

  _updateStatus() {
    const n = Math.max(1, Object.keys(this.channel.presenceState()).length);
    this.onStatus(`${n} in town · ${this.name}`, 'online');
  }

  sendState(state) {
    this.channel?.send({
      type: 'broadcast',
      event: 'state',
      payload: { id: this.id, name: this.name, s: state },
    });
  }

  peerCount() { return this._peers.size; }

  dispose() {
    this.channel?.unsubscribe();
  }
}

// ---------------------------------------------------------------
// LocalNetwork — offline stub with one simulated wanderer
// ---------------------------------------------------------------
export class LocalNetwork extends BaseNetwork {
  async connect() {
    this.onStatus(`offline · ${this.name} (add Supabase keys in config.js)`, 'local');

    // A ghost villager strolling a loop, emitted at the same cadence a
    // real peer would arrive — so RemotePlayers interpolation is tested.
    const ghostId = 'ghost-peer';
    let t = 0;
    this._timer = setInterval(() => {
      t += 1 / this.cfg.NET.sendHz;
      const x = Math.cos(t * 0.35) * 9;
      const z = Math.sin(t * 0.35) * 9 - 2;
      const h = Math.atan2(-Math.sin(t * 0.35), Math.cos(t * 0.35));
      this.onPeerState(ghostId, 'Wandering Spirit', { x, z, h, m: 1 }, Date.now());
    }, 1000 / this.cfg.NET.sendHz);
  }

  peerCount() { return 1; }

  dispose() {
    clearInterval(this._timer);
  }
}
