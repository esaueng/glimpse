-- Aggregate account snapshots only. No account/project identifiers leave the app.
CREATE TABLE daily_census (
  day TEXT NOT NULL,
  app TEXT NOT NULL CHECK (app = 'openzcad'),
  generation INTEGER NOT NULL CHECK (generation > 0),
  accounts INTEGER NOT NULL CHECK (accounts >= 0),
  projects INTEGER NOT NULL CHECK (projects >= 0),
  revisions INTEGER NOT NULL CHECK (revisions >= 0),
  storedBytes INTEGER NOT NULL CHECK (storedBytes >= 0),
  logicalBytes INTEGER NOT NULL CHECK (logicalBytes >= 0),
  unknownArtifacts INTEGER NOT NULL CHECK (unknownArtifacts >= 0),
  lt1mib INTEGER NOT NULL CHECK (lt1mib >= 0),
  mib1to10 INTEGER NOT NULL CHECK (mib1to10 >= 0),
  mib10to100 INTEGER NOT NULL CHECK (mib10to100 >= 0),
  gte100mib INTEGER NOT NULL CHECK (gte100mib >= 0),
  PRIMARY KEY(day, app)
) WITHOUT ROWID;
