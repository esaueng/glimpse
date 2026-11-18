-- Historical OpenZCAD rows are beta. Keep their schema and readers intact.
CREATE TABLE daily_counts_stable (
  day TEXT NOT NULL,
  app TEXT NOT NULL CHECK (app = 'openzcad'),
  level TEXT NOT NULL CHECK (level IN ('basic', 'optional')),
  event TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  PRIMARY KEY (day, app, level, event, bucket)
) WITHOUT ROWID;

CREATE TABLE daily_census_stable (
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
  activityReported INTEGER CHECK (activityReported IS NULL OR activityReported = 1),
  active7d INTEGER CHECK (active7d IS NULL OR active7d >= 5),
  active30d INTEGER CHECK (active30d IS NULL OR active30d >= 5),
  idle90d INTEGER CHECK (idle90d IS NULL OR idle90d >= 5),
  PRIMARY KEY (day, app)
) WITHOUT ROWID;

CREATE TABLE daily_openzcad_adoption (
  day TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('beta', 'stable')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  accounts INTEGER NOT NULL CHECK (accounts >= 0),
  signedInAccounts INTEGER NOT NULL CHECK (signedInAccounts BETWEEN 0 AND accounts),
  signInSessions INTEGER NOT NULL CHECK (signInSessions >= signedInAccounts),
  PRIMARY KEY (day, channel)
) WITHOUT ROWID;
