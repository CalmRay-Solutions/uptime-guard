import { useEffect, useState } from "react";
import { api, setToken } from "../lib/api";
import { Icon } from "./Icon";
import { StatusGlyph } from "./ui";

const RETENTION_OPTIONS: [number, string][] = [
  [14, "14 days"], [30, "30 days"], [60, "60 days"], [90, "90 days"],
  [180, "180 days"], [365, "1 year"], [0, "Keep forever"],
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
  const notifPerm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";

  const [retention, setRetention] = useState<number | null>(null);
  const [savingRetention, setSavingRetention] = useState(false);
  useEffect(() => {
    api.getSettings().then((s) => setRetention(s.retention_days)).catch(() => {});
  }, []);
  async function changeRetention(days: number) {
    setSavingRetention(true);
    try {
      const s = await api.updateSettings({ retention_days: days });
      setRetention(s.retention_days);
      say(days === 0 ? "History kept forever" : `History kept for ${days} days`);
    } catch {
      say("Could not update retention");
    } finally {
      setSavingRetention(false);
    }
  }

  const [revoking, setRevoking] = useState(false);
  async function revokeOthers() {
    if (!confirm("Sign out every other device? Your current session stays active; all other logins are ended immediately.")) return;
    setRevoking(true);
    try {
      const { token } = await api.revokeSessions();
      setToken(token); // keep this browser signed in with a fresh token
      say("All other sessions signed out");
    } catch {
      say("Could not sign out other sessions");
    } finally {
      setRevoking(false);
    }
  }
  return (
    <div className="screen" style={{ maxWidth: 760 }}>
      <div className="sec">
        <div className="h"><span className="name">Alerts</span></div>
        <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Row
            icon={sound ? "bell" : "bellOff"}
            title="Alert sounds"
            desc="Play a tone in this tab when a service goes down or recovers."
            on={sound}
            onToggle={onToggleSound}
          />
          <Row
            icon="siren"
            title="Desktop notifications"
            desc={
              notifPerm === "denied"
                ? "Blocked in your browser. Allow notifications for this site to enable."
                : "System alerts on status changes — delivered even when the app is closed."
            }
            on={notify && notifPerm === "granted"}
            disabled={notifPerm === "denied" || notifPerm === "unsupported"}
            onToggle={onToggleNotify}
          />
        </div>
      </div>

      <div className="sec">
        <div className="h"><span className="name">Telegram alerts</span></div>
        <div style={{ padding: "16px 14px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 8, background: "var(--up-soft)", flex: "none" }}>
            <StatusGlyph k="up" s={13} /><span style={{ fontSize: 12.5, fontWeight: 600 }}>Configured</span>
          </div>
          <div style={{ flex: "1 1 220px", minWidth: 0, fontSize: 12.5, color: "var(--muted)" }}>
            Server-side alerts go to the Telegram chat set on the Worker. Fires on every up→down and down→up change, and when a certificate or domain enters its warning window.
          </div>
        </div>
      </div>

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

      <div className="sec">
        <div className="h"><span className="name">Data retention</span></div>
        <div style={{ padding: "16px 14px" }}>
          <label className="fl">Keep check history &amp; resolved incidents for</label>
          <select
            className="inp"
            style={{ maxWidth: 220 }}
            value={retention ?? 60}
            disabled={retention == null || savingRetention}
            onChange={(e) => changeRetention(Number(e.target.value))}
          >
            {RETENTION_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            Older records are pruned automatically each day. “Keep forever” disables pruning — history grows without limit.
          </div>
        </div>
      </div>

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
      <button
        className={`toggle${on ? " on" : ""}`}
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="knob" />
      </button>
    </div>
  );
}
