import { verifyTotp, timingSafeEqual, generateTotpSecret } from "./totp";
import { createSessionToken, verifySessionToken } from "./session";
import { performCheckConfirmed, ServiceRow, CheckResult } from "./checks";
import { sendPush, type PushSub } from "./push";
import schemaSql from "../schema.sql";

export interface Env {
  DB: D1Database;
  // All optional: a fresh deploy configures the owner via the first-run setup screen
  // and auto-generates a session secret. These env secrets are fallbacks/overrides.
  PASSWORD?: string;
  TOTP_SECRET?: string;
  SESSION_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ASSETS: Fetcher;
  VAPID_PUBLIC?: string;
  VAPID_PRIVATE?: string;
  VAPID_SUBJECT?: string;
  // When "1", the login accepts the password alone (no TOTP). For public demo
  // instances only — never set this on a real deployment.
  DEMO_MODE?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

function uid(): string {
  return crypto.randomUUID();
}

interface CreateServiceBody {
  name?: string;
  check_type?: string;
  interval_seconds?: number;
  timeout_ms?: number;
  // http
  url?: string;
  method?: string;
  expected_status_min?: number;
  expected_status_max?: number;
  keyword?: string;
  keyword_mode?: "present" | "absent";
  json_path?: string;
  json_equals?: string;
  // tcp
  host?: string;
  port?: number;
  // dns
  domain?: string;
  record_type?: string;
  expected?: string;
  // heartbeat
  grace_seconds?: number;
  // tls / domain
  warn_days?: number;
}

interface PreparedService {
  name: string;
  url: string;
  method: string;
  expected_status_min: number;
  expected_status_max: number;
  interval_seconds: number;
  timeout_ms: number;
  check_type: string;
  config: string;
  heartbeat_token: string | null;
}

type ServiceBase = Omit<PreparedService, "url" | "config"> & { interval_seconds: number };
type TypeBuilder = (body: CreateServiceBody, base: ServiceBase) => PreparedService;

function buildHttp(body: CreateServiceBody, base: ServiceBase): PreparedService {
  const url = body.url?.trim();
  if (!url) throw new Error("url required");
  const config: Record<string, unknown> = {};
  if (body.keyword?.trim()) {
    config.keyword = body.keyword.trim();
    config.keyword_mode = body.keyword_mode ?? "present";
  }
  if (body.json_path?.trim()) {
    config.json_path = body.json_path.trim();
    if (body.json_equals != null && body.json_equals !== "") config.json_equals = String(body.json_equals);
  }
  return {
    ...base,
    url,
    method: body.method ?? "GET",
    expected_status_min: body.expected_status_min ?? 200,
    expected_status_max: body.expected_status_max ?? 299,
    config: JSON.stringify(config),
  };
}

function buildTcp(body: CreateServiceBody, base: ServiceBase): PreparedService {
  const host = body.host?.trim();
  const port = Number(body.port);
  if (!host) throw new Error("host required");
  if (!port || port < 1 || port > 65535) throw new Error("valid port required");
  return { ...base, url: `tcp://${host}:${port}`, config: JSON.stringify({ host, port }) };
}

function buildDns(body: CreateServiceBody, base: ServiceBase): PreparedService {
  const domain = body.domain?.trim();
  if (!domain) throw new Error("domain required");
  const record_type = (body.record_type ?? "A").toUpperCase();
  const config: Record<string, unknown> = { domain, record_type };
  if (body.expected?.trim()) config.expected = body.expected.trim();
  return { ...base, url: `dns://${domain} (${record_type})`, config: JSON.stringify(config) };
}

function buildHeartbeat(body: CreateServiceBody, base: ServiceBase): PreparedService {
  const token = crypto.randomUUID().replace(/-/g, "");
  const grace_seconds = body.grace_seconds ?? base.interval_seconds * 2;
  return { ...base, url: `heartbeat:${token}`, config: JSON.stringify({ grace_seconds }), heartbeat_token: token };
}

function buildTls(body: CreateServiceBody, base: ServiceBase): PreparedService {
  const host = body.host?.trim();
  if (!host) throw new Error("host required");
  const port = body.port ? Number(body.port) : 443;
  if (port < 1 || port > 65535) throw new Error("valid port required");
  const config: Record<string, unknown> = { host, port };
  if (body.warn_days != null) config.warn_days = Number(body.warn_days);
  return { ...base, url: `tls://${host}:${port}`, config: JSON.stringify(config) };
}

function buildDomain(body: CreateServiceBody, base: ServiceBase): PreparedService {
  const domain = body.domain?.trim();
  if (!domain) throw new Error("domain required");
  const config: Record<string, unknown> = { domain };
  if (body.warn_days != null) config.warn_days = Number(body.warn_days);
  return { ...base, url: `domain://${domain}`, config: JSON.stringify(config) };
}

const SERVICE_BUILDERS: Record<string, TypeBuilder> = {
  http: buildHttp,
  tcp: buildTcp,
  dns: buildDns,
  heartbeat: buildHeartbeat,
  tls: buildTls,
  domain: buildDomain,
};

/** Validates a create-service body per type and normalizes it into DB columns. */
function prepareService(body: CreateServiceBody): PreparedService {
  const name = body.name?.trim();
  if (!name) throw new Error("name required");

  const type = (body.check_type ?? "http").toLowerCase();
  const builder = SERVICE_BUILDERS[type];
  if (!builder) throw new Error(`unknown check_type "${type}"`);

  const base: ServiceBase = {
    name,
    method: "GET",
    expected_status_min: 200,
    expected_status_max: 299,
    interval_seconds: body.interval_seconds ?? 60,
    timeout_ms: body.timeout_ms ?? 10000,
    check_type: type,
    heartbeat_token: null,
  };
  return builder(body, base);
}

/** Applies a full edit to an existing service, preserving the ping token when it stays a heartbeat. */
async function updateService(env: Env, serviceId: string, body: CreateServiceBody): Promise<Response> {
  const existing = await env.DB.prepare(`SELECT * FROM services WHERE id = ?`).bind(serviceId).first<ServiceRow>();
  if (!existing) return json({ error: "not found" }, 404);
  let prepared: PreparedService;
  try {
    prepared = prepareService(body);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  const token =
    prepared.check_type === "heartbeat"
      ? existing.check_type === "heartbeat"
        ? existing.heartbeat_token
        : prepared.heartbeat_token
      : null;
  const resetExpiry = prepared.check_type !== existing.check_type;
  await env.DB.prepare(
    `UPDATE services SET name=?, url=?, method=?, expected_status_min=?, expected_status_max=?,
       interval_seconds=?, timeout_ms=?, check_type=?, config=?, heartbeat_token=?,
       current_status = CASE WHEN check_type != ? THEN 'unknown' ELSE current_status END,
       expires_at = CASE WHEN ? THEN NULL ELSE expires_at END
     WHERE id=?`
  )
    .bind(
      prepared.name, prepared.url, prepared.method, prepared.expected_status_min, prepared.expected_status_max,
      prepared.interval_seconds, prepared.timeout_ms, prepared.check_type, prepared.config, token,
      prepared.check_type, resetExpiry ? 1 : 0, serviceId
    )
    .run();
  return json({ ok: true, heartbeat_token: token });
}

/** Routes under /api/push/*: VAPID key lookup + subscription store/remove. */
async function handlePushRoute(parts: string[], req: Request, env: Env): Promise<Response | null> {
  if (parts[2] === "key" && req.method === "GET") {
    return json({ key: env.VAPID_PUBLIC ?? null });
  }
  if (parts[2] === "subscribe" && req.method === "POST") {
    const b = await req.json<PushSub>();
    if (!b.endpoint || !b.p256dh || !b.auth) return json({ error: "invalid subscription" }, 400);
    await env.DB.prepare(
      `INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
    )
      .bind(b.endpoint, b.p256dh, b.auth, Date.now())
      .run();
    return json({ ok: true });
  }
  if (parts[2] === "unsubscribe" && req.method === "POST") {
    const b = await req.json<{ endpoint: string }>();
    if (b.endpoint) await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(b.endpoint).run();
    return json({ ok: true });
  }
  return null;
}

/** Push a notification to every subscribed browser and prune dead subscriptions. */
async function notifyPush(env: Env, title: string, body: string, url: string): Promise<void> {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return;
  const { results } = await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subs`).all<PushSub>();
  if (!results?.length) return;
  const dead = await sendPush(
    { publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE, subject: env.VAPID_SUBJECT || "mailto:admin@localhost" },
    results,
    { title, body, url }
  );
  for (const endpoint of dead) {
    await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(endpoint).run();
  }
}

/** Telegram config: settings table takes precedence over env fallback. One D1 read. */
async function telegramConfig(env: Env): Promise<{ token: string; chat: string; thread: string | null }> {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN ('telegram_bot_token','telegram_chat_id','telegram_thread_id')`
  ).all<{ key: string; value: string }>();
  const m = new Map((results ?? []).map((r) => [r.key, r.value]));
  return {
    token: m.get("telegram_bot_token") || env.TELEGRAM_BOT_TOKEN || "",
    chat: m.get("telegram_chat_id") || env.TELEGRAM_CHAT_ID || "",
    thread: m.get("telegram_thread_id") || null,
  };
}

async function sendTelegram(env: Env, text: string): Promise<void> {
  const { token, chat, thread } = await telegramConfig(env);
  await postTelegram(token, chat, thread, text).catch(() => {});
}

/** Low-level Telegram send. Returns the API response so callers (e.g. a test) can report failure. */
async function postTelegram(token: string, chat: string, thread: string | null, text: string): Promise<Response | null> {
  if (!token || !chat) return null;
  const body: Record<string, unknown> = { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (thread) body.message_thread_id = Number(thread);
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const TYPE_LABEL: Record<string, string> = {
  http: "HTTP",
  tcp: "TCP",
  dns: "DNS",
  heartbeat: "Heartbeat",
  tls: "TLS",
  domain: "Domain",
};

/** Gap before the next down-reminder, by how many were already sent. Widens then caps (5m→10m→20m→40m→hourly). */
const REMINDER_STEPS_MIN = [5, 10, 20, 40, 60];
function reminderGapMs(level: number): number {
  return REMINDER_STEPS_MIN[Math.min(level, REMINDER_STEPS_MIN.length - 1)] * 60_000;
}
function fmtDowntime(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Runs a check (or records a supplied heartbeat result), persists it, and alerts on transitions. */
async function recordCheck(env: Env, svc: ServiceRow, result: CheckResult): Promise<void> {
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO checks (service_id, status, status_code, response_time_ms, error, checked_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(svc.id, result.status, result.statusCode, result.responseTime, result.error, now)
    .run();

  await env.DB.prepare(`UPDATE services SET current_status = ?, last_checked_at = ? WHERE id = ?`)
    .bind(result.status, now, svc.id)
    .run();

  if (result.expiresAt !== undefined) {
    await env.DB.prepare(`UPDATE services SET expires_at = ? WHERE id = ?`).bind(result.expiresAt, svc.id).run();
  }

  // CF Protected is informational, not an outage: never alert, and quietly close
  // any incident left open from before it was recognized as Cloudflare-fronted.
  if (result.status === "cf_protected") {
    await env.DB.prepare(`UPDATE incidents SET resolved_at = ? WHERE service_id = ? AND resolved_at IS NULL`)
      .bind(now, svc.id)
      .run();
    return;
  }

  const wasDown = svc.current_status === "down";
  const isDown = result.status === "down";

  if (!wasDown && isDown) await openIncident(env, svc, result, now);
  else if (wasDown && isDown) await remindIfDue(env, svc, result, now);
  else if (wasDown && !isDown) await resolveIncident(env, svc, result, now);
}

function faultLine(result: CheckResult): string {
  return result.error ? `Error: ${result.error}` : `Status: ${result.statusCode}`;
}

/** First down check: record the incident and fire the initial alert. */
async function openIncident(env: Env, svc: ServiceRow, result: CheckResult, now: number): Promise<void> {
  const label = TYPE_LABEL[svc.check_type] ?? svc.check_type;
  await env.DB.prepare(
    `INSERT INTO incidents (service_id, started_at, notified, last_reminder_at, reminder_level) VALUES (?, ?, 1, ?, 0)`
  )
    .bind(svc.id, now, now)
    .run();
  await sendTelegram(env, `🔴 <b>${svc.name}</b> is DOWN\n${label} · ${svc.url}\n${faultLine(result)}`);
  await notifyPush(env, `🔴 ${svc.name} is down`, `${label} · ${faultLine(result)}`, `/p/${svc.project_id}/s/${svc.id}`);
}

/** Still down: re-alert on a widening backoff so an ongoing outage isn't forgotten. */
async function remindIfDue(env: Env, svc: ServiceRow, result: CheckResult, now: number): Promise<void> {
  const inc = await env.DB.prepare(
    `SELECT id, started_at, last_reminder_at, reminder_level FROM incidents
       WHERE service_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1`
  )
    .bind(svc.id)
    .first<{ id: number; started_at: number; last_reminder_at: number | null; reminder_level: number }>();
  if (!inc) return;
  const baseline = inc.last_reminder_at ?? inc.started_at;
  if (now - baseline < reminderGapMs(inc.reminder_level)) return;
  await env.DB.prepare(`UPDATE incidents SET last_reminder_at = ?, reminder_level = ? WHERE id = ?`)
    .bind(now, inc.reminder_level + 1, inc.id)
    .run();
  const label = TYPE_LABEL[svc.check_type] ?? svc.check_type;
  await sendTelegram(
    env,
    `🔴 <b>${svc.name}</b> still DOWN · ${fmtDowntime(now - inc.started_at)}\n${label} · ${svc.url}\n${faultLine(result)}`
  );
}

/** Recovery: close the open incident and report total downtime. */
async function resolveIncident(env: Env, svc: ServiceRow, result: CheckResult, now: number): Promise<void> {
  const inc = await env.DB.prepare(
    `SELECT started_at FROM incidents WHERE service_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1`
  )
    .bind(svc.id)
    .first<{ started_at: number }>();
  await env.DB.prepare(`UPDATE incidents SET resolved_at = ? WHERE service_id = ? AND resolved_at IS NULL`)
    .bind(now, svc.id)
    .run();
  const label = TYPE_LABEL[svc.check_type] ?? svc.check_type;
  const downtime = inc ? ` · was down ${fmtDowntime(now - inc.started_at)}` : "";
  await sendTelegram(
    env,
    `✅ <b>${svc.name}</b> is back UP${downtime}\n${label} · ${svc.url}${
      result.responseTime != null ? `\nResponse time: ${result.responseTime}ms` : ""
    }`
  );
  await notifyPush(env, `✅ ${svc.name} recovered`, `${label}${downtime}`, `/p/${svc.project_id}/s/${svc.id}`);
}

async function checkService(env: Env, svc: ServiceRow): Promise<void> {
  const result = await performCheckConfirmed(svc);
  await recordCheck(env, svc, result);
}

const RETENTION_DEFAULT = 60;

// Current session epoch, cached per-isolate so we don't read D1 on every request.
// Bumping it (revoke) invalidates every token; propagates to other isolates within the TTL.
let epochCache: { value: number; at: number } | null = null;
async function currentSessionEpoch(env: Env): Promise<number> {
  const now = Date.now();
  if (epochCache && now - epochCache.at < 60_000) return epochCache.value;
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'session_epoch'`).first<{ value: string }>();
  const value = row ? Number(row.value) || 0 : 0;
  epochCache = { value, at: now };
  return value;
}

// Create every table on first use so a fresh deploy needs no schema step.
// schema.sql is all CREATE ... IF NOT EXISTS, so this is idempotent. Cached per isolate.
let schemaReady: Promise<void> | null = null;
function ensureSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const stmts = schemaSql
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
      await seedDefaultProject(env);
    })().catch((e) => {
      schemaReady = null; // let the next request retry
      throw e;
    });
  }
  return schemaReady;
}

