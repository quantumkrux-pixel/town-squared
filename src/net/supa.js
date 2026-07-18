// ============================================================
// supa.js — one Supabase client, shared by every system.
// (NetworkManager, Containers, and future server-backed systems
// all use this instead of creating their own.)
// ============================================================

let _client = null;

export async function getSupabase(cfg) {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
  if (!_client) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    _client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  return _client;
}
