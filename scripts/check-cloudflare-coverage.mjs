// Read-only check. Supply credentials through the environment, never arguments.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const account = process.env.CF_ACCOUNT_ID,
  token = process.env.CF_API_TOKEN;
if (!/^[a-f0-9]{32}$/.test(account ?? "") || !token) {
  console.error(
    "Provide CF_ACCOUNT_ID and CF_API_TOKEN through a private environment file or environment variables.",
  );
  process.exit(1);
}
const directory = await mkdtemp(join(tmpdir(), "glimpse-coverage-"));
let failed = false;
try {
  const module = join(directory, "client.mjs");
  await build({
    entryPoints: ["src/cloudflare/client.ts"],
    outfile: module,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const {
    CloudflareClient,
    inventories,
    datasets,
    analyticsSelection,
    usageRows,
  } = await import(pathToFileURL(module).href);
  const client = new CloudflareClient(account, token);
  const identity = await client.accountRequest("");
  if (identity.result?.name !== "Esau")
    throw new Error("This check only supports the Esau account.");
  async function check(source, run) {
    try {
      console.log(JSON.stringify({ source, status: "ok", ...(await run()) }));
    } catch (e) {
      failed = true;
      console.log(
        JSON.stringify({
          source,
          status: "unavailable",
          httpStatus: e.status ?? null,
        }),
      );
    }
  }
  await check("Billing coverage", async () => {
    const response = await client.accountRequest("/billable-usage/info");
    if (response.result?.covered !== true) throw new Error("Not covered");
    return { covered: true };
  });
  await check("Billing", async () => {
    const response = await client.accountRequest("/billable-usage");
    if (!Array.isArray(response.result))
      throw new Error("Invalid billing response");
    return { rows: response.result.length };
  });
  await check("Subscriptions", async () => ({
    resources: (await client.list("/subscriptions")).length,
  }));
  for (const d of inventories)
    await check(`${d.kind} inventory`, async () => ({
      resources: (await client.list(d.path, d.nested)).length,
    }));
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  for (const d of datasets)
    await check(d.name, async () => {
      const rows = await client.graphql(analyticsSelection(d), day);
      usageRows(d, rows, day);
      return { resources: rows.length };
    });
} catch {
  failed = true;
  console.error(
    "Coverage check could not verify the Esau connection. No provider payloads were logged.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