/**
 * A fresh instance starts with one project, "My Project", so the first monitor
 * has somewhere to go. The marker row means this happens once ever: deleting
 * every project later does not bring it back.
 */
async function seedDefaultProject(env: Env): Promise<void> {
  if (await getSetting(env, "default_project_seeded")) return;
  const existing = await env.DB.prepare(`SELECT id FROM projects LIMIT 1`).first<{ id: string }>();
  if (!existing) {
    await env.DB.prepare(`INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)`)
      .bind(uid(), "My Project", Date.now())
      .run();
  }
  await setSetting(env, "default_project_seeded", "1");
}

// --- Zero-secret auth: password hash, session secret, and setup state live in D1,
//     with the env secrets (PASSWORD / SESSION_SECRET / TOTP_SECRET) as fallbacks. ---
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: "SHA-256" }, key, 256);
  return b64(new Uint8Array(bits));
}
/** Store as `salt:hash` (both base64). */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${b64(salt)}:${await pbkdf2(password, salt)}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  return timingSafeEqual(await pbkdf2(password, fromB64(saltB64)), hashB64);
}

// Session secret: env if provided, else a generated one persisted in D1 (cached per isolate).
let sessionSecretCache: string | null = null;
async function getSessionSecret(env: Env): Promise<string> {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (sessionSecretCache) return sessionSecretCache;
  let s = await getSetting(env, "session_secret");
  if (!s) {
    s = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await setSetting(env, "session_secret", s);
  }
  sessionSecretCache = s;
  return s;
}

