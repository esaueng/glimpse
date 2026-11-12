# Roadmap and open work

There is no issue tracker for Glimpse; this page collects the plan that was
previously spread across the README and `docs/`. It separates what has recorded
evidence from what is only merged or planned. Written 12 November 2026 against
main `e5f529e`; nothing here was checked against production while writing it.

Rules for this page:

- **Verified** means the [validation ledger](VALIDATION.md) records the check.
  Merged code, a passing dry-run or a checked-in configuration value is not
  evidence that production runs it.
- **Unverified** or **not recorded** means the state is unknown, not that it
  failed.
- Production migrations, deployments, secrets and Access changes need the
  owner's explicit authorization. Items that need it say so.

## Current state

| Area | State | Date | Evidence |
| --- | --- | --- | --- |
| Protected dashboard at `glimpse.esau.app` | Verified: hostname-wide Access application, owner-only policy, Worker JWT verification, D1 reads through `/api/stats` | 15 Oct 2026 | [Production hostname and Access verification](VALIDATION.md#production-hostname-and-access-verification) |
| Isolated Preview environment | Verified: separate `glimpse-preview` D1 database and Access audience | 15 Oct 2026 | [Preview configuration repair](VALIDATION.md#preview-configuration-repair-15-october-2026) |
| Glimpse migrations `0001`–`0003` | Verified applied on Production and Preview | 16 Oct 2026 | [Applied migrations](VALIDATION.md#applied-migrations) |
| OpenZCAD migration `0028_glimpse_consent.sql` | Verified applied | 16 Oct 2026 | [Applied migrations](VALIDATION.md#applied-migrations) |
| App integrations (OpenZCAD #689, OpenFEA #149, OpenLattice3D #74) | Verified merged and deployed | 15–16 Oct 2026 | [Initial deployment snapshot](VALIDATION.md#initial-deployment-snapshot--16-october-2026-utc) |
| Collection in all three apps | Verified: both flags enabled by the owner; opted-in workspace opens received from all three apps; a nonempty OpenZCAD account snapshot visible | 16 Oct 2026 | [Latest live verification](VALIDATION.md#latest-live-verification--16-october-2026-utc) |
| Dashboard redesign, timeframe picker, refresh fix, query reuse (#21, #22, #24, #25) | Merged 19–21 Oct 2026. Main deploys through Workers Builds, but no production check is recorded | — | Not yet recorded |
| Cloudflare usage and cost page (#26) | Merged 24 Oct 2026. Production state not recorded | — | Not yet recorded |
| Cloudflare monitor enabled in production configuration (#27) | `wrangler.jsonc` sets `CF_MONITOR_ENABLED` to `"true"` since 24 Oct 2026. Migration `0004`, secrets and scheduled runs are **not recorded**; see open item 1 | — | Not yet recorded |
| Public demo at `/demo` | Merged in #11. The demo deploys manually and separately; no deployment or check is recorded in the ledger | — | Not yet recorded |
| Hosted CI and branch protection | Workflows exist for `verify`, `commit-privacy`, `secret-scan`, `history-privacy` and `dependency-review`. Repository visibility and required checks are repository settings and are reported, not recorded here; see [publication review](PUBLICATION.md#ongoing-checks) | — | Reported |

## Open rollout and verification items

Each item needs a recorded result in [VALIDATION.md](VALIDATION.md) before it
moves to the table above. Owners are unassigned until someone takes the item.

| # | Item | Method | Pass criterion | Owner | Account authorization |
| --- | --- | --- | --- | --- | --- |
| 1 | Cloudflare monitor state | Check the remote D1 migration ledger for `0004_cloudflare.sql` on Preview and Production; list Production Worker secrets by name only; read `cf_coverage` after a `17 * * * *` run; open the Cloudflare page | `0004` applied on both databases; `CF_ACCOUNT_ID` and `CF_API_TOKEN` present on Production only; at least one scheduled run recorded, with `cf_coverage.last_success` set for each source; billing totals match Cloudflare's own view; private apps classified; account budget set. The collector is skipped until both secrets exist (`configured` in `src/cloudflare/store.ts`), so a quiet page alone does not show failure | unassigned | Yes: migration, secrets, read of production tables |
| 2 | Account permission expiry and withdrawal | In OpenZCAD, let a test account's 30-day permission expire, and separately withdraw it; observe the next snapshots | The account leaves the next snapshot after expiry or withdrawal; nothing else about it reaches Glimpse | unassigned | Yes: production OpenZCAD account and snapshot reads |
| 3 | Retention cron execution | After the first rows pass 90 days, read the oldest `day` in `daily_counts` and `daily_census` after the `31 3 * * *` run | No row older than 89 days before the current UTC day remains. Collection started 16 Oct 2026, so the first rows become eligible around mid-January 2027 | unassigned | Yes: production D1 read |
| 4 | Anonymous Access behaviour beyond the bot challenge | From a client that passes the zone challenge without an Access session, request `/`, `/api/stats` and `/healthz` | Access login redirect or 401/403 from the Worker; no application data. Probes so far stop at the 403 challenge, which does not prove this ([ledger](VALIDATION.md#production-hostname-and-access-verification)) | unassigned | Possibly: may need a temporary, scoped test rule; never weaken the live challenge |
| 5 | Infrastructure log and backup retention | Inspect retention and access for app Worker logs, edge and Access logs, and D1 Time Travel/backups | Each system's retention is written down and is consistent with [PRIVACY.md](PRIVACY.md#transport-and-operational-limits) | unassigned | Yes: account settings read |
| 6 | Privacy review of the Cloudflare monitor | Review the infrastructure-monitor section of [PRIVACY.md](PRIVACY.md): 400-day `cf_*` retention and the dashboard write path for budgets and app mappings (`POST /api/cloudflare/settings`) | Review recorded with a date; PRIVACY.md updated if anything changes | unassigned | No |
| 7 | Hourly census delivery | Read OpenZCAD's `daily_census` row for the current day twice, a few hours apart, on several days | The stored `generation` advances between reads within a day, and each UTC day has a row while any account permission exists | unassigned | Yes: production D1 read |
| 8 | Dashboard and demo deployment after #21, #22 and #26 | Confirm the private Worker version built from current main; run `npm run deploy:demo` under authorization; repeat the demo checks in [SETUP.md](SETUP.md#public-synthetic-demo) | Private dashboard shows five pages including Cloudflare; `/demo` serves the current build with `connect-src 'none'`; live paths still require Access | unassigned | Yes: production deployment |

### Merged on this branch, not yet deployed or recorded

These are merged code changes. Treat them as unverified until deployed and
recorded in the ledger:

- A data-free "Analytics retention" heartbeat in the Cloudflare collection
  coverage table, so item 3 can be observed without reading rows. It is written
  to `cf_coverage`, so it needs migration `0004`; if the table is missing, the
  heartbeat is skipped and retention still runs.
- Named cron constants in `src/schedule.ts`, with a test that ties them to
  `wrangler.jsonc`.
- A 503 (with `Retry-After`) when the Access signing-key endpoint is
  unavailable, instead of a misleading 401.
- A 60-second clock tolerance for Access JWT time claims.
- The OpenZCAD `snapshot(...)` RPC returns `{ accepted }`, so a rejected
  (out-of-order) generation is visible to the caller.
- Collector hardening: alerts and retention run even when the identity check
  fails; unsupported datasets no longer stall backfill or send daily alerts;
  reads are capped instead of failing above 100,000 rows.
- A pending-migration guard: `/api/stats` needs `0001`–`0003` and
  `/api/cloudflare` needs `0004` in the D1 migration ledger, or they return a
  503 naming the missing migration. Deploying it before `0004` is applied leaves
  the Cloudflare page on that 503; analytics are unaffected.

## Hygiene backlog

| Item | Why |
| --- | --- |
| Pending-migration check in the deploy flow | Migrations and the demo deploy are manual, while main deploys automatically, so code can reach production before its schema. A deploy step or start-up check should fail clearly when a required migration is missing. **Done on this branch (not deployed):** `REQUIRED_MIGRATIONS` in `src/migrations.ts` (a test fails if any `migrations/*.sql` is missing from it); `/api/stats` and `/api/cloudflare` read the `d1_migrations` ledger and return a 503 naming the missing migration; ingestion RPC is unchanged |
| Split `tsconfig` per runtime | One `tsconfig.json` covers `src`, `web` and `test` with both DOM and Node types, so Worker code can use browser globals without a type error. **Done on this branch (not deployed):** `tsconfig.worker.json` (Workers types only), `tsconfig.web.json` (DOM) and `tsconfig.node.json` (tests, scripts, Vite configs); `npm run typecheck` checks all three. No type errors surfaced in `src/` |
| Freshness check for `worker-configuration.d.ts` | The generated file is committed; CI does not check that it matches `wrangler.jsonc` after `npm run types`. **Done on this branch (not deployed):** `npm run check:types` (in `npm run check` and CI) regenerates the types offline and diffs them; the committed file was stale against the installed workerd and was regenerated. A Wrangler upgrade now needs `npm run types` in the same change |
| Component tests for `web/Cloudflare.tsx` and `web/views.tsx` | Current tests cover the Worker, data semantics, ranges, the demo and configuration, not rendered components |
| Confirm where `.github/privacy` tests run | They run only in `history-privacy-request.yml` (pushes to any branch or tag, merge groups and fork pull requests), not in CI's `verify` job. Confirm this split is intended |
| Shared web hooks and one `Tile` | `web/views.tsx` and `web/Cloudflare.tsx` each define a `Tile`, and `web/Dashboard.tsx` and `web/Cloudflare.tsx` each keep their own loading and URL-state logic. Extract shared `useLoader`/`useUrlState` hooks and one `Tile` |

## Feature candidates

Details and privacy notes for each are in
[PROPOSED-METRICS.md](PROPOSED-METRICS.md). None is collected or rendered.
Every candidate needs a privacy review before work starts.

| Priority | Candidate | Privacy review | Repositories | Migration |
| --- | --- | --- | --- | --- |
| 1 | More diagnostic codes (`error_unresponsive`, `error_gpu_lost`, `error_out_of_memory`, `error_worker`) | Not started. Fixed enum values only; lowest risk | glimpse (`src/expanded.ts`), OpenZCAD, OpenFEA | No: values live in the code allowlist |
| 2 | Snapshot active accounts (7 and 30 days) and idle accounts (90 days or more) | Not started. Needs a minimum-count (k) threshold below which a field is withheld | glimpse (census schema), OpenZCAD | Yes: new `daily_census` columns |
| 3 | Decide OpenLattice3D v2 parity, or drop it explicitly | Not started. Parity extends the expanded contract to a third app | glimpse, OpenLattice3D | Possibly |
| Deferred | Active installs, new installs, time since last open, session length, platform | Blocked: each conflicts with current [PRIVACY.md](PRIVACY.md) promises or consent text, which must be revised first. Time since last open is a returning-visitor metric; platform is a fingerprinting dimension on small populations | glimpse, all apps | Possibly |
| Later | Accounts by storage used, revisions per project, model size, export formats | Not started. Snapshot ranges need the same k-threshold; import formats and WebGPU use are already partly covered by existing metrics | glimpse, OpenZCAD, OpenFEA | Snapshot fields: yes |
| Deferred | App-version dimension | Blocked on contract redesign: `record({ level, event, bucket })` has exactly three keys and no room for a dimension | glimpse, all apps | Yes |

## Non-goals

These follow from [PRIVACY.md](PRIVACY.md) and are not on the roadmap:

- No unique-user, consent-rate, per-person funnel or returning-visitor metric,
  and no cross-app join.
- No session joins, session IDs or reconstructed individual timelines.
- No per-person or per-account data in Glimpse: no persistent visitor
  identifier, IP, user agent, URL, filename, project name or email, and no
  per-account snapshot rows.
- No raw event store, raw error text or stacks, URL capture, GeoIP or custom
  dimensions.

Changing any of these needs a fresh design and consent review, as PRIVACY.md
states.
