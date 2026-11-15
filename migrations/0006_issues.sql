-- Issue sources and the issue inbox. Independent of the aggregate analytics tables.
-- Sources authenticate webhooks with a secret stored only as a SHA-256 hash.
CREATE TABLE sources (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, last_received TEXT, last_status TEXT,
  received INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, shape TEXT
);
-- One row per grouped problem. Text is scrubbed before storage (src/sources/scrub.ts).
CREATE TABLE issues (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, fingerprint TEXT NOT NULL,
  app TEXT, service TEXT,
  category TEXT NOT NULL CHECK(category IN ('error','security','deploy','availability','other')),
  severity TEXT NOT NULL CHECK(severity IN ('critical','warning','info')),
  title TEXT NOT NULL, detail TEXT, url TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved','ignored')),
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 0, deliveries INTEGER NOT NULL DEFAULT 1,
  note TEXT, updated_at TEXT NOT NULL,
  UNIQUE(source, fingerprint)
);
CREATE INDEX issues_status ON issues(status, last_seen);
CREATE INDEX issues_app ON issues(app, last_seen);
-- Activity per issue: deliveries and status changes. No people, IPs or payloads.
CREATE TABLE issue_events (
  issue TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT
);
CREATE INDEX issue_events_issue ON issue_events(issue, at);
