import { collect } from "./cloudflare/collect";
import { RETENTION_SOURCE } from "./cloudflare/model";
import { coverage } from "./cloudflare/store";
import type { MonitorEnv } from "./cloudflare/env";
import { missingMigrations } from "./migrations";
import { logFailure } from "./errors";
import { retainIssues } from "./sources/store";
// Must match wrangler.jsonc triggers.crons; test/schedule.test.ts enforces this.
export const RETENTION_CRON = "31 3 * * *";
export const COLLECT_CRON = "17 * * * *";
export const CRONS = [RETENTION_CRON, COLLECT_CRON] as const;
// Removes expired app analytics, then records a data-free heartbeat (status and time only)
// so the Collection coverage table can show that retention actually ran.
export async function retain(env: Pick<MonitorEnv, "DB">, now = new Date()) {
  const record = async (status: "ok" | "unavailable", message: string) => {
    try {
      await coverage(env.DB, RETENTION_SOURCE, status, message, now.toISOString());
    } catch (error) {
      logFailure("Retention heartbeat not recorded", error);
    }
  };
  try {
    const tables = ["daily_counts", "daily_census"];
    if (!(await missingMigrations(env.DB, "openzcad_channels")).length)
      tables.push("daily_counts_stable", "daily_census_stable", "daily_openzcad_adoption");
    await env.DB.batch(
      tables.map((table) =>
        env.DB.prepare(
          `DELETE FROM ${table} WHERE day < date('now','-89 days')`,
        ),
      ),
    );
  } catch (error) {
    await record("unavailable", "Retention failed; expired rows remain hidden.");
    throw error;
  }
  try {
    await retainIssues(env.DB);
  } catch (error) {
    // Migration 0006 may not be applied yet; analytics retention above still ran.
    if (!/no such table/i.test(String(error))) logFailure("Issue retention failed", error);
  }
  await record("ok", "Expired analytics removed (90-day window).");
}
export async function runScheduled(
  cron: string | undefined,
  env: MonitorEnv,
  now = new Date(),
) {
  // Anything other than the hourly collector runs retention, which only deletes expired rows.
  if (cron === COLLECT_CRON) return collect(env, now);
  return retain(env, now);
}
