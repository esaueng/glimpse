import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { applyMigrations } from "./d1-migrations";
import {
  allocate,
  alerts,
  billingPeriods,
  emptyData,
  forecast,
  money,
  normalizeCharges,
  validRange,
  type Charge,
  type CloudflareData,
} from "../src/cloudflare/model";
import {
  CloudflareClient,
  datasets,
  graphqlFailure,
  usageRows,
} from "../src/cloudflare/client";
import { COLLECT_CRON, RETENTION_CRON } from "../src/schedule";
import { cloudflareDemo } from "../web/cloudflare-demo";
const now = new Date("2026-10-24T12:00:00Z");
const period = {
  start: "2026-09-28T00:00:00.000Z",
  end: "2026-10-28T00:00:00.000Z",
};
const billingRow = {
  SubscriptionId: "sample-sub",
  BillingPeriodStart: period.start,
  ChargePeriodStart: "2026-10-23T00:00:00Z",
  ChargePeriodEnd: "2026-10-24T00:00:00Z",
  ServiceFamilyName: "D1",
  ServiceName: "D1 Rows Written",
  ChargeDescription: "D1 Rows Written",
  ConsumedUnit: "rows",
  ConsumedQuantity: 100,
  ContractedCost: 1.5,
  CumulatedContractedCost: 999,
  BillingCurrency: "USD",
};
describe("Cloudflare billing semantics", () => {
  it("uses the subscription anchor and clamps short months", () => {
    expect(
      billingPeriods(
        {
          subscriptions: [
            { billing_cycle_anchor_timestamp: "2026-02-28T00:00:00Z" },
          ],
        },
        now,
      ),
    ).toEqual([period]);
    expect(
      billingPeriods(
        {
          subscriptions: [
            { billing_cycle_anchor_timestamp: "2026-01-31T00:00:00Z" },
          ],
        },
        new Date("2026-02-28T12:00:00Z"),
      ),
    ).toEqual([
      { start: "2026-02-28T00:00:00.000Z", end: "2026-03-31T00:00:00.000Z" },
    ]);
  });
  it("replaces corrected charge identities and ignores cumulative amounts", async () => {
    const [first] = await normalizeCharges([billingRow], [period]);
    const [corrected] = await normalizeCharges(
      [{ ...billingRow, ContractedCost: 2, ConsumedQuantity: 150 }],
      [period],
    );
    expect(first!.cost).toBe(1500000);
    expect(corrected!.cost).toBe(2000000);
    expect(first!.id).toBe(corrected!.id);
    expect(first!.periodEnd).toBe(period.end);
    await expect(
      normalizeCharges(
        [{ ...billingRow, ContractedCost: undefined }],
        [period],
      ),
    ).rejects.toThrow();
    await expect(
      normalizeCharges(
        [{ ...billingRow, BillingCurrency: undefined }],
        [period],
      ),
    ).rejects.toThrow();
  });
  it("allocates account charges once, retains shared and unsupported costs, and preserves integer totals", async () => {
    const charges = await normalizeCharges(
      [
        billingRow,
        {
          ...billingRow,
          ServiceName: "R2 Storage",
          ServiceFamilyName: "R2",
          ChargeDescription: "R2 Storage",
          ContractedCost: 0.33,
        },
      ],
      [period],
    );
    const usage = [
      {
        day: "2026-10-23",
        resource: "D1:a",
        metric: "rowsWritten",
        value: 75,
        unit: "rows",
        aggregation: "sum" as const,
      },
      {
        day: "2026-10-23",
        resource: "D1:b",
        metric: "rowsWritten",
        value: 25,
        unit: "rows",
        aggregation: "sum" as const,
      },
    ];
    const resources = [
      {
        id: "D1:a",
        nativeId: "a",
        name: "A",
        kind: "D1" as const,
        app: "app-a",
        active: true,
      },
      {
        id: "D1:b",
        nativeId: "b",
        name: "B",
        kind: "D1" as const,
        app: "shared",
        active: true,
      },
    ];
    const allocated = allocate(charges, usage, resources);
    expect(allocated.get("app-a")).toBe(1125000);
    expect(allocated.get("shared")).toBe(375000);
    expect(allocated.get("unassigned")).toBe(330000);
    expect([...allocated.values()].reduce((a, b) => a + b, 0)).toBe(1830000);
    expect(allocate(charges, [], resources).get("unassigned")).toBe(1830000);
  });
  it("does not forecast from insufficient data and validates actual date ranges", () => {
    expect(forecast([], period, now)).toBeNull();
    const charge = {
      ...billingRow,
      start: "2026-09-28T00:00:00Z",
      end: "2026-09-29T00:00:00Z",
      periodStart: period.start,
      cost: 1e6,
    } as unknown as Charge;
    expect(forecast([charge], period, now)).toBeNull();
    expect(validRange("2026-02-30", "2026-03-01", now)).toBe(false);
    expect(validRange("2026-10-01", "2026-10-24", now)).toBe(true);
  });
  it("retains account-level R2 operations when no bucket dimension exists", () => {
    const dataset = datasets.find(
      (d) => d.name === "r2OperationsAdaptiveGroups",
    )!;
    expect(
      usageRows(
        dataset,
        [{ dimensions: { bucketName: "" }, sum: { requests: 6 } }],
        "2026-10-24",
      )[0],
    ).toMatchObject({ resource: "R2:@account", value: 6 });
  });
  it("preserves correction signs and tiny currency amounts across many apps", async () => {
    const [charge] = await normalizeCharges(
      [{ ...billingRow, ContractedCost: 0.000007 }],
      [period],
    );
    const resources = Array.from({ length: 12 }, (_, i) => ({
      id: `D1:${i}`,
      nativeId: String(i),
      name: String(i),
      kind: "D1" as const,
      app: `app-${i}`,
      active: true,
    }));
    const usage = resources.map((r) => ({
      day: "2026-10-23",
      resource: r.id,
      metric: "rowsWritten",
      value: 1,
      unit: "rows",
      aggregation: "sum" as const,
    }));
    const positive = [...allocate([charge!], usage, resources).values()];
    expect(positive.reduce((a, b) => a + b, 0)).toBe(7);
    expect(positive.every((n) => n >= 0)).toBe(true);
    const [correction] = await normalizeCharges(
      [{ ...billingRow, ContractedCost: -0.000007, ConsumedQuantity: -7 }],
      [period],
    );
    const negative = [...allocate([correction!], usage, resources).values()];
    expect(negative.reduce((a, b) => a + b, 0)).toBe(-7);
    expect(negative.every((n) => n <= 0)).toBe(true);
  });
  it("raises budget and stale-source warnings without treating unavailable as zero", () => {
    const data = cloudflareDemo(now);
    data.budget = 1e6;
    data.coverage.push({
      source: "D1 inventory",
      status: "unavailable",
      message: "Permission unavailable.",
      checkedAt: now.toISOString(),
      lastSuccess: null,
    });
    expect(alerts(data, now).some((a) => a.id.startsWith("budget:"))).toBe(
      true,
    );
    expect(
      alerts(data, now).some((a) =>
        a.message.includes("Permission unavailable"),
      ),
    ).toBe(true);
    expect(alerts(emptyData(), now)).toEqual([]);
  });
  it("uses a fixed origin, refuses redirects, reports auth failures, and bounds retries", async () => {
    const transport = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response("", { status: 403 }),
    );
    await expect(
      new CloudflareClient(
        "a".repeat(32),
        "test-token",
        transport,
      ).accountRequest("/billable-usage"),
    ).rejects.toMatchObject({ status: 403 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/billable-usage`,
    );
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
  it("uses the provider's Pages and subscription pagination limits", async () => {
    const transport = vi.fn(async (_url: RequestInfo | URL) =>
      Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      }),
    );
    const client = new CloudflareClient(
      "a".repeat(32),
      "test-token",
      transport,
    );
    await client.list("/pages/projects");
    await client.list("/subscriptions");
    expect(String(transport.mock.calls[0]![0])).toContain("per_page=10");
    expect(String(transport.mock.calls[1]![0])).toContain("per_page=50");
  });
  it("uses the native Workers fetch implementation and withholds redirects", async () => {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import {CloudflareClient} from './src/cloudflare/client';export default {async fetch(){try{await new CloudflareClient('${"a".repeat(32)}','test-only-credential').accountRequest('');return new Response('unexpected');}catch(e){return Response.json({status:e.status});}}};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
    });
    const outbound = vi.fn(
      async (_request: unknown) =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://other.invalid/" },
        }),
    );
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0]!.text,
        compatibilityDate: "2026-10-15",
        compatibilityFlags: ["nodejs_compat"],
        outboundService: outbound,
      }),
    );
    try {
      expect(
        await (await runtime.dispatchFetch("https://local.invalid/")).json(),
      ).toEqual({ status: 302 });
      expect(outbound).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.dispose();
    }
  });
});
let mf: Miniflare;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import worker from './src/index.ts';
    import { collect } from './src/cloudflare/collect';
    import { cloudflareApi } from './src/cloudflare/api';
    import { readData } from './src/cloudflare/store';
    let fail=false, identity='Esau';
    const hooks=[];
    const reply=result=>Response.json({success:true,result});
    const transport=async (url,init)=>{
      const target=new URL(url), path=target.pathname;
      if(target.hostname==='hooks.example.test'){hooks.push(JSON.parse(init.body).text);return new Response('ok');}
      if(path.endsWith('/graphql')) {
        const query=JSON.parse(init.body).query;
        if(fail && query.includes('d1Analytics')) return Response.json({data:null,errors:[{message:'private provider detail: does not have access to the path',extensions:{code:'authz'}}]});
        const name=query.match(/metrics: (\\w+)/)[1];
        const defs={workersInvocationsAdaptive:['scriptName','app-a','sum',{requests:100,errors:1,cpuTimeUs:7000}],d1AnalyticsAdaptiveGroups:['databaseId','sample-db','sum',{rowsRead:200,rowsWritten:100}],d1StorageAdaptiveGroups:['databaseId','sample-db','max',{databaseSizeBytes:2048}],r2OperationsAdaptiveGroups:['bucketName','sample-bucket','sum',{requests:10}],r2StorageAdaptiveGroups:['bucketName','sample-bucket','max',{payloadSize:1024}],kvOperationsAdaptiveGroups:['namespaceId','sample-kv','sum',{requests:2}],durableObjectsInvocationsAdaptiveGroups:['namespaceId','sample-do','sum',{requests:3}],durableObjectsPeriodicGroups:['namespaceId','sample-do','sum',{duration:1000,rowsRead:0,rowsWritten:0}],containersUsageAdaptiveGroups:['applicationId','sample-container','sum',{cpuTimeSec:1,allocatedMemory:100,allocatedDisk:100,txBytes:1}],queueMessageOperationsAdaptiveGroups:['queueId','sample-queue','sum',{billableOperations:5}]};
        const [dimension,id,group,values]=defs[name];
        return Response.json({data:{viewer:{accounts:[{metrics:[{dimensions:{[dimension]:id},[group]:values}]}]}}});
      }
      if(path.endsWith('/settings')) return reply({bindings:[{type:'d1',id:'sample-db'},{type:'plain_text',name:'DO_NOT_STORE',text:'private-config'}]});
      const map={
        '':{name:identity},'/workers/scripts':[{id:'app-a'},{id:'app-b'}],'/pages/projects':[],
        '/d1/database':[{uuid:'sample-db',name:'sample-db'}],'/r2/buckets':{buckets:[{name:'sample-bucket'}]},
        '/storage/kv/namespaces':[{id:'sample-kv',title:'sample-kv'}],'/workers/durable_objects/namespaces':[{id:'sample-do',name:'sample-do',script:'app-a'}],
        '/containers/applications':[{id:'sample-container',name:'app-a-container'}],'/queues':[{queue_id:'sample-queue',queue_name:'app-a-queue'}],
        '/billable-usage/info':{covered:true,subscriptions:[{billing_cycle_anchor_timestamp:'2026-02-28T00:00:00Z'}]},
        '/billable-usage':${JSON.stringify([billingRow])},
        '/subscriptions':[{id:'sample-plan',rate_plan:{public_name:'Sample Plan'},price:5,currency:'USD',frequency:'monthly',current_period_end:'2026-10-28T00:00:00Z'}]
      };
      const suffix=path.replace(/^\\/client\\/v4\\/accounts\\/[a-f0-9]+/,'');
      return reply(map[suffix]);
    };
    export default {async fetch(request,env){
      const url=new URL(request.url), path=url.pathname;
      const at=url.searchParams.get('at')||'2026-10-24T12:00:00Z';
      const target=url.searchParams.has('webhook')?{...env,CF_ALERT_WEBHOOK:'https://hooks.example.test/alerts'}:env;
      if(path==='/_test/collect'){try{await collect(target,new Date(at),transport);}catch(e){return new Response(e.name,{status:500});}return new Response('ok');}
      if(path==='/_test/fail'){fail=url.searchParams.get('on')!=='0';return new Response('ok');}
      if(path==='/_test/identity'){identity=url.searchParams.get('name');return new Response('ok');}
      if(path==='/_test/hooks'){return Response.json(hooks.splice(0));}
      if(path==='/_test/read'){
        const scoped=url.searchParams.has('unconfigured')?{...env,CF_MONITOR_ENABLED:'false'}:env;
        return Response.json(await readData(scoped,{now:new Date(at),limit:Number(url.searchParams.get('limit'))||undefined,since:url.searchParams.get('since')||undefined}));
      }
      if(path==='/_test/cron'){
        // Exercise the real scheduled handler; collection reaches the fake API via global fetch.
        const original=globalThis.fetch;
        globalThis.fetch=transport;
        try{await worker.scheduled({cron:url.searchParams.get('cron')},env);}
        catch(e){return new Response(e.name,{status:500});}
        finally{globalThis.fetch=original;}
        return new Response('ok');
      }
      return cloudflareApi(request,env);
    }};
  `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    external: ["cloudflare:workers"],
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      bindings: {
        CF_MONITOR_ENABLED: "true",
        CF_ACCOUNT_ID: "a".repeat(32),
        CF_API_TOKEN: "test-only-credential",
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  await applyMigrations(db);
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
describe("Cloudflare collection and protected settings persistence", () => {
  it("discovers resources, recognizes shared bindings, and never stores variables", async () => {
    expect(
      (await mf.dispatchFetch("https://example.test/_test/collect")).status,
    ).toBe(200);
    const data = (await (
      await mf.dispatchFetch("https://example.test/api/cloudflare")
    ).json()) as any;
    expect(data.apps.map((a: any) => a.id)).toContain("app-a");
    expect(data.resources.find((r: any) => r.id === "D1:sample-db").app).toBe(
      "shared",
    );
    expect(data.coverage.every((s: any) => s.status === "ok")).toBe(true);
    expect(data.charges).toHaveLength(1);
    expect(data.charges[0].cost).toBe(1500000);
    expect(JSON.stringify(data)).not.toMatch(
      /private-config|test-only-credential|DO_NOT_STORE/,
    );
  });
  it("reconciles charges and daily counters without adding cumulative values", async () => {
    const db = await mf.getD1Database("DB");
    const before = await db
      .prepare(
        "SELECT value FROM cf_usage WHERE day='2026-10-23' AND metric='rowsWritten'",
      )
      .first<any>();
    await mf.dispatchFetch("https://example.test/_test/collect");
    expect(
      await db
        .prepare(
          "SELECT value FROM cf_usage WHERE day='2026-10-23' AND metric='rowsWritten'",
        )
        .first(),
    ).toEqual(before);
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM cf_charges").first<any>()).n,
    ).toBe(1);
  });
  it("requires same-origin bounded JSON, validates app identity, and persists manual mappings", async () => {
    const endpoint = "https://example.test/api/cloudflare/settings";
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"budget":10000000}',
        })
      ).status,
    ).toBe(403);
    const headers = {
      "Content-Type": "application/json",
      Origin: "https://example.test",
    };
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ resource: "D1:sample-db", app: "missing" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ budget: NaN }),
        })
      ).status,
    ).toBe(204); // JSON encodes NaN as null: explicitly clears a budget.
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ budget: -1 }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ resource: "D1:sample-db", app: "app-a" }),
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: " ".repeat(9000),
        })
      ).status,
    ).toBe(413);
    const db = await mf.getD1Database("DB");
    // Exercise daily rediscovery rather than only the hourly usage refresh.
    await db.prepare("DELETE FROM cf_state WHERE key='discovered'").run();
    await mf.dispatchFetch("https://example.test/_test/collect");
    expect(
      await db
        .prepare("SELECT app,manual FROM cf_resources WHERE id='D1:sample-db'")
        .first<any>(),
    ).toEqual({ app: "app-a", manual: 1 });
  });
  it("retains last successful usage on schema/permission failures and redacts provider details", async () => {
    const db = await mf.getD1Database("DB");
    const before = await db
      .prepare(
        "SELECT value FROM cf_usage WHERE day='2026-10-23' AND metric='rowsWritten'",
      )
      .first();
    await mf.dispatchFetch("https://example.test/_test/fail");
    await mf.dispatchFetch("https://example.test/_test/collect");
    expect(
      await db
        .prepare(
          "SELECT value FROM cf_usage WHERE day='2026-10-23' AND metric='rowsWritten'",
        )
        .first(),
    ).toEqual(before);
    const data = (await (
      await mf.dispatchFetch("https://example.test/api/cloudflare")
    ).json()) as any;
    expect(
      data.coverage.some(
        (c: any) => c.status === "unsupported" && c.lastSuccess,
      ),
    ).toBe(true);
    expect(JSON.stringify(data)).not.toContain("private provider detail");
  });
});

