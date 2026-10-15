# Validation and remaining rollout work

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

With the owner's separate Esau-only Wrangler authorization, source commit `4702ac79376afe509d25044ef0b8352ad968da23` was deployed as Worker version `f63cabb5-da44-4c66-8959-41b0eb0e585f`, with `glimpse.esau.app` and cron `31 3 * * *`. The deployed runtime configuration matches PR #3; merge that PR to retain the binding/domain/Access settings in future main builds. No CI protections were bypassed or PRs merged by this deployment action.

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
