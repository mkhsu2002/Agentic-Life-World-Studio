CREATE TABLE IF NOT EXISTS import_reviews (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  segment_id TEXT REFERENCES segments(id),
  kind TEXT NOT NULL CHECK(kind IN ('evidence','processing','brief')),
  status TEXT NOT NULL CHECK(status IN ('open','resolved')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  resolution_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS import_review_open_job ON import_reviews(job_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS import_review_world ON import_reviews(world_id,status);
DROP INDEX IF EXISTS jobs_active_logical_key;
DROP INDEX IF EXISTS jobs_active_key;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_key ON jobs(logical_key) WHERE status IN ('queued','running','waiting_user');

-- Preserve prior imports and coverage, opening a recoverable dialogue instead of a failed dead end.
INSERT OR IGNORE INTO import_reviews(id,world_id,job_id,segment_id,kind,status,code,message,details_json,created_at)
SELECT 'review_legacy_'||j.id,j.world_id,j.id,
  (SELECT s.id FROM segments s JOIN worlds w ON s.source_id=w.source_id WHERE w.id=j.world_id AND s.status!='done' ORDER BY s.ordinal LIMIT 1),
  'processing','open',COALESCE(j.error,'IMPORT_RETRY'),
  '這段內容需要重新核對。已保存先前的閱讀進度，你可以補充說明後繼續；若仍有引句疑義，會列出原文與待確認內容。',
  '{"legacy":true}',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM jobs j JOIN worlds w ON w.id=j.world_id
WHERE j.kind='import' AND j.status='failed' AND json_extract(w.document_json,'$.status')='reading';
INSERT OR IGNORE INTO messages(id,world_id,role,content,created_at)
SELECT 'message_'||id,world_id,'assistant',message,created_at FROM import_reviews WHERE id LIKE 'review_legacy_%';
INSERT OR IGNORE INTO audit(id,world_id,type,message,data_json,created_at)
SELECT 'audit_'||id,world_id,'import.needs_input',message,'{}',created_at FROM import_reviews WHERE id LIKE 'review_legacy_%';
UPDATE jobs SET status='waiting_user',error=NULL,lease_until=NULL,stage='awaiting_confirmation'
WHERE kind='import' AND status='failed' AND id IN (SELECT job_id FROM import_reviews WHERE status='open');
