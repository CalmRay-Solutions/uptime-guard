import { useEffect, useState } from "react";
import { api, type CheckType, type CreateServiceInput, type Service } from "../lib/api";
import { TYPES, cfg } from "../lib/derive";
import { Icon } from "./Icon";

const STEP: Record<CheckType, string> = { http: "REQUEST", tcp: "CONNECTION", dns: "RECORD", tls: "CERTIFICATE", domain: "REGISTRAR", heartbeat: "SCHEDULE" };
const INTERVALS: [string, string, number][] = [["1m", "1 min", 60], ["5m", "5 min", 300], ["15m", "15 min", 900], ["daily", "Daily", 86400]];

const DEFAULT_FORM = {
  name: "", url: "", method: "GET", statusMin: "200", statusMax: "299", keyword: "", keywordMode: "present",
  host: "", port: "", domain: "", record: "A", expected: "", warnDays: "", every: "24h", grace: "30m",
};
function fmtDur(sec: number): string {
  if (sec % 86400 === 0) return sec / 86400 + "d";
  if (sec % 3600 === 0) return sec / 3600 + "h";
  return Math.round(sec / 60) + "m";
}
/** Map an existing service back into editable form fields. */
function formFromService(s: Service): Record<string, string> {
  const c = cfg(s);
  const f = { ...DEFAULT_FORM, name: s.name };
  if (s.check_type === "http") {
    f.url = s.url; f.method = s.method;
    f.statusMin = String(s.expected_status_min); f.statusMax = String(s.expected_status_max);
    if (c.keyword) { f.keyword = String(c.keyword); f.keywordMode = String(c.keyword_mode ?? "present"); }
  } else if (s.check_type === "tcp") { f.host = String(c.host ?? ""); f.port = String(c.port ?? ""); }
  else if (s.check_type === "dns") { f.domain = String(c.domain ?? ""); f.record = String(c.record_type ?? "A"); f.expected = String(c.expected ?? ""); }
  else if (s.check_type === "tls") { f.host = String(c.host ?? ""); f.port = String(c.port ?? 443); f.warnDays = c.warn_days != null ? String(c.warn_days) : ""; }
  else if (s.check_type === "domain") { f.domain = String(c.domain ?? ""); f.warnDays = c.warn_days != null ? String(c.warn_days) : ""; }
  else if (s.check_type === "heartbeat") { f.every = fmtDur(s.interval_seconds); f.grace = fmtDur(Number(c.grace_seconds ?? s.interval_seconds * 2)); }
  return f;
}
function intervalKey(sec: number): string {
  return sec >= 86400 ? "daily" : sec >= 900 ? "15m" : sec >= 300 ? "5m" : "1m";
}

