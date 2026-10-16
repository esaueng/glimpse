# Validation and rollout record

## Current production status — 16 October 2026 UTC

The owner explicitly authorized merging all three reviewed PRs, applying their
required migrations and deploying the updates. All three are merged; their
required checks passed at the final PR heads and their production Workers builds
succeeded. Existing automatic deployments were used; no CI protection was bypassed.

| Component | Merged change | Active production version |
| --- | --- | --- |
| Glimpse | [#7](https://github.com/esaueng/glimpse/pull/7), merge `477df3f` | `74b0b69c-d096-47b4-bb3e-74acb1f025ba` |
| OpenZCAD | [#689](https://github.com/esaueng/OpenZCAD/pull/689), merge `6d8276e` | `1051e80c-9009-4c0f-b9d4-c4c238d37e52` |
| OpenFEA | [#149](https://github.com/esaueng/OpenFEA/pull/149), merge `d843707` | `d7539848-b580-44bb-9f0f-fd71e5afd1f8` |

Glimpse's active version also includes the independently merged branding PR #8
on main `bf291a4`; those assets were preserved. OpenZCAD's final reviewed head
`e78fee20` includes the companion review's fixes and an awaited React `act` around
the asynchronous parameter-rename focus transition. Its focus assertions remain
unchanged; ten focused runs passed 80 tests, followed by the complete hosted
quality, validation, unit and six-shard browser checks. The merged main's
Cloudflare verify/upload and Workers Build checks also passed.

### Applied migrations

- Glimpse Production: `0001_aggregates.sql`, `0002_openlattice3d.sql` and
  `0003_census.sql` are recorded as applied. The pending second and third
  migrations were applied during this rollout. Before/after reads confirmed
  zero aggregate rows/events and no inserted synthetic production events.
- Glimpse isolated Preview: `0003_census.sql` was applied through the dedicated
  Preview migration configuration; all three migrations are now applied.
- OpenZCAD's existing production database: `0028_glimpse_consent.sql` was applied
  before its automatic deployment. The post-migration read found zero account
  permission grants and generation zero. OpenFEA requires no migration.

All three remote migration targets report **no migrations to apply**. Read-only
Time Travel bookmarks were recorded before the production schema changes; no
existing account/project contents were exported.

### Verified live

- Authenticated Chrome loads the compact dark Glimpse Overview, per-app/date
  controls, Basic/Optional views and Storage page through the protected
  `glimpse.esau.app` API. Production counts are genuinely empty; unsupported
  OpenFEA cloud-account measurements remain distinct from zero. No console
  warnings/errors were observed. Existing production/Preview Access audiences
  and separate databases were preserved.
- Anonymous HTTP probes receive Cloudflare's edge challenge (403) without
  application data. This does not independently prove the Access redirect or
  Worker JWT rejection after the edge challenge.
- The active app versions bind `GLIMPSE` to `glimpse` with their respective
  `OpenZCADIngest` and `OpenFEAIngest` entrypoints. Both apps' active
  `GLIMPSE_BASIC_ENABLED` and `GLIMPSE_USAGE_ENABLED` values are **false**.
- OpenZCAD `/api/health` returns 200 with its existing account/storage readiness
  checks true. Chrome loads the signed-out workspace and expanded Privacy & data
  notice with usage consent unchecked and no warning/error logs. No model edits
  or consent changes were made.
- OpenFEA's origin `/healthz` returns 200 and `status: ok`. Chrome loads its start
  page and expanded notice with consent unchecked and the report action disabled.
  No user file was opened and no consent was granted. A PWA-controlled browser
  navigation to `/healthz` renders the frontend fallback; the direct origin probe
  verifies the health endpoint separately.

### Still awaiting production verification

Collection remains disabled. Live opted-in event delivery and nonzero aggregate
isolation, signed-in account permission/expiry/withdrawal propagation, hourly
census delivery and retention cron execution have not been verified in production.
The local/hosted regressions below cover collection contracts and handlers in test environments.
Infrastructure log/backup retention and anonymous behavior beyond zone bot
protection also remain separate operational checks. Enabling collection requires
a deliberate rollout and the applicable user choices; deployment alone does not
grant consent.

## Historical implementation and setup checks

The entries below record earlier stages and their limitations at that time.
Their references to pending deployment, migrations or payment-blocked CI are
historical; the current production status above supersedes those rollout claims.

15 October 2026. The owner authorized dedicated production database setup, the initial migration, and Glimpse deployment. The protected dashboard is live. No app analytics activation was performed.

## Tested locally

- `npm run check`: TypeScript, six regression scenarios against real local Cloudflare Worker/RPC/D1, React/Vite production build automatically triggered by Wrangler from a missing `dist` directory, and Worker dry-run.
- Tests reject identifying/free-text/extra fields, app overrides, invalid dates/levels/buckets; validate JWT signature/issuer/audience/expiry; protect both assets and API; check concurrent atomic aggregation, app and level separation, and expiry filtering plus the actual retention handler's deletion.
- Browser QA uses the in-app browser with a locally signed test JWT and synthetic D1 counts. Verified combined totals (60 Basic requests), Optional totals (13 workspace opens, 2 exports, 3 solves), OpenZCAD-only isolation (8 opens, 0 exports/solves), date exclusion/empty state, native invalid-date validation, and no horizontal overflow at 390px.
- Desktop viewport 1505×1045 and mobile 390×844; full-page screenshots inspected. The concept and desktop/mobile renders were compared with `view_image`.
- Runtime dependencies have no npm audit findings at validation time. Miniflare 5 beta is a **development-only** dependency matching the version used by current Wrangler; no Miniflare code ships in the Worker.
- Three commit-identity regressions accept the approved public GitHub merge display name only for its allowlisted login, and continue rejecting private addresses and unapproved names. All current commit metadata passes locally.

## Hosted build configuration

Cloudflare's Glimpse Production build command is `npm run build`; deploy remains `npx wrangler deploy`, with root `/`. After PR #2 was merged, production build `c544471e-5515-4dcd-87d3-a025837fb10c` on main `1f92aa3` successfully built/uploaded assets, then failed with Cloudflare error `10181` because `DB` referenced the all-zero placeholder ID.

The owner authorized the missing infrastructure work. A dedicated `glimpse` D1 database was created in Esau, its actual ID replaced the placeholder, and Wrangler applied `0001_aggregates.sql` successfully. A remote read confirmed its migration ledger entry and zero aggregate rows. No existing application database was reused, and no synthetic production events were inserted.

With the owner's separate Esau-only Wrangler authorization, source commit `bc77543a3f00e1f44e5bfcc8f64011661d88507b` was deployed as Worker version `f63cabb5-da44-4c66-8959-41b0eb0e585f`, with `glimpse.esau.app` and cron `31 3 * * *`. The deployed runtime configuration matches PR #3; merge that PR to retain the binding/domain/Access settings in future main builds. No CI protections were bypassed or PRs merged by this deployment action.

GitHub Actions is separately blocked before jobs start by an account payment/spending-limit error. Hosted branch previews remain unconfigured: the Previews Base UI displays the saved build command, but the observed branch job reports no build command and Wrangler requires a separate `previews` block with preview-safe bindings. Neither limitation is a successful hosted CI result. The production service was deployed directly with the owner's explicit authorization after local checks passed.

## Visual verification

The generated concept guided the layout. Compared: header/hero copy and hierarchy; open four-column totals; app/date controls; activity chart; table/performance split; thin borders and spacing; footer; responsive stacking and control sizes. The above-the-fold headline, brand and intro match. Necessary additions are the Collection selector, explicit UTC/scope/status text and Basic “Not collected” labels. The histogram uses the actual fixed timing buckets rather than a continuous logarithmic axis. System typography is used without external font requests. These intentional changes reflect the two-level collection contract. No remaining material layout issue was observed.

The requested default dark theme replaces the original light palette throughout the canvas, controls, table, charts, labels, error and focus states. CSS and initial HTML both declare the dark color scheme, including native date controls; no preference storage or new dependency is used. Local Chrome QA at 1512px and 390px verified populated charts, OpenFEA Optional filtering (5 opens, 2 exports, 3 solves), no horizontal overflow, and no browser warnings/errors using synthetic local D1 data. Palette checks give text contrast of at least 6.42:1 and control-border contrast of 3.18:1. This theme change has not been deployed to production.

Image generation was used only for the UI concept, not as a dashboard asset. Browser screenshots are QA artifacts kept outside the source tree; synthetic fixture generation and the temporary local authorization proxy are not production features or checked-in authentication bypasses.

## Production hostname and Access verification

- `glimpse.esau.app` is attached to Worker `glimpse` for Production only. `workers.dev` and Preview URLs are disabled.
- A hostname-specific self-hosted Access application named `Glimpse` protects every path on this hostname. It has exactly one Allow policy, `Internal admin tools - Cloudflare`: the verified owner's exact email AND Cloudflare login method. Cloudflare is the sole selected identity provider, with all-provider acceptance and WARP authentication off. There are no bypass, service-auth or broad account-member policies on this application. The existing shared policy was inspected without modifying it.
- After saving, reopening the application confirmed its hostname, policy and Cloudflare-only identity-provider selection. The policy tester allowed the verified owner and blocked the other three known identities. This tests last-seen identities, not every possible real-world login.
- Chrome completed Cloudflare authentication using the owner's existing session. After production deployment, reloading `https://glimpse.esau.app/` loaded the real dashboard and successfully queried D1 through the JWT-protected API. Verified combined Basic totals, OpenZCAD and OpenFEA Optional views, explicit opted-in-only labeling, and a one-day date filter. All counts are zero as expected with app collection disabled; production nonzero aggregation/isolation remains unverified. The native date control was used because the browser automation fill helper did not update React date state.
- Unauthenticated HTTP probes to `/`, `/api/stats` and `/healthz` received 403 managed-challenge responses before Access login. They exposed no application data, but do not independently prove anonymous Access redirect behavior past the zone's bot protection. No challenge rules were weakened.
- The checked-in route, database binding, Access issuer and this application's AUD match the deployed configuration. No credentials or owner email are included in source.

## Not yet verified

Anonymous Access behavior past zone bot protection, app service-binding resolution and real production event delivery/nonzero aggregation, cron delivery and infrastructure log/backup retention. Both app flags remain false. Read [setup](SETUP.md) and [privacy limits](PRIVACY.md) before activation. Hosted CI results are reported on each PR and are distinct from these local checks.


## OpenLattice3D extension (15 October 2026)

The third-app collector adds `OpenLattice3DIngest`, the fixed app/date filter and table labels, and separate generation outcome events. Generation counts are labeled independently from solver counts in the per-app view. The combined run total includes both. Its RPC allowlist rejects solver/FEA workflow events and other apps reject generation events.

`npm run check` passes: seven real Worker/RPC/D1/JWT scenarios, typecheck and clean deployment dry-run/build. The new regression upgrades a populated v1 database with `0002_openlattice3d.sql`, verifies old counts survive, accepts third-app metrics, rejects identity/unknown-app data and verifies combined/per-app reads. Production migration, deployment, app binding resolution and real delivery remain pending. No production migration, activation or manual deployment was performed for this extension.

Chrome QA with a local synthetic-data server verified the third-app selector, Optional filter, `Lattice generations` total (3), workspace activity (5) and only OpenLattice3D event rows. No console errors/warnings were observed. These are synthetic UI fixtures outside source and production; the real Worker/D1/JWT tests above verify the backend separately. The OpenLattice3D consent UI was also checked on its local Worker at desktop and 390×844, including reload persistence and actual two-tab withdrawal.


## Preview configuration repair (15 October 2026)

The missing `previews` configuration is repaired with an isolated `glimpse-preview` D1 database, a dedicated migration configuration and a separate Preview Access audience. Both migrations were applied to that staging database, not production. The saved `Glimpse previews` Access application protects only this Worker's preview URLs with the same exact-owner AND Cloudflare-login policy; no shared policy was edited.

The configuration regression checks database/migration-target alignment, separate JWT audiences, disabled production workers.dev and absence of production routes, crons or service bindings in Previews. Real local Worker tests reject tokens across both environments and verify that Preview counts do not enter the production test database. Local typecheck, nine regression scenarios and clean Wrangler build/dry-run passed. Hosted preview verification and GitHub CI are recorded on PR #5; the latter is independently blocked by account payments/spending limits until resolved. OpenLattice3D PR #74 passed its hosted checks, merged, and its automatic production build succeeded.

## Expanded analytics and top-bar dashboard (16 October 2026 UTC)

This follow-up is based on the merged dark theme, OpenLattice3D integration and
isolated Preview configuration. The new v2 details apply to OpenZCAD/OpenFEA;
third-app legacy counts and Preview/production separation remain supported.

Local service validation: `npm run check` passes **15 tests** across real
Worker/RPC/D1/Access, preview configuration and dashboard measurement semantics,
plus typechecking and a clean Wrangler deployment dry-run. Four privacy-policy
regressions pass after synchronizing the newly merged CI policy. Tests cover strict event/report/census schemas, extra private
fields, concurrent app-separated counts, stock replacement rather than summing,
out-of-order deliveries across UTC days, retention, and environment JWT isolation.

Integration verification was run in the actual app checkouts:

- OpenZCAD: root **4,629 passed / 8 skipped**, web **2,956 passed**, parity
  **185 passed / 1 skipped**, typecheck and build/bundle gate passed. Lint has
  zero errors and the existing 16 hook warnings. The final consent/API/census
  probes passed (99 root and 62 web focused checks). Settings browser suite:
  **29 passed**, with the cloud-off cold reload repeated three more times.
  The full unrelated browser suite was not rerun. A newly merged master-switch
  guard exposed a startup edge during integration; v2 now rechecks the stored
  cloud choice on every send and the strengthened cold/cross-tab regressions pass.
  Census SQL tests migrate the real schema, including a legacy NULL-sized
  artifact inserted before the historical upload guards; those guards are kept.
- OpenFEA: core builds, all five package suites (**269 tests**), Cloudflare config
  verification, typecheck, root **1,520 tests**, production build and bundle budgets
  passed. Final targeted analytics/relay/storage checks: **31 passed**. Isolated
  real-Chrome STEP-selection and portable project-results probes passed. The
  initial sandboxed Chrome launch could not expose its test debugging port;
  running the same isolated probes with the required process permissions passed.

Chrome extension QA used a synthetic local D1 fixture, never production events.
Verified combined/per-app/Basic/Optional/date filters, empty results, stale data
on a failed refresh, Storage/Diagnostics/Privacy navigation, and preserved lattice
generation counts (3 generations, 1 export) in the third-app view. A valid pasted
report rendered only its own counts; adding a private-text field rejected it and
cleared the earlier report. File-picker automation requires the extension's
file-URL permission and was not completed; that broader permission was not granted.
The parser and byte/schema bounds are tested, and Paste JSON is fully exercised.

Design QA: Chrome screenshots at **1536×1024** and **390×844**, no page horizontal
overflow or unexpected browser warnings/errors. `view_image` compared the final
concept with desktop/mobile renders. Inspected top navigation/selection, title and
metric typography, dark palette and contrast, divided summary strip, chart axes,
bar shares, table density, spacing and mobile ordering. The overly small chart
labels and bars normalized to the largest bucket were corrected; bars now encode
share of observations. Above-the-fold copy is the concept plus explicit applied
scope and measurement corrections. Intentional additions: preserved third-app
labels/completed outcomes, accessible daily tables, and local Paste JSON. Dates
use native controls, data/UTC updates are real fixture values, and there is no
invented live metric or remaining material visual mismatch. Screenshots and the
local authorization fixture are outside Git; the latter is not shipped.

**Not deployed or remotely migrated:** new service `0003_census.sql` (including
its isolated Preview DB) and OpenZCAD `0028_glimpse_consent.sql` need separate
migration authorization and rollout review. No expanded collection flags,
production data, Access policies or domains were changed. Production nonzero
cohort totals, real event delivery, expiry/withdrawal propagation, hourly census
and retention delivery, and infrastructure backups/log retention await staging
and production verification. Hosted CI/Preview results are recorded on the PRs;
local checks are not a claim that those hosted checks passed.

Final Overview refinement: removed the subtitle, chart caption, panel paragraphs,
report controls and footer. Detailed views retain definitions and local reports.
Chrome recheck at 1536×1024 and 390×844 shows no horizontal overflow; the desktop
Overview fits within 1024px height. Diagnostics still exposes report inspection,
with no console warnings/errors. Fresh screenshots were compared with the
top-bar concept using `view_image`. The reduced copy is intentional owner steering.
