import { WorkerEntrypoint } from "cloudflare:workers";
import {
  ACTIVITY_FIELDS,
  census,
  CENSUS_FIELDS,
  publicCensus,
  thresholdActivity,
  type Census,
} from "./expanded";
import { access } from "./auth";
import { dateRange, metric, type App } from "./contract";
import { cloudflareApi } from "./cloudflare/api";
import { logFailure } from "./errors";
import { migrationPending, missingMigrations } from "./migrations";
import { runScheduled } from "./schedule";
export async function record(
  env: Pick<Env, "DB">,
  app: App,
  value: unknown,
  now = new Date(),
): Promise<void> {
  const m = metric(value, app);
  if (!m) throw new Error("Invalid metric");
  // Receipt-day only. No client timestamps, raw event table, or identifying dimensions.
  await env.DB.prepare(
    `INSERT INTO daily_counts(day,app,level,event,bucket,count) VALUES(?,?,?,?,?,1)
    ON CONFLICT(day,app,level,event,bucket) DO UPDATE SET count=count+1`,
  )
    .bind(now.toISOString().slice(0, 10), app, m.level, m.event, m.bucket)
    .run();
}
export async function snapshot(
  env: Pick<Env, "DB">,
  app: App,
  value: unknown,
  now = new Date(),
): Promise<{ accepted: boolean }> {
  const c = census(value, app);
  if (!c) throw new Error("Invalid census");
  const day = now.toISOString().slice(0, 10);
  const reported = ACTIVITY_FIELDS.some((k) => Object.hasOwn(c, k));
  try {
    // The k-threshold applies before storage: a withheld count is stored as NULL.
    return await writeSnapshot(env.DB, app, day, thresholdActivity(c), reported);
  } catch (error) {
    // Migration 0005 is optional (src/migrations.ts). Until it is applied, keep accepting
    // the established census and drop only the activity counts it has no columns for.
    if (!/no column named|no such column/i.test(String(error))) throw error;
    if (reported)
      console.warn(
        "Census activity counts dropped: migration 0005_census_activity.sql pending",
      );
    return writeSnapshot(env.DB, app, day, c, null);
  }
}
/** `reported` true/false writes the 0005 columns; null writes only the 0003 columns. */
async function writeSnapshot(
  db: D1Database,
  app: App,
  day: string,
  c: Census,
  reported: boolean | null,
): Promise<{ accepted: boolean }> {
  const fields: string[] = ["generation", ...CENSUS_FIELDS];
  const values: (number | null)[] = [c.generation, ...CENSUS_FIELDS.map((k) => c[k])];
  if (reported !== null) {
    // A same-day replacement without activity counts clears earlier ones (NULL = not collected).
    fields.push("activityReported", ...ACTIVITY_FIELDS);
    values.push(
      reported ? 1 : null,
      ...ACTIVITY_FIELDS.map((k) => (reported ? (c[k] ?? null) : null)),
    );
  }
  const result = await db
    .prepare(
      `INSERT INTO daily_census(day,app,${fields.join(",")}) SELECT ?,?,${fields.map(() => "?").join(",")} WHERE ? > COALESCE((SELECT MAX(generation) FROM daily_census WHERE app=?),0)
    ON CONFLICT(day,app) DO UPDATE SET ${fields.map((k) => `${k}=excluded.${k}`).join(",")}
    WHERE excluded.generation > daily_census.generation
    AND excluded.generation > COALESCE((SELECT MAX(generation) FROM daily_census WHERE app=excluded.app AND day<>excluded.day),0)`,
    )
    .bind(day, app, ...values, c.generation, app)
    .run();
  // A snapshot older than (or equal to) the newest stored generation is not written.
  return { accepted: result.meta.changes > 0 };
}
// Binding entrypoints fix app identity. There is intentionally no HTTP ingest API.
export class OpenZCADIngest extends WorkerEntrypoint<Env> {
  // Resolves { accepted: false } when a newer generation is already stored.
  async snapshot(value: unknown) {
    return snapshot(this.env, "openzcad", value);
  }
  async record(value: unknown) {
    await record(this.env, "openzcad", value);
  }
}
export class OpenFEAIngest extends WorkerEntrypoint<Env> {
  async record(value: unknown) {
    await record(this.env, "openfea", value);
  }
}
export class OpenLattice3DIngest extends WorkerEntrypoint<Env> {
  async record(value: unknown) {
    await record(this.env, "openlattice3d", value);
  }
}
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
function protect(response: Response) {
  const result = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) result.headers.set(k, v);
  return result;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && ["GET", "HEAD"].includes(request.method))
      return protect(new Response(request.method === "HEAD" ? null : "ok"));
    const result = await access(request, env);
    if (result === "unavailable")
      return protect(
        new Response("Authentication temporarily unavailable", {
          status: 503,
          headers: { "Retry-After": "60" },
        }),
      );
    if (result !== "allowed")
      return protect(new Response("Authentication required", { status: 401 }));
    if (
      url.pathname === "/api/cloudflare" ||
      url.pathname.startsWith("/api/cloudflare/")
    ) {
      try {
        const missing = await missingMigrations(env.DB, "cloudflare");
        if (missing.length) return protect(migrationPending(missing));
        return protect(await cloudflareApi(request, env));
      } catch (error) {
        logFailure("Cloudflare monitor request failed", error);
        return protect(
          Response.json(
            {
              error:
                "Cloudflare monitor unavailable. Check its migration and connection.",
            },
            { status: 503 },
          ),
        );
      }
    }
    if (!["GET", "HEAD"].includes(request.method))
      return protect(
        new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        }),
      );
    try {
      if (url.pathname === "/api/stats") {
        const range = dateRange(url.searchParams);
        if (!range)
          return protect(
            Response.json(
              {
                error:
                  "Choose a valid UTC date range of at most 90 days, app, and collection level.",
              },
              { status: 400 },
            ),
          );
        const missing = await missingMigrations(env.DB, "stats");
        if (missing.length) return protect(migrationPending(missing));
        const rows = await env.DB.prepare(
          `SELECT day,app,level,event,bucket,count FROM daily_counts
          WHERE day>=? AND day<=? AND day>=date('now','-89 days') AND level=? AND (?='all' OR app=?)
          ORDER BY day,app,event,bucket`,
        )
          .bind(range.from, range.to, range.level, range.app, range.app)
          .all();
        // SELECT * follows the schema: without migration 0005 the activity columns are
        // simply absent, and publicCensus also drops them for snapshots that never sent them.
        const snapshots =
          range.level === "optional"
            ? await env.DB.prepare(
                `SELECT * FROM daily_census WHERE day>=? AND day<=? AND day>=date('now','-89 days') AND (?='all' OR app=?) ORDER BY day DESC LIMIT 90`,
              )
                .bind(range.from, range.to, range.app, range.app)
                .all<Record<string, unknown>>()
            : { results: [] };
        // Optional schema: reported, never blocking (src/migrations.ts).
        const pendingMigrations =
          range.level === "optional"
            ? await missingMigrations(env.DB, "census_activity")
            : [];
        return protect(
          Response.json({
            range,
            rows: rows.results,
            census: snapshots.results.map(publicCensus),
            ...(pendingMigrations.length ? { pendingMigrations } : {}),
            receivedAt: new Date().toISOString(),
          }),
        );
      }
      if (url.pathname.startsWith("/api/"))
        return protect(new Response("Not found", { status: 404 }));
      return protect(await env.ASSETS.fetch(request));
    } catch (error) {
      logFailure("Analytics request failed", error);
      return protect(
        Response.json({ error: "Analytics unavailable" }, { status: 503 }),
      );
    }
  },
  async scheduled(controller, env) {
    await runScheduled(controller.cron, env);
  },
} satisfies ExportedHandler<Env>;
