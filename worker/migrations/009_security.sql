-- Login rate limiting: record attempts per client IP.
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, at);
-- Session epoch (bumping it revokes every issued token) lives in the settings table.
