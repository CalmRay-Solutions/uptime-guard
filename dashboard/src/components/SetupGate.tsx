import { useState } from "react";
import QRCode from "qrcode";
import { setupAccount, setupTotpNew, getConfig } from "../lib/api";
import { Icon } from "./Icon";

type Totp = { secret: string; otpauth: string; qr: string };

/**
 * First-run wizard. Two required steps: owner password, then authenticator -
 * the account is only created once both are set, so an instance is never live
 * with a single factor.
 */
export function SetupGate({ onReady }: { onReady: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [totp, setTotp] = useState<Totp | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const passwordReady = password.length >= 8 && confirm === password;

  async function toStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordReady) return;
    setBusy(true);
    setError(null);
    try {
      // Mint the secret once and keep it while the user scans; re-minting on
      // re-render would invalidate the QR they are looking at.
      const next = totp ?? (await mintTotp());
      setTotp(next);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function mintTotp(): Promise<Totp> {
    const { secret, otpauth } = await setupTotpNew(getConfig().baseUrl);
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 190, color: { dark: "#0b0e14", light: "#ffffff" } });
    return { secret, otpauth, qr };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!totp || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await setupAccount(getConfig().baseUrl, password, totp.secret, code);
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
        <form className="box" onSubmit={step === 1 ? toStep2 : submit}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 30 }}>
            <div className="logo" style={{ width: 26, height: 26, borderRadius: 8 }}><Icon n="shield" s={14} /></div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 500, letterSpacing: ".1em" }}>UPTIME GUARD</div>
          </div>

          <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: ".1em", marginBottom: 8 }}>
            STEP {step} OF 2
          </div>
          <h1>{step === 1 ? "Create your account" : "Add your authenticator"}</h1>
          <p className="lead">
            {step === 1
              ? "First-time setup - choose an owner password. Next you'll pair an authenticator app, which is required."
              : "Scan the code in your authenticator app, then confirm the 6 digits it shows. You'll need this at every sign-in."}
          </p>

          {error && (
            <div role="alert" style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px", marginBottom: 18, border: "1px solid var(--down)", borderRadius: 9, background: "var(--down-soft)" }}>
              <div style={{ width: 8, height: 8, background: "var(--down)", borderRadius: "50%", marginTop: 5, flex: "none" }} />
              <div style={{ fontWeight: 600, fontSize: 13 }}>{error}</div>
            </div>
          )}

          {step === 1 ? (
            <>
              <label className="fl">Password</label>
              <input className="inp" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: 6 }} />
              <div style={{ fontSize: 12, color: tooShort ? "var(--warn)" : "var(--faint)", marginBottom: 16 }}>
                At least 8 characters.
              </div>

              <label className="fl">Confirm password</label>
              <input className="inp" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ marginBottom: 6 }} />
              <div style={{ fontSize: 12, color: mismatch ? "var(--down)" : "var(--faint)", marginBottom: 20 }}>
                {mismatch ? "Passwords don't match." : "Re-enter your password."}
              </div>

              <button className="btn pri press" type="submit" disabled={busy || !passwordReady} style={{ width: "100%", justifyContent: "center", padding: 11 }}>
                {busy ? "Preparing…" : "Continue"}
              </button>
            </>
          ) : (
            <>
              {totp && (
                <>
                  <img src={totp.qr} alt="Authenticator QR code" width={158} height={158} style={{ borderRadius: 10, background: "#fff", padding: 6, marginBottom: 14 }} />
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
                    Scan in Google Authenticator / Authy, or enter this key manually:
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <code className="mono" style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--sunken)", fontSize: 12, overflowWrap: "anywhere" }}>{totp.secret}</code>
                    <button type="button" className="btn t-fast press" onClick={() => { navigator.clipboard?.writeText(totp.secret); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                      <Icon n="copy" s={13} />{copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--warn)", marginBottom: 18 }}>
                    Keep this key somewhere safe. It is the only way back in if you lose the device.
                  </div>
                </>
              )}

              <label className="fl">6-digit code</label>
              <input className="inp mono" inputMode="numeric" maxLength={6} autoFocus value={code} placeholder="000000" onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ fontSize: 18, letterSpacing: ".26em", marginBottom: 20 }} />

              <button className="btn pri press" type="submit" disabled={busy || code.length !== 6} style={{ width: "100%", justifyContent: "center", padding: 11 }}>
                {busy ? "Creating…" : "Create account & sign in"}
              </button>
              <button type="button" className="mono" onClick={() => { setStep(1); setError(null); }} style={{ marginTop: 16, padding: 0, border: 0, background: "none", color: "var(--faint)", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>
                back to password
              </button>
            </>
          )}
        </form>
      </div>
      <div className="aside">
        <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: ".1em" }}>WELCOME</div>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.5 }}>
          Your Uptime Guard is deployed and ready.
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: "34ch" }}>
          Claim this instance with a password and an authenticator app, then add your first monitor. Everything runs on your own Cloudflare account.
        </div>
      </div>
    </div>
  );
}
