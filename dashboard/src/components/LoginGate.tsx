import { useEffect, useState } from "react";
import { login, getConfig, getMeta } from "../lib/api";
import { Icon } from "./Icon";

export function LoginGate({ onReady }: { onReady: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [baseUrl, setBaseUrl] = useState(getConfig().baseUrl);
  const [showAdv, setShowAdv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  // Demo instances accept a password alone — hide the authenticator field.
  useEffect(() => {
    getMeta(baseUrl.trim()).then((m) => setDemo(m.demo)).catch(() => {});
  }, [baseUrl]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || (!demo && !code.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await login(baseUrl.trim(), password, demo ? "" : code.trim());
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
          <h1>Sign in</h1>
          <p className="lead">{demo ? "Live demo — explore with sample data." : "Owner access only. Sessions last 30 days."}</p>

          {demo && (
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px", marginBottom: 18, border: "1px solid var(--border)", borderRadius: 9, background: "var(--up-soft)" }}>
              <span style={{ color: "var(--accent)", flex: "none", marginTop: 1 }}><Icon n="info" s={15} /></span>
              <div style={{ fontSize: 12.5, color: "var(--fg)" }}>
                Demo password is <strong>demo</strong> — no authenticator needed. This instance uses sample data and resets periodically.
              </div>
            </div>
          )}

          {error && (
            <div role="alert" style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px", marginBottom: 18, border: "1px solid var(--down)", borderRadius: 9, background: "var(--down-soft)" }}>
              <div style={{ width: 8, height: 8, background: "var(--down)", borderRadius: "50%", marginTop: 5, flex: "none" }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{error}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Check the 6-digit code is current. Codes rotate every 30 seconds.</div>
              </div>
            </div>
          )}

          <label className="fl">Password</label>
          <input className="inp" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: 16 }} />

          {!demo && (
            <>
              <label className="fl">Authenticator code</label>
              <input className="inp mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" style={{ fontSize: 18, letterSpacing: ".26em", marginBottom: 6 }} />
              <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 20 }}>6 digits from your authenticator app.</div>
            </>
          )}

          <button className="btn pri press" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", padding: 11 }}>
            {busy ? "Signing in…" : "Sign In"}
          </button>

          <div style={{ marginTop: 18 }}>
            <button type="button" className="mono" onClick={() => setShowAdv((v) => !v)} style={{ padding: 0, border: 0, background: "none", color: "var(--faint)", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>
              {showAdv ? "hide worker URL" : "advanced · worker URL"}
            </button>
            {showAdv && (
              <input className="inp mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://uptime.you.workers.dev" style={{ marginTop: 10, fontSize: 12.5, padding: "9px 11px" }} />
            )}
          </div>
        </form>
      </div>
      <div className="aside">
        <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: ".1em" }}>MONITORING WHILE YOU'RE AWAY</div>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.5 }}>
          Uptime Guard keeps checking your servers, sites, certificates and cron jobs on its own.
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: "34ch" }}>
          Telegram alerts fire the moment something goes down, whether or not this dashboard is open.
        </div>
      </div>
    </div>
  );
}
