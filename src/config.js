// ============================================================
// config.js — one place to tune the whole game
// ============================================================

export const CONFIG = {
  // ---- Supabase ----------------------------------------------------------
  // Leave these empty to run in offline/local mode (a simulated peer wanders
  // around so you can see remote interpolation working). Paste your project
  // URL + anon key to go live — nothing else changes.
  SUPABASE_URL: 'https://pqemruckngvnepvplzsd.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ZQFhR9oBEIazCo6MSujUxw_j-6zfYhJ',
  ROOM: 'town:Vale',

  // ---- NPC AI (LLM conversations) -----------------------------------------
  // Requires Supabase keys above AND the npc-chat Edge Function deployed
  // (see supabase/functions/npc-chat/). Flip enabled to true once deployed.
  NPC_AI: {
    enabled: false,
  },

  // ---- Camera ------------------------------------------------------------
  CAMERA: {
    pitchDeg: 55,        // fixed downward tilt (the "locked" perspective)
    distance: 22,        // starting orbit distance
    minDistance: 10,
    maxDistance: 42,
    rotateSpeed: 0.0055, // radians per pixel of horizontal drag
    followLerp: 6.0,     // how snappily the camera chases the player
    fov: 45,
  },

  // ---- Player ------------------------------------------------------------
  PLAYER: {
    speed: 4.2,          // metres / second
    turnLerp: 12.0,
    radius: 0.45,        // collision circle
  },

  // ---- Network -----------------------------------------------------------
  NET: {
    sendHz: 10,          // position broadcast rate
    interpDelayMs: 120,  // remote players render this far in the past
    peerTimeoutMs: 6000, // drop peers we haven't heard from
  },

  WORLD_URL: 'data/town.json',
};

// Deterministic-ish fantasy name for this session's player
const FIRST = ['Bram','Wren','Sylas','Maeve','Torv','Isolde','Fenn','Aldric','Nyra','Corin'];
const LAST  = ['Ashfoot','Thistledown','Emberwick','Hollowbrook','Ironvale','Duskmere'];
export function randomName() {
  return FIRST[(Math.random() * FIRST.length) | 0] + ' ' +
         LAST[(Math.random() * LAST.length) | 0];
}
