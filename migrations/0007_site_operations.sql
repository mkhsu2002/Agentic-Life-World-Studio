CREATE TABLE studio_sites (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES studio_conversations(id), base_revision INTEGER NOT NULL,
 code_hash TEXT NOT NULL, code_key TEXT NOT NULL, content_key TEXT NOT NULL, stage TEXT NOT NULL,
 branch TEXT, pr_number INTEGER, commit_sha TEXT, main_sha TEXT, proposal_id TEXT REFERENCES studio_proposals(id),
 preview_ready INTEGER NOT NULL DEFAULT 0, production_ready INTEGER NOT NULL DEFAULT 0,
 owner_event_id INTEGER REFERENCES studio_events(id), cancel_epoch INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX studio_site_one_release ON studio_sites((1)) WHERE stage IN ('merging','deploying');
CREATE INDEX studio_sites_conversation ON studio_sites(conversation_id,created_at);
CREATE TABLE studio_publications (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES studio_conversations(id), site_id TEXT NOT NULL REFERENCES studio_sites(id),
 slug TEXT NOT NULL, content_key TEXT NOT NULL, content_hash TEXT NOT NULL, site_commit TEXT NOT NULL,
 locales_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX studio_publication_slug ON studio_publications(slug) WHERE status='active';
CREATE TABLE studio_operation_runs (
 id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES studio_conversations(id),policy_hash TEXT NOT NULL,
 status TEXT NOT NULL,scheduled_for TEXT NOT NULL,completed_at TEXT,created_at TEXT NOT NULL,
 UNIQUE(conversation_id,policy_hash,scheduled_for)
);
CREATE UNIQUE INDEX studio_operation_one_running ON studio_operation_runs(conversation_id) WHERE status='running';
CREATE TABLE studio_deploy_deliveries (id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE studio_automation_wakeups (id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES studio_conversations(id),policy_hash TEXT NOT NULL,due_at TEXT NOT NULL,dispatched_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX studio_automation_due ON studio_automation_wakeups(due_at);
CREATE TABLE studio_journey_records(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES studio_conversations(id),run_id TEXT NOT NULL UNIQUE,publication_id TEXT NOT NULL REFERENCES studio_publications(id),document_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TRIGGER studio_journey_records_immutable_update BEFORE UPDATE ON studio_journey_records BEGIN SELECT RAISE(ABORT,'immutable journey'); END;
