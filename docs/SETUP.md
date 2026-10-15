# Setup and rollout

Target: the existing Esau Cloudflare account that hosts `openzcad` and `openfea`. Select it using the existing Wrangler authentication; no access-bearing values belong in Git. Review the real intended audience and [privacy limits](PRIVACY.md) first.

1. Install with `npm ci`. The dedicated `glimpse` D1 database now exists in the Esau account and its ID is configured in `wrangler.jsonc`. The owner authorized initial setup; `0001_aggregates.sql` is applied and the dashboard is deployed. For future authorized migrations, authenticate Wrangler for this account and run `npx wrangler d1 migrations apply DB --remote`. Future production migrations still require authorization. Local simulation uses `--local`. When recreating this setup elsewhere, create a separate database with `npx wrangler d1 create glimpse` and update its ID; do not reuse an application database.
2. The primary hostname is `glimpse.esau.app`, attached to Worker `glimpse` for Production only. Its hostname-specific Cloudflare Access application, `Glimpse`, has one Allow policy: the existing `Internal admin tools - Cloudflare` policy (exact owner email **AND** Login Methods = Cloudflare). Only Cloudflare is selected as an available identity provider; One-time PIN, WARP authentication, bypass policies and broad account-member policies are not attached. The current owner identity was checked against the verified Cloudflare profile; do not put the email in this repository. Reusing this policy does not modify the six other applications already using it. `ACCESS_ISSUER` and `ACCESS_AUD` match the live team and this application's audience, and the custom-domain route is checked in. These are public token-validation configuration, not credentials. Keep `workers_dev` and preview URLs disabled. When recreating the application, update the audience from its Additional settings and run `npm run types`; protect the hostname before attaching its route. Do not broaden the policy when deploying.
3. Confirm Access policies and logging/retention for app Workers, edge, Access, D1 backups. Glimpse logging/tracing is disabled. Do not enable raw request or telemetry-body logging. Verify that the intended audience/countries and controller notices support Basic server counters; opt-in remains required for Optional mode regardless of any local analytics exemption.
4. With authorization, deploy Glimpse using `npx wrangler deploy`. The two RPC entrypoints are `OpenZCADIngest` and `OpenFEAIngest`. They bind a caller to its app; there is no HTTP ingestion route. The default HTTP handler protects both assets and `/api/stats`, validates the Access JWT itself, and fails closed for missing configuration. `/healthz` is a data-free liveness response in the Worker; the hostname-wide Access application still requires authentication before any path reaches the Worker.
5. Review and deploy the two app integration PRs **after the service exists**. Each declares a `GLIMPSE` service binding to its own entrypoint and a global optional-ingress rate limiter. Both `GLIMPSE_BASIC_ENABLED` and `GLIMPSE_USAGE_ENABLED` start as `false`; keep preview/self-hosted configurations off unless deliberately configured. These flags are independent. Enable Basic only after the deployment-specific review; enable Optional only when notices and consent controls are ready. Browser consent is still required in addition to the Optional deployment switch.
6. Check without consent that no `/api/glimpse/usage` request occurs. Exercise known API operations and verify Basic counts. Opt in separately in each app, perform exports/solver/feature actions, and verify Optional app-separated counts. Withdraw while an operation is pending and verify subsequent actions cause no optional sends. Reopen and test cross-tab withdrawal. Verify unconfigured/self-hosted deployments work without Glimpse.
7. Confirm unauthenticated dashboard and API requests return 401 (or the Access login redirect), authorized requests show counts, app/date/level filters isolate rows, and retention removes expired aggregates. Recheck the daily retention cron and infrastructure backups after 90 days or with controlled staging fixtures.

## Ingestion contract

`record({ level, event, bucket })` accepts exactly those three keys. No client timestamp, count, dimensions, request/response body, URLs, identifiers or error text. Each accepted call adds one to the receipt day's aggregate. Basic: `api_request`, `api_error`, `api_latency`. Optional: `workspace_opened`, `export_completed`, `export_failed`, `solver_completed`, `solver_failed`, `workflow_model`, `workflow_mesh`, `workflow_setup`, `workflow_run`, `workflow_results`, `feature_used`, `operation_latency`. OpenZCAD rejects solver/FEA-only steps. Non-timing events require `bucket: none`; timing events require one of `lt_100ms`, `100ms_1s`, `1s_10s`, `10s_60s`, `gte_60s`.

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

## Expanded analytics upgrade

Before merging/deploying the expanded dashboard, follow
[EXPANDED-ANALYTICS.md](EXPANDED-ANALYTICS.md). It adds Glimpse migration
`0002_census.sql` and OpenZCAD migration `0028_glimpse_consent.sql`; neither has
been applied remotely as part of this change. Initial-deployment authorization
does not authorize these new production migrations. Deploy the reviewed service
before app integrations. All expanded metrics remain optional and old browser
grants require a fresh choice; cloud account statistics require a separate grant.
