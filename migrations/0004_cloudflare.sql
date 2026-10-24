-- Private infrastructure metadata; independent of the 90-day application analytics.
CREATE TABLE cf_apps (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'unknown' CHECK(visibility IN ('public','private','unknown')),
  budget INTEGER CHECK(budget IS NULL OR budget > 0)
);
INSERT INTO cf_apps(id,name) VALUES('unassigned','Unassigned'),('shared','Shared infrastructure');
CREATE TABLE cf_resources (
  id TEXT PRIMARY KEY, native_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  app TEXT NOT NULL DEFAULT 'unassigned' REFERENCES cf_apps(id),
  manual INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, seen_at TEXT NOT NULL
);
CREATE INDEX cf_resources_app ON cf_resources(app);
CREATE TABLE cf_usage (
  day TEXT NOT NULL, resource TEXT NOT NULL, metric TEXT NOT NULL,
  value REAL NOT NULL CHECK(value >= 0), unit TEXT NOT NULL,
  aggregation TEXT NOT NULL CHECK(aggregation IN ('sum','max','quantile')),
  PRIMARY KEY(day,resource,metric)
) WITHOUT ROWID;
CREATE TABLE cf_charges (
  id TEXT PRIMARY KEY, subscription TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  start TEXT NOT NULL, end TEXT NOT NULL, family TEXT NOT NULL, description TEXT NOT NULL,
  unit TEXT NOT NULL, quantity REAL NOT NULL, cost INTEGER NOT NULL, currency TEXT NOT NULL
);
CREATE INDEX cf_charges_period ON cf_charges(period_start,start);
CREATE TABLE cf_subscriptions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER, currency TEXT NOT NULL,
  frequency TEXT NOT NULL, renews TEXT
);
CREATE TABLE cf_coverage (
  source TEXT PRIMARY KEY, status TEXT NOT NULL, message TEXT NOT NULL,
  checked_at TEXT NOT NULL, last_success TEXT
);
CREATE TABLE cf_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE cf_leases (key TEXT PRIMARY KEY, expires INTEGER NOT NULL, owner TEXT NOT NULL);
CREATE TABLE cf_alerts (id TEXT PRIMARY KEY, delivered_at TEXT NOT NULL);
