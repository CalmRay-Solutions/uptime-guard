export interface Project {
  id: string;
  name: string;
  created_at: number;
  public?: number;
  public_slug?: string | null;
}

export interface PublicStatusData {
  project: string;
  updated_at: number;
  summary: { total: number; down: number; warn: number; operational: boolean };
  services: { name: string; type: CheckType; status: string; uptime_90d: number | null }[];
}

export interface RecentCheck {
  status: "up" | "down" | "cf_protected";
  response_time_ms: number | null;
  checked_at: number;
}

export type CheckType = "http" | "tcp" | "dns" | "heartbeat" | "tls" | "domain";

export interface AppSettings {
  retention_days: number;
  telegram: { has_token: boolean; token_hint: string; chat_id: string; thread_id: string };
  totp: { configured: boolean };
}

export interface Incident {
  id: number;
  started_at: number;
  resolved_at: number | null;
}
export interface ServiceStats {
  uptime: { h24: number | null; d7: number | null; d30: number | null; d90: number | null };
  mttr_ms: number | null;
  incidents_90d: number;
  incidents: Incident[];
}

export interface Service {
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
  current_status: "up" | "down" | "unknown" | "cf_protected";
  last_checked_at: number | null;
  created_at: number;
  check_type: CheckType;
  config: string; // JSON string
  heartbeat_token: string | null;
  last_ping_at: number | null;
  expires_at: number | null;
  // Enriched by GET /projects/:id/services (absent on check-now response).
  recent?: RecentCheck[];
  uptime_24h?: number | null;
  avg_response_ms?: number | null;
  checks_24h?: number;
}

export interface CreateServiceInput {
  name: string;
  check_type: CheckType;
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

export interface Check {
  id: number;
  service_id: string;
  status: "up" | "down";
  status_code: number | null;
  response_time_ms: number | null;
  error: string | null;
  checked_at: number;
}

const BASE_URL_KEY = "ug_base_url";
const TOKEN_KEY = "ug_token";

export function getConfig() {
  return {
    baseUrl: localStorage.getItem(BASE_URL_KEY) ?? "",
    token: localStorage.getItem(TOKEN_KEY) ?? "",
  };
}

export function setBaseUrl(baseUrl: string) {
  localStorage.setItem(BASE_URL_KEY, baseUrl.replace(/\/$/, ""));
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasConfig() {
  return Boolean(getConfig().token);
}

export class AuthError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = getConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    throw new AuthError("session expired, please log in again");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Public entry-screen flags (demo mode, first-run setup). Never throws. */
export async function getMeta(baseUrl: string): Promise<{ demo: boolean; setup_required: boolean }> {
  try {
    const res = await fetch(`${baseUrl}/api/meta`);
    if (!res.ok) return { demo: false, setup_required: false };
    return (await res.json()) as { demo: boolean; setup_required: boolean };
  } catch {
    return { demo: false, setup_required: false };
  }
}

/** Candidate authenticator secret for the first-run wizard (no auth yet). */
export async function setupTotpNew(baseUrl: string): Promise<{ secret: string; otpauth: string }> {
  const res = await fetch(`${baseUrl}/api/setup/totp-new`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not start authenticator setup");
  }
  return (await res.json()) as { secret: string; otpauth: string };
}

/**
 * First-run account creation. Password and authenticator are both required.
 * Stores the returned session token on success.
 */
export async function setupAccount(
  baseUrl: string,
  password: string,
  totpSecret: string,
  totpCode: string
): Promise<void> {
  setBaseUrl(baseUrl);
  const res = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, totp_secret: totpSecret, totp_code: totpCode }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "setup failed");
  }
  const { token } = (await res.json()) as { token: string };
  setToken(token);
}

/** Public status page - no auth, same-origin relative fetch. */
export async function getPublicStatus(slug: string): Promise<PublicStatusData> {
  const res = await fetch(`/api/public/status/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(res.status === 404 ? "not found" : `Request failed: ${res.status}`);
  return res.json() as Promise<PublicStatusData>;
}

export async function login(baseUrl: string, password: string, code: string): Promise<void> {
  setBaseUrl(baseUrl);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "login failed");
  }
  const { token } = (await res.json()) as { token: string };
  setToken(token);
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (name: string) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  renameProject: (id: string, name: string) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  setProjectPublic: (id: string, isPublic: boolean) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ public: isPublic }) }),

  listServices: (projectId: string) => request<Service[]>(`/api/projects/${projectId}/services`),
  createService: (projectId: string, data: CreateServiceInput) =>
    request<{ id: string; heartbeat_token: string | null }>(`/api/projects/${projectId}/services`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteService: (id: string) => request<{ ok: boolean }>(`/api/services/${id}`, { method: "DELETE" }),
  pauseService: (id: string, paused: boolean) =>
    request<{ ok: boolean }>(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify({ paused }) }),
  updateService: (id: string, data: CreateServiceInput) =>
    request<{ ok: boolean; heartbeat_token: string | null }>(`/api/services/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  checkNow: (id: string) => request<Service>(`/api/services/${id}/check-now`, { method: "POST" }),
  getChecks: (id: string, limit = 50) => request<Check[]>(`/api/services/${id}/checks?limit=${limit}`),
  getServiceStats: (id: string) => request<ServiceStats>(`/api/services/${id}/stats`),

  revokeSessions: () => request<{ token: string }>("/api/auth/revoke", { method: "POST" }),

  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (data: Partial<{ retention_days: number; telegram_bot_token: string; telegram_chat_id: string; telegram_thread_id: string }>) =>
    request<AppSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(data) }),
  telegramTest: () => request<{ ok: boolean }>("/api/settings/telegram-test", { method: "POST" }),
  totpNew: () => request<{ secret: string; otpauth: string }>("/api/settings/totp-new"),
  totpConfirm: (secret: string, code: string) =>
    request<{ ok: boolean }>("/api/settings/totp", { method: "POST", body: JSON.stringify({ secret, code }) }),

  pushKey: () => request<{ key: string | null }>("/api/push/key"),
  pushSubscribe: (sub: { endpoint: string; p256dh: string; auth: string }) =>
    request<{ ok: boolean }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
};
