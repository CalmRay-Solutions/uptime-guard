import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, setToken, type AppSettings } from "../lib/api";
import { Icon, type IconName } from "./Icon";
import { StatusGlyph } from "./ui";

const RETENTION_OPTIONS: [number, string][] = [
  [14, "14 days"], [30, "30 days"], [60, "60 days"], [90, "90 days"],
  [180, "180 days"], [365, "1 year"], [0, "Keep forever"],
];

type SectionId = "notifications" | "telegram" | "security" | "data" | "appearance";
const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "telegram", label: "Telegram", icon: "send" },
  { id: "security", label: "Security", icon: "lock" },
  { id: "data", label: "Data", icon: "gauge" },
  { id: "appearance", label: "Appearance", icon: "sun" },
];

export function Settings({
  theme, onTheme, sound, onToggleSound, notify, onToggleNotify, onLogout, say,
}: {
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
  sound: boolean;
  onToggleSound: () => void;
  notify: boolean;
  onToggleNotify: () => void;
  onLogout: () => void;
  say: (m: string) => void;
}) {
  const [section, setSection] = useState<SectionId>("notifications");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const reload = () => api.getSettings().then(setSettings).catch(() => {});
  useEffect(() => { reload(); }, []);

  return (
    <div className="screen">
      <div className="settings2">
        <nav className="rail" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? "on" : ""} onClick={() => setSection(s.id)}>
              <Icon n={s.icon} s={15} />{s.label}
            </button>
          ))}
        </nav>

        <div className="panel">
          {section === "notifications" && <Notifications sound={sound} onToggleSound={onToggleSound} notify={notify} onToggleNotify={onToggleNotify} />}
          {section === "telegram" && <Telegram settings={settings} onSaved={reload} say={say} />}
          {section === "security" && <Security settings={settings} onTotpSaved={reload} onLogout={onLogout} say={say} />}
          {section === "data" && <DataRetention settings={settings} onSaved={setSettings} say={say} />}
          {section === "appearance" && <Appearance theme={theme} onTheme={onTheme} />}
        </div>
      </div>
    </div>
  );
}

function Notifications({ sound, onToggleSound, notify, onToggleNotify }: { sound: boolean; onToggleSound: () => void; notify: boolean; onToggleNotify: () => void }) {
  const notifPerm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  return (
    <div className="sec">
      <div className="h"><span className="name">Notifications</span></div>
      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        <Row icon={sound ? "bell" : "bellOff"} title="Alert sounds" desc="Play a tone in this tab when a service goes down or recovers." on={sound} onToggle={onToggleSound} />
        <Row
          icon="siren"
          title="Desktop notifications"
          desc={notifPerm === "denied" ? "Blocked in your browser. Allow notifications for this site to enable." : "System alerts on status changes - delivered even when the app is closed."}
          on={notify && notifPerm === "granted"}
          disabled={notifPerm === "denied" || notifPerm === "unsupported"}
          onToggle={onToggleNotify}
        />
      </div>
    </div>
  );
}

