import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { statusColor, statusSoft, statusLabel, statusIcon, type StatusKind, type Beat } from "../lib/derive";

export function StatusGlyph({ k, s = 14 }: { k: StatusKind; s?: number }) {
  return <span style={{ color: statusColor(k), display: "inline-flex" }}><Icon n={statusIcon(k)} s={s} /></span>;
}

export function Pill({ k }: { k: StatusKind }) {
  return (
    <span className="pill" style={{ background: statusSoft(k) }}>
      <StatusGlyph k={k} s={13} />
      {statusLabel(k)}
    </span>
  );
}

const HB = { up: 15, down: 22, blank: 6 };
const HBbig = { up: 28, down: 46, blank: 10 };

interface TipState { x: number; y: number; kind: Beat["kind"]; text: string }

export const HeartbeatBars = memo(function HeartbeatBars({ beats, big }: { beats: Beat[]; big?: boolean }) {
  const H = big ? HBbig : HB;
  const [tip, setTip] = useState<TipState | null>(null);

  const show = (e: React.MouseEvent<HTMLElement>, b: Beat) => {
    if (!b.tip) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 76), window.innerWidth - 76);
    setTip({ x, y: r.top, kind: b.kind, text: b.tip });
  };

  return (
    <div className="beats" style={big ? { height: 46, gap: 2 } : undefined} onMouseLeave={() => setTip(null)}>
      {beats.map((b, i) => (
        <i
          key={i}
          onMouseEnter={(e) => show(e, b)}
          style={{
            height: H[b.kind],
            background: b.kind === "blank" ? "var(--border)" : `var(--${b.kind})`,
            animationDelay: `${i * 8}ms`,
            cursor: b.tip ? "pointer" : undefined,
          }}
        />
      ))}
      {tip &&
        createPortal(
          <div className="beat-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            <span className="dot" style={{ background: tip.kind === "blank" ? "var(--faint)" : `var(--${tip.kind})` }} />
            {tip.text}
          </div>,
          document.body
        )}
    </div>
  );
});
