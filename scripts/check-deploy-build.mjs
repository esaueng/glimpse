import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// dist is generated and ignored. Prove deployment works without a prior Vite build.
await rm(resolve(root, 'dist'), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Wrangler must build assets before validating deployment');
const html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)];
assert(assets.some((match) => match[1].endsWith('.js')), 'Built dashboard script is missing');
assert(assets.some((match) => match[1].endsWith('.css')), 'Built dashboard stylesheet is missing');
for (const [, asset] of assets) await access(resolve(root, 'dist', `.${asset}`));
console.log('PASS: clean Wrangler dry-run generated the dashboard and its referenced assets.');
