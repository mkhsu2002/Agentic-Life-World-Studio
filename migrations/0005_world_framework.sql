-- Append-only author-reviewed content snapshots; draft changes cannot rewrite approvals.
CREATE TABLE world_snapshots (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(world_id, revision, content_hash)
);
CREATE TABLE analysis_checkpoints (
  job_id TEXT NOT NULL REFERENCES jobs(id),
  stage TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(job_id, stage, input_hash)
);
CREATE TABLE source_images (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  label TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX source_images_world ON source_images(world_id);
