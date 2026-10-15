CREATE TABLE daily_counts (
  day TEXT NOT NULL,
  app TEXT NOT NULL CHECK (app IN ('openzcad', 'openfea')),
  level TEXT NOT NULL CHECK (level IN ('basic', 'optional')),
  event TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  PRIMARY KEY (day, app, level, event, bucket)
) WITHOUT ROWID;
