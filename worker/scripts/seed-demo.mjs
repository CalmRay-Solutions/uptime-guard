// Generates realistic mock data for the public demo instance.
// Usage: node scripts/seed-demo.mjs > /tmp/seed.sql
import { randomUUID } from "crypto";

const DAY = 86_400_000;
const now = Date.now();
const out = [];
const esc = (s) => String(s).replace(/'/g, "''");
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? v : `'${esc(v)}'`);

function insert(table, row) {
  const keys = Object.keys(row);
  out.push(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((k) => q(row[k])).join(", ")});`);
}

const projects = [
  { id: randomUUID(), name: "Production", public: 1, public_slug: "demo" },
  { id: randomUUID(), name: "Acme Corp · Client", public: 0, public_slug: null },
  { id: randomUUID(), name: "Internal Tools", public: 0, public_slug: null },
];
for (const p of projects) insert("projects", { id: p.id, name: p.name, created_at: now - 120 * DAY, public: p.public, public_slug: p.public_slug });

// status: current_status stored value. 'warn' is derived from expiry, so warn services store 'up'.
const svc = [
  // Production
  { p: 0, name: "Marketing Site", type: "http", url: "https://example.com", st: "up", rt: 120 },
  { p: 0, name: "API Gateway", type: "http", url: "https://api.example.com/health", st: "up", rt: 78 },
  { p: 0, name: "Checkout Service", type: "http", url: "https://checkout.example.com", st: "down", code: 503, err: "unexpected status 503" },
  { p: 0, name: "Postgres Primary", type: "tcp", host: "db.example.com", port: 5432, st: "up", rt: 34 },
  { p: 0, name: "Redis Cache", type: "tcp", host: "cache.example.com", port: 6379, st: "up", rt: 21 },
  { p: 0, name: "app.example.com", type: "tls", host: "app.example.com", st: "up", rt: 260, expDays: 9 },   // warn
  { p: 0, name: "example.com", type: "domain", host: "example.com", st: "up", expDays: 214 },
  // Acme Corp
  { p: 1, name: "Acme Dashboard", type: "http", url: "https://app.acme.com", st: "up", rt: 205 },
  { p: 1, name: "Acme API", type: "http", url: "https://api.acme.com/status", st: "up", rt: 143 },
  { p: 1, name: "acme.com", type: "tls", host: "acme.com", st: "up", rt: 240, expDays: 68 },
  { p: 1, name: "cdn.acme.com", type: "tls", host: "cdn.acme.com", st: "cf_protected", expDays: null },
  { p: 1, name: "Nightly Backup", type: "heartbeat", st: "up", intervalH: 24 },
  // Internal Tools
  { p: 2, name: "Grafana", type: "http", url: "https://grafana.internal.example", st: "up", rt: 96 },
  { p: 2, name: "CI Runner", type: "tcp", host: "ci.internal.example", port: 22, st: "up", rt: 48 },
  { p: 2, name: "Staging", type: "http", url: "https://staging.internal.example", st: "down", err: "connection timed out" },
];

function urlFor(s, token) {
  if (s.type === "http") return s.url;
  if (s.type === "tcp") return `tcp://${s.host}:${s.port}`;
  if (s.type === "tls") return `tls://${s.host}:443`;
  if (s.type === "domain") return `domain://${s.host}`;
  if (s.type === "heartbeat") return `heartbeat:${token}`;
}
function configFor(s) {
  if (s.type === "tcp") return JSON.stringify({ host: s.host, port: s.port });
  if (s.type === "tls") return JSON.stringify({ host: s.host, port: 443, warn_days: 14 });
  if (s.type === "domain") return JSON.stringify({ domain: s.host, warn_days: 30 });
  if (s.type === "heartbeat") return JSON.stringify({ grace_seconds: s.intervalH * 3600 * 2 });
  return "{}";
}

const rand = (a, b) => a + Math.random() * (b - a);

for (const s of svc) {
  const id = randomUUID();
  const token = s.type === "heartbeat" ? randomUUID().replace(/-/g, "") : null;
  const interval = s.type === "heartbeat" ? s.intervalH * 3600 : s.type === "tls" || s.type === "domain" ? 86400 : 300;
  const expires_at = s.expDays != null ? now + s.expDays * DAY : null;

  insert("services", {
    id, project_id: projects[s.p].id, name: s.name, url: urlFor(s, token),
    method: "GET", expected_status_min: 200, expected_status_max: s.type === "http" ? 399 : 299,
    interval_seconds: interval, timeout_ms: 10000, paused: 0, current_status: s.st,
    last_checked_at: now - Math.floor(rand(10, 120)) * 1000,
    created_at: now - 120 * DAY, check_type: s.type, config: configFor(s),
    heartbeat_token: token, last_ping_at: s.type === "heartbeat" ? now - Math.floor(rand(1, 6)) * 3600 * 1000 : null,
    expires_at,
  });

  // Recent checks (last ~30h, every 30 min) for sparkline + 24h uptime/avg.
  if (s.type !== "heartbeat" && s.type !== "domain") {
    const n = 60;
    for (let i = n; i >= 0; i--) {
      const at = now - i * 30 * 60 * 1000;
      // Down services: last ~6 checks down (ongoing), earlier up.
      const isDownNow = s.st === "down" && i <= 6;
      const status = s.st === "cf_protected" ? "cf_protected" : isDownNow ? "down" : "up";
      const rt = status === "up" && s.rt ? Math.round(rand(s.rt * 0.7, s.rt * 1.4)) : null;
      insert("checks", {
        service_id: id, status,
        status_code: s.type === "http" ? (status === "down" ? s.code ?? null : 200) : null,
        response_time_ms: rt, error: status === "down" ? s.err ?? "failed check" : null, checked_at: at,
      });
    }
  }

  // 90-day daily rollups (a couple of dips for realism).
  const todayStart = Math.floor(now / DAY) * DAY;
  for (let d = 89; d >= 0; d--) {
    const day = todayStart - d * DAY;
    const total = 288; // 5-min checks/day
    let up = total;
    if (s.st === "down") up = d === 0 ? Math.round(total * 0.4) : d < 2 ? Math.round(total * 0.9) : total - (Math.random() < 0.1 ? Math.round(rand(1, 6)) : 0);
    else up = total - (Math.random() < 0.06 ? Math.round(rand(1, 8)) : 0);
    if (s.st === "cf_protected") up = total;
    insert("daily_stats", { service_id: id, day, up, total });
  }

  // Incidents: ongoing for down services, plus a couple of resolved ones for history.
  if (s.st === "down") {
    insert("incidents", { service_id: id, started_at: now - Math.floor(rand(2, 5)) * 3600 * 1000, resolved_at: null, notified: 1 });
  }
  if (["Marketing Site", "API Gateway", "Checkout Service", "Acme Dashboard"].includes(s.name)) {
    for (let k = 0; k < 3; k++) {
      const start = now - Math.floor(rand(3, 70)) * DAY - Math.floor(rand(0, 20)) * 3600 * 1000;
      insert("incidents", { service_id: id, started_at: start, resolved_at: start + Math.floor(rand(3, 90)) * 60 * 1000, notified: 1 });
    }
  }
}

console.log(out.join("\n"));
