// Checks that the committed worker-configuration.d.ts matches what `wrangler types`
// generates from wrangler.jsonc and the installed workerd runtime.
//   node scripts/check-worker-types.mjs          check only (CI, `npm run check:types`)
//   node scripts/check-worker-types.mjs --write  regenerate the committed file (`npm run types`)
// Generation is local: Wrangler builds the types from the config and its bundled workerd,
// without network access or a Cloudflare login. Local secrets files (.dev.vars, .env) and
// process.env are deliberately not read, so the committed file never depends on (or
// leaks the names of) a developer's local secrets.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const committedName = 'worker-configuration.d.ts';
const committedPath = resolve(root, committedName);
const write = process.argv.includes('--write');

// The output must sit beside the committed file: the generated `import("./src/index")`
// path is relative to it.
const outputName = write ? committedName : `.worker-configuration.check-${process.pid}.d.ts`;
const outputPath = resolve(root, outputName);
const scratch = mkdtempSync(join(tmpdir(), 'glimpse-types-'));
const emptyEnvFile = join(scratch, 'empty.env');
writeFileSync(emptyEnvFile, '');

/** Ignores the generating command line (it names the output path) and trailing whitespace. */
function normalize(/** @type {string} */ text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/running `wrangler types[^`]*`/, 'running `wrangler types`')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

let generated;
try {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  delete env.CLOUDFLARE_INCLUDE_PROCESS_ENV;
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
      'types',
      outputName,
      // An explicit, empty env file makes Wrangler skip .dev.vars and .env.
      '--env-file',
      emptyEnvFile,
    ],
    { cwd: root, encoding: 'utf8', env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    console.error(`FAIL: \`wrangler types\` exited with status ${result.status}; see output above.`);
    process.exit(1);
  }
  generated = readFileSync(outputPath, 'utf8');
} finally {
  if (!write) rmSync(outputPath, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}

if (write) {
  // Keep the header free of the temporary env-file path, and the file free of trailing
  // whitespace (which editors and `git diff --check` would otherwise flag).
  writeFileSync(committedPath, `${normalize(generated)}\n`);
  console.log(`Wrote ${committedName}.`);
  process.exit(0);
}

// Only the part derived from wrangler.jsonc (bindings, vars, compatibility date and flags)
// is enforced. The runtime section tracks the installed workerd version, so enforcing it
// would fail every Wrangler upgrade (including Dependabot PRs); a drift there is reported
// as a warning instead. `npm run types` refreshes both parts.
const RUNTIME_MARKER = '// Begin runtime types';
/** @param {string} text */
function split(text) {
  const lines = normalize(text).split('\n');
  const at = lines.indexOf(RUNTIME_MARKER);
  const config = (at === -1 ? lines : lines.slice(0, at)).map((line) =>
    line.replace(/workerd@\S+/, 'workerd@<installed>'),
  );
  return { config, runtime: at === -1 ? [] : lines.slice(at) };
}
const committedParts = split(readFileSync(committedPath, 'utf8'));
const freshParts = split(generated);
const committed = committedParts.config;
const fresh = freshParts.config;
const runtimeDrift =
  committedParts.runtime.join('\n') !== freshParts.runtime.join('\n');
const first = committed.findIndex((line, i) => line !== fresh[i]);
if (first === -1 && committed.length === fresh.length) {
  console.log(`PASS: ${committedName} matches \`wrangler types\` for wrangler.jsonc.`);
  if (runtimeDrift)
    console.warn(
      `WARN: the runtime types section differs from the installed workerd; run \`npm run types\` when convenient.`,
    );
  process.exit(0);
}
const at = first === -1 ? Math.min(committed.length, fresh.length) : first;
console.error(
  [
    `FAIL: ${committedName} is stale for wrangler.jsonc. Run \`npm run types\` and commit the result.`,
    `First difference at line ${at + 1}:`,
    `  committed: ${committed[at] ?? '<end of file>'}`,
    `  generated: ${fresh[at] ?? '<end of file>'}`,
    'A wrangler.jsonc change (bindings, vars, compatibility date or flags) changes the generated types.',
  ].join('\n'),
);
process.exit(1);
