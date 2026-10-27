DROP INDEX IF EXISTS jobs_logical_key;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_logical_key ON jobs(logical_key) WHERE status IN ('queued','running');