function Telegram({ settings, onSaved, say }: { settings: AppSettings | null; onSaved: () => void; say: (m: string) => void }) {
  const tg = settings?.telegram;
  const [token, setToken] = useState("");
  const [chat, setChat] = useState("");
  const [thread, setThread] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  useEffect(() => { if (tg) { setChat(tg.chat_id); setThread(tg.thread_id); } }, [tg?.chat_id, tg?.thread_id]);

  async function save() {
    setBusy("save");
    try {
      const patch: Record<string, string> = { telegram_chat_id: chat, telegram_thread_id: thread };
      if (token.trim()) patch.telegram_bot_token = token.trim(); // blank = keep existing
      await api.updateSettings(patch);
      setToken("");
      onSaved();
      say("Telegram settings saved");
    } catch { say("Could not save Telegram settings"); } finally { setBusy(""); }
  }
  async function test() {
    setBusy("test");
    try { await api.telegramTest(); say("Test message sent - check Telegram"); }
    catch (e) { say(e instanceof Error ? e.message : "Test failed"); } finally { setBusy(""); }
  }

  return (
    <div className="sec">
      <div className="h"><span className="name">Telegram alerts</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: tg?.has_token ? "var(--up)" : "var(--faint)" }}>
          <StatusGlyph k={tg?.has_token ? "up" : "unknown"} s={12} />{tg?.has_token ? "Configured" : "Not set"}
        </span>
      </div>
      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 13 }}>
        <div className="field">
          <label className="fl">Bot token</label>
          <input className="inp mono" type="password" value={token} placeholder={tg?.has_token ? `${tg.token_hint} · leave blank to keep` : "123456:ABC-…  from @BotFather"} onChange={(e) => setToken(e.target.value)} />
        </div>
        <div className="tgrid">
          <div className="field">
            <label className="fl">Chat / channel ID</label>
            <input className="inp mono" value={chat} placeholder="-1001234567890" onChange={(e) => setChat(e.target.value)} />
          </div>
          <div className="field">
            <label className="fl">Thread ID <span style={{ color: "var(--faint)", fontWeight: 400 }}>· optional</span></label>
            <input className="inp mono" value={thread} placeholder="topic id" onChange={(e) => setThread(e.target.value)} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--faint)" }}>
          Message <strong>@BotFather</strong> to create a bot. For a channel, add the bot as admin; the ID looks like <code>-100…</code>. Thread ID targets a specific topic in a forum group.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn pri t-fast press" onClick={save} disabled={busy !== ""}>{busy === "save" ? "Saving…" : "Save"}</button>
          <button className="btn t-fast press" onClick={test} disabled={busy !== "" || !tg?.has_token}>{busy === "test" ? "Sending…" : "Send test"}</button>
        </div>
      </div>
    </div>
  );
}

function Security({ settings, onTotpSaved, onLogout, say }: { settings: AppSettings | null; onTotpSaved: () => void; onLogout: () => void; say: (m: string) => void }) {
  const [revoking, setRevoking] = useState(false);
  async function revokeOthers() {
    if (!confirm("Sign out every other device? Your current session stays active; all other logins end immediately.")) return;
    setRevoking(true);
    try { const { token } = await api.revokeSessions(); setToken(token); say("All other sessions signed out"); }
    catch { say("Could not sign out other sessions"); } finally { setRevoking(false); }
  }

  return (
    <>
      <TotpCard configured={settings?.totp.configured ?? false} onSaved={onTotpSaved} say={say} />
      <div className="sec">
        <div className="h"><span className="name">Session</span></div>
        <div style={{ padding: "16px 14px", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Signed in as <strong style={{ color: "var(--fg)" }}>owner</strong> · password + authenticator</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 3 }}>Token stored in this browser · 30-day session</div>
          </div>
          <button className="btn t-fast press" disabled={revoking} onClick={revokeOthers}>{revoking ? "Signing out…" : "Log out other devices"}</button>
          <button className="btn t-fast press" style={{ borderColor: "var(--down)", color: "var(--down)", fontWeight: 600 }} onClick={onLogout}>Log out</button>
        </div>
      </div>
    </>
  );
}

