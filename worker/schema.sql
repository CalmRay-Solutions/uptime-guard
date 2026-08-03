-- uptime-guard D1 schema

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  public INTEGER NOT NULL DEFAULT 0,
  public_slug TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(public_slug);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  expected_status_min INTEGER NOT NULL DEFAULT 200,
  expected_status_max INTEGER NOT NULL DEFAULT 299,
  interval_seconds INTEGER NOT NULL DEFAULT 60,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  paused INTEGER NOT NULL DEFAULT 0,
  current_status TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  -- Monitor type: 'http' | 'tcp' | 'dns' | 'heartbeat'
  check_type TEXT NOT NULL DEFAULT 'http',
  -- Type-specific settings as JSON (keyword/json assert, host/port, domain/record, grace).
  config TEXT NOT NULL DEFAULT '{}',
  -- Heartbeat (dead-man's switch) push token + last received ping.
  heartbeat_token TEXT,
  last_ping_at INTEGER,
  -- For tls / domain monitors: the parsed certificate or registration expiry (epoch ms).
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_services_hbtoken ON services(heartbeat_token);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  error TEXT,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checks_service ON checks(service_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  resolved_at INTEGER,
  notified INTEGER NOT NULL DEFAULT 0,
  -- Escalating re-alerts while still down: last reminder time + how many sent.
  last_reminder_at INTEGER,
  reminder_level INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incidents_service ON incidents(service_id);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_stats (
  service_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  up INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (service_id, day)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, at);
