# Setup and rollout

Target: the existing Esau Cloudflare account that hosts `openzcad`, `openfea` and `openlattice3d`. Select it using the existing Wrangler authentication; no access-bearing values belong in Git. Review the real intended audience and [privacy limits](PRIVACY.md) first.

1. Install with `npm ci`. The dedicated `glimpse` D1 database now exists in the Esau account and its ID is configured in `wrangler.jsonc`. The owner authorized initial setup; `0001_aggregates.sql` is applied and the dashboard is deployed. For future authorized migrations, authenticate Wrangler for this account and run `npx wrangler d1 migrations apply DB --remote`. Future production migrations still require authorization. Local simulation uses `--local`. When recreating this setup elsewhere, create a separate database with `npx wrangler d1 create glimpse` and update its ID; do not reuse an application database.
2. The primary hostname is `glimpse.esau.app`, attached to Worker `glimpse` for Production only. Its hostname-specific Cloudflare Access application, `Glimpse`, has one Allow policy: the existing `Internal admin tools - Cloudflare` policy (exact owner email **AND** Login Methods = Cloudflare). Only Cloudflare is selected as an available identity provider; One-time PIN, WARP authentication, bypass policies and broad account-member policies are not attached. The current owner identity was checked against the verified Cloudflare profile; do not put the email in this repository. Reusing this policy does not modify the six other applications already using it. `ACCESS_ISSUER` and `ACCESS_AUD` match the live team and this application's audience, and the custom-domain route is checked in. These are public token-validation configuration, not credentials. Keep `workers_dev` and preview URLs disabled. When recreating the application, update the audience from its Additional settings and run `npm run types`; protect the hostname before attaching its route. Do not broaden the policy when deploying.
3. Confirm Access policies and logging/retention for app Workers, edge, Access, D1 backups. Glimpse logging/tracing is disabled. Do not enable raw request or telemetry-body logging. Verify that the intended audience/countries and controller notices support Basic server counters; opt-in remains required for Optional mode regardless of any local analytics exemption.
4. With authorization, deploy Glimpse using `npx wrangler deploy`. The three RPC entrypoints are `OpenZCADIngest`, `OpenFEAIngest` and `OpenLattice3DIngest`. They bind a caller to its app; there is no HTTP ingestion route. The default HTTP handler protects both assets and `/api/stats`, validates the Access JWT itself, and fails closed for missing configuration. `/healthz` is a data-free liveness response in the Worker; the hostname-wide Access application still requires authentication before any path reaches the Worker.
5. Review and deploy the app integration PRs **after the service exists**. Each needs a `GLIMPSE` service binding to its own entrypoint and a global optional-ingress rate limiter. Both `GLIMPSE_BASIC_ENABLED` and `GLIMPSE_USAGE_ENABLED` start as `false`; keep preview/self-hosted configurations off unless deliberately configured. These flags are independent. Enable Basic only after the deployment-specific review; enable Optional only when notices and consent controls are ready. Browser consent is still required in addition to the Optional deployment switch.
6. Check without consent that no `/api/glimpse/usage` request occurs. Exercise known API operations and verify Basic counts. Opt in separately in each app, perform exports/solver/feature actions, and verify Optional app-separated counts. Withdraw while an operation is pending and verify subsequent actions cause no optional sends. Reopen and test cross-tab withdrawal. Verify unconfigured/self-hosted deployments work without Glimpse.
7. Confirm unauthenticated dashboard and API requests return 401 (or the Access login redirect), authorized requests show counts, app/date/level filters isolate rows, and retention removes expired aggregates. Recheck the daily retention cron and infrastructure backups after 90 days or with controlled staging fixtures.

## Ingestion contract

