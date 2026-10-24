import {
  DAY,
  emptyData,
  isoDay,
  type CloudflareData,
} from "../src/cloudflare/model";
export function cloudflareDemo(now = new Date()): CloudflareData {
  const current = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const previous = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const data: CloudflareData = {
    ...emptyData(true, now),
    budget: 100e6,
    periods: [
      { start: current.toISOString(), end: end.toISOString() },
      { start: previous.toISOString(), end: current.toISOString() },
    ],
    apps: [
      { id: "openzcad", name: "OpenZCAD", visibility: "public", budget: 50e6 },
      { id: "openfea", name: "OpenFEA", visibility: "public", budget: null },
      {
        id: "openlattice3d",
        name: "OpenLattice3D",
        visibility: "public",
        budget: null,
      },
      {
        id: "sample-status",
        name: "Internal status",
        visibility: "private",
        budget: 10e6,
      },
      {
        id: "shared",
        name: "Shared infrastructure",
        visibility: "unknown",
        budget: null,
      },
      {
        id: "unassigned",
        name: "Unassigned",
        visibility: "unknown",
        budget: null,
      },
    ],
    resources: [],
    usage: [],
    charges: [],
    subscriptions: [
      {
        id: "sample-paid-plan",
        name: "Workers Paid · sample",
        amount: 5e6,
        currency: "USD",
        frequency: "monthly",
        renews: end.toISOString(),
      },
    ],
    coverage: [
      "Billing",
      "Subscriptions",
      "Esau connection",
      "Workers inventory",
      "D1 inventory",
      "R2 inventory",
      "Workers usage · workersInvocationsAdaptive",
    ].map((source) => ({
      source,
      status: "ok",
      message: "Fictional data · no Cloudflare connection",
      checkedAt: now.toISOString(),
      lastSuccess: now.toISOString(),
    })),
  };
  for (const app of data.apps.slice(0, 4)) {
    data.resources.push({
      id: `Workers:${app.id}`,
      nativeId: app.id,
      name: `${app.name} · sample Worker`,
      kind: "Workers",
      app: app.id,
      active: true,
    });
    data.resources.push({
      id: `D1:sample-${app.id}`,
      nativeId: `sample-${app.id}`,
      name: `${app.name} · sample database`,
      kind: "D1",
      app: app.id,
      active: true,
    });
  }
  data.resources.push({
    id: "R2:sample-assets",
    nativeId: "sample-assets",
    name: "Shared assets · sample bucket",
    kind: "R2",
    app: "shared",
    active: true,
  });
  for (let time = previous.getTime(); time <= now.getTime(); time += DAY) {
    const day = isoDay(new Date(time)),
      period = time < current.getTime() ? data.periods[1]! : data.periods[0]!,
      dayEnd = new Date(time + DAY).toISOString();
    let requests = 0,
      writes = 0,
      cpu = 0;
    data.apps.slice(0, 4).forEach((app, i) => {
      const count = Math.round((8000 + ((time / DAY) % 7) * 1300) * (4 - i)),
        writeCount = Math.round(count * 0.08);
      requests += count;
      writes += writeCount;
      cpu += count * 1300;
      for (const [metric, value, unit] of [
        ["workerRequests", count, "requests"],
        ["workerErrors", i + 1, "errors"],
        ["workerCpuUs", count * 1300, "microseconds"],
      ] as const)
        data.usage.push({
          day,
          resource: `Workers:${app.id}`,
          metric,
          value,
          unit,
          aggregation: "sum",
        });
      data.usage.push(
        {
          day,
          resource: `D1:sample-${app.id}`,
          metric: "rowsWritten",
          value: writeCount,
          unit: "rows",
          aggregation: "sum",
        },
        {
          day,
          resource: `D1:sample-${app.id}`,
          metric: "databaseSizeBytes",
          value: (200 + i * 50) * 2 ** 20,
          unit: "bytes",
          aggregation: "max",
        },
      );
    });
    for (const [family, description, quantity, cost] of [
      ["Workers", "Workers Standard requests", requests, 400000],
      ["Workers", "Workers Standard CPU time", cpu, 680000],
      ["D1", "D1 Rows Written", writes, 1200000],
      ["R2", "R2 Storage", 12, 320000],
    ] as const)
      data.charges.push({
        id: `sample-${day}-${description}`,
        subscription: "sample-subscription",
        periodStart: period.start,
        periodEnd: period.end,
        start: `${day}T00:00:00Z`,
        end: dayEnd,
        family,
        description,
        quantity,
        cost,
        currency: "USD",
        unit: "Count",
      });
    data.usage.push({
      day,
      resource: "R2:sample-assets",
      metric: "r2StorageBytes",
      value: 12 * 2 ** 30,
      unit: "bytes",
      aggregation: "max",
    });
  }
  return data;
}
export const loadCloudflareDemo = async (_signal: AbortSignal) =>
  cloudflareDemo();
