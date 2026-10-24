import { WorkerEntrypoint } from "cloudflare:workers";
import { census, CENSUS_FIELDS } from "./expanded";
import { authorized } from "./auth";
import { dateRange, metric, type App } from "./contract";
import { cloudflareApi } from "./cloudflare/api";
import { collect } from "./cloudflare/collect";
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
) {
  const c = census(value, app);
  if (!c) throw new Error("Invalid census");
  const fields = ["generation", ...CENSUS_FIELDS] as const;
  await env.DB.prepare(
    `INSERT INTO daily_census(day,app,${fields.join(",")}) SELECT ?,?,${fields.map(() => "?").join(",")} WHERE ? > COALESCE((SELECT MAX(generation) FROM daily_census WHERE app=?),0)
    ON CONFLICT(day,app) DO UPDATE SET ${fields.map((k) => `${k}=excluded.${k}`).join(",")}
    WHERE excluded.generation > daily_census.generation
    AND excluded.generation > COALESCE((SELECT MAX(generation) FROM daily_census WHERE app=excluded.app AND day<>excluded.day),0)`,
  )
    .bind(
      now.toISOString().slice(0, 10),
      app,
      ...fields.map((k) => c[k]),
      c.generation,
      app,
    )
    .run();
}
// Binding entrypoints fix app identity. There is intentionally no HTTP ingest API.
export class OpenZCADIngest extends WorkerEntrypoint<Env> {
  async snapshot(value: unknown) {
    await snapshot(this.env, "openzcad", value);
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
    if (!(await authorized(request, env)))
      return protect(new Response("Authentication required", { status: 401 }));
    if (
      url.pathname === "/api/cloudflare" ||
      url.pathname.startsWith("/api/cloudflare/")
    ) {
      try {
        return protect(await cloudflareApi(request, env));
      } catch {
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
        const rows = await env.DB.prepare(
          `SELECT day,app,level,event,bucket,count FROM daily_counts
          WHERE day>=? AND day<=? AND day>=date('now','-89 days') AND level=? AND (?='all' OR app=?)
          ORDER BY day,app,event,bucket`,
        )
          .bind(range.from, range.to, range.level, range.app, range.app)
          .all();
        const snapshots =
          range.level === "optional"
            ? await env.DB.prepare(
                `SELECT * FROM daily_census WHERE day>=? AND day<=? AND day>=date('now','-89 days') AND (?='all' OR app=?) ORDER BY day DESC LIMIT 90`,
              )
                .bind(range.from, range.to, range.app, range.app)
                .all()
            : { results: [] };
        return protect(
          Response.json({
            range,
            rows: rows.results,
            census: snapshots.results,
            receivedAt: new Date().toISOString(),
          }),
        );
      }
      if (url.pathname.startsWith("/api/"))
        return protect(new Response("Not found", { status: 404 }));
      return protect(await env.ASSETS.fetch(request));
    } catch {
      return protect(
        Response.json({ error: "Analytics unavailable" }, { status: 503 }),
      );
    }
  },
  async scheduled(controller, env) {
    if (controller.cron === "17 * * * *") {
      await collect(env);
      return;
    }
    await env.DB.batch(
      ["daily_counts", "daily_census"].map((table) =>
        env.DB.prepare(
          `DELETE FROM ${table} WHERE day < date('now','-89 days')`,
        ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
