import { connect } from "cloudflare:sockets";
import { getCertExpiry } from "./tls";

export type CheckType = "http" | "tcp" | "dns" | "heartbeat" | "tls" | "domain";

export interface ServiceRow {
  id: string;
  project_id: string;
  name: string;
  url: string;
  method: string;
  expected_status_min: number;
  expected_status_max: number;
  interval_seconds: number;
  timeout_ms: number;
  paused: number;
  current_status: string;
  last_checked_at: number | null;
  created_at: number;
  check_type: CheckType;
  config: string; // JSON
  heartbeat_token: string | null;
  last_ping_at: number | null;
  expires_at: number | null;
}

export interface CheckResult {
  status: "up" | "down" | "cf_protected";
  statusCode: number | null;
  responseTime: number | null;
  error: string | null;
  // Set by tls / domain checks: parsed expiry (epoch ms) to persist on the service.
  expiresAt?: number | null;
}

interface HttpConfig {
  keyword?: string;
  keyword_mode?: "present" | "absent";
  json_path?: string;
  json_equals?: string;
}
interface TcpConfig {
  host?: string;
  port?: number;
}
interface DnsConfig {
  domain?: string;
  record_type?: string;
  expected?: string;
}
interface HeartbeatConfig {
  grace_seconds?: number;
}
interface TlsConfig {
  host?: string;
  port?: number;
  warn_days?: number;
}
interface DomainConfig {
  domain?: string;
  warn_days?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shared expiry-to-status logic for tls/domain: down if expired or within the warning window. */
function expiryResult(
  expiresAt: number | null,
  warnDays: number,
  responseTime: number | null,
  noun: string
): CheckResult {
  if (expiresAt == null || !Number.isFinite(expiresAt)) {
    return { status: "down", statusCode: null, responseTime, error: `could not determine ${noun}`, expiresAt: null };
  }
  const daysLeft = Math.floor((expiresAt - Date.now()) / DAY_MS);
  if (daysLeft < 0) {
    return { status: "down", statusCode: null, responseTime, error: `${noun} expired ${-daysLeft}d ago`, expiresAt };
  }
  if (daysLeft <= warnDays) {
    return { status: "down", statusCode: null, responseTime, error: `${noun} expires in ${daysLeft}d`, expiresAt };
  }
  return { status: "up", statusCode: null, responseTime, error: null, expiresAt };
}

function parseConfig<T>(svc: ServiceRow): T {
  try {
    return JSON.parse(svc.config || "{}") as T;
  } catch {
    return {} as T;
  }
}

/** Reads a dotted path (e.g. "data.status") out of a parsed JSON value. */
function readJsonPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc != null && typeof acc === "object" ? (acc as any)[key] : undefined), obj);
}

