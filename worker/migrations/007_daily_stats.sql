-- Per-service daily rollups so 7/30/90-day SLA stays cheap and survives pruning.
CREATE TABLE IF NOT EXISTS daily_stats (
  service_id TEXT NOT NULL,
  day INTEGER NOT NULL,   -- UTC midnight (epoch ms) of the day
  up INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (service_id, day)
);

-- Backfill from whatever check history already exists.
INSERT INTO daily_stats (service_id, day, up, total)
SELECT service_id,
       (checked_at / 86400000) * 86400000 AS day,
       SUM(CASE WHEN status IN ('up','cf_protected') THEN 1 ELSE 0 END),
       COUNT(*)
FROM checks
GROUP BY service_id, day
ON CONFLICT(service_id, day) DO UPDATE SET up = excluded.up, total = excluded.total;
