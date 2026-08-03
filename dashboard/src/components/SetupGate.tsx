import { useState } from "react";
import { setupAccount, getConfig } from "../lib/api";
import { Icon } from "./Icon";

export function SetupGate({ onReady }: { onReady: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 8 && confirm === password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await setupAccount(getConfig().baseUrl, password);
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="pane">
        <form className="box" onSubmit={submit}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 30 }}>
            <div className="logo" style={{ width: 26, height: 26, borderRadius: 8 }}><Icon n="shield" s={14} /></div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 500, letterSpacing: ".1em" }}>UPTIME GUARD</div>
          </div>
          <h1>Create your account</h1>
          <p className="lead">First-time setup — choose an owner password. You can enable two-factor authentication next, in Settings.</p>

          {error && (
            <div role="alert" style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px", marginBottom: 18, border: "1px solid var(--down)", borderRadius: 9, background: "var(--down-soft)" }}>
              <div style={{ width: 8, height: 8, background: "var(--down)", borderRadius: "50%", marginTop: 5, flex: "none" }} />
              <div style={{ fontWeight: 600, fontSize: 13 }}>{error}</div>
            </div>
          )}

          <label className="fl">Password</label>
          <input className="inp" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 12, color: tooShort ? "var(--warn)" : "var(--faint)", marginBottom: 16 }}>
            {tooShort ? "At least 8 characters." : "At least 8 characters."}
          </div>

          <label className="fl">Confirm password</label>
          <input className="inp" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 12, color: mismatch ? "var(--down)" : "var(--faint)", marginBottom: 20 }}>
            {mismatch ? "Passwords don't match." : "Re-enter your password."}
          </div>

          <button className="btn pri press" type="submit" disabled={busy || !ready} style={{ width: "100%", justifyContent: "center", padding: 11 }}>
            {busy ? "Creating…" : "Create account & sign in"}
          </button>
        </form>
      </div>
      <div className="aside">
        <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: ".1em" }}>WELCOME</div>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.5 }}>
          Your Uptime Guard is deployed and ready.
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: "34ch" }}>
          Set a password to claim this instance, then add your first monitor. Everything runs on your own Cloudflare account.
        </div>
      </div>
    </div>
  );
}