function TotpCard({ configured, onSaved, say }: { configured: boolean; onSaved: () => void; say: (m: string) => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function begin() {
    setBusy(true);
    try {
      const { secret, otpauth } = await api.totpNew();
      const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 190, color: { dark: "#0b0e14", light: "#ffffff" } });
      setSetup({ secret, otpauth, qr }); setCode("");
    } catch { say("Could not start authenticator setup"); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!setup) return;
    setBusy(true);
    try { await api.totpConfirm(setup.secret, code.trim()); setSetup(null); onSaved(); say("Authenticator updated"); }
    catch (e) { say(e instanceof Error ? e.message : "Invalid code"); } finally { setBusy(false); }
  }

  return (
    <div className="sec">
      <div className="h"><span className="name">Two-factor authentication</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: configured ? "var(--up)" : "var(--warn)" }}>
          <StatusGlyph k={configured ? "up" : "warn"} s={12} />{configured ? "Configured" : "Not set"}
        </span>
      </div>
      <div style={{ padding: "16px 14px" }}>
        {!setup ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <div style={{ flex: "1 1 260px", fontSize: 12.5, color: "var(--muted)" }}>
              A 6-digit code from your authenticator app is required at login. Reconfiguring replaces the current authenticator.
            </div>
            <button className="btn t-fast press" disabled={busy} onClick={begin}>{busy ? "Preparing…" : configured ? "Reconfigure" : "Set up authenticator"}</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
            <img src={setup.qr} alt="Authenticator QR code" width={158} height={158} style={{ borderRadius: 10, flex: "none", background: "#fff", padding: 6 }} />
            <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Scan the QR in Google Authenticator / Authy, or enter this key manually:</div>
              <div style={{ display: "flex", gap: 8 }}>
                <code className="mono" style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--sunken)", fontSize: 12, overflowWrap: "anywhere" }}>{setup.secret}</code>
                <button className="btn t-fast press" onClick={() => { navigator.clipboard?.writeText(setup.secret); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Icon n="copy" s={13} />{copied ? "Copied" : "Copy"}</button>
              </div>
              <label className="fl" style={{ marginTop: 4 }}>Enter the 6-digit code to confirm</label>
              <input className="inp mono" inputMode="numeric" maxLength={6} value={code} placeholder="000000" style={{ fontSize: 17, letterSpacing: ".22em", maxWidth: 180 }} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn pri t-fast press" disabled={busy || code.length !== 6} onClick={confirm}>{busy ? "Verifying…" : "Confirm & save"}</button>
                <button className="btn t-fast press" onClick={() => setSetup(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DataRetention({ settings, onSaved, say }: { settings: AppSettings | null; onSaved: (s: AppSettings) => void; say: (m: string) => void }) {
  const [saving, setSaving] = useState(false);
  async function change(days: number) {
    setSaving(true);
    try { const s = await api.updateSettings({ retention_days: days }); onSaved(s); say(days === 0 ? "History kept forever" : `History kept for ${days} days`); }
    catch { say("Could not update retention"); } finally { setSaving(false); }
  }
  return (
    <div className="sec">
      <div className="h"><span className="name">Data retention</span></div>
      <div style={{ padding: "16px 14px" }}>
        <label className="fl">Keep check history &amp; resolved incidents for</label>
        <select className="inp" style={{ maxWidth: 220 }} value={settings?.retention_days ?? 60} disabled={settings == null || saving} onChange={(e) => change(Number(e.target.value))}>
          {RETENTION_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          Older records are pruned automatically each day. “Keep forever” disables pruning - history grows without limit.
        </div>
      </div>
    </div>
  );
}

function Appearance({ theme, onTheme }: { theme: "light" | "dark"; onTheme: (t: "light" | "dark") => void }) {
  return (
    <div className="sec">
      <div className="h"><span className="name">Appearance</span></div>
      <div style={{ padding: "16px 14px" }}>
        <label className="fl">Theme</label>
        <div style={{ display: "flex", gap: 2 }}>
          {(["light", "dark"] as const).map((t) => (
            <button key={t} className={`tabc${theme === t ? " on" : ""}`} onClick={() => onTheme(t)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon n={t === "light" ? "sun" : "moon"} s={13} />{t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, title, desc, on, disabled, onToggle }: { icon: "bell" | "bellOff" | "siren"; title: string; desc: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ color: on ? "var(--accent)" : "var(--faint)", flex: "none" }}><Icon n={icon} s={17} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{desc}</div>
      </div>
      <button className={`toggle${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={title} disabled={disabled} onClick={onToggle}>
        <span className="knob" />
      </button>
    </div>
  );
}
