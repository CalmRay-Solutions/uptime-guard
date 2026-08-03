import { useEffect, useMemo, useState } from "react";
import { api, getConfig, type Service, type Check, type ServiceStats } from "../lib/api";
import { Icon } from "./Icon";
import { Pill, HeartbeatBars } from "./ui";
import {
  statusOf, statusColor, beats, uptimePct, respMs, targetOf, typeMeta, timeAgo, cfg, expiryDays, fmtDate,
} from "../lib/derive";

/** Detail-shaped placeholder shown on refresh/deep-link while the service loads,
 *  so the view never flashes the Overview before snapping to the detail page. */
export function ServiceDetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen">
      <button className="btn t-fast press" style={{ alignSelf: "flex-start" }} onClick={onBack}>
        <Icon n="chevron" s={13} style={{ transform: "rotate(180deg)" }} />Back to overview
      </button>
      <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
        <div className="sk" style={{ width: 220, height: 22 }} />
        <div className="sk" style={{ width: 280, height: 13 }} />
        <div className="sk" style={{ width: 150, height: 13 }} />
      </div>
      <div className="grid-sum">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card sumcard">
            <div className="sk" style={{ width: 72, height: 12 }} />
            <div className="sk" style={{ width: 52, height: 26, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="sec">
        <div className="h"><span className="name">Response time</span></div>
        <div style={{ padding: 14 }}><div className="sk" style={{ height: 140, width: "100%" }} /></div>
      </div>
    </div>
  );
}