async function checkHttp(svc: ServiceRow): Promise<CheckResult> {
  const cfg = parseConfig<HttpConfig>(svc);
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), svc.timeout_ms);
    const res = await fetch(svc.url, {
      method: svc.method,
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "uptime-guard/1.0" },
    });
    const needBody = Boolean(cfg.keyword || cfg.json_path);
    const body = needBody ? await res.text() : "";
    clearTimeout(timer);
    const responseTime = Date.now() - startedAt;

    const statusOk = res.status >= svc.expected_status_min && res.status <= svc.expected_status_max;
    if (!statusOk) {
      return { status: "down", statusCode: res.status, responseTime, error: `unexpected status ${res.status}` };
    }

    if (cfg.keyword) {
      const present = body.includes(cfg.keyword);
      const wantPresent = (cfg.keyword_mode ?? "present") === "present";
      if (present !== wantPresent) {
        return {
          status: "down",
          statusCode: res.status,
          responseTime,
          error: wantPresent ? `keyword "${cfg.keyword}" not found` : `keyword "${cfg.keyword}" present`,
        };
      }
    }

    if (cfg.json_path) {
      let value: unknown;
      try {
        value = readJsonPath(JSON.parse(body), cfg.json_path);
      } catch {
        return { status: "down", statusCode: res.status, responseTime, error: "invalid JSON response" };
      }
      if (cfg.json_equals != null && String(value) !== cfg.json_equals) {
        return {
          status: "down",
          statusCode: res.status,
          responseTime,
          error: `${cfg.json_path}=${String(value)} != ${cfg.json_equals}`,
        };
      }
      if (cfg.json_equals == null && value === undefined) {
        return { status: "down", statusCode: res.status, responseTime, error: `${cfg.json_path} missing` };
      }
    }

    return { status: "up", statusCode: res.status, responseTime, error: null };
  } catch (e) {
    return {
      status: "down",
      statusCode: null,
      responseTime: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkTcp(svc: ServiceRow): Promise<CheckResult> {
  const cfg = parseConfig<TcpConfig>(svc);
  if (!cfg.host || !cfg.port) {
    return { status: "down", statusCode: null, responseTime: null, error: "host/port not configured" };
  }
  const startedAt = Date.now();
  let socket: ReturnType<typeof connect> | null = null;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("connection timed out")), svc.timeout_ms)
    );
    socket = connect({ hostname: cfg.host, port: cfg.port });
    await Promise.race([socket.opened, timeout]);
    const responseTime = Date.now() - startedAt;
    await socket.close().catch(() => {});
    return { status: "up", statusCode: null, responseTime, error: null };
  } catch (e) {
    if (socket) await socket.close().catch(() => {});
    return {
      status: "down",
      statusCode: null,
      responseTime: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkDns(svc: ServiceRow): Promise<CheckResult> {
  const cfg = parseConfig<DnsConfig>(svc);
  if (!cfg.domain) {
    return { status: "down", statusCode: null, responseTime: null, error: "domain not configured" };
  }
  const recordType = (cfg.record_type || "A").toUpperCase();
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), svc.timeout_ms);
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cfg.domain)}&type=${recordType}`,
      { headers: { accept: "application/dns-json" }, signal: controller.signal }
    );
    clearTimeout(timer);
    const responseTime = Date.now() - startedAt;
    const data = (await res.json()) as { Answer?: { data: string; type: number }[]; Status?: number };
    const answers = data.Answer ?? [];

    if (answers.length === 0) {
      return { status: "down", statusCode: null, responseTime, error: `no ${recordType} record for ${cfg.domain}` };
    }
    if (cfg.expected) {
      const match = answers.some((a) => a.data.replace(/\.$/, "") === cfg.expected!.replace(/\.$/, ""));
      if (!match) {
        return {
          status: "down",
          statusCode: null,
          responseTime,
          error: `expected ${cfg.expected}, got ${answers.map((a) => a.data).join(", ")}`,
        };
      }
    }
    return { status: "up", statusCode: null, responseTime, error: null };
  } catch (e) {
    return {
      status: "down",
      statusCode: null,
      responseTime: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * A Worker can't open a raw TCP socket to a Cloudflare-fronted host (the edge
 * refuses edge→edge sockets), so getCertExpiry gets reset. This confirms, over
 * plain HTTP, whether the host sits behind Cloudflare — if so we surface a
 * non-alerting "CF Protected" state instead of a false "down".
 */
async function isCloudflareFronted(host: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://${host}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "uptime-guard/1.0" },
    });
    clearTimeout(timer);
    return res.headers.has("cf-ray") || (res.headers.get("server") ?? "").toLowerCase().includes("cloudflare");
  } catch {
    return false;
  }
}

async function checkTls(svc: ServiceRow): Promise<CheckResult> {
  const cfg = parseConfig<TlsConfig>(svc);
  if (!cfg.host) {
    return { status: "down", statusCode: null, responseTime: null, error: "host not configured", expiresAt: null };
  }
  const port = cfg.port ?? 443;
  const warnDays = cfg.warn_days ?? 14;
  try {
    const { notAfter, responseTime } = await getCertExpiry(cfg.host, port, svc.timeout_ms);
    return expiryResult(notAfter, warnDays, responseTime, "certificate");
  } catch (e) {
    // The socket failed. If the host is behind Cloudflare, that's expected — mark it
    // CF Protected (Cloudflare auto-manages the edge cert) and keep checking, so if the
    // proxy is ever turned off and the origin becomes reachable we read the real cert.
    if (await isCloudflareFronted(cfg.host, svc.timeout_ms)) {
      return {
        status: "cf_protected",
        statusCode: null,
        responseTime: null,
        error: "Behind Cloudflare · edge certificate auto-managed",
        expiresAt: null,
      };
    }
    return {
      status: "down",
      statusCode: null,
      responseTime: null,
      error: e instanceof Error ? e.message : String(e),
      expiresAt: null,
    };
  }
}

async function checkDomain(svc: ServiceRow): Promise<CheckResult> {
  const cfg = parseConfig<DomainConfig>(svc);
  if (!cfg.domain) {
    return { status: "down", statusCode: null, responseTime: null, error: "domain not configured", expiresAt: null };
  }
  const warnDays = cfg.warn_days ?? 30;
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), svc.timeout_ms);
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(cfg.domain)}`, {
      headers: { accept: "application/rdap+json", "User-Agent": "uptime-guard/1.0" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const responseTime = Date.now() - startedAt;
    if (!res.ok) {
      return { status: "down", statusCode: res.status, responseTime, error: `RDAP lookup failed (${res.status})`, expiresAt: null };
    }
    const data = (await res.json()) as { events?: { eventAction: string; eventDate: string }[] };
    const event = data.events?.find(
      (e) => e.eventAction === "expiration" || e.eventAction === "registrar expiration"
    );
    if (!event) {
      return { status: "down", statusCode: null, responseTime, error: "no expiration in RDAP record", expiresAt: null };
    }
    const expiresAt = Date.parse(event.eventDate);
    return expiryResult(Number.isNaN(expiresAt) ? null : expiresAt, warnDays, responseTime, "registration");
  } catch (e) {
    return {
      status: "down",
      statusCode: null,
      responseTime: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
      expiresAt: null,
    };
  }
}

