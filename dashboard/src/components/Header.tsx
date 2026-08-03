import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export function Header({
  crumb, title, dotColor, updatedAt, error, checking, sound, onToggleSound, onMenu, onRefresh, onAdd,
}: {
  crumb: string;
  title: string;
  dotColor: string;
  updatedAt: number | null;
  error?: boolean;
  checking?: boolean;
  sound: boolean;
  onToggleSound: () => void;
  onMenu: () => void;
  onRefresh: () => void;
  onAdd: () => void;
}) {
  // Local ticking "updated Ns ago" without re-rendering the whole tree.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const label = error
    ? "connection lost"
    : updatedAt == null
    ? "loading…"
    : `updated ${Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))}s ago`;

  return (
    <header className="head">
      <button className="btn icon-only menu-btn t-fast press" onClick={onMenu} aria-label="Menu">
        <svg className="ico" width={16} height={16} viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
      </button>
      <div style={{ minWidth: 0, flex: "1 1 140px" }}>
        <div className="crumb">{crumb}</div>
        <div className="title">{title}</div>
      </div>
      <div className="live">
        <span className="p"><i style={{ background: dotColor }} /><i style={{ background: dotColor }} /></span>
        <span>{label}</span>
      </div>
      <button
        className="btn t-fast press icon-only"
        onClick={onToggleSound}
        title={sound ? "Mute alert sounds" : "Enable alert sounds"}
        aria-label={sound ? "Mute alert sounds" : "Enable alert sounds"}
      >
        <Icon n={sound ? "bell" : "bellOff"} s={15} style={sound ? undefined : { color: "var(--faint)" }} />
      </button>
      <button className="btn t-fast press" onClick={onRefresh} disabled={checking}>
        <Icon n="refresh" s={13} cls={checking ? "spin" : undefined} /><span className="lbl-md">Refresh</span>
      </button>
      <button className="btn pri t-fast press" onClick={onAdd}><Icon n="plus" s={14} /><span className="lbl-md">Add service</span></button>
    </header>
  );
}
