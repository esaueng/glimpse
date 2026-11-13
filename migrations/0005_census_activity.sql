-- Optional account-activity counts in the OpenZCAD census. Privacy review approved
-- 13 November 2026 (docs/PRIVACY.md). Aggregate counts over consenting accounts only.
-- activityReported is 1 when the snapshot carried activity counts; NULL means not collected.
-- A NULL count on such a row means withheld by the k-threshold (fewer than 5). The CHECKs
-- keep any count below 5 out of storage even if the Worker's threshold were bypassed.
ALTER TABLE daily_census ADD COLUMN activityReported INTEGER CHECK (activityReported IS NULL OR activityReported = 1);
ALTER TABLE daily_census ADD COLUMN active7d INTEGER CHECK (active7d IS NULL OR active7d >= 5);
ALTER TABLE daily_census ADD COLUMN active30d INTEGER CHECK (active30d IS NULL OR active30d >= 5);
ALTER TABLE daily_census ADD COLUMN idle90d INTEGER CHECK (idle90d IS NULL OR idle90d >= 5);