/** True when no owner password exists yet (fresh deploy → show the setup screen). */
async function setupRequired(env: Env): Promise<boolean> {
  if (env.PASSWORD) return false;
  return !(await getSetting(env, "password_hash"));
}

/** Read one settings value, or null. */
async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first<{ value: string }>();
  return row ? row.value : null;
}
/** Upsert a settings value; empty string deletes the row (clears the setting). */
async function setSetting(env: Env, key: string, value: string): Promise<void> {
  if (value === "") {
    await env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(key).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(key, value)
    .run();
}

/** Retention window in days (0 = keep forever), from the settings table. */
async function getRetentionDays(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'retention_days'`).first<{ value: string }>();
  const n = row ? Number(row.value) : RETENTION_DEFAULT;
  return Number.isFinite(n) && n >= 0 ? n : RETENTION_DEFAULT;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Roll the last few complete UTC days of raw checks into per-service daily_stats. */
async function rollupDaily(env: Env): Promise<void> {
  const todayStart = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const from = todayStart - 3 * DAY_MS; // re-roll last 3 complete days (idempotent catch-up)
  await env.DB.prepare(
    `INSERT INTO daily_stats (service_id, day, up, total)
     SELECT service_id, (checked_at / 86400000) * 86400000 AS day,
            SUM(CASE WHEN status IN ('up','cf_protected') THEN 1 ELSE 0 END), COUNT(*)
     FROM checks WHERE checked_at >= ? AND checked_at < ?
     GROUP BY service_id, day
     ON CONFLICT(service_id, day) DO UPDATE SET up = excluded.up, total = excluded.total`
  )
    .bind(from, todayStart)
    .run();
}

/** Public-safe status for one service (no internal target/config leaked). */
function publicStatusOf(s: ServiceRow): string {
  if (s.current_status === "down") return "down";
  if ((s.check_type === "tls" || s.check_type === "domain") && s.expires_at != null) {
    const days = Math.floor((s.expires_at - Date.now()) / DAY_MS);
    let warn = s.check_type === "domain" ? 30 : 14;
    try {
      const c = JSON.parse(s.config || "{}");
      if (c.warn_days != null) warn = Number(c.warn_days);
    } catch {
      /* default */
    }
    if (days < 0) return "down";
    if (days <= warn) return "warn";
  }
  return "up"; // up + cf_protected both read as operational publicly
}

/**
 * Read-only public status for a project, by its share slug. No auth. Sanitized
 * (names + status + 90d uptime only) and edge-cached ~60s so heavy traffic
 * doesn't hammer D1.
 */
async function publicStatus(env: Env, ctx: ExecutionContext, req: Request, slug: string): Promise<Response> {
  const cache = caches.default;
  const cached = await cache.match(req);
  if (cached) return cached;

  const project = await env.DB.prepare(`SELECT id, name FROM projects WHERE public_slug = ? AND public = 1`)
    .bind(slug)
    .first<{ id: string; name: string }>();
  if (!project) return json({ error: "not found" }, 404);

  const now = Date.now();
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;

  const svcRes = await env.DB.prepare(
    `SELECT * FROM services WHERE project_id = ? AND paused = 0 ORDER BY created_at DESC`
  )
    .bind(project.id)
    .all<ServiceRow>();
  const services = svcRes.results ?? [];

  const histRes = await env.DB.prepare(
    `SELECT d.service_id AS sid, SUM(d.up) AS up, SUM(d.total) AS total
     FROM daily_stats d JOIN services s ON s.id = d.service_id
     WHERE s.project_id = ? AND d.day >= ? GROUP BY d.service_id`
  )
    .bind(project.id, todayStart - 89 * DAY_MS)
    .all<{ sid: string; up: number; total: number }>();
  const todayRes = await env.DB.prepare(
    `SELECT c.service_id AS sid, SUM(CASE WHEN c.status IN ('up','cf_protected') THEN 1 ELSE 0 END) AS up, COUNT(*) AS total
     FROM checks c JOIN services s ON s.id = c.service_id
     WHERE s.project_id = ? AND c.checked_at >= ? GROUP BY c.service_id`
  )
    .bind(project.id, todayStart)
    .all<{ sid: string; up: number; total: number }>();

  const hist = new Map((histRes.results ?? []).map((r) => [r.sid, r]));
  const today = new Map((todayRes.results ?? []).map((r) => [r.sid, r]));
  const items = services.map((s) => {
    const h = hist.get(s.id);
    const t = today.get(s.id);
    const up = (h?.up ?? 0) + (t?.up ?? 0);
    const total = (h?.total ?? 0) + (t?.total ?? 0);
    return { name: s.name, type: s.check_type, status: publicStatusOf(s), uptime_90d: total > 0 ? (up / total) * 100 : null };
  });

  const down = items.filter((i) => i.status === "down").length;
  const warn = items.filter((i) => i.status === "warn").length;
  const resp = json({
    project: project.name,
    updated_at: now,
    summary: { total: items.length, down, warn, operational: down === 0 && warn === 0 },
    services: items,
  });
  resp.headers.set("Cache-Control", "public, max-age=60");
  ctx.waitUntil(cache.put(req, resp.clone()));
  return resp;
}

/** SLA windows (from rollups + today's live partial), MTTR, and recent incidents. */
async function getServiceStats(env: Env, serviceId: string): Promise<Response> {
  const now = Date.now();
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;

  const daysRes = await env.DB.prepare(
    `SELECT day, up, total FROM daily_stats WHERE service_id = ? AND day >= ? ORDER BY day`
  )
    .bind(serviceId, todayStart - 90 * DAY_MS)
    .all<{ day: number; up: number; total: number }>();
  const days = daysRes.results ?? [];

  const upExpr = `SUM(CASE WHEN status IN ('up','cf_protected') THEN 1 ELSE 0 END) AS up, COUNT(*) AS total`;
  const today = await env.DB.prepare(`SELECT ${upExpr} FROM checks WHERE service_id = ? AND checked_at >= ?`)
    .bind(serviceId, todayStart)
    .first<{ up: number | null; total: number | null }>();
  const todayUp = today?.up ?? 0;
  const todayTotal = today?.total ?? 0;

  const windowPct = (winDays: number): number | null => {
    const cutoff = todayStart - (winDays - 1) * DAY_MS;
    let up = todayUp;
    let total = todayTotal;
    for (const d of days) {
      if (d.day >= cutoff && d.day < todayStart) { up += d.up; total += d.total; }
    }
    return total > 0 ? (up / total) * 100 : null;
  };

  const h24 = await env.DB.prepare(`SELECT ${upExpr} FROM checks WHERE service_id = ? AND checked_at >= ?`)
    .bind(serviceId, now - DAY_MS)
    .first<{ up: number | null; total: number | null }>();
  const uptimeH24 = (h24?.total ?? 0) > 0 ? ((h24!.up ?? 0) / h24!.total!) * 100 : null;

  const inc90 = await env.DB.prepare(
    `SELECT COUNT(*) AS n, AVG(CASE WHEN resolved_at IS NOT NULL THEN resolved_at - started_at END) AS mttr
     FROM incidents WHERE service_id = ? AND started_at >= ?`
  )
    .bind(serviceId, now - 90 * DAY_MS)
    .first<{ n: number; mttr: number | null }>();

  const incRes = await env.DB.prepare(
    `SELECT id, started_at, resolved_at FROM incidents WHERE service_id = ? ORDER BY started_at DESC LIMIT 20`
  )
    .bind(serviceId)
    .all<{ id: number; started_at: number; resolved_at: number | null }>();

  return json({
    uptime: { h24: uptimeH24, d7: windowPct(7), d30: windowPct(30), d90: windowPct(90) },
    mttr_ms: inc90?.mttr ?? null,
    incidents_90d: inc90?.n ?? 0,
    incidents: incRes.results ?? [],
  });
}

/** Daily housekeeping: drop check history and resolved incidents past retention. */
async function pruneOldData(env: Env): Promise<void> {
  const days = await getRetentionDays(env);
  if (days <= 0) return; // keep forever
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  await env.DB.prepare(`DELETE FROM checks WHERE checked_at < ?`).bind(cutoff).run();
  await env.DB.prepare(`DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?`).bind(cutoff).run();
  // Login attempts are only needed for the rate-limit window; drop anything older than a day.
  await env.DB.prepare(`DELETE FROM login_attempts WHERE at < ?`).bind(Date.now() - 24 * 60 * 60 * 1000).run();
}

/** Routes under /api/settings: read + patch app settings. */
interface SettingsPatch {
  retention_days?: number;
  telegram_bot_token?: string;
  telegram_chat_id?: string;
  telegram_thread_id?: string;
}

/** Non-secret snapshot of settings for the dashboard (never returns raw token/TOTP secret). */
async function settingsSnapshot(env: Env): Promise<Response> {
  const tg = await telegramConfig(env);
  const totpConfigured = Boolean((await getSetting(env, "totp_secret")) || env.TOTP_SECRET);
  const tokenFromDb = await getSetting(env, "telegram_bot_token");
  return json({
    retention_days: await getRetentionDays(env),
    telegram: {
      has_token: Boolean(tg.token),
      // Masked hint only — never the full token.
      token_hint: tokenFromDb ? `…${tokenFromDb.slice(-4)}` : tg.token ? "set via env" : "",
      chat_id: (await getSetting(env, "telegram_chat_id")) ?? "",
      thread_id: (await getSetting(env, "telegram_thread_id")) ?? "",
    },
    totp: { configured: totpConfigured },
  });
}

async function handleSettingsRoute(parts: string[], req: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  // /api/settings
  if (parts.length === 2) {
    if (req.method === "GET") return settingsSnapshot(env);
    if (req.method === "PATCH") {
      const b = await req.json<SettingsPatch>();
      if (b.retention_days != null) await setSetting(env, "retention_days", String(Math.max(0, Math.floor(Number(b.retention_days) || 0))));
      if (b.telegram_bot_token !== undefined) await setSetting(env, "telegram_bot_token", b.telegram_bot_token.trim());
      if (b.telegram_chat_id !== undefined) await setSetting(env, "telegram_chat_id", b.telegram_chat_id.trim());
      if (b.telegram_thread_id !== undefined) await setSetting(env, "telegram_thread_id", b.telegram_thread_id.trim());
      return settingsSnapshot(env);
    }
    return null;
  }
  if (parts.length !== 3) return null;

  // /api/settings/telegram-test — send a test message with the saved config
  if (parts[2] === "telegram-test" && req.method === "POST") {
    const { token, chat, thread } = await telegramConfig(env);
    if (!token || !chat) return json({ error: "Set a bot token and chat id first." }, 400);
    const res = await postTelegram(token, chat, thread, "✅ <b>Uptime Guard</b>\nTest alert — your Telegram settings are working.").catch(() => null);
    if (!res || !res.ok) {
      const detail = res ? ((await res.json().catch(() => ({}))) as { description?: string }).description : "request failed";
      return json({ error: `Telegram rejected the message: ${detail ?? "unknown error"}` }, 400);
    }
    return json({ ok: true });
  }

  // /api/settings/totp-new — mint a candidate secret (not saved until confirmed)
  if (parts[2] === "totp-new" && req.method === "GET") {
    const secret = generateTotpSecret();
    const label = encodeURIComponent("Uptime Guard");
    const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${label}&algorithm=SHA1&digits=6&period=30`;
    return json({ secret, otpauth });
  }

  // /api/settings/totp — verify a code against the candidate secret, then save it
  if (parts[2] === "totp" && req.method === "POST") {
    const b = await req.json<{ secret: string; code: string }>();
    if (!b.secret || !(await verifyTotp(b.secret, b.code ?? ""))) {
      return json({ error: "That code doesn't match — check the time on your device and try again." }, 400);
    }
    await setSetting(env, "totp_secret", b.secret);
    void ctx; // reserved for future cache invalidation
    return json({ ok: true });
  }
  return null;
}

