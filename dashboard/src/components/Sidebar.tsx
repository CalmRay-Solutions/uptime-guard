import { memo, useState } from "react";
import type { Project, Service } from "../lib/api";
import { Icon, type IconName } from "./Icon";
import { statusColor, statusOf, type StatusKind } from "../lib/derive";

type Screen = "overview" | "settings";

function projectHealth(services: Service[] | undefined): StatusKind {
  if (!services || services.length === 0) return "up";
  let worst: StatusKind = "up";
  const rank = { down: 0, warn: 1, unknown: 2, up: 3, cf_protected: 4, paused: 5 };
  for (const s of services) {
    const k = statusOf(s);
    if (rank[k] < rank[worst]) worst = k;
  }
  return worst;
}

export const Sidebar = memo(function Sidebar({
  projects, selectedId, servicesByProject, screen, open, onClose, onSelectProject, onScreen, onCreateProject, onLogout,
}: {
  projects: Project[];
  selectedId: string | null;
  servicesByProject: Record<string, Service[] | undefined>;
  screen: Screen;
  open: boolean;
  onClose: () => void;
  onSelectProject: (id: string) => void;
  onScreen: (s: Screen) => void;
  onCreateProject: (name: string) => Promise<void>;
  onLogout: () => void;
}) {
  const nav: [Screen, string, IconName][] = [
    ["overview", "Overview", "dash"],
    ["settings", "Settings", "settings"],
  ];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const name = draft.trim();
    if (!name) { setAdding(false); setDraft(""); return; }
    setBusy(true);
    try { await onCreateProject(name); setDraft(""); setAdding(false); } finally { setBusy(false); }
  }

  return (
    <>
      {open && <div className="side-scrim" onClick={onClose} />}
      <aside className={`side${open ? " open" : ""}`}>
      <div className="brand">
        <span className="logo"><Icon n="activity" s={13} /></span>
        <b>UPTIME GUARD</b>
        <button className="iconbtn t-fast side-close" onClick={onClose} aria-label="Close menu"><Icon n="x" s={14} /></button>
      </div>
      <div className="lbl">
        <span>PROJECTS</span>
        <button className="iconbtn t-fast press" title="New project" onClick={() => setAdding((a) => !a)}><Icon n="plus" s={13} /></button>
      </div>
      <div className="plist">
        {adding && (
          <input
            className="inp mono"
            autoFocus
            value={draft}
            disabled={busy}
            placeholder="Project name…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              else if (e.key === "Escape") { setAdding(false); setDraft(""); }
            }}
            onBlur={() => { if (!draft.trim()) { setAdding(false); setDraft(""); } }}
            style={{ padding: "8px 11px", fontSize: 13, marginBottom: 4 }}
          />
        )}
        {projects.length === 0 && !adding && <div style={{ padding: "8px 11px", fontSize: 12.5, color: "var(--faint)" }}>No projects yet</div>}
        {projects.map((p) => {
          const on = selectedId === p.id && screen === "overview";
          const svcs = servicesByProject[p.id];
          return (
            <button key={p.id} className={`prow t-fast${on ? " on" : ""}`} onClick={() => onSelectProject(p.id)} title={p.name}>
              <span className="l">
                <span className="dot" style={{ background: statusColor(projectHealth(svcs)) }} />
                <span>{p.name}</span>
              </span>
              <span className="c">{svcs ? svcs.length : "·"}</span>
            </button>
          );
        })}
      </div>
      <div className="sidesep" />
      <nav className="nav">
        {nav.map(([k, label, ic]) => (
          <button key={k} className={`nrow t-fast${screen === k ? " on" : ""}`} onClick={() => onScreen(k)}>
            <Icon n={ic} s={15} />{label}
          </button>
        ))}
      </nav>
      <div className="foot">
        <div className="who"><b>owner</b><small>2FA on · 30d session</small></div>
        <button className="logout t-fast press" onClick={onLogout} title="Log out"><Icon n="logout" s={13} />Log out</button>
      </div>
      </aside>
    </>
  );
});
