import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { census, parseReport } from "../src/expanded";
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
          name: "cad",
          modules: true,
          script: caller,
          compatibilityDate: "2026-10-15",
          serviceBindings: {
            GLIMPSE: { name: "collector", entrypoint: "OpenZCADIngest" },
            RETENTION: { name: "collector", entrypoint: "CronProbe" },
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
  await db.exec(
    readFileSync("migrations/0001_aggregates.sql", "utf8").replace(/\n/g, " "),
  );
  await db.exec(
    readFileSync("migrations/0002_census.sql", "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join(" "),
  );
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
    for (const path of ["/", "/assets/app.js", "/api/stats", "/ingest"])
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
      GLIMPSE: { snapshot(v: unknown): Promise<void> };
    }>("cad");
    await bindings.GLIMPSE.snapshot({ ...validCensus, generation: 20 });
    await bindings.GLIMPSE.snapshot({
      ...validCensus,
      generation: 10,
      accounts: 1,
    });
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
    ]);
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
      "INSERT INTO daily_census SELECT ?,app,generation,accounts,projects,revisions,storedBytes,logicalBytes,unknownArtifacts,lt1mib,mib1to10,mib10to100,gte100mib FROM daily_census WHERE day=?",
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