/**
 * Heartbeat is passive: status is derived from how long ago the last ping arrived.
 * grace_seconds defaults to 2x the expected interval.
 */
export function evaluateHeartbeat(svc: ServiceRow, now = Date.now()): CheckResult {
  const cfg = parseConfig<HeartbeatConfig>(svc);
  const grace = (cfg.grace_seconds ?? svc.interval_seconds * 2) * 1000;
  if (!svc.last_ping_at) {
    return { status: "down", statusCode: null, responseTime: null, error: "no ping received yet" };
  }
  const age = now - svc.last_ping_at;
  if (age > grace) {
    return {
      status: "down",
      statusCode: null,
      responseTime: null,
      error: `last ping ${Math.round(age / 1000)}s ago (grace ${grace / 1000}s)`,
    };
  }
  return { status: "up", statusCode: null, responseTime: null, error: null };
}

/** Active check dispatch for http/tcp/dns. Heartbeat is handled via evaluateHeartbeat. */
export async function performCheck(svc: ServiceRow): Promise<CheckResult> {
  switch (svc.check_type) {
    case "tcp":
      return checkTcp(svc);
    case "dns":
      return checkDns(svc);
    case "tls":
      return checkTls(svc);
    case "domain":
      return checkDomain(svc);
    case "heartbeat":
      return evaluateHeartbeat(svc);
    case "http":
    default:
      return checkHttp(svc);
  }
}

// Flap prevention: on a failed active check, re-check a few times within the same
// run (seconds apart) before trusting "down". A real outage still confirms in
// seconds; a momentary blip that passes on retry never alerts. Independent of the
// (possibly 5-minute) check interval, which only controls how often we look.
export const CONFIRM_RETRIES = 2;
export const CONFIRM_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a check and, if it fails, confirms with quick retries before returning
 * "down". Any passing retry wins (the failure was a blip). Heartbeats are passive
 * (their grace window already confirms) so they skip retries.
 */
export async function performCheckConfirmed(
  svc: ServiceRow,
  retries = CONFIRM_RETRIES,
  delayMs = CONFIRM_DELAY_MS
): Promise<CheckResult> {
  let result = await performCheck(svc);
  if (svc.check_type === "heartbeat" || result.status !== "down") return result;
  for (let attempt = 0; attempt < retries; attempt++) {
    await sleep(delayMs);
    const retry = await performCheck(svc);
    if (retry.status !== "down") return retry; // recovered on retry -> treat as a blip
    result = retry;
  }
  return result;
}
