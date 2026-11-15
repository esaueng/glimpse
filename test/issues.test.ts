import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { applyMigrations, MIGRATION_FILES } from "./d1-migrations";
import { cloudflareIssues } from "../src/sources/model";
import { frames, scrub, shape } from "../src/sources/scrub";

describe("scrub", () => {
  it("removes identifying values and keeps the explanation", () => {
    expect(
      scrub(
        "TypeError at https://api.example.com/v1/users/42?token=abc#x for jane@example.com from 203.0.113.9 id 3f2a9c1e-1b2c-4d5e-8f90-123456789abc",
      ),
    ).toBe("TypeError at https://api.example.com/v1/users/42 for [email] from [ip] id [id]");
    // Assembled at runtime so the secret scanner does not flag a fake token in the source.
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijklmnop"].join(".");
    expect(scrub(`Authorization: Bearer ${jwt}`)).toBe("Authorization: [secret]");
    expect(scrub("password=hunter2 failed")).toBe("[secret] failed");
    // Compressed IPv6, without touching frames, times, C++ scopes or plain colons.
    expect(scrub("Failure from 2001:db8::1234, fe80::1%eth0 and ::1")).toBe("Failure from [ip], [ip] and [ip]");
    expect(scrub("TypeError: x at index.ts:22:5 at 12:30:45 in Foo::bar, a : b")).toBe(
      "TypeError: x at index.ts:22:5 at 12:30:45 in Foo::bar, a : b",
    );
    expect(scrub("word ".repeat(100), 20)).toHaveLength(20);
    expect(scrub("  ")).toBeNull();
    expect(scrub({})).toBeNull();
  });
  it("keeps only stack frames, with file names and no query strings", () => {
    expect(
      frames(
        "Error: user jane@example.com not found\n    at handler (src/routes/users.ts:12:5)\n    at https://x.example/worker.js?v=2:40:1\nsecret line",
      ),
    ).toEqual(["handler (users.ts:12:5)", "worker.js:40:1"]);
  });
  it("describes a payload by key paths only", () => {
    expect(shape({ data: { issue: { id: "secret-value", tags: ["a"] } }, ts: 1 })).toEqual([
      "data",
      "data.issue",
      "data.issue.id",
      "data.issue.tags",
      "ts",
    ]);
  });
});

describe("Cloudflare Workers Issues adapter", () => {
  it("recognises the Save and Test message", () => {
    expect(
      cloudflareIssues.parse({
        text: "Hello World! This is a test message sent from https://cloudflare.com. If you can see this, your webhook is configured properly.",
      }),
    ).toEqual({ kind: "test" });
  });
  it("classifies vulnerability scans as security with the reported risk", () => {
    const parsed = cloudflareIssues.parse({
      name: "Issues",
      text: "Potential vulnerability scan · wordpress · low risk",
      data: { script_name: "openzcad", occurrences: 48 },
      ts: 1794700000,
    });
    expect(parsed.kind).toBe("events");
    const [event] = parsed.kind === "events" ? parsed.events : [];
    expect(event).toMatchObject({
      title: "Potential vulnerability scan · wordpress · low risk",
      category: "security",
      severity: "info",
      service: "openzcad",
      occurrences: 48,
      fingerprint: "title:openzcad:potential vulnerability scan · wordpress · low risk",
      resolved: false,
    });
  });
  it("uses an issue id, error type and scrubbed stack when present", () => {
    const parsed = cloudflareIssues.parse({
      alert_type: "workers_observability_alert",
      alert_correlation_id: "per-delivery",
      data: {
        issue: {
          id: "abc123",
          title: "TypeError: Cannot read properties of undefined (reading 'name')",
          script_name: "openfea-api",
          error_type: "TypeError",
          stack: "TypeError: x\n    at load (src/a.ts:1:2)",
          url: "https://dash.cloudflare.com/acct/workers/services/view/openfea-api/production/issues/abc123?tab=1",
        },
      },
    });
    const [event] = parsed.kind === "events" ? parsed.events : [];
    expect(event).toMatchObject({
      fingerprint: "id:abc123",
      category: "error",
      severity: "warning",
      service: "openfea-api",
      url: "https://dash.cloudflare.com/acct/workers/services/view/openfea-api/production/issues/abc123",
      detail: { errorType: "TypeError", frames: ["load (a.ts:1:2)"] },
    });
  });
  it("marks alert end events as resolved and rejects payloads without a title", () => {
    const parsed = cloudflareIssues.parse({
      alert_event: "ALERT_STATE_EVENT_END",
      data: { episode: { id: "ep1", summary: "Error rate above 5%" } },
    });
    expect(parsed.kind === "events" && parsed.events[0]!.resolved).toBe(true);
    expect(cloudflareIssues.parse({ data: {} })).toEqual({ kind: "unrecognised" });
    expect(cloudflareIssues.parse([])).toEqual({ kind: "unrecognised" });
  });
});

