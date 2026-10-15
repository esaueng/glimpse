-- Expand the fixed app allowlist while preserving every existing aggregate.
CREATE TABLE daily_counts_next (
  day TEXT NOT NULL,
  app TEXT NOT NULL CHECK (app IN ('openzcad', 'openfea', 'openlattice3d')),
  level TEXT NOT NULL CHECK (level IN ('basic', 'optional')),
  event TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  PRIMARY KEY (day, app, level, event, bucket)
) WITHOUT ROWID;
INSERT INTO daily_counts_next SELECT day,app,level,event,bucket,count FROM daily_counts;
DROP TABLE daily_counts;
ALTER TABLE daily_counts_next RENAME TO daily_counts;
