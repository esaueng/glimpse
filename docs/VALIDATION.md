# Validation and remaining rollout work

15 October 2026. No production deployment, database migration, Access-policy update or analytics activation was performed.

## Tested locally

- `npm run check`: TypeScript, six regression scenarios against real local Cloudflare Worker/RPC/D1, React/Vite production build automatically triggered by Wrangler from a missing `dist` directory, and Worker dry-run.
- Tests reject identifying/free-text/extra fields, app overrides, invalid dates/levels/buckets; validate JWT signature/issuer/audience/expiry; protect both assets and API; check concurrent atomic aggregation, app and level separation, and expiry filtering plus the actual retention handler's deletion.
- Browser QA uses the in-app browser with a locally signed test JWT and synthetic D1 counts. Verified combined totals (60 Basic requests), Optional totals (13 workspace opens, 2 exports, 3 solves), OpenZCAD-only isolation (8 opens, 0 exports/solves), date exclusion/empty state, native invalid-date validation, and no horizontal overflow at 390px.
- Desktop viewport 1505×1045 and mobile 390×844; full-page screenshots inspected. The concept and desktop/mobile renders were compared with `view_image`.
- Runtime dependencies have no npm audit findings at validation time. Miniflare 5 beta is a **development-only** dependency matching the version used by current Wrangler; no Miniflare code ships in the Worker.
- Three commit-identity regressions accept the approved public GitHub merge display name only for its allowlisted login, and continue rejecting private addresses and unapproved names. All current commit metadata passes locally.

## Hosted build configuration

Cloudflare's Glimpse Production build command was saved as `npm run build` on 15 October 2026 and confirmed after reload; deploy remains `npx wrangler deploy`, with root `/`. The Previews Base UI also displays `npm run build` after saving, but the subsequent automatic branch build still reports no build command and fails before asset validation because Wrangler requires a separate `previews` block with preview-safe D1/Access bindings. Do not treat that UI value as proof of hosted preview execution. No manual build retry, production deployment or migration was performed. GitHub Actions could not start either initial build-fix job because the account reported failed payments or an exhausted spending limit. These infrastructure limitations are distinct from local test results.

## Visual verification

The generated concept guided the implementation. Compared: header/hero copy and hierarchy; true-white/navy/teal palette; open four-column totals; app/date controls; activity chart; table/performance split; thin borders and spacing; footer; responsive stacking and control sizes. The above-the-fold headline, brand and intro match. Necessary additions are the Collection selector, explicit UTC/scope/status text and Basic “Not collected” labels. The histogram uses the actual fixed timing buckets rather than a continuous logarithmic axis. System typography is used without external font requests. These intentional changes reflect the two-level collection contract. No remaining material layout issue was observed.

Image generation was used only for the UI concept, not as a dashboard asset. Browser screenshots are QA artifacts kept outside the source tree; synthetic fixture generation and the temporary local authorization proxy are not production features or checked-in authentication bypasses.

## Not yet verified

Production hostname, D1 creation/migration, Access configuration and authorized/unauthorized live behavior, app service-binding resolution, real production event delivery, cron delivery and infrastructure log/backup retention. Both app flags remain false. Read [setup](SETUP.md) and [privacy limits](PRIVACY.md) before activation. Hosted CI results are reported on each PR and are distinct from these local checks.
