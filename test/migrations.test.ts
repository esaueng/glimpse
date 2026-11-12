import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { REQUIRED_MIGRATIONS, requiredFor } from "../src/migrations";
import {
  applyMigration,
  MIGRATION_FILES,
  migrationSql,
  recordMigration,
} from "./d1-migrations";

describe("REQUIRED_MIGRATIONS", () => {
  it("lists every migration file, and only those, with at least one surface each", () => {
    expect(MIGRATION_FILES.length).toBeGreaterThan(0);
    expect(Object.keys(REQUIRED_MIGRATIONS).sort()).toEqual(MIGRATION_FILES);
    for (const surfaces of Object.values(REQUIRED_MIGRATIONS))
      expect(surfaces.length).toBeGreaterThan(0);
    expect(requiredFor("stats")).toEqual([
      "0001_aggregates.sql",
      "0002_openlattice3d.sql",
      "0003_census.sql",
    ]);
    expect(requiredFor("cloudflare")).toEqual(["0004_cloudflare.sql"]);
  });
});

const issuer = "https://test.cloudflareaccess.com";
const today = new Date().toISOString().slice(0, 10);
let mf: Miniflare;
let token: string;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" };
  token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(issuer)
    .setAudience("dashboard")
    .setSubject("test")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  const bundle = await build({
    entryPoints: ["src/index.ts"],
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
          script: bundle.outputFiles[0]!.text,
          compatibilityDate: "2026-10-15",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          bindings: { ACCESS_ISSUER: issuer, ACCESS_AUD: "dashboard" },
          serviceBindings: { ASSETS: () => new Response("<h1>Private</h1>") },
          outboundService: () =>
            new Response(JSON.stringify({ keys: [jwk] }), {
              headers: { "Content-Type": "application/json" },
            }),
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
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});

const get = (path: string, auth = true) =>
  mf.dispatchFetch(`https://glimpse.test${path}`, {
    headers: auth ? { "Cf-Access-Jwt-Assertion": token } : {},
  });
const stats = (auth = true) =>
  get(`/api/stats?from=${today}&to=${today}`, auth);
const pending = async (response: Awaited<ReturnType<typeof get>>) => {
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const body = (await response.json()) as {
    error: string;
    missingMigrations: string[];
  };
  for (const name of body.missingMigrations)
    expect(body.error).toContain(name);
  return body.missingMigrations;
};
const ingest = async () => {
  const { GLIMPSE } = await mf.getBindings<{
    GLIMPSE: { record(value: unknown): Promise<void> };
  }>("fea");
  try {
    await GLIMPSE.record({ level: "basic", event: "api_request", bucket: "none" });
    return 204;
  } catch {
    return 400;
  }
};

// Ordered: each step applies more of the schema to the same database.
describe("pending-migration guard on authenticated API paths", () => {
  it("names every missing migration when the ledger does not exist", async () => {
    expect((await stats(false)).status).toBe(401);
    expect((await get("/api/cloudflare", false)).status).toBe(401);
    expect(await pending(await stats())).toEqual(requiredFor("stats"));
    expect(await pending(await get("/api/cloudflare"))).toEqual(
      requiredFor("cloudflare"),
    );
    // Static assets and unknown API paths are not guarded.
    expect((await get("/")).status).toBe(200);
    expect((await get("/api/unknown")).status).toBe(404);
  });
  it("leaves ingestion RPC unchanged: it still writes when the schema exists without a ledger entry", async () => {
    const db = await mf.getD1Database("DB", "collector");
    expect(await ingest()).toBe(400); // no table yet, exactly as before the guard
    await db.exec(migrationSql("0001_aggregates.sql"));
    await db.exec(migrationSql("0002_openlattice3d.sql"));
    expect(await ingest()).toBe(204);
    expect(
      await db.prepare("SELECT SUM(count) AS n FROM daily_counts").first("n"),
    ).toBe(1);
    expect(await pending(await stats())).toEqual(requiredFor("stats"));
  });
  it("reports only the migrations still missing, then serves once they are applied", async () => {
    const db = await mf.getD1Database("DB", "collector");
    // Record the two migrations whose SQL was applied above.
    await recordMigration(db, "0001_aggregates.sql");
    await recordMigration(db, "0002_openlattice3d.sql");
    expect(await pending(await stats())).toEqual(["0003_census.sql"]);
    await applyMigration(db, "0003_census.sql");
    const ok = await stats();
    expect(ok.status).toBe(200);
    expect(
      ((await ok.json()) as { rows: { count: number }[] }).rows.map(
        (r) => r.count,
      ),
    ).toEqual([1]);
    // The Cloudflare page needs its own migration, independently of analytics.
    expect(await pending(await get("/api/cloudflare"))).toEqual([
      "0004_cloudflare.sql",
    ]);
    await applyMigration(db, "0004_cloudflare.sql");
    expect((await get("/api/cloudflare")).status).toBe(200);
  });
  it("caches a satisfied schema per isolate instead of re-reading the ledger", async () => {
    const db = await mf.getD1Database("DB", "collector");
    await db.exec("DROP TABLE d1_migrations;");
    expect((await stats()).status).toBe(200);
    expect((await get("/api/cloudflare")).status).toBe(200);
  });
});
