ALTER TABLE jobs ADD COLUMN logical_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_logical_key ON jobs(logical_key);
