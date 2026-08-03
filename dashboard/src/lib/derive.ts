import type { Service, CheckType } from "./api";
import type { IconName } from "../components/Icon";

export type StatusKind = "up" | "down" | "warn" | "paused" | "unknown" | "cf_protected";

const DAY = 86_400_000;

/** Parse a service's JSON config safely. */
export function cfg(s: Service): Record<string, unknown> {
  try {
    return JSON.parse(s.config || "{}");
  } catch {
    return {};
  }
}

/** Days until expiry, or null. */
export function expiryDays(s: Service): number | null {
  if (s.expires_at == null) return null;
  return Math.floor((s.expires_at - Date.now()) / DAY);
}

/** The single display status for a service, folding in pause + expiry warnings. */
export function statusOf(s: Service): StatusKind {
  if (s.paused) return "paused";
  if (s.current_status === "cf_protected") return "cf_protected";
  if (s.current_status === "down") return "down";
  if (s.check_type === "tls" || s.check_type === "domain") {
    const d = expiryDays(s);
    const warn = Number(cfg(s).warn_days ?? (s.check_type === "tls" ? 14 : 30));
    if (d != null && d <= warn) return d < 0 ? "down" : "warn";
  }
  if (s.current_status === "up") return "up";
  return "unknown";
}

export const statusColor = (k: StatusKind) =>
  k === "down" ? "var(--down)" : k === "warn" ? "var(--warn)" : k === "paused" ? "var(--paused)" : k === "cf_protected" ? "var(--cf)" : k === "unknown" ? "var(--faint)" : "var(--up)";
export const statusSoft = (k: StatusKind) =>
  k === "down" ? "var(--down-soft)" : k === "warn" ? "var(--warn-soft)" : k === "paused" ? "var(--sunken)" : k === "cf_protected" ? "var(--cf-soft)" : "var(--up-soft)";
export const statusLabel = (k: StatusKind) =>
  k === "down" ? "Down" : k === "warn" ? "Warning" : k === "paused" ? "Paused" : k === "cf_protected" ? "CF Protected" : k === "unknown" ? "Pending" : "Up";
export const statusIcon = (k: StatusKind): IconName =>
  k === "down" ? "cX" : k === "warn" ? "tri" : k === "paused" ? "cPause" : k === "cf_protected" ? "cloud" : "cCheck";

/** Rank for severity sort · most urgent first. */
const RANK: Record<StatusKind, number> = { down: 0, warn: 1, unknown: 2, up: 3, cf_protected: 4, paused: 5 };
export function bySeverity(a: Service, b: Service) {
  return RANK[statusOf(a)] - RANK[statusOf(b)];
}

export interface Beat {
  kind: "up" | "down" | "blank";
  tip?: string;
}
/** Build a fixed-width heartbeat strip from recent[] (newest last), padded with blanks. */
export function beats(s: Service, n = 40): Beat[] {
  const rec = s.recent ?? [];
  const tail = rec.slice(-n);
  const pad = Math.max(0, n - tail.length);
  const out: Beat[] = [];
  for (let i = 0; i < pad; i++) out.push({ kind: "blank" });
  for (const c of tail) {
    const down = c.status === "down";
    const label = c.status === "cf_protected" ? "CF Protected" : down ? "Down" : "Up";
    const ms = !down && c.response_time_ms != null ? ` · ${c.response_time_ms} ms` : "";
    const clock = new Date(c.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    out.push({ kind: down ? "down" : "up", tip: `${label}${ms} · ${clock} · ${timeAgo(c.checked_at)}` });
  }
  return out;
}

export function uptimePct(s: Service): string {
  if (s.check_type === "tls" || s.check_type === "domain") return "-";
  if (s.uptime_24h == null) return "-";
  const v = s.uptime_24h;
  return (v >= 99.995 ? 100 : v).toFixed(v >= 99.995 ? 0 : 2) + "%";
}

export function respMs(s: Service): string {
  if (s.check_type === "heartbeat" || s.check_type === "domain") return "-";
  if (statusOf(s) === "down") return "-";
  if (s.avg_response_ms == null) return "-";
  return s.avg_response_ms + " ms";
}

/** Mask the last two octets of any IPv4 address for privacy in the read-only UI. */
export function maskIp(str: string): string {
  return str.replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, "$1.$2.•.•");
}

/** Target text shown under the service name. */
export function targetOf(s: Service): string {
  if (s.check_type === "heartbeat") return s.heartbeat_token ? `/ping/${s.heartbeat_token.slice(0, 6)}…` : "heartbeat";
  return maskIp(s.url);
}

export function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const d = Math.max(0, Date.now() - ts);
  const s = Math.floor(d / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export interface Summary {
  up: number;
  down: number;
  warn: number;
  paused: number;
  fleet: string;
}
export function summarize(list: Service[]): Summary {
  let up = 0, down = 0, warn = 0, paused = 0;
  const upt: number[] = [];
  for (const s of list) {
    const k = statusOf(s);
    if (k === "up") up++;
    else if (k === "down") down++;
    else if (k === "warn") warn++;
    else if (k === "paused") paused++;
    if (s.uptime_24h != null && s.check_type !== "tls" && s.check_type !== "domain") upt.push(s.uptime_24h);
  }
  const fleet = upt.length ? (upt.reduce((a, b) => a + b, 0) / upt.length).toFixed(2) + "%" : "-";
  return { up, down, warn, paused, fleet };
}

export interface TypeMeta {
  badge: string;
  name: string;
  desc: string;
}
export const TYPES: { type: CheckType; meta: TypeMeta }[] = [
  { type: "http", meta: { badge: "HTTP", name: "HTTP(S)", desc: "Fetch a URL and check the status code, body or a JSON field." } },
  { type: "tcp", meta: { badge: "TCP", name: "TCP Port", desc: "Open a socket to host:port · SSH, Postgres, SMTP, game servers." } },
  { type: "dns", meta: { badge: "DNS", name: "DNS record", desc: "Resolve A / AAAA / CNAME / MX / TXT / NS, optionally assert the value." } },
  { type: "tls", meta: { badge: "TLS", name: "TLS certificate", desc: "Read a site certificate and warn before it expires." } },
  { type: "domain", meta: { badge: "DOMAIN", name: "Domain expiry", desc: "Watch the registrar expiry date via WHOIS / RDAP." } },
  { type: "heartbeat", meta: { badge: "HEARTBEAT", name: "Heartbeat", desc: "Your cron job pings a URL. No ping in the grace window = down." } },
];
export const typeMeta = (t: CheckType): TypeMeta => TYPES.find((x) => x.type === t)?.meta ?? TYPES[0].meta;
