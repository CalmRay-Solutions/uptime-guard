import { useEffect, useMemo, useState } from "react";
import type { Service, CheckType } from "../lib/api";
import { Icon } from "./Icon";
import { Pill, StatusGlyph, HeartbeatBars } from "./ui";
import { PublicShareModal } from "./PublicShareModal";
import { ProjectModal } from "./ProjectModal";
import {
  statusOf, statusColor, statusSoft, bySeverity, beats, summarize, uptimePct, respMs,
  targetOf, typeMeta, timeAgo, expiryDays, fmtDate, TYPES,
} from "../lib/derive";

const PAGE = 10;

export function Overview({
  services, loading, error, projectName, onOpen, onAdd, onRefresh,
  isPublic, publicSlug, onSetPublic, onRenameProject, onDeleteProject,
}: {
  services: Service[] | null;
  loading: boolean;
  error: string | null;
  projectName: string;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
  isPublic: boolean;
  publicSlug: string | null;
  onSetPublic: (makePublic: boolean) => Promise<void>;
  onRenameProject: (name: string) => Promise<void>;
  onDeleteProject: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<CheckType | "all">("all");
  const [shareOpen, setShareOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const sorted = useMemo(() => (services ? services.slice().sort(bySeverity) : []), [services]);
  const sum = useMemo(() => summarize(services ?? []), [services]);
  const isEmpty = !loading && services != null && services.length === 0;

  const counts = useMemo(() => {
    const c = {} as Record<CheckType, number>;
    for (const s of services ?? []) c[s.check_type] = (c[s.check_type] ?? 0) + 1;
    return c;
  }, [services]);
  // Drop a filter that no longer matches anything (e.g. after switching projects).
  const active = filter !== "all" && !counts[filter] ? "all" : filter;
  const visible = useMemo(
    () => (active === "all" ? sorted : sorted.filter((s) => s.check_type === active)),
    [sorted, active]
  );

  // Pagination · fixed page size, with filler rows so the table height never changes
  // between pages or filters (constant row count = no layout shift).
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [active, projectName]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE));
  const pageClamped = Math.min(page, pageCount - 1);
  const start = pageClamped * PAGE;
  const pageItems = visible.slice(start, start + PAGE);
  const rowsPerView = Math.min(services?.length ?? 0, PAGE);
  const fillerCount = Math.max(0, rowsPerView - pageItems.length);

  const banner = useMemo(() => {
    if (loading || isEmpty || !services) return null;
    if (sum.down > 1) {
      const names = sorted.filter((s) => statusOf(s) === "down").map((s) => s.name).slice(0, 3).join(", ");
      return { k: "down" as const, ic: "oct" as const, t: `${sum.down} services are down`, sub: `${names} are failing checks.`, arg: sorted.find((s) => statusOf(s) === "down")?.id };
    }
    if (sum.down === 1) {
      const d = sorted.find((s) => statusOf(s) === "down")!;
      return { k: "down" as const, ic: "oct" as const, t: `${d.name} is down`, sub: `Last checked ${timeAgo(d.last_checked_at)}. Telegram alert sent.`, arg: d.id };
    }
    if (sum.warn > 0) {
      const w = sorted.find((s) => statusOf(s) === "warn")!;
      const d = expiryDays(w);
      return { k: "warn" as const, ic: "tri" as const, t: `Everything is up · ${sum.warn} warning`, sub: `${w.name}${d != null ? ` expires in ${d} days.` : "."}`, arg: w.id };
    }
    return { k: "up" as const, ic: "cCheck" as const, t: `All ${services.length} services are up`, sub: "Every check is passing.", arg: undefined };
  }, [loading, isEmpty, services, sum, sorted]);

  const expiring = useMemo(
    () => (services ?? [])
      .filter((s) => (s.check_type === "tls" || s.check_type === "domain") && s.expires_at != null && expiryDays(s)! <= 30)
      .sort((a, b) => (a.expires_at! - b.expires_at!))
      .slice(0, 6),
    [services]
  );

  return (
    <div className="screen">
      {error && services && (
        <div className="banner" role="alert" style={{ background: "var(--warn-soft)" }}>
          <span style={{ color: "var(--warn)" }}><Icon n="tri" s={20} /></span>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div className="t" style={{ fontSize: 13.5 }}>Can't reach the Worker</div>
            <div className="s">Showing the last data received. Retrying automatically.</div>
          </div>
          <button className="btn t-fast press" onClick={onRefresh}>Retry now</button>
        </div>
      )}

      {loading ? (
        <div className="banner" aria-hidden="true">
          <div className="sk" style={{ width: 22, height: 22, borderRadius: 6, flex: "none" }} />
          <div style={{ flex: "1 1 280px" }}>
            <div className="sk" style={{ width: 210, height: 14 }} />
            <div className="sk" style={{ width: 300, height: 11, marginTop: 8 }} />
          </div>
        </div>
      ) : banner ? (
        <div className="banner" role="status" style={{ background: statusSoft(banner.k) }}>
          <span style={{ color: statusColor(banner.k) }}><Icon n={banner.ic} s={20} /></span>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <div className="t">{banner.t}</div>
            <div className="s">{banner.sub}</div>
          </div>
          {banner.arg && (
            <button className="btn t-fast press" style={{ fontWeight: 600 }} onClick={() => onOpen(banner.arg!)}>
              Open service<Icon n="chevron" s={13} />
            </button>
          )}
        </div>
      ) : null}

      <div className="grid-sum">
        {([["Up", sum.up, "up"], ["Down", sum.down, "down"], ["Warning", sum.warn, "warn"], ["Paused", sum.paused, "paused"]] as const).map(
          ([label, val, k]) => {
            const col = val > 0 && (k === "down" || k === "warn") ? statusColor(k) : "var(--fg)";
            return (
              <div key={label} className="card sumcard">
                <div className="lbl"><StatusGlyph k={k} />{label}</div>
                <div className="v" style={{ color: col }}>{loading ? "-" : val}</div>
              </div>
            );
          }
        )}
        <div className="card sumcard">
          <div className="lbl" style={{ color: "var(--muted)" }}><Icon n="gauge" s={14} />Fleet uptime 24h</div>
          <div className="v">{loading || isEmpty ? "-" : sum.fleet}</div>
          <div className="fleetbar"><i style={{ width: loading || sum.fleet === "-" ? 0 : Math.min(100, parseFloat(sum.fleet)) + "%" }} /></div>
        </div>
      </div>

      <div className="sec">
        <div className="h">
          <span className="name">Services</span>
          <span className="meta">{loading ? "loading" : `${services?.length ?? 0} monitors · ${projectName.toLowerCase()}`}</span>
          <div style={{ flex: 1 }} />
          <button className="btn t-fast press" style={{ padding: "5px 10px" }} onClick={() => setShareOpen(true)} title="Public status page">
            <Icon n="globe" s={13} style={{ color: isPublic ? "var(--up)" : undefined }} />{isPublic ? "Public" : "Share"}
          </button>
          <button className="btn t-fast press" style={{ padding: "5px 10px" }} onClick={() => setProjectOpen(true)} title="Rename or delete this project">
            <Icon n="pencil" s={13} />Project
          </button>
        </div>

        {loading ? (
          <>
            <div className="filterbar" aria-hidden="true">
              {[52, 60, 56].map((w, i) => <div key={i} className="sk" style={{ width: w, height: 30, borderRadius: 8 }} />)}
            </div>
            <div className="tscroll">
              <div className="tinner">
                <div className="trow thead">
                  <div>SERVICE</div><div>STATUS</div><div>RECENT CHECKS</div><div>UPTIME 24H</div><div>RESPONSE</div><div>CHECKED</div>
                </div>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="trow srow" aria-hidden="true">
                    <div className="svc"><div className="sk" style={{ width: 150 + (i % 3) * 40, height: 13 }} /><div className="sk" style={{ width: 110, height: 10, marginTop: 8 }} /></div>
                    <div className="cell-pill"><div className="sk" style={{ width: 62, height: 20, borderRadius: 999 }} /></div>
                    <div className="beats"><div className="sk" style={{ width: "100%", height: 22 }} /></div>
                    <div className="num u30"><div className="sk" style={{ width: 40, height: 12 }} /></div>
                    <div className="num resp"><div className="sk" style={{ width: 44, height: 12 }} /></div>
                    <div className="num chk"><div className="sk" style={{ width: 48, height: 11 }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : isEmpty ? (
          <div className="empty">
            <div className="ring"><Icon n="radar" s={22} /></div>
            <h3>No services in {projectName} yet</h3>
            <p>Add the first monitor and Uptime Guard starts checking within 60 seconds.</p>
            <button className="btn pri t-fast press" onClick={onAdd}>Add your first service</button>
          </div>
        ) : (
          <>
            <div className="filterbar" role="tablist" aria-label="Filter services by type">
              <button role="tab" aria-selected={active === "all"} className={`tabc${active === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>
                All<span className="fcount">{services?.length ?? 0}</span>
              </button>
              {TYPES.filter(({ type }) => counts[type]).map(({ type, meta }) => (
                <button key={type} role="tab" aria-selected={active === type} className={`tabc${active === type ? " on" : ""}`} onClick={() => setFilter(type)}>
                  {meta.badge}<span className="fcount">{counts[type]}</span>
                </button>
              ))}
            </div>
            <div className="tscroll">
              <div className="tinner">
                <div className="trow thead">
                  <div>SERVICE</div><div>STATUS</div><div>RECENT CHECKS</div><div>UPTIME 24H</div><div>RESPONSE</div><div>CHECKED</div>
                </div>
                {pageItems.map((s) => (
                  <ServiceRow key={s.id} s={s} onOpen={onOpen} />
                ))}
                {Array.from({ length: fillerCount }).map((_, i) => (
                  <div key={`f${i}`} className="trow srow filler" aria-hidden="true">
                    <div className="svc"><div className="n"><b>&nbsp;</b></div><div className="tgt">&nbsp;</div></div>
                  </div>
                ))}
              </div>
            </div>
            {visible.length > PAGE && (
              <div className="pager">
                <span className="info">{start + 1}–{Math.min(start + PAGE, visible.length)} of {visible.length}</span>
                <div style={{ flex: 1 }} />
                <button className="btn t-fast press" disabled={pageClamped === 0} onClick={() => setPage(pageClamped - 1)} aria-label="Previous page">
                  <Icon n="chevron" s={13} style={{ transform: "rotate(180deg)" }} />
                </button>
                <span className="info">{pageClamped + 1} / {pageCount}</span>
                <button className="btn t-fast press" disabled={pageClamped >= pageCount - 1} onClick={() => setPage(pageClamped + 1)} aria-label="Next page">
                  <Icon n="chevron" s={13} />
                </button>
              </div>
            )}
            <div className="legend">
              <span><StatusGlyph k="up" s={13} />Operational</span>
              <span><StatusGlyph k="warn" s={13} />Warning</span>
              <span><StatusGlyph k="down" s={13} />Failed check</span>
              <span><Icon n="dashed" s={13} style={{ color: "var(--faint)" }} />No data</span>
            </div>
          </>
        )}
      </div>

      {!loading && !isEmpty && expiring.length > 0 && (
        <div className="sec" style={{ maxWidth: 460 }}>
          <div className="h"><span className="name">Expiring soon</span><span className="meta">within 30 days</span></div>
          {expiring.map((s) => {
            const d = expiryDays(s);
            const col = d != null && d < 0 ? "var(--down)" : d != null && d <= (s.check_type === "tls" ? 14 : 30) ? "var(--warn)" : "var(--fg)";
            return (
              <div key={s.id} className="exp">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>
                    {s.check_type === "tls" ? "TLS" : "Registrar"} · {s.expires_at ? fmtDate(s.expires_at) : "-"}
                  </div>
                </div>
                <div className="r"><div className="mono" style={{ fontSize: 15, color: col }}>{d != null ? `${d} d` : "-"}</div></div>
              </div>
            );
          })}
        </div>
      )}

      {projectOpen && (
        <ProjectModal
          name={projectName}
          serviceCount={services?.length ?? 0}
          onClose={() => setProjectOpen(false)}
          onRename={onRenameProject}
          onDelete={onDeleteProject}
        />
      )}

      {shareOpen && (
        <PublicShareModal
          isPublic={isPublic}
          slug={publicSlug}
          onClose={() => setShareOpen(false)}
          onSetPublic={onSetPublic}
        />
      )}
    </div>
  );
}

function ServiceRow({ s, onOpen }: { s: Service; onOpen: (id: string) => void }) {
  const k = statusOf(s);
  const bs = beats(s);
  return (
    <div
      className={`trow srow${k === "down" ? " down" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(s.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(s.id); }
      }}
    >
      <div className="svc">
        <div className="n"><b>{s.name}</b><span className="badge">{typeMeta(s.check_type).badge}</span></div>
        <div className="tgt">{targetOf(s)}</div>
      </div>
      <div className="cell-pill"><Pill k={k} /></div>
      <HeartbeatBars beats={bs} />
      <div className="num u30" style={{ color: k === "down" ? "var(--down)" : "var(--fg)" }}>{uptimePct(s)}</div>
      <div className="num resp" style={{ color: "var(--muted)" }}>{respMs(s)}</div>
      <div className="num chk" style={{ fontSize: 11, color: "var(--faint)" }}>{timeAgo(s.last_checked_at)}</div>
    </div>
  );
}