describe("webhook and inbox service", () => {
  let mf: Miniflare, token: string;
  const origin = "https://glimpse.test";
  const issuer = "https://test.cloudflareaccess.com";
  type Init = { method?: string; body?: string; headers?: Record<string, string> };
  const api = (path: string, init: Init = {}) =>
    mf.dispatchFetch(`${origin}${path}`, {
      ...init,
      headers: {
        "Cf-Access-Jwt-Assertion": token,
        Origin: origin,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  const deliver = (id: string, secret: string | null, body: unknown) =>
    mf.dispatchFetch(`${origin}/hooks/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "cf-webhook-auth": secret }) },
      body: JSON.stringify(body),
    });
  const scan = (occurrences: number, extra: Record<string, unknown> = {}) => ({
    name: "Issues",
    text: "Potential vulnerability scan · secret-files · low risk",
    data: { script_name: "openzcad", occurrences, ...extra },
    ts: Math.floor(Date.now() / 1000),
  });

  beforeAll(async () => {
    const keys = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" };
    token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience("dashboard")
      .setSubject("test")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(keys.privateKey);
    const bundle = await build({
      entryPoints: ["src/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      external: ["cloudflare:workers"],
    });
    const worker = (name: string, db: string) => ({
      name,
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: db },
      bindings: { ACCESS_ISSUER: issuer, ACCESS_AUD: "dashboard" },
      serviceBindings: { ASSETS: () => new Response("<h1>Glimpse</h1>") },
      outboundService: () =>
        new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } }),
    });
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [worker("glimpse", "db"), worker("pending", "pending-db")] }));
    await applyMigrations(await mf.getD1Database("DB", "glimpse"));
    await applyMigrations(
      await mf.getD1Database("DB", "pending"),
      MIGRATION_FILES.filter((f) => f !== "0006_issues.sql"),
    );
  }, 30000);
  afterAll(() => mf?.dispose());

  it("keeps the inbox API behind Access", async () => {
    const res = await mf.dispatchFetch(`${origin}/api/issues`);
    expect(res.status).toBe(401);
  });

  it("creates a source, authenticates deliveries and groups repeats", async () => {
    const created = await api("/api/sources", {
      method: "POST",
      body: JSON.stringify({ kind: "cloudflare-issues", name: "Workers Issues" }),
    });
    expect(created.status).toBe(201);
    const { id, secret, url, header } = (await created.json()) as Record<string, string>;
    expect(url).toBe(`${origin}/hooks/${id}`);
    expect(header).toBe("cf-webhook-auth");

    // No Access token is needed, but the secret is.
    expect((await deliver(id, null, scan(1))).status).toBe(401);
    expect((await deliver(id, "wrong", scan(1))).status).toBe(401);
    expect((await deliver("src_unknown000", secret, scan(1))).status).toBe(401);
    expect((await deliver(id, secret, scan(12))).status).toBe(202);
    expect((await deliver(id, secret, scan(30))).status).toBe(202);

    const list = (await (await api("/api/issues")).json()) as {
      issues: { id: string; app: string; occurrences: number; deliveries: number; status: string; category: string }[];
      counts: Record<string, number>;
    };
    expect(list.issues).toHaveLength(1);
    expect(list.issues[0]).toMatchObject({ app: "openzcad", occurrences: 30, deliveries: 2, status: "open", category: "security" });
    expect(list.counts).toEqual({ open: 1, acknowledged: 0, resolved: 0, ignored: 0 });

    const sources = (await (await api("/api/sources")).json()) as { sources: Record<string, unknown>[] };
    expect(sources.sources[0]).toMatchObject({ id, received: 2, rejected: 2, last_status: "ok: 1 issue" });
    expect(JSON.stringify(sources)).not.toContain(secret);
    expect(sources.sources[0]).not.toHaveProperty("secret_hash");
  });

  it("reopens resolved issues on a new occurrence but keeps ignored ones ignored", async () => {
    const { id: source, secret } = (await (
      await api("/api/sources", { method: "POST", body: JSON.stringify({ kind: "cloudflare-issues", name: "Second" }) })
    ).json()) as Record<string, string>;
    await deliver(source, secret, { text: "Crash", data: { issue: { id: "i1", script_name: "openfea" } } });
    const issue = ((await (await api("/api/issues?app=openfea")).json()) as { issues: { id: string }[] }).issues[0]!;

    expect(
      (await api(`/api/issues/${issue.id}`, { method: "POST", body: JSON.stringify({ status: "resolved", note: "Fixed in #40" }) }))
        .status,
    ).toBe(204);
    await deliver(source, secret, { text: "Crash", data: { issue: { id: "i1", script_name: "openfea" } } });
    let detail = (await (await api(`/api/issues/${issue.id}`)).json()) as {
      status: string;
      note: string;
      activity: { kind: string }[];
    };
    expect(detail.status).toBe("open");
    expect(detail.note).toBe("Fixed in #40");
    expect(detail.activity.map((a) => a.kind)).toEqual(["reopened", "resolved by dashboard", "opened"]);

    await api(`/api/issues/${issue.id}`, { method: "POST", body: JSON.stringify({ status: "ignored" }) });
    await deliver(source, secret, { text: "Crash", data: { issue: { id: "i1", script_name: "openfea" } } });
    detail = (await (await api(`/api/issues/${issue.id}`)).json()) as typeof detail;
    expect(detail.status).toBe("ignored");
  });

  it("never stores a source's raw issue key", async () => {
    const { id, secret } = (await (
      await api("/api/sources", { method: "POST", body: JSON.stringify({ kind: "cloudflare-issues", name: "Keys" }) })
    ).json()) as Record<string, string>;
    await deliver(id, secret, { text: "Crash", data: { issue: { id: "alice@example.com", script_name: "openlattice3d" } } });
    const body = await (await api("/api/issues?app=openlattice3d")).text();
    expect(body).toContain("Crash");
    expect(body).not.toContain("alice");
  });

  it("ignores replays and stale end events when choosing a status", async () => {
    const { id: source, secret } = (await (
      await api("/api/sources", { method: "POST", body: JSON.stringify({ kind: "cloudflare-issues", name: "Order" }) })
    ).json()) as Record<string, string>;
    const at = (s: number) => Math.floor(Date.now() / 1000) - s;
    const crash = (ts: number, extra: Record<string, unknown> = {}) => ({
      text: "Order crash",
      ts,
      data: { issue: { id: "order-1", script_name: "openzcad", occurrences: 3 } },
      ...extra,
    });
    await deliver(source, secret, crash(at(600)));
    const issue = ((await (await api("/api/issues?category=error&app=openzcad")).json()) as {
      issues: { id: string; title: string }[];
    }).issues.find((i) => i.title === "Order crash")!;
    const status = async () => ((await (await api(`/api/issues/${issue.id}`)).json()) as { status: string }).status;

    // An end event older than the latest occurrence does not resolve it.
    await deliver(source, secret, crash(at(900), { alert_event: "ALERT_STATE_EVENT_END" }));
    expect(await status()).toBe("open");

    await api(`/api/issues/${issue.id}`, { method: "POST", body: '{"status":"resolved"}' });
    // Replaying the same occurrence does not reopen it.
    await deliver(source, secret, crash(at(600)));
    expect(await status()).toBe("resolved");
    // A newer occurrence does.
    await deliver(source, secret, crash(at(0) + 1));
    expect(await status()).toBe("open");
    // A current end event resolves it.
    await deliver(source, secret, crash(at(0) + 2, { alert_event: "ALERT_STATE_EVENT_END" }));
    expect(await status()).toBe("resolved");
  });

  it("validates writes and filters", async () => {
    expect((await api("/api/issues?status=everything")).status).toBe(400);
    expect((await api("/api/issues/iss_0000000000000000", { method: "POST", body: '{"status":"open"}' })).status).toBe(404);
    expect((await api("/api/issues/iss_0000000000000000", { method: "POST", body: '{"status":"gone"}' })).status).toBe(400);
    expect(
      (
        await api("/api/sources", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
          body: JSON.stringify({ kind: "cloudflare-issues", name: "x" }),
        })
      ).status,
    ).toBe(403);
    expect((await api("/api/sources", { method: "POST", body: JSON.stringify({ kind: "nope", name: "x" }) })).status).toBe(400);
  });

  it("keeps the key paths of an unrecognised payload, never its values", async () => {
    const { id, secret } = (await (
      await api("/api/sources", { method: "POST", body: JSON.stringify({ kind: "cloudflare-issues", name: "Third" }) })
    ).json()) as Record<string, string>;
    expect((await deliver(id, secret, { data: { mystery: "jane@example.com" } })).status).toBe(202);
    const sources = (await (await api("/api/sources")).json()) as { sources: { id: string; shape: string; last_status: string }[] };
    const row = sources.sources.find((s) => s.id === id)!;
    expect(row.last_status).toBe("unrecognised payload");
    expect(JSON.parse(row.shape)).toEqual(["data", "data.mystery"]);
    expect(row.shape).not.toContain("jane");
  });

  it("rotates and deletes sources", async () => {
    const { id, secret } = (await (
      await api("/api/sources", { method: "POST", body: JSON.stringify({ kind: "cloudflare-issues", name: "Rotate" }) })
    ).json()) as Record<string, string>;
    const rotated = (await (await api(`/api/sources/${id}`, { method: "POST", body: '{"action":"rotate"}' })).json()) as {
      secret: string;
    };
    expect(rotated.secret).not.toBe(secret);
    expect((await deliver(id, secret, scan(1))).status).toBe(401);
    expect((await deliver(id, rotated.secret, scan(1))).status).toBe(202);
    expect((await api(`/api/sources/${id}`, { method: "POST", body: '{"action":"delete"}' })).status).toBe(204);
    expect((await deliver(id, rotated.secret, scan(1))).status).toBe(401);
  });

  it("answers 503 until migration 0006 is applied", async () => {
    // getWorker's typings describe a Request-like object; at runtime it is a Fetcher.
    const pending = (await mf.getWorker("pending")) as unknown as {
      fetch(url: string, init?: Init): Promise<Response>;
    };
    expect((await pending.fetch(`${origin}/hooks/src_abcdefgh`, { method: "POST", body: "{}" })).status).toBe(503);
    const res = await pending.fetch(`${origin}/api/issues`, { headers: { "Cf-Access-Jwt-Assertion": token } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { missingMigrations: string[] }).missingMigrations).toEqual(["0006_issues.sql"]);
  });
});