async function runDueChecks(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT * FROM services WHERE paused = 0`).all<ServiceRow>();

  const now = Date.now();
  const due = (results ?? []).filter((svc) => {
    // Heartbeats are evaluated every tick so overdue pings surface promptly.
    if (svc.check_type === "heartbeat") return true;
    if (!svc.last_checked_at) return true;
    return now - svc.last_checked_at >= svc.interval_seconds * 1000;
  });

  await Promise.allSettled(due.map((svc) => checkService(env, svc)));
}

async function requireAuth(req: Request, env: Env): Promise<Response | null> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const epoch = await verifySessionToken(token, await getSessionSecret(env));
  if (epoch === null) return json({ error: "unauthorized" }, 401);
  if (epoch !== (await currentSessionEpoch(env))) return json({ error: "session revoked" }, 401);
  return null;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

    // Ensure tables exist (no-op after the first request on each isolate).
    await ensureSchema(env);

    // /api/auth/login — password + authenticator (TOTP) code, no session required
    if (parts[0] === "api" && parts[1] === "auth" && parts[2] === "login" && req.method === "POST") {
      try {
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        const now = Date.now();
        const LOGIN_WINDOW_MS = 15 * 60 * 1000;
        const LOGIN_MAX_FAILS = 8;
        const recent = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ok = 0 AND at > ?`
        )
          .bind(ip, now - LOGIN_WINDOW_MS)
          .first<{ n: number }>();
        if ((recent?.n ?? 0) >= LOGIN_MAX_FAILS) {
          return json({ error: "Too many attempts. Try again in a few minutes." }, 429, { "Retry-After": "900" });
        }

        const body = await req.json<{ password: string; code: string }>();
        // Password: prefer the hash created at setup (D1), fall back to the env secret.
        const passwordHash = await getSetting(env, "password_hash");
        const passwordOk = Boolean(body.password) && (
          passwordHash ? await verifyPassword(body.password, passwordHash)
            : Boolean(env.PASSWORD) && timingSafeEqual(body.password, env.PASSWORD!)
        );
        // TOTP is editable from Settings (DB) with env fallback; when none is set, it's skipped.
        const totpSecret = (await getSetting(env, "totp_secret")) || env.TOTP_SECRET || "";
        const requireTotp = env.DEMO_MODE !== "1" && Boolean(totpSecret);
        const codeOk = passwordOk && (!requireTotp || (await verifyTotp(totpSecret, body.code ?? "")));
        const success = passwordOk && codeOk;

        await env.DB.prepare(`INSERT INTO login_attempts (ip, at, ok) VALUES (?, ?, ?)`)
          .bind(ip, now, success ? 1 : 0)
          .run();

        if (!success) {
          // Progressive delay: each recent failure slows the next response (capped at 5s),
          // throttling brute force long before the hard lockout.
          const delayMs = Math.min(((recent?.n ?? 0) + 1) * 500, 5000);
          await new Promise((r) => setTimeout(r, delayMs));
          return json({ error: "invalid password or code" }, 401);
        }

        // A good login clears this IP's failure streak.
        await env.DB.prepare(`DELETE FROM login_attempts WHERE ip = ? AND ok = 0`).bind(ip).run();
        const token = await createSessionToken(await getSessionSecret(env), await currentSessionEpoch(env));
        return json({ token });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    // /ping/:token — public heartbeat receiver (no auth). Your cron/server calls this.
    if (parts[0] === "ping" && parts.length === 2) {
      const token = parts[1];
      const svc = await env.DB.prepare(`SELECT * FROM services WHERE heartbeat_token = ?`)
        .bind(token)
        .first<ServiceRow>();
      if (!svc) return json({ error: "unknown heartbeat token" }, 404);

      const now = Date.now();
      await env.DB.prepare(`UPDATE services SET last_ping_at = ? WHERE id = ?`).bind(now, svc.id).run();
      // A ping means "alive": record an up check and fire recovery alert if it was down.
      if (svc.paused === 0) {
        await recordCheck(env, svc, { status: "up", statusCode: null, responseTime: null, error: null });
      }
      return json({ ok: true });
    }

    // /api/meta — public flags the entry screen adapts to (demo, first-run setup)
    if (parts[0] === "api" && parts[1] === "meta" && req.method === "GET") {
      return json({ demo: env.DEMO_MODE === "1", setup_required: await setupRequired(env) });
    }

    // /api/setup/totp-new — mint a candidate authenticator secret for the setup
    // wizard. Unauthenticated on purpose: there is no account yet, and the secret
    // is worthless until /api/setup saves it alongside the owner password.
    if (parts[0] === "api" && parts[1] === "setup" && parts[2] === "totp-new" && req.method === "GET") {
      if (env.DEMO_MODE === "1") return json({ error: "not available" }, 403);
      if (!(await setupRequired(env))) return json({ error: "already set up" }, 403);
      const secret = generateTotpSecret();
      const label = encodeURIComponent("Uptime Guard");
      return json({
        secret,
        otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${label}&algorithm=SHA1&digits=6&period=30`,
      });
    }

    // /api/setup — first-run account creation (only while no password exists).
    // Password AND authenticator are both required: the account is never created
    // with one factor, so there is no window where the owner is password-only.
    if (parts[0] === "api" && parts[1] === "setup" && req.method === "POST") {
      if (env.DEMO_MODE === "1") return json({ error: "not available" }, 403);
      if (!(await setupRequired(env))) return json({ error: "already set up" }, 403);
      const b = await req.json<{ password?: string; totp_secret?: string; totp_code?: string }>();
      if (!b.password || b.password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      if (!b.totp_secret) return json({ error: "Authenticator setup is required." }, 400);
      if (!(await verifyTotp(b.totp_secret, b.totp_code ?? ""))) {
        return json({ error: "That code doesn't match - check the time on your device and try again." }, 400);
      }
      await setSetting(env, "totp_secret", b.totp_secret);
      await setSetting(env, "password_hash", await hashPassword(b.password));
      const token = await createSessionToken(await getSessionSecret(env), await currentSessionEpoch(env));
      return json({ token });
    }

    // /api/public/status/:slug — read-only status page data, no auth
    if (parts[0] === "api" && parts[1] === "public" && parts[2] === "status" && parts[3] && req.method === "GET") {
      return publicStatus(env, ctx, req, parts[3]);
    }

    // Anything that isn't an API call or heartbeat ping is a dashboard route: serve the
    // SPA via the assets binding. With not_found_handling="single-page-application",
    // unknown paths return index.html (200), so deep links and refreshes resolve to the
    // client-side router instead of a Worker 404.
    if (parts[0] !== "api" && parts[0] !== "ping") {
      return env.ASSETS.fetch(req);
    }

    const authError = await requireAuth(req, env);
    if (authError) return authError;

    // Demo instances are read-only: allow viewing (GET) but block any mutation.
    if (env.DEMO_MODE === "1" && req.method !== "GET") {
      return json({ error: "This is a read-only demo." }, 403);
    }

    try {
      // /api/auth/revoke — sign out every other session and re-issue this one
      if (parts[0] === "api" && parts[1] === "auth" && parts[2] === "revoke" && req.method === "POST") {
        const next = (await currentSessionEpoch(env)) + 1;
        await env.DB.prepare(
          `INSERT INTO settings (key, value) VALUES ('session_epoch', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
          .bind(String(next))
          .run();
        epochCache = { value: next, at: Date.now() };
        const token = await createSessionToken(await getSessionSecret(env), next);
        return json({ token });
      }

      if (parts[0] === "api" && parts[1] === "push") {
        const pushRes = await handlePushRoute(parts, req, env);
        if (pushRes) return pushRes;
      }
      if (parts[0] === "api" && parts[1] === "settings") {
        const settingsRes = await handleSettingsRoute(parts, req, env, ctx);
        if (settingsRes) return settingsRes;
      }

      // /api/projects
      if (parts[0] === "api" && parts[1] === "projects" && parts.length === 2) {
        if (req.method === "GET") {
          const { results } = await env.DB.prepare(
            `SELECT * FROM projects ORDER BY created_at DESC`
          ).all();
          return json(results);
        }
        if (req.method === "POST") {
          const body = await req.json<{ name: string }>();
          if (!body.name?.trim()) return json({ error: "name required" }, 400);
          const id = uid();
          await env.DB.prepare(`INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)`)
            .bind(id, body.name.trim(), Date.now())
            .run();
          return json({ id, name: body.name.trim(), created_at: Date.now() }, 201);
        }
      }

      // /api/projects/:id  (DELETE, PATCH for public status toggle)
      if (parts[0] === "api" && parts[1] === "projects" && parts.length === 3) {
        const projectId = parts[2];
        if (req.method === "DELETE") {
          await env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId).run();
          return json({ ok: true });
        }
        if (req.method === "PATCH") {
          const body = await req.json<{ public?: boolean; name?: string }>();
          if (typeof body.name === "string") {
            const name = body.name.trim();
            if (!name) return json({ error: "name required" }, 400);
            await env.DB.prepare(`UPDATE projects SET name = ? WHERE id = ?`).bind(name, projectId).run();
            const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first<{ public_slug: string | null }>();
            if (!row) return json({ error: "not found" }, 404);
            // The public page prints the project name, so drop its cached copy.
            if (row.public_slug) ctx.waitUntil(caches.default.delete(`${url.origin}/api/public/status/${row.public_slug}`));
            return json(row);
          }
          if (typeof body.public !== "boolean") return json({ error: "nothing to update" }, 400);
          const existing = await env.DB.prepare(`SELECT public_slug FROM projects WHERE id = ?`)
            .bind(projectId)
            .first<{ public_slug: string | null }>();
          let slug = existing?.public_slug ?? null;
          if (body.public) {
            slug = slug || crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            await env.DB.prepare(`UPDATE projects SET public = 1, public_slug = ? WHERE id = ?`).bind(slug, projectId).run();
          } else {
            await env.DB.prepare(`UPDATE projects SET public = 0 WHERE id = ?`).bind(projectId).run();
          }
          // Purge the edge-cached public response so enabling/disabling takes effect at once.
          if (slug) ctx.waitUntil(caches.default.delete(`${url.origin}/api/public/status/${slug}`));
          const updated = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
          return json(updated);
        }
      }

      // /api/projects/:id/services
      if (parts[0] === "api" && parts[1] === "projects" && parts[3] === "services" && parts.length === 4) {
        const projectId = parts[2];
        if (req.method === "GET") {
          const { results } = await env.DB.prepare(
            `SELECT * FROM services WHERE project_id = ? ORDER BY created_at DESC`
          )
            .bind(projectId)
            .all<ServiceRow>();

          const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
          const enriched = await Promise.all(
            (results ?? []).map(async (svc) => {
              // Last 40 checks (newest first), returned oldest->newest for the sparkline.
              const recentRes = await env.DB.prepare(
                `SELECT status, response_time_ms, checked_at FROM checks
                 WHERE service_id = ? ORDER BY checked_at DESC LIMIT 40`
              )
                .bind(svc.id)
                .all<{ status: string; response_time_ms: number | null; checked_at: number }>();
              const recent = (recentRes.results ?? []).reverse();

              // 24h uptime + average response time.
              const stats = await env.DB.prepare(
                `SELECT
                   COUNT(*) AS total,
                   SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up,
                   AVG(response_time_ms) AS avg_ms
                 FROM checks WHERE service_id = ? AND checked_at >= ?`
              )
                .bind(svc.id, dayAgo)
                .first<{ total: number; up: number; avg_ms: number | null }>();

              const total = stats?.total ?? 0;
              return {
                ...svc,
                recent,
                uptime_24h: total > 0 ? ((stats!.up ?? 0) / total) * 100 : null,
                avg_response_ms: stats?.avg_ms != null ? Math.round(stats.avg_ms) : null,
                checks_24h: total,
              };
            })
          );
          return json(enriched);
        }
        if (req.method === "POST") {
          const body = await req.json<CreateServiceBody>();
          let prepared: PreparedService;
          try {
            prepared = prepareService(body);
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : String(e) }, 400);
          }
          const id = uid();
          await env.DB.prepare(
            `INSERT INTO services
              (id, project_id, name, url, method, expected_status_min, expected_status_max,
               interval_seconds, timeout_ms, paused, current_status, created_at,
               check_type, config, heartbeat_token)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unknown', ?, ?, ?, ?)`
          )
            .bind(
              id,
              projectId,
              prepared.name,
              prepared.url,
              prepared.method,
              prepared.expected_status_min,
              prepared.expected_status_max,
              prepared.interval_seconds,
              prepared.timeout_ms,
              Date.now(),
              prepared.check_type,
              prepared.config,
              prepared.heartbeat_token
            )
            .run();
          return json({ id, heartbeat_token: prepared.heartbeat_token }, 201);
        }
      }

      // /api/services/:id
      if (parts[0] === "api" && parts[1] === "services" && parts.length === 3) {
        const serviceId = parts[2];
        if (req.method === "DELETE") {
          await env.DB.prepare(`DELETE FROM services WHERE id = ?`).bind(serviceId).run();
          return json({ ok: true });
        }
        if (req.method === "PATCH") {
          const body = await req.json<CreateServiceBody & { paused?: boolean }>();
          if (!body.check_type && typeof body.paused === "boolean") {
            await env.DB.prepare(`UPDATE services SET paused = ? WHERE id = ?`)
              .bind(body.paused ? 1 : 0, serviceId)
              .run();
            return json({ ok: true });
          }
          return updateService(env, serviceId, body);
        }
        if (req.method === "GET") {
          const svc = await env.DB.prepare(`SELECT * FROM services WHERE id = ?`).bind(serviceId).first();
          if (!svc) return json({ error: "not found" }, 404);
          return json(svc);
        }
      }

      // /api/services/:id/checks
      if (parts[0] === "api" && parts[1] === "services" && parts[3] === "checks" && parts.length === 4) {
        const serviceId = parts[2];
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
        const { results } = await env.DB.prepare(
          `SELECT * FROM checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT ?`
        )
          .bind(serviceId, limit)
          .all();
        return json(results);
      }

      // /api/services/:id/stats — SLA windows + incident history
      if (parts[0] === "api" && parts[1] === "services" && parts[3] === "stats" && parts.length === 4) {
        return getServiceStats(env, parts[2]);
      }

      // /api/services/:id/check-now
      if (parts[0] === "api" && parts[1] === "services" && parts[3] === "check-now" && parts.length === 4) {
        const serviceId = parts[2];
        const svc = await env.DB.prepare(`SELECT * FROM services WHERE id = ?`)
          .bind(serviceId)
          .first<ServiceRow>();
        if (!svc) return json({ error: "not found" }, 404);
        await checkService(env, svc);
        const updated = await env.DB.prepare(`SELECT * FROM services WHERE id = ?`).bind(serviceId).first();
        return json(updated);
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Demo instances keep their seeded sample data frozen — no live checks or pruning.
    if (env.DEMO_MODE === "1") return;
    await ensureSchema(env);
    if (event.cron === "0 3 * * *") {
      ctx.waitUntil((async () => { await rollupDaily(env); await pruneOldData(env); })());
    } else {
      ctx.waitUntil(runDueChecks(env));
    }
  },
};
