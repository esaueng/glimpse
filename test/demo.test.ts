import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseConfigFileTextToJson } from "typescript";
import demoWorker from "../src/demo";
import { demoStats } from "../web/demo-data";
import { census, CENSUS_FIELDS } from "../src/expanded";
import { metric } from "../src/contract";
const now = new Date("2026-10-15T12:00:00Z");
const range = {
  app: "all",
  level: "optional",
  from: "2026-10-01",
  to: "2026-10-15",
};
describe("synthetic demo", () => {
  it("generates deterministic valid aggregate rows and snapshots for all apps", () => {
    const data = demoStats(range, now);
    expect(data).toEqual(demoStats(range, now));
    expect(new Set(data.rows.map((r) => r.app)).size).toBe(3);
    expect(data.rows.length).toBeGreaterThan(100);
    for (const { app, level, event, bucket, count } of data.rows) {
      expect(metric({ level, event, bucket }, app)).not.toBeNull();
      expect(count).toBeGreaterThan(0);
    }
    expect(data.census).toHaveLength(15);
    for (const row of data.census) {
      expect(
        census(
          Object.fromEntries(
            ["generation", ...CENSUS_FIELDS].map((k) => [
              k,
              row[k as keyof typeof row],
            ]),
          ),
          "openzcad",
        ),
      ).not.toBeNull();
    }
  });
  it("filters by app, collection and dates without inventing unsupported metrics", () => {
    for (const app of ["openzcad", "openfea", "openlattice3d"])
      for (const level of ["basic", "optional"]) {
        const data = demoStats({ ...range, app, level, from: range.to }, now);
        expect(data.rows.length).toBeGreaterThan(0);
        expect(
          data.rows.every(
            (r) => r.app === app && r.level === level && r.day === range.to,
          ),
        ).toBe(true);
        expect(data.census.length).toBe(
          app === "openzcad" && level === "optional" ? 1 : 0,
        );
      }
    expect(() => demoStats({ ...range, from: "2026-01-01" }, now)).toThrow();
    expect(() => demoStats({ ...range, app: "unknown" }, now)).toThrow();
  });
  it("has no database, service binding, cron, or public workers.dev endpoint", () => {
    const config = parseConfigFileTextToJson(
      "demo",
      readFileSync("wrangler.demo.jsonc", "utf8"),
    ).config;
    expect(config.name).toBe("glimpse-demo");
    expect(config.routes).toEqual([
      { pattern: "glimpse.esau.app/demo*", zone_name: "esau.app" },
    ]);
    for (const key of [
      "d1_databases",
      "services",
      "kv_namespaces",
      "r2_buckets",
      "triggers",
      "vars",
      "durable_objects",
    ])
      expect(config[key]).toBeUndefined();
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.assets.run_worker_first).toBe(true);
  });
  it("serves only demo entry/assets, strips credentials, and blocks browser API access", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(new URL(request.url).pathname),
    );
    const env = { ASSETS: { fetch } } as unknown as Pick<Env, "ASSETS">;
    for (const path of [
      "/demo",
      "/demo/",
      "/demo/assets/index-test.js",
      "/demo/brand/mark.svg",
    ]) {
      const response = await demoWorker.fetch(
        new Request(`https://glimpse.esau.app${path}`, {
          headers: {
            Cookie: "private-session",
            "Cf-Access-Jwt-Assertion": "private-jwt",
          },
        }),
        env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "connect-src 'none'",
      );
      const forwarded = fetch.mock.calls.at(-1)![0];
      expect(forwarded.headers.get("Cookie")).toBeNull();
      expect(forwarded.headers.get("Cf-Access-Jwt-Assertion")).toBeNull();
      expect(await response.text()).toBe(
        path === "/demo" || path === "/demo/" ? "/index.html" : path.slice(5),
      );
    }
    fetch.mockClear();
    for (const path of [
      "/",
      "/api/stats",
      "/demo/api/stats",
      "/demo/api/ingest",
      "/demolition",
      "/demo/private",
      "/demo/%2e%2e/api/stats",
      "/demo//api/stats",
    ])
      expect(
        (
          await demoWorker.fetch(
            new Request(`https://glimpse.esau.app${path}`),
            env,
          )
        ).status,
      ).toBe(404);
    expect(
      (
        await demoWorker.fetch(
          new Request("https://glimpse.esau.app/demo", { method: "POST" }),
          env,
        )
      ).status,
    ).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
});