export function AddServiceModal({
  projectId, projectName, edit, onClose, onCreated, say,
}: {
  projectId: string;
  projectName: string;
  edit?: Service | null;
  onClose: () => void;
  onCreated: () => void;
  say: (m: string) => void;
}) {
  const [type, setType] = useState<CheckType>(edit?.check_type ?? "http");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>(() => (edit ? formFromService(edit) : { ...DEFAULT_FORM }));
  const [interval, setIntervalKey] = useState(edit ? intervalKey(edit.interval_seconds) : "5m");
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const expiry = type === "tls" || type === "domain";

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pickType(t: CheckType) {
    setType(t); setErr(null);
    setIntervalKey(t === "tls" || t === "domain" ? "daily" : "5m");
  }

  function toSeconds(v: string): number {
    const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(v.trim());
    if (!m) return 86400;
    const n = +m[1], u = (m[2] || "m").toLowerCase();
    return n * (u === "s" ? 1 : u === "m" ? 60 : u === "h" ? 3600 : 86400);
  }

  async function save() {
    if (!f.name.trim()) return setErr("Give the monitor a name.");
    const data: CreateServiceInput = { name: f.name.trim(), check_type: type };
    if (type === "http") {
      if (!f.url.trim()) return setErr("Enter a URL.");
      data.url = f.url.trim(); data.method = f.method;
      data.expected_status_min = +f.statusMin || 200; data.expected_status_max = +f.statusMax || 299;
      if (f.keyword.trim()) { data.keyword = f.keyword.trim(); data.keyword_mode = f.keywordMode as "present" | "absent"; }
    } else if (type === "tcp") {
      if (!f.host.trim() || !f.port.trim()) return setErr("Host and port are required.");
      data.host = f.host.trim(); data.port = +f.port;
    } else if (type === "dns") {
      if (!f.domain.trim()) return setErr("Enter a domain.");
      data.domain = f.domain.trim(); data.record_type = f.record; if (f.expected.trim()) data.expected = f.expected.trim();
    } else if (type === "tls") {
      if (!f.host.trim()) return setErr("Enter a host.");
      data.host = f.host.trim(); if (f.port.trim()) data.port = +f.port; if (f.warnDays.trim()) data.warn_days = +f.warnDays;
    } else if (type === "domain") {
      if (!f.domain.trim()) return setErr("Enter a domain.");
      data.domain = f.domain.trim(); if (f.warnDays.trim()) data.warn_days = +f.warnDays;
    } else if (type === "heartbeat") {
      data.interval_seconds = toSeconds(f.every); data.grace_seconds = toSeconds(f.grace);
    }
    if (type !== "heartbeat") data.interval_seconds = INTERVALS.find((i) => i[0] === interval)?.[2] ?? 300;

    setBusy(true); setErr(null);
    try {
      if (edit) { await api.updateService(edit.id, data); say("Service updated"); }
      else { await api.createService(projectId, data); say("Service added. First check within 60s"); }
      onCreated();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  const F = (label: string, node: React.ReactNode, full?: boolean) => (
    <div className="field" style={full ? { gridColumn: "1/-1" } : undefined}><label>{label}</label>{node}</div>
  );
  const inp = (k: string, ph = "", mono = true) => <input className={`inp${mono ? " mono" : ""}`} value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} />;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.02em" }}>{edit ? "Edit service" : "Add service"}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Project: {projectName}</div>
          </div>
          <button className="iconbtn t-fast" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="Close"><Icon n="x" s={15} /></button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>1 · WHAT SHOULD WE WATCH?</div>
            <div className="typegrid">
              {TYPES.map(({ type: t, meta }) => (
                <button key={t} className={`typecard t-fast${type === t ? " on" : ""}`} onClick={() => pickType(t)}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span className="badge">{meta.badge}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.012em" }}>{meta.name}</span>
                  </span>
                  <span style={{ display: "block", marginTop: 5, fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>{meta.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>2 · {STEP[type]}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
              {F("Name", inp("name", type === "http" ? "GitHub API" : "My monitor", false), true)}

              {type === "http" && <>
                {F("URL", inp("url", "https://api.example.com/health"), true)}
                {F("Method", <select className="inp mono" value={f.method} onChange={(e) => set("method", e.target.value)}><option>GET</option><option>HEAD</option><option>POST</option></select>)}
                {F("Expected status", <div style={{ display: "flex", gap: 6 }}>{inp("statusMin")}{inp("statusMax")}</div>)}
                <div className="field" style={{ gridColumn: "1/-1", display: "grid", gridTemplateColumns: "150px 1fr", gap: 8 }}>
                  <select className="inp" style={{ background: "var(--sunken)", fontSize: 12.5 }} value={f.keywordMode} onChange={(e) => set("keywordMode", e.target.value)}><option value="present">Body contains</option><option value="absent">Body must not contain</option></select>
                  {inp("keyword", "optional keyword")}
                </div>
              </>}
              {type === "tcp" && <>{F("Host", inp("host", "db.internal"))}{F("Port", inp("port", "5432"))}</>}
              {type === "dns" && <>
                {F("Domain", inp("domain", "example.com"))}
                {F("Record type", <select className="inp mono" value={f.record} onChange={(e) => set("record", e.target.value)}>{["A", "AAAA", "CNAME", "MX", "TXT", "NS"].map((r) => <option key={r}>{r}</option>)}</select>)}
                {F("Expected value (optional)", inp("expected", "93.184.215.14"), true)}
              </>}
              {type === "tls" && <>{F("Host", inp("host", "example.com"))}{F("Port", inp("port", "443"))}{F("Warn before expiry (days)", inp("warnDays", "14"), true)}</>}
              {type === "domain" && <>{F("Domain", inp("domain", "example.com"))}{F("Warn before expiry (days)", inp("warnDays", "30"))}</>}
              {type === "heartbeat" && <>
                {F("Expected every", inp("every", "24h"))}
                {F("Grace window", inp("grace", "30m"))}
                <div style={{ gridColumn: "1/-1", padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--sunken)", fontSize: 12.5, color: "var(--muted)" }}>
                  A unique ping URL is generated when you save. Call it from your cron job on every successful run.
                </div>
              </>}

              {type !== "heartbeat" && (
                <div className="field" style={{ gridColumn: "1/-1" }}>
                  <label>Check interval</label>
                  <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                    {(expiry ? INTERVALS.filter((i) => i[0] === "daily") : INTERVALS).map(([k, label]) => (
                      <button key={k} className={`tabc${interval === k ? " on" : ""}`} onClick={() => setIntervalKey(k)}>{label}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 6 }}>
                    {expiry ? "Expiry checks run once a day." : "The Worker cron runs every 60 seconds; intervals are multiples of that."}
                  </div>
                </div>
              )}
            </div>
          </div>
          {err && <div style={{ padding: "10px 12px", border: "1px solid var(--down)", borderRadius: 9, background: "var(--down-soft)", fontSize: 13, color: "var(--fg)" }}>{err}</div>}
        </div>

        <div className="mf">
          <div style={{ flex: 1, fontSize: 12, color: "var(--faint)" }}>{edit ? "Changes apply on the next check." : "Checks start within 60 seconds of saving."}</div>
          <button className="btn t-fast press" onClick={onClose}>Cancel</button>
          <button className="btn pri t-fast press" onClick={save} disabled={busy}>{busy ? "Saving…" : edit ? "Save changes" : "Save service"}</button>
        </div>
      </div>
    </div>
  );
}
