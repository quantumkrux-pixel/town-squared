// ============================================================
// CharacterCreate.js — one-time character setup on first login.
//
// Shown only when the server profile has name_set = false. Claims a
// unique display name via the set_display_name RPC (validated and
// deduped server-side), then never appears again for that account.
//
// Resolves with the chosen name so boot can seed identity + nametag.
// ============================================================

const CSS = `
  #charCreate {
    position: fixed; inset: 0; z-index: 90;
    display: flex; align-items: center; justify-content: center;
    background:
      linear-gradient(rgba(26,21,18,0.74), rgba(20,16,12,0.92)),
      url('assets/ui/loading-bg.png') center / cover no-repeat, #1a1512;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #charCreate .card {
    width: min(360px, calc(100vw - 32px));
    background: linear-gradient(160deg, rgba(42,33,24,0.97), rgba(26,20,14,0.97));
    border: 2px solid rgba(201,162,75,0.55); border-radius: 14px;
    box-shadow: 0 16px 50px rgba(0,0,0,0.6);
    padding: 28px 24px; color: #e9ddc2;
    display: flex; flex-direction: column; gap: 14px; text-align: center;
  }
  #charCreate h1 {
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 21px;
    letter-spacing: 0.08em; color: #c9a24b;
  }
  #charCreate p { font-size: 13px; color: rgba(233,221,194,0.75); line-height: 1.5; margin-top: -6px; }
  #charCreate .portrait {
    width: 84px; height: 84px; border-radius: 50%; align-self: center;
    border: 2px solid rgba(201,162,75,0.55); overflow: hidden;
    background: #d9c9a8; color: #6b5330;
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 38px;
    display: flex; align-items: center; justify-content: center;
  }
  #charCreate input {
    background: rgba(0,0,0,0.3); border: 1px solid rgba(201,162,75,0.35);
    border-radius: 9px; padding: 12px 14px; color: #e9ddc2; font-size: 16px;
    text-align: center; font-family: 'Cinzel', serif; letter-spacing: 0.04em;
  }
  #charCreate .go {
    background: #c9a24b; color: #1a1512; border: none; border-radius: 9px;
    padding: 13px; font-family: 'Cinzel', serif; font-weight: 700;
    letter-spacing: 0.08em; font-size: 15px; cursor: pointer;
  }
  #charCreate .go:disabled { opacity: 0.5; cursor: default; }
  #charCreate .msg { font-size: 12px; min-height: 15px; color: #d99; }
`;

const SAMPLE = ['Wren Ashfoot', 'Bram Quill', 'Sable Merrow', 'Tomas Vane', 'Elin Marsh', 'Corvin Reed'];

export class CharacterCreate {
  constructor({ auth, cfg }) {
    this.auth = auth;
    this.cfg = cfg;
  }

  /** Returns the chosen name, or null if creation isn't needed. */
  async maybeRun(profileRow) {
    if (profileRow?.name_set) return null; // already created

    const { getSupabase } = await import('./net/supa.js');
    const supa = await getSupabase(this.cfg);
    if (!supa) return null;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const gate = document.createElement('div');
    gate.id = 'charCreate';
    const placeholder = SAMPLE[(Math.random() * SAMPLE.length) | 0];
    gate.innerHTML = `
      <div class="card">
        <div class="portrait">?</div>
        <h1>Name Your Traveler</h1>
        <p>This is how the town — and your future companions — will know you. Choose well; it's yours to keep.</p>
        <input type="text" maxlength="20" placeholder="${placeholder}" autocomplete="off">
        <button class="go">ENTER THE TOWN</button>
        <div class="msg"></div>
      </div>`;
    document.body.appendChild(gate);

    const input = gate.querySelector('input');
    const portrait = gate.querySelector('.portrait');
    const goBtn = gate.querySelector('.go');
    const msg = gate.querySelector('.msg');
    input.focus();

    // live initial in the portrait as they type
    input.addEventListener('input', () => {
      const c = input.value.trim().charAt(0).toUpperCase();
      portrait.textContent = c || '?';
    });

    return new Promise(resolve => {
      const attempt = async () => {
        const name = input.value.trim();
        if (name.length < 3) { msg.textContent = 'At least 3 characters.'; return; }
        goBtn.disabled = true; msg.style.color = '#cc9'; msg.textContent = 'Claiming your name…';
        const { data, error } = await supa.rpc('set_display_name', { p_name: name });
        if (error || data?.error) {
          msg.style.color = '#d99';
          msg.textContent = data?.error ?? error?.message ?? 'Try another name.';
          goBtn.disabled = false;
          return;
        }
        gate.remove();
        resolve(data.name);
      };
      goBtn.addEventListener('click', attempt);
      input.addEventListener('keydown', e => { if (e.code === 'Enter') attempt(); });
    });
  }
}
