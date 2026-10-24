import {
  finite,
  resourceKey,
  text,
  type ResourceKind,
  type Usage,
} from "./model";

export class ApiError extends Error {
  constructor(
    public status: number,
    public reason = "Cloudflare API unavailable",
  ) {
    super(reason);
  }
}
export class CloudflareClient {
  constructor(
    readonly account: string,
    private token: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
  ) {
    if (!/^[a-f0-9]{32}$/.test(account) || !token)
      throw new Error("Monitor connection not configured");
  }
  async request(path: string, body?: unknown): Promise<any> {
    // Fixed provider origin; no endpoint, account or credentials accepted from the browser.
    const url = `https://api.cloudflare.com/client/v4${path}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.transport(url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15000),
          redirect: "manual",
        });
      } catch {
        throw new ApiError(0);
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        const delay = Math.min(
          5000,
          Math.max(
            250,
            Number(response.headers.get("Retry-After")) * 1000 ||
              500 * 2 ** attempt,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(response.status);
      }
      let json: any;
      try {
        json = await response.json();
      } catch {
        throw new ApiError(502, "Invalid Cloudflare response");
      }
      if (json.success === false) throw new ApiError(502);
      return json;
    }
    throw new ApiError(503);
  }
  async accountRequest(path: string) {
    return this.request(`/accounts/${this.account}${path}`);
  }
  async list(path: string, nested?: string): Promise<any[]> {
    const all: any[] = [];
    const perPage = path.startsWith("/pages/")
      ? 10
      : path === "/subscriptions"
        ? 50
        : 100;
    let cursor: string | undefined;
    for (let page = 1; page <= 25; page++) {
      const json = await this.accountRequest(
        `${path}${path.includes("?") ? "&" : "?"}${cursor ? `cursor=${encodeURIComponent(cursor)}` : `page=${page}`}&per_page=${perPage}`,
      );
      const rows = nested ? json.result?.[nested] : json.result;
      if (!Array.isArray(rows))
        throw new ApiError(502, "Invalid resource listing");
      all.push(...rows);
      if (json.result_info && "cursor" in json.result_info) {
        cursor = json.result_info.cursor || undefined;
        if (!cursor) return all;
        continue;
      }
      const pages = json.result_info?.total_pages;
      if (pages ? page >= pages : rows.length < perPage) return all;
    }
    throw new ApiError(413, "Resource listing exceeds collection limit");
  }
  async graphql(selection: string, day: string) {
    const next = new Date(Date.parse(day) + 86400000).toISOString();
    const json = await this.request("/graphql", {
      query: `query { viewer { accounts(filter: { accountTag: "${this.account}" }) { ${selection.replaceAll("$start", JSON.stringify(`${day}T00:00:00Z`)).replaceAll("$end", JSON.stringify(next))} } } }`,
    });
    if (json.errors?.length)
      throw new ApiError(
        422,
        "Analytics dataset unavailable for this connection",
      );
    const rows = json.data?.viewer?.accounts?.[0]?.metrics;
    if (!Array.isArray(rows))
      throw new ApiError(502, "Analytics response missing");
    if (rows.length >= 10000)
      throw new ApiError(
        413,
        "Analytics result truncated; collection withheld",
      );
    return rows;
  }
}
export const inventories: {
  kind: ResourceKind;
  path: string;
  nested?: string;
  id: string;
  name: string;
}[] = [
  { kind: "Workers", path: "/workers/scripts", id: "id", name: "id" },
  { kind: "Pages", path: "/pages/projects", id: "name", name: "name" },
  { kind: "D1", path: "/d1/database", id: "uuid", name: "name" },
  {
    kind: "R2",
    path: "/r2/buckets",
    nested: "buckets",
    id: "name",
    name: "name",
  },
  { kind: "KV", path: "/storage/kv/namespaces", id: "id", name: "title" },
  {
    kind: "Durable Objects",
    path: "/workers/durable_objects/namespaces",
    id: "id",
    name: "name",
  },
  {
    kind: "Containers",
    path: "/containers/applications",
    id: "id",
    name: "name",
  },
  { kind: "Queues", path: "/queues", id: "queue_id", name: "queue_name" },
];
type Field = {
  field: string;
  metric: string;
  unit: string;
  group: "sum" | "max" | "quantiles";
};
export const datasets: {
  name: string;
  kind: ResourceKind;
  dimension: string;
  fields: Field[];
}[] = [
  {
    name: "workersInvocationsAdaptive",
    kind: "Workers",
    dimension: "scriptName",
    fields: [
      {
        field: "requests",
        metric: "workerRequests",
        unit: "requests",
        group: "sum",
      },
      { field: "errors", metric: "workerErrors", unit: "errors", group: "sum" },
      {
        field: "cpuTimeUs",
        metric: "workerCpuUs",
        unit: "microseconds",
        group: "sum",
      },
    ],
  },
  {
    name: "d1AnalyticsAdaptiveGroups",
    kind: "D1",
    dimension: "databaseId",
    fields: [
      { field: "rowsRead", metric: "rowsRead", unit: "rows", group: "sum" },
      {
        field: "rowsWritten",
        metric: "rowsWritten",
        unit: "rows",
        group: "sum",
      },
    ],
  },
  {
    name: "d1StorageAdaptiveGroups",
    kind: "D1",
    dimension: "databaseId",
    fields: [
      {
        field: "databaseSizeBytes",
        metric: "databaseSizeBytes",
        unit: "bytes",
        group: "max",
      },
    ],
  },
  {
    name: "r2OperationsAdaptiveGroups",
    kind: "R2",
    dimension: "bucketName",
    fields: [
      {
        field: "requests",
        metric: "r2Operations",
        unit: "operations",
        group: "sum",
      },
    ],
  },
  {
    name: "r2StorageAdaptiveGroups",
    kind: "R2",
    dimension: "bucketName",
    fields: [
      {
        field: "payloadSize",
        metric: "r2StorageBytes",
        unit: "bytes",
        group: "max",
      },
    ],
  },
  {
    name: "kvOperationsAdaptiveGroups",
    kind: "KV",
    dimension: "namespaceId",
    fields: [
      {
        field: "requests",
        metric: "kvOperations",
        unit: "operations",
        group: "sum",
      },
    ],
  },
  {
    name: "durableObjectsInvocationsAdaptiveGroups",
    kind: "Durable Objects",
    dimension: "namespaceId",
    fields: [
      {
        field: "requests",
        metric: "doRequests",
        unit: "requests",
        group: "sum",
      },
    ],
  },
  {
    name: "durableObjectsPeriodicGroups",
    kind: "Durable Objects",
    dimension: "namespaceId",
    fields: [
      {
        field: "duration",
        metric: "doDuration",
        unit: "GB-seconds",
        group: "sum",
      },
      { field: "rowsRead", metric: "doRowsRead", unit: "rows", group: "sum" },
      {
        field: "rowsWritten",
        metric: "doRowsWritten",
        unit: "rows",
        group: "sum",
      },
    ],
  },
  {
    name: "containersUsageAdaptiveGroups",
    kind: "Containers",
    dimension: "applicationId",
    fields: [
      {
        field: "cpuTimeSec",
        metric: "containerCpuSeconds",
        unit: "seconds",
        group: "sum",
      },
      {
        field: "allocatedMemory",
        metric: "containerMemory",
        unit: "byte-seconds",
        group: "sum",
      },
      {
        field: "allocatedDisk",
        metric: "containerDisk",
        unit: "byte-seconds",
        group: "sum",
      },
      {
        field: "txBytes",
        metric: "containerEgress",
        unit: "bytes",
        group: "sum",
      },
    ],
  },
  {
    name: "queueMessageOperationsAdaptiveGroups",
    kind: "Queues",
    dimension: "queueId",
    fields: [
      {
        field: "billableOperations",
        metric: "queueOperations",
        unit: "operations",
        group: "sum",
      },
    ],
  },
];
export function analyticsSelection(dataset: (typeof datasets)[number]) {
  const groups = [...new Set(dataset.fields.map((f) => f.group))]
    .map(
      (group) =>
        `${group} { ${dataset.fields
          .filter((f) => f.group === group)
          .map((f) => f.field)
          .join(" ")} }`,
    )
    .join(" ");
  return `metrics: ${dataset.name}(limit: 10000, filter: { datetime_geq: $start, datetime_lt: $end }) { dimensions { ${dataset.dimension} } ${groups} }`;
}
export function usageRows(
  dataset: (typeof datasets)[number],
  rows: any[],
  day: string,
): Usage[] {
  return rows.flatMap((row) => {
    if (!row.dimensions || !(dataset.dimension in row.dimensions))
      throw new ApiError(502, "Analytics resource identifier missing");
    // Account-level operations (for example R2 ListBuckets) have no bucket ID.
    const id = text(row.dimensions[dataset.dimension]) || "@account";
    return dataset.fields.map((f) => {
      const value = finite(row[f.group]?.[f.field]);
      if (value === null) throw new ApiError(502, "Analytics metric missing");
      return {
        day,
        resource: resourceKey(dataset.kind, id),
        metric: f.metric,
        value,
        unit: f.unit,
        aggregation: f.group === "quantiles" ? ("quantile" as const) : f.group,
      };
    });
  });
}
