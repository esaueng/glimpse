import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { applyMigration, applyMigrations, MIGRATION_FILES } from "./d1-migrations";
import {
  ACTIVITY_FIELDS,
  ACTIVITY_MIN_COUNT,
  census,
  DIAGNOSTICS,
  EXPANDED,
  parseReport,
  publicCensus,
  thresholdActivity,
} from "../src/expanded";
import { dateRange, metric } from "../src/contract";
let mf: Miniflare;
let token: string;
let privateKey: CryptoKey;
const today = new Date().toISOString().slice(0, 10);
const issuer = "https://test.cloudflareaccess.com";
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test";
  jwk.alg = "RS256";
  token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(issuer)
    .setAudience("dashboard")
    .setSubject("test")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const bundle = await build({
    stdin: {
      contents: `import worker, { snapshot } from './src/index.ts'; export * from './src/index.ts'; export default worker; import { WorkerEntrypoint } from 'cloudflare:workers'; export class CronProbe extends WorkerEntrypoint { async run() { await worker.scheduled({}, this.env); } async at(value, day) { await snapshot(this.env, 'openzcad', value, new Date(day)); } }`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    external: ["cloudflare:workers"],
  });
  const caller = `export default {async fetch(r,env){try {await env.GLIMPSE.record(await r.json()); return new Response(null,{status:204});}catch{return new Response(null,{status:400});}}}`;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "collector",
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: "2026-10-15",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          bindings: { ACCESS_ISSUER: issuer, ACCESS_AUD: "dashboard" },
          serviceBindings: {
            ASSETS: () =>
              new Response("<h1>Private</h1>", {
                headers: { "Content-Type": "text/html" },
              }),
          },
          outboundService: (request: { url: string }) =>
            new Response(
              JSON.stringify(
                request.url === `${issuer}/cdn-cgi/access/certs`
                  ? { keys: [jwk] }
                  : {},
              ),
              { headers: { "Content-Type": "application/json" } },
            ),
        },
        {
          name: "preview-collector",
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: "2026-10-15",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "preview-db" },
          bindings: { ACCESS_ISSUER: issuer, ACCESS_AUD: "preview-dashboard" },
          serviceBindings: { ASSETS: () => new Response("<h1>Preview</h1>") },
          outboundService: () =>
            new Response(JSON.stringify({ keys: [jwk] }), {
              headers: { "Content-Type": "application/json" },
            }),
        },
        {
          // Access signing-key endpoint outage: the certs URL fails for this instance.
          name: "outage-collector",
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: "2026-10-15",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "outage-db" },
          bindings: { ACCESS_ISSUER: issuer, ACCESS_AUD: "dashboard" },
          serviceBindings: { ASSETS: () => new Response("<h1>Outage</h1>") },
          outboundService: () => new Response("unavailable", { status: 503 }),
        },
        {
          name: "cad",
          modules: true,
          script: caller,
          compatibilityDate: "2026-10-15",
          serviceBindings: {
            GLIMPSE: { name: "collector", entrypoint: "OpenZCADIngest" },
            RETENTION: { name: "collector", entrypoint: "CronProbe" },
            PREVIEW: "preview-collector",
            OUTAGE: "outage-collector",
          },
        },
        {
          name: "lattice",
          modules: true,
          script: caller,
          compatibilityDate: "2026-10-15",
          serviceBindings: {
            GLIMPSE: { name: "collector", entrypoint: "OpenLattice3DIngest" },
          },
        },
        {
          name: "fea",
          modules: true,
          script: caller,
          compatibilityDate: "2026-10-15",
          serviceBindings: {
            GLIMPSE: { name: "collector", entrypoint: "OpenFEAIngest" },
          },
        },
      ],
    }),
  );
  const db = await mf.getD1Database("DB", "collector");
  await applyMigration(db, "0001_aggregates.sql");
  // Upgrade a populated v1 database, as production will do.
  await db
    .prepare("INSERT INTO daily_counts VALUES(?,?,?,?,?,?)")
    .bind(today, "openzcad", "basic", "api_request", "none", 7)
    .run();
  await applyMigrations(db, MIGRATION_FILES.slice(1));
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
const ingest = async (app: string, value: unknown) => {
  const bindings = await mf.getBindings<{
    GLIMPSE: { record(value: unknown): Promise<void> };
  }>(app);
  try {
    await bindings.GLIMPSE.record(value);
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
};
const stats = async (query = "") =>
  mf.dispatchFetch(
    `https://glimpse.test/api/stats?from=${today}&to=${today}${query}`,
    { headers: { "Cf-Access-Jwt-Assertion": token } },
  );
describe("privacy contract", () => {
  it("rejects identity, arbitrary text, timestamps, counts and app overrides", () => {
    const allowed = {
      level: "optional",
      event: "export_completed",
      bucket: "none",
    };
    for (const key of [
      "email",
      "filename",
      "geometry",
      "projectName",
      "url",
      "visitorId",
      "timestamp",
      "count",
      "app",
      "consent",
    ])
      expect(metric({ ...allowed, [key]: "secret" }, "openfea")).toBeNull();
    for (const value of [
      null,
      [],
      { ...allowed, event: "custom_name" },
      { ...allowed, bucket: "filename.step" },
    ])
      expect(metric(value, "openfea")).toBeNull();
    expect(
      metric(
        { level: "optional", event: "solver_completed", bucket: "none" },
        "openzcad",
      ),
    ).toBeNull();
  });
  it("validates bounded, real UTC dates, app and level", () => {
    for (const query of [
      "from=2026-02-30",
      "from=2020-01-01",
      "app=unknown",
      "level=all",
      "from=2026-10-15&to=2026-10-14",
      "from=2026-10-01&from=2026-10-02",
      "email=x",
    ])
      expect(
        dateRange(new URLSearchParams(query), new Date("2026-10-15")),
      ).toBeNull();
  });
});
describe("real Worker RPC, D1 and Access JWT", () => {
  it("fails closed for all dashboard surfaces and public HTTP ingest", async () => {
    for (const path of ["/", "/assets/app.js", "/api/stats", "/api/cloudflare", "/api/cloudflare/settings", "/ingest"])
      expect(
        (await mf.dispatchFetch("https://glimpse.test" + path)).status,
      ).toBe(401);
    expect(
      (await mf.dispatchFetch("https://glimpse.test/healthz")).status,
    ).toBe(200);
    expect(
      (
        await mf.dispatchFetch("https://glimpse.test/", {
          headers: {
            "Cf-Access-Authenticated-User-Email": "spoof@test.invalid",
            "Cf-Access-Jwt-Assertion": "forged",
          },
        })
      ).status,
    ).toBe(401);
  });
  it("validates signature, expiry, issuer and audience", async () => {
    for (const claims of [
      { aud: "wrong", iss: issuer, exp: Math.floor(Date.now() / 1000) + 300 },
      {
        aud: "dashboard",
        iss: "https://other.cloudflareaccess.com",
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      { aud: "dashboard", iss: issuer, exp: 1 },
    ]) {
      const bad = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setSubject("test")
        .setIssuedAt()
        .sign(privateKey);
      expect(
        (
          await mf.dispatchFetch("https://glimpse.test/", {
            headers: { "Cf-Access-Jwt-Assertion": bad },
          })
        ).status,
      ).toBe(401);
    }
    const response = await mf.dispatchFetch("https://glimpse.test/", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });
  it("rejects algorithm-confusion tokens (HS256 and none)", async () => {
    const jwk = await exportJWK(
      (await generateKeyPair("RS256", { extractable: true })).publicKey,
    );
    const hs256 = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience("dashboard")
      .setSubject("test")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(String(jwk.n)));
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const none = `${encode({ alg: "none", typ: "JWT" })}.${encode({
      iss: issuer,
      aud: "dashboard",
      sub: "test",
      iat: now,
      exp: now + 300,
    })}.`;
    for (const bad of [hs256, none])
      expect(
        (
          await mf.dispatchFetch("https://glimpse.test/api/stats", {
            headers: { "Cf-Access-Jwt-Assertion": bad },
          })
        ).status,
      ).toBe(401);
  });
  it("tolerates small clock skew but not stale tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = (exp: number) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setIssuer(issuer)
        .setAudience("dashboard")
        .setSubject("test")
        .setIssuedAt(exp - 300)
        .setExpirationTime(exp)
        .sign(privateKey);
    const status = async (exp: number) =>
      (
        await mf.dispatchFetch("https://glimpse.test/", {
          headers: { "Cf-Access-Jwt-Assertion": await signed(exp) },
        })
      ).status;
    expect(await status(now - 30)).toBe(200);
    expect(await status(now - 120)).toBe(401);
  });
  it("returns 503, not 401, when Access signing keys cannot be fetched", async () => {
    const { OUTAGE: outage } = await mf.getBindings<{
      OUTAGE: { fetch: typeof fetch };
    }>("cad");
    const response = await outage.fetch("https://glimpse.test/api/stats", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    // Requests without a token are still plain authentication failures.
    expect((await outage.fetch("https://glimpse.test/")).status).toBe(401);
  });
  it("aggregates concurrently by app, day, level, event and bucket", async () => {
    const value = {
      level: "optional",
      event: "export_completed",
      bucket: "none",
    };
    await Promise.all(Array.from({ length: 12 }, () => ingest("cad", value)));
    await ingest("fea", value);
    await ingest("fea", {
      level: "basic",
      event: "api_request",
      bucket: "none",
    });
    await ingest("fea", {
      level: "optional",
      event: "solver_completed",
      bucket: "none",
    });
    expect((await ingest("cad", { ...value, app: "openfea" })).status).toBe(
      400,
    );
    expect(
      (await ingest("fea", { ...value, filename: "private.step" })).status,
    ).toBe(400);
    const optional = (await (await stats("&level=optional")).json()) as {
      rows: { app: string; event: string; count: number }[];
    };
    expect(
      optional.rows.find(
        (r) => r.app === "openzcad" && r.event === "export_completed",
      )?.count,
    ).toBe(12);
    expect(
      optional.rows.find(
        (r) => r.app === "openfea" && r.event === "export_completed",
      )?.count,
    ).toBe(1);
    const cad = (await (
      await stats("&level=optional&app=openzcad")
    ).json()) as { rows: { app: string }[] };
    expect(cad.rows.every((r) => r.app === "openzcad")).toBe(true);
    const basic = (await (await stats()).json()) as {
      rows: { level: string }[];
    };
    expect(basic.rows.every((r) => r.level === "basic")).toBe(true);
    const db = await mf.getD1Database("DB", "collector");
    expect(
      (
        await db
          .prepare("PRAGMA table_info(daily_counts)")
          .all<{ name: string }>()
      ).results.map((r: { name: string }) => r.name),
    ).toEqual(["day", "app", "level", "event", "bucket", "count"]);
  });
  it("preserves v1 counts and isolates the third app through real RPC", async () => {
    const db = await mf.getD1Database("DB", "collector");
    expect(
      await db
        .prepare(
          "SELECT count FROM daily_counts WHERE app='openzcad' AND level='basic'",
        )
        .first("count"),
    ).toBe(7);
    const value = {
      level: "optional",
      event: "generation_completed",
      bucket: "none",
    };
    expect((await ingest("lattice", value)).status).toBe(204);
    expect((await ingest("lattice", { ...value, app: "openfea" })).status).toBe(
      400,
    );
    expect((await ingest("fea", value)).status).toBe(400);
    expect((await ingest("cad", value)).status).toBe(400);
    expect(
      (await ingest("lattice", { ...value, event: "solver_completed" })).status,
    ).toBe(400);
    expect(
      (await ingest("lattice", { ...value, filename: "private.stl" })).status,
    ).toBe(400);
    await ingest("lattice", { ...value, event: "export_completed" });
    const scoped = (await (
      await stats("&app=openlattice3d&level=optional")
    ).json()) as { rows: { app: string; event: string; count: number }[] };
    expect(scoped.rows).toHaveLength(2);
    expect(
      scoped.rows.every((r) => r.app === "openlattice3d" && r.count === 1),
    ).toBe(true);
    const combined = (await (await stats("&level=optional")).json()) as {
      rows: { app: string }[];
    };
    expect(new Set(combined.rows.map((r) => r.app))).toEqual(
      new Set(["openzcad", "openfea", "openlattice3d"]),
    );
    await expect(
      db
        .prepare("INSERT INTO daily_counts VALUES(?,?,?,?,?,?)")
        .bind(today, "unknown", "basic", "api_request", "none", 1)
        .run(),
    ).rejects.toThrow();
  });
  it("rejects cross-environment JWTs and reads only the Preview database", async () => {
    const previewToken = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience("preview-dashboard")
      .setSubject("test")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const { PREVIEW: preview } = await mf.getBindings<{
      PREVIEW: { fetch: typeof fetch };
    }>("cad");
    for (const path of ["/", "/api/stats"]) {
      expect((await preview.fetch(`https://preview.test${path}`)).status).toBe(
        401,
      );
      expect(
        (
          await preview.fetch(`https://preview.test${path}`, {
            headers: { "Cf-Access-Jwt-Assertion": token },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await mf.dispatchFetch(`https://glimpse.test${path}`, {
            headers: { "Cf-Access-Jwt-Assertion": previewToken },
          })
        ).status,
      ).toBe(401);
    }
    const db = await mf.getD1Database("DB", "preview-collector");
    // Preview has the analytics migrations; the stats guard needs all three.
    await applyMigrations(db, [
      "0001_aggregates.sql",
      "0002_openlattice3d.sql",
      "0003_census.sql",
    ]);
    await db
      .prepare("INSERT INTO daily_counts VALUES(?,?,?,?,?,?)")
      .bind(today, "openlattice3d", "basic", "api_request", "none", 13)
      .run();
    const response = await preview.fetch(
      `https://preview.test/api/stats?from=${today}&to=${today}`,
      {
        headers: { "Cf-Access-Jwt-Assertion": previewToken },
      },
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { rows: { count: number }[] }).rows.map(
        (r) => r.count,
      ),
    ).toEqual([13]);
    const production = (await (await stats("&app=openlattice3d")).json()) as {
      rows: unknown[];
    };
    expect(production.rows).toEqual([]);
  });
  it("hides expired aggregates even if the retention cron is delayed", async () => {
    const db = await mf.getD1Database("DB", "collector");
    const expired = new Date(Date.now() - 90 * 86400000)
      .toISOString()
      .slice(0, 10);
    await db
      .prepare("INSERT INTO daily_counts VALUES(?,?,?,?,?,?)")
      .bind(expired, "openfea", "basic", "api_request", "none", 99)
      .run();
    const r = await mf.dispatchFetch(
      `https://glimpse.test/api/stats?from=${expired}&to=${expired}`,
      { headers: { "Cf-Access-Jwt-Assertion": token } },
    );
    expect(((await r.json()) as { rows: unknown[] }).rows).toEqual([]);
    const probe = await mf.getBindings<{ RETENTION: { run(): Promise<void> } }>(
      "cad",
    );
    await probe.RETENTION.run();
    expect(
      (
        await db
          .prepare("SELECT count(*) AS count FROM daily_counts WHERE day=?")
          .bind(expired)
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    expect((await stats("&app=wrong")).status).toBe(400);
  });
});

const validCensus = {
  generation: 1,
  accounts: 2,
  projects: 3,
  revisions: 4,
  storedBytes: 100,
  logicalBytes: 200,
  unknownArtifacts: 0,
  lt1mib: 1,
  mib1to10: 1,
  mib10to100: 1,
  gte100mib: 0,
};
describe("expanded analytics", () => {
  it("rejects arbitrary dimensions, invalid totals and cross-app census", () => {
    expect(census(validCensus, "openzcad")).toEqual(validCensus);
    for (const bad of [
      { ...validCensus, userId: "private" },
      { ...validCensus, storedBytes: NaN },
      { ...validCensus, projects: 4 },
      { ...validCensus, accounts: 0 },
    ])
      expect(census(bad, "openzcad")).toBeNull();
    expect(census(validCensus, "openfea")).toBeNull();
    expect(
      metric(
        { level: "basic", event: "error_mesh", bucket: "none" },
        "openfea",
      ),
    ).toBeNull();
    expect(
      metric(
        { level: "optional", event: "project_size", bucket: "private.step" },
        "openfea",
      ),
    ).toBeNull();
    expect(
      metric(
        {
          level: "optional",
          event: "feature_operation",
          bucket: "feature.fillet",
        },
        "openzcad",
      ),
    ).not.toBeNull();
    expect(
      metric(
        {
          level: "optional",
          event: "feature_operation",
          bucket: "feature.fillet",
        },
        "openfea",
      ),
    ).toBeNull();
  });
  it("only accepts local report aggregates without identifiers or histories", () => {
    const good = {
      schema: 2,
      app: "openfea",
      rows: [{ event: "error_mesh", bucket: "none", count: 3 }],
    };
    expect(parseReport(good)).toEqual(good);
    for (const bad of [
      { ...good, email: "private" },
      { ...good, rows: [{ ...good.rows[0], stack: "private" }] },
      { ...good, rows: [{ event: "url", bucket: "none", count: 1 }] },
      { ...good, rows: [...good.rows, ...good.rows] },
      { ...good, rows: [{ ...good.rows[0], count: Infinity }] },
    ])
      expect(parseReport(bad)).toBeNull();
  });
  it("replaces cloud snapshots without summing accounts, rejects stale deliveries and hides them from Basic", async () => {
    const bindings = await mf.getBindings<{
      GLIMPSE: { snapshot(v: unknown): Promise<{ accepted: boolean }> };
    }>("cad");
    expect(
      await bindings.GLIMPSE.snapshot({ ...validCensus, generation: 20 }),
    ).toEqual({ accepted: true });
    // A stale generation is reported to the caller instead of being dropped silently.
    expect(
      await bindings.GLIMPSE.snapshot({
        ...validCensus,
        generation: 10,
        accounts: 1,
      }),
    ).toEqual({ accepted: false });
    expect(
      await bindings.GLIMPSE.snapshot({ ...validCensus, generation: 20 }),
    ).toEqual({ accepted: false });
    await expect(async () => {
      await bindings.GLIMPSE.snapshot({ ...validCensus, email: "private" });
    }).rejects.toThrow();
    const optional = (await (await stats("&level=optional")).json()) as {
      census: { accounts: number; generation: number }[];
    };
    expect(optional.census).toHaveLength(1);
    expect(optional.census[0]).toMatchObject({ accounts: 2, generation: 20 });
    expect(
      ((await (await stats()).json()) as { census: unknown[] }).census,
    ).toEqual([]);
    expect(
      (
        (await (await stats("&level=optional&app=openfea")).json()) as {
          census: unknown[];
        }
      ).census,
    ).toEqual([]);
    const db = await mf.getD1Database("DB", "collector");
    expect(
      (
        await db
          .prepare("PRAGMA table_info(daily_census)")
          .all<{ name: string }>()
      ).results.map((r: { name: string }) => r.name),
    ).toEqual([
      "day",
      "app",
      "generation",
      "accounts",
      "projects",
      "revisions",
      "storedBytes",
      "logicalBytes",
      "unknownArtifacts",
      "lt1mib",
      "mib1to10",
      "mib10to100",
      "gte100mib",
      // 0005: nullable, so earlier rows and older OpenZCAD versions stay valid.
      "activityReported",
      "active7d",
      "active30d",
      "idle90d",
    ]);
    // A snapshot without activity counts serves without the activity keys.
    expect(Object.keys(optional.census[0]!)).not.toContain("active7d");
    expect(Object.keys(optional.census[0]!)).not.toContain("activityReported");
  });
});

it("rejects late snapshots across UTC days and purges expired snapshot metadata", async () => {
  const probe = await mf.getBindings<{
    RETENTION: {
      at(value: unknown, day: string): Promise<void>;
      run(): Promise<void>;
    };
  }>("cad");
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await probe.RETENTION.at({ ...validCensus, generation: 19 }, tomorrow);
  const db = await mf.getD1Database("DB", "collector");
  expect(
    await db
      .prepare("SELECT count(*) AS n FROM daily_census WHERE day=?")
      .bind(tomorrow)
      .first(),
  ).toEqual({ n: 0 });
  const expired = new Date(Date.now() - 90 * 86400000)
    .toISOString()
    .slice(0, 10);
  await db
    .prepare(
      "INSERT INTO daily_census SELECT ?,app,generation,accounts,projects,revisions,storedBytes,logicalBytes,unknownArtifacts,lt1mib,mib1to10,mib10to100,gte100mib,activityReported,active7d,active30d,idle90d FROM daily_census WHERE day=?",
    )
    .bind(expired, today)
    .run();
  await probe.RETENTION.run();
  expect(
    await db
      .prepare("SELECT count(*) AS n FROM daily_census WHERE day=?")
      .bind(expired)
      .first(),
  ).toEqual({ n: 0 });
});

// Privacy review approved 13 Nov 2026 (docs/PRIVACY.md, "Review: additional diagnostic codes and account activity").
const NEW_CODES = [
  "error_unresponsive",
  "error_gpu_lost",
  "error_out_of_memory",
  "error_worker",
];
// OpenLattice3D sends them too since ADR 0001 Option B (accepted 13 Nov 2026).
describe("additional diagnostic codes", () => {
  it("accepts the fixed codes from all three apps, with bucket none", () => {
    for (const event of NEW_CODES) {
      expect(DIAGNOSTICS).toContain(event);
      for (const app of ["openzcad", "openfea", "openlattice3d"] as const)
        expect(metric({ level: "optional", event, bucket: "none" }, app)).toEqual({
          level: "optional",
          event,
          bucket: "none",
        });
      expect(metric({ level: "basic", event, bucket: "none" }, "openzcad")).toBeNull();
      expect(
        metric({ level: "optional", event, bucket: "GPU hung in shader" }, "openfea"),
      ).toBeNull();
    }
    for (const event of ["error_gpu", "error_network", "error_crash", "error_worker_oom"])
      expect(metric({ level: "optional", event, bucket: "none" }, "openzcad")).toBeNull();
  });
  it("accepts the codes in local reports for all three apps, never unknown apps", () => {
    for (const app of ["openzcad", "openfea", "openlattice3d"]) {
      const report = {
        schema: 2,
        app,
        rows: NEW_CODES.map((event) => ({ event, bucket: "none", count: 2 })),
      };
      expect(parseReport(report)).toEqual(report);
    }
    expect(
      parseReport({
        schema: 2,
        app: "openslicer",
        rows: [{ event: "error_gpu_lost", bucket: "none", count: 1 }],
      }),
    ).toBeNull();
  });
  it("counts the codes through the real RPC for each app", async () => {
    for (const event of NEW_CODES) {
      const value = { level: "optional", event, bucket: "none" };
      expect((await ingest("cad", value)).status).toBe(204);
      expect((await ingest("fea", value)).status).toBe(204);
      expect((await ingest("lattice", value)).status).toBe(204);
    }
    const { rows } = (await (await stats("&level=optional")).json()) as {
      rows: { app: string; event: string; count: number }[];
    };
    for (const event of NEW_CODES)
      expect(
        rows
          .filter((r) => r.event === event)
          .map((r) => [r.app, r.count])
          .sort(),
      ).toEqual([
        ["openfea", 1],
        ["openlattice3d", 1],
        ["openzcad", 1],
      ]);
  });
});

// ADR 0001 Option B, accepted by the owner on 13 Nov 2026 (docs/PRIVACY.md,
// "Review: OpenLattice3D targeted subset"). Written out here rather than imported, so a change
// to the allowlist in src/expanded.ts has to change this test too.
const LATTICE_SUBSET: Record<string, readonly string[]> = {
  error_runtime: ["none"],
  error_import: ["none"],
  error_export: ["none"],
  error_storage: ["none"],
  error_render: ["none"],
  error_unresponsive: ["none"],
  error_gpu_lost: ["none"],
  error_out_of_memory: ["none"],
  error_worker: ["none"],
  export_latency: ["lt_100ms", "100ms_1s", "1s_10s", "10s_60s", "gte_60s"],
  project_size: ["lt_1mib", "1_10mib", "10_100mib", "gte_100mib"],
  feature_category: ["create", "import", "export", "measure", "other"],
  lattice_cells: ["lt_1k", "1k_10k", "10k_100k", "gte_100k"],
};
const LATTICE_REJECTED = [
  "error_mesh",
  "error_solver",
  "error_cloud_save",
  "error_cloud_load",
  "error_feature",
  "feature_operation",
  "cloud_status",
  "part_count",
  "transfer_upload",
  "transfer_download",
  "mesh_latency",
  "solver_latency",
  "save_latency",
  "solver_backend",
];
const opt = (event: string, bucket: string) => ({ level: "optional", event, bucket });
describe("OpenLattice3D targeted subset (ADR 0001 Option B)", () => {
  it("accepts every bucket of each subset event from OpenLattice3D, Optional level only", () => {
    for (const [event, buckets] of Object.entries(LATTICE_SUBSET))
      for (const bucket of buckets) {
        expect(metric(opt(event, bucket), "openlattice3d")).toEqual(
          opt(event, bucket),
        );
        expect(
          metric({ level: "basic", event, bucket }, "openlattice3d"),
        ).toBeNull();
      }
  });
  it("rejects every other expanded event and bucket from OpenLattice3D", () => {
    // Every event in the v2 vocabulary is either in the subset or listed as rejected.
    expect(
      Object.keys(EXPANDED).filter((e) => !Object.hasOwn(LATTICE_SUBSET, e)).sort(),
    ).toEqual([...LATTICE_REJECTED].sort());
    for (const event of LATTICE_REJECTED) {
      expect(EXPANDED[event]!.length).toBeGreaterThan(0);
      for (const bucket of EXPANDED[event]!)
        expect(metric(opt(event, bucket), "openlattice3d")).toBeNull();
    }
    // Feature categories that have no lattice meaning.
    for (const bucket of ["edit", "mesh", "solve"])
      expect(metric(opt("feature_category", bucket), "openlattice3d")).toBeNull();
    // Buckets outside the fixed ranges, including finer or exact cell counts.
    for (const [event, bucket] of [
      ["lattice_cells", "gte_1m"],
      ["lattice_cells", "12345"],
      ["lattice_cells", "none"],
      ["lattice_cells", "1_10mib"],
      ["export_latency", "none"],
      ["project_size", "gte_1gib"],
      ["error_gpu_lost", "NVIDIA"],
      ["error_generation", "none"],
    ])
      expect(metric(opt(event!, bucket!), "openlattice3d")).toBeNull();
    // v1 scope is unchanged, and there is still no census for OpenLattice3D.
    for (const event of ["solver_completed", "workflow_model", "feature_used"])
      expect(metric(opt(event, "none"), "openlattice3d")).toBeNull();
    expect(metric(opt("generation_failed", "none"), "openlattice3d")).not.toBeNull();
    expect(census(validCensus, "openlattice3d")).toBeNull();
  });
  it("keeps the lattice cell count to OpenLattice3D, and the other apps' scopes unchanged", () => {
    for (const app of ["openzcad", "openfea"] as const) {
      for (const bucket of LATTICE_SUBSET.lattice_cells!)
        expect(metric(opt("lattice_cells", bucket), app)).toBeNull();
      for (const bucket of ["edit", "mesh", "solve"])
        expect(metric(opt("feature_category", bucket), app)).not.toBeNull();
      expect(metric(opt("error_feature", "none"), app)).not.toBeNull();
    }
    expect(metric(opt("error_mesh", "none"), "openfea")).not.toBeNull();
    expect(metric(opt("error_mesh", "none"), "openzcad")).toBeNull();
    expect(metric(opt("cloud_status", "server"), "openzcad")).not.toBeNull();
    expect(metric(opt("cloud_status", "server"), "openfea")).toBeNull();
  });
  it("accepts OpenLattice3D local reports with the same per-app scope", () => {
    const rows = Object.entries(LATTICE_SUBSET).flatMap(([event, buckets]) =>
      buckets.map((bucket) => ({ event, bucket, count: 3 })),
    );
    expect(rows.length).toBeLessThanOrEqual(128);
    const report = { schema: 2, app: "openlattice3d", rows };
    expect(parseReport(report)).toEqual(report);
    for (const event of LATTICE_REJECTED)
      expect(
        parseReport({
          schema: 2,
          app: "openlattice3d",
          rows: [{ event, bucket: EXPANDED[event]![0], count: 1 }],
        }),
      ).toBeNull();
    for (const row of [
      { event: "feature_category", bucket: "solve", count: 1 },
      { event: "lattice_cells", bucket: "gte_1m", count: 1 },
      { event: "generation_failed", bucket: "none", count: 1 },
    ])
      expect(parseReport({ schema: 2, app: "openlattice3d", rows: [row] })).toBeNull();
    for (const app of ["openzcad", "openfea"])
      expect(
        parseReport({
          schema: 2,
          app,
          rows: [{ event: "lattice_cells", bucket: "lt_1k", count: 1 }],
        }),
      ).toBeNull();
  });
  it("stores accepted events in daily_counts through the real RPC, without a migration", async () => {
    const events: [string, string][] = [
      ["error_runtime", "none"],
      ["error_import", "none"],
      ["error_export", "none"],
      ["error_storage", "none"],
      ["error_render", "none"],
      ["export_latency", "10s_60s"],
      ["project_size", "10_100mib"],
      ["feature_category", "measure"],
      ...LATTICE_SUBSET.lattice_cells!.map((b): [string, string] => ["lattice_cells", b]),
    ];
    for (const [event, bucket] of events)
      expect((await ingest("lattice", opt(event, bucket))).status).toBe(204);
    for (const event of LATTICE_REJECTED)
      expect(
        (await ingest("lattice", opt(event, EXPANDED[event]![0]!))).status,
      ).toBe(400);
    expect((await ingest("lattice", opt("feature_category", "solve"))).status).toBe(400);
    expect((await ingest("cad", opt("lattice_cells", "lt_1k"))).status).toBe(400);
    expect((await ingest("fea", opt("lattice_cells", "lt_1k"))).status).toBe(400);
    const { rows } = (await (
      await stats("&level=optional&app=openlattice3d")
    ).json()) as { rows: { app: string; event: string; bucket: string; count: number }[] };
    for (const [event, bucket] of events)
      expect(rows.find((r) => r.event === event && r.bucket === bucket)?.count).toBe(1);
    expect(rows.some((r) => LATTICE_REJECTED.includes(r.event))).toBe(false);
    const db = await mf.getD1Database("DB", "collector");
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM daily_counts WHERE app='openlattice3d' AND level='optional' AND event='lattice_cells'",
        )
        .first("n"),
    ).toBe(4);
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM daily_counts WHERE event='lattice_cells' AND app<>'openlattice3d'")
        .first("n"),
    ).toBe(0);
  });
});

const active = { ...validCensus, accounts: 40, active7d: 12, active30d: 20, idle90d: 9 };
const snapshotBinding = async () =>
  (
    await mf.getBindings<{
      GLIMPSE: { snapshot(v: unknown): Promise<{ accepted: boolean }> };
    }>("cad")
  ).GLIMPSE;
const storedActivity = async () =>
  (await mf.getD1Database("DB", "collector"))
    .prepare("SELECT activityReported,active7d,active30d,idle90d FROM daily_census WHERE day=?")
    .bind(today)
    .first();
const servedCensus = async () =>
  (await (await stats("&level=optional")).json()) as {
    census: Record<string, unknown>[];
    pendingMigrations?: string[];
  };
describe("census activity counts", () => {
  it("keeps snapshots without activity fields valid, as older OpenZCAD versions send them", () => {
    const old = census(validCensus, "openzcad");
    expect(old).toEqual(validCensus);
    for (const k of ACTIVITY_FIELDS) expect(old).not.toHaveProperty(k);
  });
  it("accepts all three fields or none, as integers bounded by accounts, or null", () => {
    expect(census(active, "openzcad")).toEqual(active);
    const appWithheld = { ...active, active7d: null, idle90d: null };
    expect(census(appWithheld, "openzcad")).toEqual(appWithheld);
    const { idle90d: _idle, ...two } = active;
    const { active7d: _a, active30d: _b, ...one } = active;
    for (const bad of [
      two,
      one,
      { ...active, active7d: -1 },
      { ...active, active7d: 1.5 },
      { ...active, active7d: "12" },
      { ...active, active30d: NaN },
      { ...active, active7d: undefined },
      { ...active, idle90d: 41 }, // more than the consenting accounts
      { ...active, active7d: 21 }, // a 7-day saver is also a 30-day saver
      { ...active, active30d: 32 }, // active in 30 days and idle for 90 cannot overlap
      { ...active, accountIds: [1, 2] },
    ])
      expect(census(bad, "openzcad")).toBeNull();
    expect(census(active, "openfea")).toBeNull();
  });
  it(`withholds a count below ${ACTIVITY_MIN_COUNT}, or one with fewer than ${ACTIVITY_MIN_COUNT} accounts outside it`, () => {
    expect(ACTIVITY_MIN_COUNT).toBe(5);
    expect(thresholdActivity(active)).toEqual(active);
    expect(
      thresholdActivity({ ...active, active7d: 4, active30d: 36, idle90d: 0 }),
    ).toMatchObject({ active7d: null, active30d: null, idle90d: null });
    expect(
      thresholdActivity({ ...active, active7d: 5, active30d: 35, idle90d: 5 }),
    ).toMatchObject({ active7d: 5, active30d: 35, idle90d: 5 });
    // With fewer than 2K consenting accounts every count is withheld.
    expect(
      thresholdActivity({ ...active, accounts: 9, active7d: 5, active30d: 5, idle90d: 4 }),
    ).toMatchObject({ active7d: null, active30d: null, idle90d: null });
    expect(thresholdActivity(validCensus)).toEqual(validCensus);
    // Read time: rows without the 0005 flag never expose activity keys.
    expect(
      publicCensus({ ...validCensus, activityReported: null, active7d: 50, active30d: null, idle90d: null }),
    ).toEqual(validCensus);
    expect(publicCensus({ ...active, activityReported: 1, active7d: 3 })).toEqual({
      ...active,
      active7d: null,
    });
  });
  it("stores withheld counts as NULL at ingest and serves them as null", async () => {
    const GLIMPSE = await snapshotBinding();
    expect(
      await GLIMPSE.snapshot({ ...active, generation: 30, active7d: 3, active30d: 9, idle90d: 28 }),
    ).toEqual({ accepted: true });
    expect(await storedActivity()).toEqual({
      activityReported: 1,
      active7d: null,
      active30d: 9,
      idle90d: 28,
    });
    const served = await servedCensus();
    expect(served.pendingMigrations).toBeUndefined();
    expect(served.census[0]).toMatchObject({ accounts: 40, active7d: null, active30d: 9, idle90d: 28 });
    expect(served.census[0]).not.toHaveProperty("activityReported");
    // The database refuses a small count even if the Worker's threshold were bypassed.
    const db = await mf.getD1Database("DB", "collector");
    await expect(
      db.prepare("UPDATE daily_census SET active7d=3 WHERE day=?").bind(today).run(),
    ).rejects.toThrow(/CHECK/);
  });
  it("re-applies the threshold at read time to stored values", async () => {
    const db = await mf.getD1Database("DB", "collector");
    // A row stored without the complement rule: 9 of 12 leaves 3 accounts outside the count.
    await db
      .prepare("UPDATE daily_census SET accounts=12, active30d=9, idle90d=NULL WHERE day=?")
      .bind(today)
      .run();
    expect((await servedCensus()).census[0]).toMatchObject({
      accounts: 12,
      active7d: null,
      active30d: null,
      idle90d: null,
    });
  });
  it("clears activity counts when a later same-day snapshot comes from an older OpenZCAD", async () => {
    const GLIMPSE = await snapshotBinding();
    expect(await GLIMPSE.snapshot({ ...validCensus, generation: 31 })).toEqual({ accepted: true });
    expect(await storedActivity()).toEqual({
      activityReported: null,
      active7d: null,
      active30d: null,
      idle90d: null,
    });
    const row = (await servedCensus()).census[0];
    for (const k of ACTIVITY_FIELDS) expect(row).not.toHaveProperty(k);
  });
});
