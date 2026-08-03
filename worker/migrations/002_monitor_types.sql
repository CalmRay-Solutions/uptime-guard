-- Adds multi-type monitor support to an existing services table.
-- Safe to run once on a DB created from the original schema.

ALTER TABLE services ADD COLUMN check_type TEXT NOT NULL DEFAULT 'http';
ALTER TABLE services ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE services ADD COLUMN heartbeat_token TEXT;
ALTER TABLE services ADD COLUMN last_ping_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_services_hbtoken ON services(heartbeat_token);
