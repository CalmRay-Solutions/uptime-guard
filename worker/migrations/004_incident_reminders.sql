-- Escalating re-alerts: track reminder cadence per open incident.
ALTER TABLE incidents ADD COLUMN last_reminder_at INTEGER;
ALTER TABLE incidents ADD COLUMN reminder_level INTEGER NOT NULL DEFAULT 0;
