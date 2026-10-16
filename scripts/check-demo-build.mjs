import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await rm(resolve(root, "dist-demo"), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules/wrangler/bin/wrangler.js"),
    "deploy",
    "--config",
    "wrangler.demo.jsonc",
    "--dry-run",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
if (result.error) throw result.error;
assert.equal(
  result.status,
  0,
  "Demo Wrangler dry-run must build isolated assets",
);
const html = await readFile(resolve(root, "dist-demo/index.html"), "utf8");
assert(html.includes("Glimpse · Public demo"));
const assets = [...html.matchAll(/(?:src|href)="(\/demo\/[^"?#]+)"/g)];
assert(assets.some(([, asset]) => asset.endsWith(".js")));
assert(assets.some(([, asset]) => asset.endsWith(".css")));
for (const [, asset] of assets) {
  const file = resolve(root, "dist-demo", asset.slice("/demo/".length));
  await access(file);
  if (asset.endsWith(".js")) {
    const source = await readFile(file, "utf8");
    assert(
      !source.includes("/api/stats"),
      "Demo must never bundle the production API loader",
    );
    assert(
      source.includes("workspace_opened"),
      "Demo must bundle synthetic metrics",
    );
    assert(
      source.includes("All numbers are made up."),
      "Demo must be clearly labeled",
    );
  }
}
console.log(
  "PASS: isolated demo builds from clean output without the production API loader.",
);
