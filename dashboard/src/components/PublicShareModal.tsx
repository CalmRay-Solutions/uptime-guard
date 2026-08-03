import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export function PublicShareModal({
  isPublic, slug, onClose, onSetPublic,
}: {
  isPublic: boolean;
  slug: string | null;
  onClose: () => void;
  onSetPublic: (makePublic: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = slug ? `${location.origin}/status/${slug}` : "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggle(makePublic: boolean) {
    setBusy(true);
    try { await onSetPublic(makePublic); } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.02em" }}>Public status page</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>A read-only page anyone can view · no login required</div>
          </div>
          <button className="iconbtn t-fast" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="Close"><Icon n="x" s={15} /></button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="vseg" role="tablist" aria-label="Project visibility">
            <button role="tab" aria-selected={!isPublic} className={`vseg-i${!isPublic ? " on" : ""}`} disabled={busy} onClick={() => { if (isPublic) toggle(false); }}>
              <Icon n="lock" s={13} />Private
            </button>
            <button role="tab" aria-selected={isPublic} className={`vseg-i${isPublic ? " on" : ""}`} disabled={busy} onClick={() => { if (!isPublic) toggle(true); }}>
              <Icon n="globe" s={13} />Public
            </button>
          </div>

          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {busy
              ? "Saving…"
              : isPublic
                ? "Anyone with the link below can view current status and 90-day uptime."
                : "Only you can see this project."}
          </div>

          {isPublic && url && (
            <div>
              <label className="fl">Shareable link</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}>
                <input className="inp mono" readOnly value={url} style={{ fontSize: 12.5 }} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn t-fast press" onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
                  <Icon n="copy" s={13} />{copied ? "Copied" : "Copy"}
                </button>
                <a className="btn t-fast press" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }} title="Open status page">
                  <Icon n="chevron" s={13} />
                </a>
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--faint)" }}>
            Shows service names, current status and 90-day uptime only — never URLs, IP addresses, or configuration.
          </div>
        </div>
      </div>
    </div>
  );
}
