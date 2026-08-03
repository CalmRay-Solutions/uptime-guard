-- Adds expiry tracking for tls / domain monitors.
ALTER TABLE services ADD COLUMN expires_at INTEGER;
