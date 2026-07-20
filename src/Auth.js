// ============================================================
// Auth.js — real account identity (email + password).
//
// No anonymous sessions: a player must sign in or register before
// entering the town, which is what makes server-authoritative state
// trustworthy — auth.uid() is a real, durable person, not a throwaway
// a cheater can re-mint. The session is persisted by the Supabase
// client, so returning players skip the gate.
//
// Presents a login/register overlay and resolves only once a session
// exists. Offline (no keys) it refuses — server-authoritative play
// requires the server.
// ============================================================

const GATE_CSS = `
  #authGate {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background:
      linear-gradient(rgba(26,21,18,0.72), rgba(20,16,12,0.9)),
      url('assets/ui/loading-bg.png') center / cover no-repeat, #1a1512;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #authGate .card {
    width: min(340px, calc(100vw - 32px));
    background: linear-gradient(160deg, rgba(42,33,24,0.97), rgba(26,20,14,0.97));
    border: 2px solid rgba(201,162,75,0.55); border-radius: 14px;
    box-shadow: 0 16px 50px rgba(0,0,0,0.6);
    padding: 26px 24px; color: #e9ddc2;
    display: flex; flex-direction: column; gap: 12px;
  }
  #authGate h1 {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 24px;
    letter-spacing: 0.12em; color: #c9a24b; text-align: center; margin-bottom: 2px;
  }
  #authGate .tab { display: flex; gap: 6px; }
  #authGate .tab button {
    flex: 1; background: rgba(0,0,0,0.25); color: #e9ddc2;
    border: 1px solid rgba(201,162,75,0.3); border-radius: 8px;
    padding: 9px; font-weight: 600; cursor: pointer; font-size: 13px;
  }
  #authGate .tab button.on { background: rgba(201,162,75,0.28); border-color: rgba(201,162,75,0.6); }
  #authGate input {
    background: rgba(0,0,0,0.3); border: 1px solid rgba(201,162,75,0.3);
    border-radius: 8px; padding: 11px 13px; color: #e9ddc2; font-size: 14px;
  }
  #authGate .go {
    background: #c9a24b; color: #1a1512; border: none; border-radius: 9px;
    padding: 12px; font-family: 'Cinzel', serif; font-weight: 700;
    letter-spacing: 0.08em; font-size: 15px; cursor: pointer; margin-top: 4px;
  }
  #authGate .go:disabled { opacity: 0.5; cursor: default; }
  #authGate .msg { font-size: 12px; text-align: center; min-height: 16px; color: #d99; }
  #authGate .msg.ok { color: #9c9; }
  #authGate .hint { font-size: 11px; opacity: 0.6; text-align: center; }
`;

export class Auth {
  constructor(cfg) {
    this.cfg = cfg;
    this.supa = null;
    this.user = null;
    this.online = false;
  }

  async init() {
    try {
      const { getSupabase } = await import('./net/supa.js');
      this.supa = await getSupabase(this.cfg);
    } catch { this.supa = null; }

    if (!this.supa) {
      this._fatalNoServer();
      return new Promise(() => {}); // never resolves — the town stays closed
    }

    const { data: { session } } = await this.supa.auth.getSession();
    if (session?.user) {
      this.user = session.user;
      this.online = true;
      return this._identity();
    }
    return this._gate();
  }

  _identity() {
    return { id: this.user.id, email: this.user.email, name: null, online: true };
  }

  signOut() {
    return this.supa?.auth.signOut().then(() => location.reload());
  }

  // ---------------- gate UI ----------------
  _gate() {
    const style = document.createElement('style');
    style.textContent = GATE_CSS;
    document.head.appendChild(style);

    const gate = document.createElement('div');
    gate.id = 'authGate';
    gate.innerHTML = `
      <div class="card">
        <h1>TOWN-SQUARED</h1>
        <div class="tab">
          <button data-mode="login" class="on">Sign in</button>
          <button data-mode="register">Register</button>
        </div>
        <input type="email" placeholder="Email" autocomplete="email">
        <input type="password" placeholder="Password" autocomplete="current-password">
        <button class="go">ENTER</button>
        <div class="msg"></div>
        <div class="hint">Your character, gold, and friends are tied to this account.</div>
      </div>`;
    document.body.appendChild(gate);

    const [emailEl, passEl] = gate.querySelectorAll('input');
    const goBtn = gate.querySelector('.go');
    const msg = gate.querySelector('.msg');
    const tabs = gate.querySelectorAll('.tab button');
    let mode = 'login';

    tabs.forEach(t => t.addEventListener('click', () => {
      mode = t.dataset.mode;
      tabs.forEach(x => x.classList.toggle('on', x === t));
      goBtn.textContent = mode === 'login' ? 'ENTER' : 'CREATE ACCOUNT';
      msg.textContent = ''; msg.className = 'msg';
    }));

    return new Promise(resolve => {
      const attempt = async () => {
        const email = emailEl.value.trim();
        const password = passEl.value;
        if (!email || password.length < 6) {
          msg.className = 'msg'; msg.textContent = 'Enter an email and a password of 6+ characters.';
          return;
        }
        goBtn.disabled = true; msg.className = 'msg'; msg.textContent = 'One moment…';
        try {
          if (mode === 'register') {
            const { error } = await this.supa.auth.signUp({ email, password });
            if (error) throw error;
            const { data: { session } } = await this.supa.auth.getSession();
            if (!session) {
              msg.className = 'msg ok';
              msg.textContent = 'Check your email to confirm, then sign in.';
              goBtn.disabled = false;
              return;
            }
            this.user = session.user;
          } else {
            const { data, error } = await this.supa.auth.signInWithPassword({ email, password });
            if (error) throw error;
            this.user = data.user;
          }
          this.online = true;
          gate.remove();
          resolve(this._identity());
        } catch (err) {
          msg.className = 'msg';
          msg.textContent = err?.message ?? 'That did not work — try again.';
          goBtn.disabled = false;
        }
      };
      goBtn.addEventListener('click', attempt);
      passEl.addEventListener('keydown', e => { if (e.code === 'Enter') attempt(); });
    });
  }

  _fatalNoServer() {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:#1a1512;color:#e9ddc2;font-family:sans-serif;text-align:center;padding:24px;';
    d.innerHTML = `<div><h1 style="font-family:Cinzel,serif;color:#c9a24b;letter-spacing:.1em">TOWN-SQUARED</h1>
      <p style="opacity:.8;margin-top:12px">The town is unreachable — no server connection is configured.</p></div>`;
    document.body.appendChild(d);
  }
}