export function ServiceDetail({
  service, onBack, onMutated, onEdit, say,
}: {
  service: Service;
  onBack: () => void;
  onMutated: () => void;
  onEdit: (s: Service) => void;
  say: (m: string) => void;
}) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [sla, setSla] = useState<ServiceStats | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "pause" | "delete">("");
  const [copied, setCopied] = useState(false);
  const s = service;
  const k = statusOf(s);
  const isHb = s.check_type === "heartbeat";

  useEffect(() => {
    let alive = true;
    api.getChecks(s.id, 120).then((c) => alive && setChecks(c)).catch(() => {});
    api.getServiceStats(s.id).then((r) => alive && setSla(r)).catch(() => {});
    return () => { alive = false; };
  }, [s.id, s.last_checked_at]);

  async function checkNow() {
    setBusy("check"); say("Checking now…");
    try { await api.checkNow(s.id); onMutated(); say("Check complete"); } catch { say("Check failed"); } finally { setBusy(""); }
  }
  async function togglePause() {
    setBusy("pause");
    try { await api.pauseService(s.id, !s.paused); onMutated(); say(s.paused ? "Monitoring resumed" : "Monitoring paused"); } catch { say("Could not update"); } finally { setBusy(""); }
  }
  async function del() {
    if (!confirm(`Delete “${s.name}”? This removes its history too.`)) return;
    setBusy("delete");
    try { await api.deleteService(s.id); say("Service deleted"); onMutated(); onBack(); } catch { say("Delete failed"); setBusy(""); }
  }

  const stats = useMemo(() => buildStats(s), [s]);
  const pingUrl = isHb ? `${getConfig().baseUrl || window.location.origin}/ping/${s.heartbeat_token ?? ""}` : "";

  return (
    <div className="screen">
      <button className="btn t-fast press" style={{ alignSelf: "flex-start" }} onClick={onBack}>
        <Icon n="chevron" s={13} style={{ transform: "rotate(180deg)" }} />Back to overview
      </button>

      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start", padding: "16px 18px" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: "-.025em" }}>{s.name}</h2>
            <span className="badge" style={{ fontSize: 9.5, padding: "2px 6px", borderRadius: 5 }}>{typeMeta(s.check_type).badge}</span>
            <Pill k={k} />
          </div>
          <div className="mono" style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>{targetOf(s)}</div>
          <div style={{ marginTop: 8, fontSize: 13 }}>{sinceLine(s)}</div>
        </div>
        <div className="detail-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {!isHb && (
            <button className="btn pri t-fast press" onClick={checkNow} disabled={busy === "check"}>
              <Icon n="zap" s={13} />{busy === "check" ? "Checking…" : "Check now"}
            </button>
          )}
          <button className="btn t-fast press" onClick={togglePause} disabled={busy === "pause"}>
            <Icon n={s.paused ? "play" : "pause"} s={13} />{s.paused ? "Resume" : "Pause"}
          </button>
          <button className="btn t-fast press" onClick={() => onEdit(s)}>
            <Icon n="pencil" s={13} />Edit
          </button>
          <button className="btn danger t-fast press" onClick={del} disabled={busy === "delete"}>
            <Icon n="trash" s={13} />Delete
          </button>
        </div>
      </div>

      <div className="grid-sum">
        {stats.map((t) => (
          <div key={t.label} className="card sumcard">
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>{t.label}</div>
            <div className="mono" style={{ fontSize: 20, letterSpacing: "-.025em", color: t.color }}>{t.value}</div>
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 3 }}>{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="sec">
        <div className="h">
          <span className="name">Uptime &amp; reliability</span>
          <div style={{ flex: 1 }} />
          {sla?.mttr_ms != null && <span className="meta">avg recovery {fmtDuration(sla.mttr_ms)}</span>}
        </div>
        <div className="slagrid">
          {([["24 hours", "h24"], ["7 days", "d7"], ["30 days", "d30"], ["90 days", "d90"]] as const).map(([label, key]) => {
            const v = sla ? sla.uptime[key] : undefined;
            return (
              <div key={key} className="slacell">
                <div className="k">{label}</div>
                <div className="v" style={{ color: v == null ? "var(--faint)" : uptimeColor(v) }}>
                  {sla == null ? <span className="sk" style={{ width: 52, height: 20, display: "inline-block" }} /> : v == null ? "-" : fmtPct(v)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!isHb && s.check_type !== "tls" && s.check_type !== "domain" && (
        <div className="sec">
          <div className="h"><span className="name">Recent checks</span><div style={{ flex: 1 }} /><span className="meta">last {Math.min((s.recent ?? []).length, 40)}</span></div>
          <div style={{ padding: "16px 14px 12px" }}>
            <HeartbeatBars beats={beats(s)} big />
            <div className="mono" style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10.5, color: "var(--faint)" }}>
              <span>older</span><span>now</span>
            </div>
          </div>
        </div>
      )}

      {!isHb && s.check_type !== "tls" && s.check_type !== "domain" && (
        <ResponseChart checks={checks} />
      )}

      {isHb && s.heartbeat_token && (
        <div className="sec">
          <div className="h"><span className="name">Ping URL</span></div>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <code className="mono" style={{ flex: "1 1 320px", minWidth: 0, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--sunken)", fontSize: 12, overflowWrap: "anywhere" }}>{pingUrl}</code>
              <button className="btn t-fast press" style={{ fontWeight: 600 }} onClick={() => { navigator.clipboard?.writeText(pingUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
                <Icon n="copy" s={13} />{copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>ADD TO YOUR CRON JOB</div>
              <pre className="mono" style={{ margin: 0, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--sunken)", fontSize: 12, color: "var(--muted)", overflowX: "auto" }}>
{`your-job.sh && curl -fsS -m 10 \\\n  ${pingUrl}`}
              </pre>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Call this from your cron job on every successful run. If no ping arrives within the grace window, Uptime Guard marks it down and alerts you on Telegram.
            </div>
          </div>
        </div>
      )}

      <div className="sec">
        <div className="h">
          <span className="name">Incident history</span>
          <div style={{ flex: 1 }} />
          {sla && <span className="meta">{sla.incidents_90d} in 90 days</span>}
        </div>
        {sla == null ? (
          <div style={{ padding: 14 }}><div className="sk" style={{ width: 220 }} /></div>
        ) : sla.incidents.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12.5, color: "var(--muted)" }}>No incidents recorded - nothing has gone down.</div>
        ) : (
          sla.incidents.map((inc) => {
            const ongoing = inc.resolved_at == null;
            const dur = (ongoing ? Date.now() : inc.resolved_at!) - inc.started_at;
            return (
              <div key={inc.id} className="incrow">
                <span className="dot" style={{ background: ongoing ? "var(--down)" : "var(--faint)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: ongoing ? "var(--down)" : "var(--fg)" }}>{ongoing ? "Ongoing outage" : "Resolved"}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>
                    {fmtDateTime(inc.started_at)}{ongoing ? "" : ` → ${fmtDateTime(inc.resolved_at!)}`}
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 13, color: ongoing ? "var(--down)" : "var(--muted)" }}>{fmtDuration(dur)}</div>
              </div>
            );
          })
        )}
      </div>

      <div className="sec">
        <div className="h"><span className="name">Recent events</span></div>
        <div className="tscroll">
          <div style={{ minWidth: 560 }}>
            <div style={{ display: "grid", gridTemplateColumns: "92px 150px 1fr", gap: 12, padding: "8px 14px", borderBottom: "1px solid var(--border)" }} className="mono">
              {["EVENT", "WHEN", "DETAIL"].map((h) => <div key={h} style={{ fontSize: 10, letterSpacing: ".1em", color: "var(--faint)" }}>{h}</div>)}
            </div>
            {checks == null ? (
              <div style={{ padding: 14 }}><div className="sk" style={{ width: 220 }} /></div>
            ) : checks.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12.5, color: "var(--muted)" }}>No checks recorded yet.</div>
            ) : (
              checks.slice(0, 15).map((c) => (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "92px 150px 1fr", gap: 12, padding: "11px 14px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                  <div><Pill k={c.status === "down" ? "down" : "up"} /></div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(c.checked_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", overflowWrap: "anywhere" }}>
                    {c.error ? c.error : c.status === "up" ? `OK${c.response_time_ms != null ? ` in ${c.response_time_ms} ms` : ""}${c.status_code ? ` · HTTP ${c.status_code}` : ""}` : "Failed check"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtPct(v: number): string {
  return (v >= 99.995 ? 100 : v).toFixed(v >= 99.995 ? 0 : 2) + "%";
}
function uptimeColor(v: number): string {
  if (v >= 99.9) return "var(--up)";
  if (v >= 99) return "var(--fg)";
  if (v >= 95) return "var(--warn)";
  return "var(--down)";
}
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sinceLine(s: Service): string {
  const k = statusOf(s);
  if (s.paused) return `Paused · last checked ${timeAgo(s.last_checked_at)}`;
  if (k === "down") return `Down · last checked ${timeAgo(s.last_checked_at)}`;
  if ((s.check_type === "tls" || s.check_type === "domain") && s.expires_at != null) {
    const d = expiryDays(s);
    return `${d != null && d < 0 ? "Expired" : "Valid"} · expires ${fmtDate(s.expires_at)}${d != null && d >= 0 ? ` (${d} days)` : ""}`;
  }
  if (s.check_type === "heartbeat") return `Last ping ${timeAgo(s.last_ping_at)}`;
  return `Up · last checked ${timeAgo(s.last_checked_at)}`;
}

function buildStats(s: Service): { label: string; value: string; sub: string; color: string }[] {
  const k = statusOf(s);
  if (s.check_type === "tls" || s.check_type === "domain") {
    const d = expiryDays(s);
    const warn = Number(cfg(s).warn_days ?? (s.check_type === "tls" ? 14 : 30));
    return [
      { label: "Days to expiry", value: d != null ? String(d) : "-", sub: s.expires_at ? fmtDate(s.expires_at) : "-", color: d != null && d <= warn ? "var(--warn)" : "var(--fg)" },
      { label: s.check_type === "tls" ? "Handshake" : "Lookup", value: s.avg_response_ms != null ? s.avg_response_ms + " ms" : "-", sub: "last check", color: "var(--fg)" },
      { label: "Warn window", value: warn + " d", sub: "before expiry", color: "var(--fg)" },
      { label: "Checked", value: timeAgo(s.last_checked_at), sub: "runs daily", color: "var(--fg)" },
    ];
  }
  if (s.check_type === "heartbeat") {
    const grace = Number(cfg(s).grace_seconds ?? s.interval_seconds * 2);
    return [
      { label: "Last ping", value: timeAgo(s.last_ping_at), sub: s.last_ping_at ? new Date(s.last_ping_at).toLocaleTimeString() : "-", color: k === "down" ? "var(--down)" : "var(--up)" },
      { label: "Uptime 24h", value: uptimePct(s), sub: "rolling window", color: "var(--fg)" },
      { label: "Expected every", value: fmtDur(s.interval_seconds), sub: `${fmtDur(grace)} grace`, color: "var(--fg)" },
      { label: "Checks 24h", value: String(s.checks_24h ?? 0), sub: "pings received", color: "var(--fg)" },
    ];
  }
  return [
    { label: "Response now", value: respMs(s), sub: k === "down" ? "no response" : "avg 24h", color: k === "down" ? "var(--down)" : "var(--fg)" },
    { label: "Uptime 24h", value: uptimePct(s), sub: "rolling window", color: k === "down" ? "var(--down)" : "var(--fg)" },
    { label: "Interval", value: fmtDur(s.interval_seconds), sub: "cron every 60s", color: "var(--fg)" },
    { label: "Checks 24h", value: String(s.checks_24h ?? 0), sub: "in last day", color: "var(--fg)" },
  ];
}
function fmtDur(sec: number): string {
  if (sec % 86400 === 0) return sec / 86400 + " d";
  if (sec % 3600 === 0) return sec / 3600 + " h";
  if (sec % 60 === 0) return sec / 60 + " min";
  return sec + " s";
}

function ResponseChart({ checks }: { checks: Check[] | null }) {
  const chart = useMemo(() => {
    if (!checks || checks.length === 0) return null;
    // checks are newest-first; take up to 56, chronological
    const pts = checks.slice(0, 56).reverse();
    const vals = pts.map((c) => (c.status === "down" ? null : c.response_time_ms ?? 0));
    const nums = vals.filter((v): v is number => v != null);
    if (nums.length === 0) return null;
    const max = Math.max.apply(null, nums) * 1.15 || 1;
    const n = pts.length;
    const X = (i: number) => 42 + (i / Math.max(1, n - 1)) * 574;
    const Y = (v: number) => 146 - (v / max) * 132;
    let d = "", started = false;
    vals.forEach((v, i) => { if (v == null) { started = false; return; } d += `${started ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)} `; started = true; });
    const sorted = nums.slice().sort((a, b) => a - b);
    const fmt = (v: number) => (v >= 1000 ? (v / 1000).toFixed(2) + " s" : Math.round(v) + " ms");
    const ticks = [0, 0.5, 1].map((f) => { const v = max * (1 - f) * 0.9, y = 14 + f * 132; return { y: y.toFixed(1), ty: (y + 3.5).toFixed(1), label: fmt(v) }; });
    return {
      line: d.trim(),
      ticks,
      avg: fmt(nums.reduce((a, b) => a + b, 0) / nums.length),
      p95: fmt(sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]),
      max: fmt(sorted[sorted.length - 1]),
    };
  }, [checks]);

  return (
    <div className="sec">
      <div className="h"><span className="name">Response time</span></div>
      <div style={{ padding: 14 }}>
        {checks == null ? (
          <div className="sk" style={{ height: 140, width: "100%" }} />
        ) : !chart ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "40px 0", textAlign: "center" }}>Not enough data yet.</div>
        ) : (
          <>
            <svg viewBox="0 0 620 176" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }} role="img" aria-label="Response time">
              {chart.ticks.map((t, i) => (
                <g key={i}>
                  <line x1="42" x2="616" y1={t.y} y2={t.y} stroke="var(--border)" />
                  <text x="36" y={t.ty} textAnchor="end" fill="var(--faint)" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{t.label}</text>
                </g>
              ))}
              <path d={chart.line} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <div className="mono" style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 6, fontSize: 10.5, color: "var(--faint)" }}>
              <span>AVG {chart.avg}</span><span>P95 {chart.p95}</span><span>MAX {chart.max}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