describe("Cloudflare monitor robustness", () => {
  it("formats an invalid currency code as a plain number instead of throwing", () => {
    expect(() => money(1500000, "bogus")).not.toThrow();
    expect(money(1500000, "bogus")).toMatch(/1[.,]50 bogus$/);
    expect(money(1500000, "x".repeat(500)).length).toBeLessThan(40);
    expect(money(1500000, "USD")).toContain("1.50");
  });
  it("does not alert on unsupported datasets but still alerts on unavailable sources", () => {
    const data: CloudflareData = {
      ...emptyData(true, now),
      coverage: [
        {
          source: "D1 usage · d1AnalyticsAdaptiveGroups",
          status: "unsupported",
          message: "Analytics dataset unavailable for this connection.",
          checkedAt: now.toISOString(),
          lastSuccess: null,
        },
        {
          source: "Esau connection",
          status: "unavailable",
          message: "Permission unavailable or token expired.",
          checkedAt: now.toISOString(),
          lastSuccess: null,
        },
      ],
    };
    expect(alerts(data, now).map((a) => a.message)).toEqual([
      "Esau connection: Permission unavailable or token expired.",
    ]);
  });
  it("allocates multi-day charges from indexed usage within the charge window", async () => {
    const [charge] = await normalizeCharges(
      [
        {
          ...billingRow,
          ChargePeriodStart: "2026-10-20T00:00:00Z",
          ChargePeriodEnd: "2026-10-23T00:00:00Z",
          ContractedCost: 3,
        },
      ],
      [period],
    );
    const row = (day: string, resource: string, value: number) => ({
      day,
      resource,
      metric: "rowsWritten",
      value,
      unit: "rows",
      aggregation: "sum" as const,
    });
    const usage = [
      row("2026-10-20", "D1:a", 1),
      row("2026-10-21", "D1:b", 1),
      row("2026-10-22", "D1:b", 1),
      row("2026-10-23", "D1:a", 1000), // Outside the half-open charge window.
    ];
    const resources = ["a", "b"].map((id) => ({
      id: `D1:${id}`,
      nativeId: id,
      name: id,
      kind: "D1" as const,
      app: `app-${id}`,
      active: true,
    }));
    const allocated = allocate([charge!], usage, resources);
    expect(allocated.get("app-a")).toBe(1000000);
    expect(allocated.get("app-b")).toBe(2000000);
    // Scale: thousands of charges against tens of thousands of usage rows stays fast.
    const many = Array.from({ length: 3000 }, () => charge!);
    const big = Array.from({ length: 40000 }, (_, i) =>
      row(
        `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
        `D1:${i % 2 ? "a" : "b"}`,
        1,
      ),
    );
    const started = performance.now();
    allocate(many, big, resources);
    expect(performance.now() - started).toBeLessThan(2000);
  });
  it("classifies only schema and entitlement GraphQL errors as unsupported", () => {
    expect(
      graphqlFailure([
        {
          message: "does not have access to the path",
          extensions: { code: "authz" },
        },
      ]),
    ).toBe("unsupported");
    expect(graphqlFailure([{ message: 'unknown field "fooGroups"' }])).toBe(
      "unsupported",
    );
    expect(
      graphqlFailure([
        { message: "rate limiter budget depleted, try again after 5 minutes" },
      ]),
    ).toBe("transient");
    expect(graphqlFailure([{ message: "something unexpected" }])).toBe(
      "failed",
    );
    expect(graphqlFailure([])).toBe("failed");
  });
  it("retries transient network errors and rate-limited GraphQL responses within the bounded policy", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      if (++calls < 3) throw new TypeError("network");
      return Response.json({ success: true, result: { name: "Esau" } });
    });
    const client = new CloudflareClient("a".repeat(32), "test-token", flaky);
    await expect(client.accountRequest("")).resolves.toMatchObject({
      result: { name: "Esau" },
    });
    expect(flaky).toHaveBeenCalledTimes(3);
    const down = vi.fn(async (): Promise<Response> => {
      throw new TypeError("network");
    });
    await expect(
      new CloudflareClient("a".repeat(32), "test-token", down).accountRequest(
        "",
      ),
    ).rejects.toMatchObject({ status: 0 });
    expect(down).toHaveBeenCalledTimes(3);
    const limited = vi.fn(async () =>
      Response.json({ errors: [{ message: "rate limit exceeded" }] }),
    );
    await expect(
      new CloudflareClient("a".repeat(32), "test-token", limited).graphql(
        "metrics: x",
        "2026-10-24",
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(limited).toHaveBeenCalledTimes(3);
  }, 15000);
});
describe("Cloudflare collection resilience", () => {
  const state = async (key: string) => {
    const db = await mf.getD1Database("DB");
    const row = await db
      .prepare("SELECT value FROM cf_state WHERE key=?")
      .bind(key)
      .first<{ value: string }>();
    return row ? JSON.parse(row.value) : null;
  };
  it("keeps backfilling past an unsupported dataset and sends no alert for it", async () => {
    // The previous suite left the D1 analytics dataset failing as unsupported.
    const unsupported = "backfillAge:d1AnalyticsAdaptiveGroups";
    const before = await state(unsupported);
    const other = await state("backfillAge:workersInvocationsAdaptive");
    expect(
      await (
        await mf.dispatchFetch("https://example.test/_test/collect?webhook=1")
      ).text(),
    ).toBe("ok");
    expect(await state(unsupported)).toBe(before + 1);
    expect(await state("backfillAge:workersInvocationsAdaptive")).toBe(
      other + 1,
    );
    expect(
      await (await mf.dispatchFetch("https://example.test/_test/hooks")).json(),
    ).toEqual([]);
    await mf.dispatchFetch("https://example.test/_test/fail?on=0");
  });
  it("still retains and alerts when the account identity check fails", async () => {
    const db = await mf.getD1Database("DB");
    await db
      .prepare(
        "INSERT INTO cf_usage(day,resource,metric,value,unit,aggregation) VALUES('2025-01-01','D1:sample-db','rowsRead',1,'rows','sum')",
      )
      .run();
    const collected = await state("lastCollected");
    await mf.dispatchFetch("https://example.test/_test/identity?name=Other");
    expect(
      await (
        await mf.dispatchFetch(
          "https://example.test/_test/collect?webhook=1&at=2026-10-24T13:00:00Z",
        )
      ).text(),
    ).toBe("ok");
    await mf.dispatchFetch("https://example.test/_test/identity?name=Esau");
    const hooks = (await (
      await mf.dispatchFetch("https://example.test/_test/hooks")
    ).json()) as string[];
    expect(hooks).toEqual([
      "Glimpse · Esau connection: Collection failed; previous results retained.",
    ]);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM cf_usage WHERE day='2025-01-01'")
        .first(),
    ).toEqual({ n: 0 });
    expect(await state("lastCollected")).toBe(collected);
  });
  it("scopes and bounds monitor reads without failing the response", async () => {
    const full = (await (
      await mf.dispatchFetch("https://example.test/_test/read")
    ).json()) as CloudflareData;
    expect(full.usage.length).toBeGreaterThan(1);
    expect(full.periods.length).toBeGreaterThan(0);
    const recent = (await (
      await mf.dispatchFetch("https://example.test/_test/read?since=2026-10-24")
    ).json()) as CloudflareData;
    expect(recent.usage.length).toBeGreaterThan(0);
    expect(recent.usage.every((u) => u.day >= "2026-10-24")).toBe(true);
    expect(recent.periods).toEqual(full.periods);
    const bounded = (await (
      await mf.dispatchFetch("https://example.test/_test/read?limit=12")
    ).json()) as CloudflareData;
    expect(bounded.usage.length).toBeLessThanOrEqual(12);
    expect(
      bounded.coverage.find((c) => c.source === "Usage history"),
    ).toMatchObject({ status: "unavailable" });
    expect(
      (await mf.dispatchFetch("https://example.test/api/cloudflare?from=bogus"))
        .status,
    ).toBe(400);
    expect(
      (
        await mf.dispatchFetch(
          "https://example.test/api/cloudflare?from=2026-10-24",
        )
      ).status,
    ).toBe(200);
  });
  it("dispatches the hourly cron to collection and the daily cron to retention with a heartbeat", async () => {
    const started = new Date().toISOString();
    const db = await mf.getD1Database("DB");
    expect(
      await (
        await mf.dispatchFetch(
          `https://example.test/_test/cron?cron=${encodeURIComponent(COLLECT_CRON)}`,
        )
      ).text(),
    ).toBe("ok");
    expect((await state("lastCollected")) >= started).toBe(true);
    const expired = new Date(Date.now() - 90 * 86400000)
      .toISOString()
      .slice(0, 10);
    await db
      .prepare("INSERT INTO daily_counts VALUES(?,?,?,?,?,?)")
      .bind(expired, "openfea", "basic", "api_request", "none", 3)
      .run();
    expect(
      await (
        await mf.dispatchFetch(
          `https://example.test/_test/cron?cron=${encodeURIComponent(RETENTION_CRON)}`,
        )
      ).text(),
    ).toBe("ok");
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM daily_counts WHERE day=?")
        .bind(expired)
        .first(),
    ).toEqual({ n: 0 });
    const data = (await (
      await mf.dispatchFetch("https://example.test/api/cloudflare")
    ).json()) as CloudflareData;
    const heartbeat = data.coverage.find(
      (c) => c.source === "Analytics retention",
    );
    expect(heartbeat).toMatchObject({ status: "ok" });
    expect(heartbeat!.lastSuccess! >= started).toBe(true);
    // The heartbeat is readable even when the monitor itself is disabled.
    const disabled = (await (
      await mf.dispatchFetch("https://example.test/_test/read?unconfigured=1")
    ).json()) as CloudflareData;
    expect(disabled.configured).toBe(false);
    expect(disabled.coverage.map((c) => c.source)).toEqual([
      "Analytics retention",
    ]);
  });
});