`record({ level, event, bucket })` accepts exactly those three keys. No client timestamp, count, dimensions, request/response body, URLs, identifiers or error text. Each accepted call adds one to the receipt day's aggregate. Basic: `api_request`, `api_error`, `api_latency`. Optional: `workspace_opened`, `export_completed`, `export_failed`, `solver_completed`, `solver_failed`, `generation_completed`, `generation_failed`, `workflow_model`, `workflow_mesh`, `workflow_setup`, `workflow_run`, `workflow_results`, `feature_used`, `operation_latency`. OpenZCAD rejects solver/FEA-only steps. Generation events are exclusive to OpenLattice3D. Its Optional allowlist is limited to workspace opens, exports, generation outcomes and operation latency; FEA workflow and solver events are rejected. Non-timing events require `bucket: none`; timing events require one of `lt_100ms`, `100ms_1s`, `1s_10s`, `10s_60s`, `gte_60s`.

The app relay accepts only `event` and `bucket`; it never accepts Basic client events. Metrics are best effort and can undercount on outages, in-flight request cancellation, or rate limits. Allowed events can be spoofed by custom clients. There is no deduplication identifier or delivery retry. Do not use these statistics for billing or individual decisions.

## Rollback

Set both app flags to `false` and redeploy the app Workers to stop collection. Optional users can independently withdraw in the UI. The apps tolerate unavailable Glimpse bindings and failed deliveries. Roll back app versions before deleting the Glimpse service or removing bindings. Keep the protected aggregate database only for its documented retention; any manual deletion/migration is a separate authorized action. GitHub Actions CI does not deploy; the existing Cloudflare Workers Builds integration deploys main pushes.

## Cloudflare Workers Builds

In **Glimpse → Settings → Build → Build configuration**, set:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

The Vite build creates `dist`, which is intentionally ignored by Git. Leaving Build command as `None` made the initial Cloudflare build fail with “assets.directory … does not exist”. The repository also declares `build.command` in Wrangler so direct CLI deployments build assets first. Cloudflare [documents that Workers Builds does not honor this custom-build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), so configure the hosted Build command explicitly as above.

`npm run check:deploy` removes generated `dist` output, runs a deployment **dry-run**, and checks that the generated HTML references existing bundled JavaScript and CSS. CI invokes this regression after typechecking and tests; it cannot pass solely because an earlier frontend build left `dist` behind. This does not upload a Worker, create/migrate D1, or establish production Access configuration. The original main deployment subsequently built/uploaded assets successfully, then exposed the missing D1 binding. The dedicated database, initial migration and protected production deployment are now complete; see the validation ledger. Merge the production-configuration PR before relying on future main builds, so main retains the real database binding and Access configuration.

## OpenLattice3D rollout

The third-app change includes `0002_openlattice3d.sql`; it has **not** been applied to production as part of this change. The migration rebuilds the app CHECK constraint, copying all seven existing columns, counts and primary keys unchanged. The local Worker/D1 regression upgrades a populated v1 database and verifies preservation, RPC app isolation, rejection of unknown app values and combined reads.

With separate production authorization, apply this migration to the dedicated Glimpse D1 database and deploy the collector with `OpenLattice3DIngest` before configuring the app binding:

```json
{"binding":"GLIMPSE","service":"glimpse","entrypoint":"OpenLattice3DIngest"}
```

OpenLattice3D deliberately leaves this binding out until the service is ready. Both app switches remain `false`. Enable only after the privacy/retention review above; Optional also requires each browser's saved choice in **Inspect → Privacy & data**. Its model processing is browser-local; Basic does not measure lattice generation, visits, health checks or static assets. There are currently no geometry API operations to count. Optional counts actual completed/failed mesh and project exports and single-run lattice generations; cancelled, stale and comparison-preview runs are excluded. Workspace opens are counted only if consent is already saved when the workspace mounts, with no retroactive count on opt-in.

Rollback by disabling the app flags first. The expanded schema accepts old app values and is compatible with the previous collector; do not reverse the migration by dropping third-app counts. No additional database, domain, public ingest route or authentication change is needed.
