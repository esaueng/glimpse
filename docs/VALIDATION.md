# Validation and remaining rollout work

15 October 2026. No dashboard code deployment, database migration or analytics activation was performed. The requested production hostname and its Access application were configured separately below.

## Tested locally

- `npm run check`: TypeScript, six regression scenarios against real local Cloudflare Worker/RPC/D1, React/Vite production build automatically triggered by Wrangler from a missing `dist` directory, and Worker dry-run.
- Tests reject identifying/free-text/extra fields, app overrides, invalid dates/levels/buckets; validate JWT signature/issuer/audience/expiry; protect both assets and API; check concurrent atomic aggregation, app and level separation, and expiry filtering plus the actual retention handler's deletion.
- Browser QA uses the in-app browser with a locally signed test JWT and synthetic D1 counts. Verified combined totals (60 Basic requests), Optional totals (13 workspace opens, 2 exports, 3 solves), OpenZCAD-only isolation (8 opens, 0 exports/solves), date exclusion/empty state, native invalid-date validation, and no horizontal overflow at 390px.
- Desktop viewport 1505×1045 and mobile 390×844; full-page screenshots inspected. The concept and desktop/mobile renders were compared with `view_image`.
- Runtime dependencies have no npm audit findings at validation time. Miniflare 5 beta is a **development-only** dependency matching the version used by current Wrangler; no Miniflare code ships in the Worker.
- Three commit-identity regressions accept the approved public GitHub merge display name only for its allowlisted login, and continue rejecting private addresses and unapproved names. All current commit metadata passes locally.

## Hosted build configuration

Cloudflare's Glimpse Production build command was saved as `npm run build` on 15 October 2026 and confirmed after reload; deploy remains `npx wrangler deploy`, with root `/`. The Previews Base UI also displays `npm run build` after saving, but the subsequent automatic branch build still reports no build command and fails before asset validation because Wrangler requires a separate `previews` block with preview-safe D1/Access bindings. Do not treat that UI value as proof of hosted preview execution. No manual build retry, production deployment or migration was performed. GitHub Actions could not start either initial build-fix job because the account reported failed payments or an exhausted spending limit. These infrastructure limitations are distinct from local test results.

After PR #2 was merged, production build `c544471e-5515-4dcd-87d3-a025837fb10c` on main `1f92aa3` successfully built and uploaded its assets, then failed with Cloudflare error `10181`: the `DB` binding references the all-zero placeholder database ID. The live Esau account inventory contains ten D1 databases and no `glimpse` database. Completing deployment requires creating the separate Glimpse database, applying the reviewed `0001_aggregates.sql` migration (one empty `daily_counts` aggregate table), replacing the placeholder ID, and deploying the configured Worker. Those production provisioning/migration/deployment actions remain pending authorization; no existing application database should be reused.

## Visual verification

The generated concept guided the implementation. Compared: header/hero copy and hierarchy; true-white/navy/teal palette; open four-column totals; app/date controls; activity chart; table/performance split; thin borders and spacing; footer; responsive stacking and control sizes. The above-the-fold headline, brand and intro match. Necessary additions are the Collection selector, explicit UTC/scope/status text and Basic “Not collected” labels. The histogram uses the actual fixed timing buckets rather than a continuous logarithmic axis. System typography is used without external font requests. These intentional changes reflect the two-level collection contract. No remaining material layout issue was observed.

Image generation was used only for the UI concept, not as a dashboard asset. Browser screenshots are QA artifacts kept outside the source tree; synthetic fixture generation and the temporary local authorization proxy are not production features or checked-in authentication bypasses.

## Production hostname and Access verification

- `glimpse.esau.app` is attached to Worker `glimpse` for Production only. `workers.dev` and Preview URLs are disabled.
- A hostname-specific self-hosted Access application named `Glimpse` protects every path on this hostname. It has exactly one Allow policy, `Internal admin tools - Cloudflare`: the verified owner's exact email AND Cloudflare login method. Cloudflare is the sole selected identity provider, with all-provider acceptance and WARP authentication off. There are no bypass, service-auth or broad account-member policies on this application. The existing shared policy was inspected without modifying it.
- After saving, reopening the application confirmed its hostname, policy and Cloudflare-only identity-provider selection. The policy tester allowed the verified owner and blocked the other three known identities. This tests last-seen identities, not every possible real-world login.
- A new Chrome visit passed through Cloudflare authentication using the owner's existing session and reached the current Worker's `Hello world` placeholder at `https://glimpse.esau.app/`. This verifies authorized routing and sign-in, not the dashboard or analytics database.
- Unauthenticated HTTP probes to `/`, `/api/stats` and `/healthz` received 403 managed-challenge responses before Access login. They exposed no application data, but do not independently prove anonymous Access redirect behavior past the zone's bot protection. No challenge rules were weakened.
- The checked-in route, Access issuer and this application's AUD match the live configuration. No credentials or owner email are included in source. The actual dashboard still needs its database and code deployed.

## Not yet verified

D1 creation/migration, authorized dashboard/API behavior after deployment, anonymous Access behavior past zone bot protection, app service-binding resolution, real production event delivery, cron delivery and infrastructure log/backup retention. Both app flags remain false. Read [setup](SETUP.md) and [privacy limits](PRIVACY.md) before activation. Hosted CI results are reported on each PR and are distinct from these local checks.
