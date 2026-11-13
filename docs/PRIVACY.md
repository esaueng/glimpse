# Glimpse privacy and consent review

The application-analytics statements below apply to the existing app counters,
consent-gated aggregates and local reports. The separate, owner-authorized
[Cloudflare infrastructure monitor](CLOUDFLARE.md) stores resource names/IDs,
ownership mappings, daily infrastructure usage, subscriptions and costs in private
`cf_*` tables with up to 400 days of daily history. It excludes customer/visitor
identities and model data. Its credentials and real data never enter the public
demo or repository. Infrastructure monitoring does not expand browser analytics
or change any application's consent controls.

Reviewed 15 October 2026. This records a technical approach and its limits; it is not a blanket legal exemption or a production compliance certification.

**Addition approved 13 November 2026.** The [review of additional diagnostic codes and account activity](#review-additional-diagnostic-codes-and-account-activity) at the end of this page was written 12 November 2026 and approved by the owner as drafted on 13 November 2026. Nothing it describes is collected until the app adapters ship.

**Addition accepted 13 November 2026.** The [review of the OpenLattice3D targeted subset](#review-openlattice3d-targeted-subset-adr-0001) at the end of this page was accepted by the owner on 13 November 2026 through the choice of Option B in [ADR 0001](decisions/0001-openlattice3d-v2-parity.md). Nothing it describes is collected until OpenLattice3D ships its adapter with a new consent version and notice.

**Review pending.** The infrastructure-monitor paragraph above was added on 24 October 2026 with the Cloudflare page (#26), after the last full review. It has not been through that review. Open questions include the 400-day retention of `cf_*` history, which is longer than the 90-day analytics retention, and the dashboard's write path for budgets and manual app mappings (`POST /api/cloudflare/settings`, behind Access). The review is tracked in the [roadmap](ROADMAP.md#open-rollout-and-verification-items).

## Two distinct purposes

**Basic statistics** count API requests, server failures (HTTP 5xx), and response time buckets inside each app Worker. They observe work the server already performs. They never read browser storage, add a client ping, or receive model/project attributes. Static asset requests and health probes are excluded. They are operation counts, not visits, users, sessions, or adoption estimates. Browser-local exports and solves cannot be counted this way: the dashboard marks these as opt-in only in Basic mode.

**Optional analytics** count fixed feature/workflow actions and local outcomes only after an affirmative checkbox choice. They start off for every browser, including browsers with an old default-on analytics preference. OpenZCAD and OpenFEA save only `granted-v2` under their own consent keys; the earlier `granted-v1` choice does not authorize expanded collection. OpenLattice3D retains its separate legacy scope and consent version; before it sends the [targeted subset](#review-openlattice3d-targeted-subset-adr-0001) it must ask again under a new consent version and notice. No identifier is generated. The choice is separate across apps, not synchronized to an account. Refusal has no effect on the application. The same control withdraws consent immediately; pending requests are aborted, future sends recheck storage, and other open tabs follow storage events. DNT/GPC suppress sends. If saving withdrawal fails, collection stops in that page and the UI explains that site storage must be cleared to remove an older saved grant. Requests already received cannot be recalled; anonymous aggregate counts cannot be attributed to a person for deletion. The client has no event queue, retries, replay, or session recording.

Optional totals represent **opted-in users only**. They are not representative of all users. No consent rate, funnel per person, unique count, returning-visitor metric, or cross-app join is possible. “Workflow” means independent counts of steps; it does not reconstruct a sequence.

## Strict data boundary

The browser sends exactly `event` and `bucket`. The app relay rejects extra fields, unknown values, cross-origin requests, oversized streamed bodies, and unsupported methods/content types. The app adds `level: optional`; fixed service-binding entrypoints select the app. Basic measurements are generated only on the backend. Glimpse revalidates the entire vocabulary and immediately upserts `(UTC day, app, level, event, bucket, count)` in D1. There is no raw event store, exact timestamp, unique key, cookie, IP, user agent, referrer, URL, filename, project/model name, email, geometry, model content, account key, or persistent visitor identifier in the analytics schema.

Optional ingress is capped at 120 requests/minute per app/Cloudflare rate-limit location using one constant key, without an IP-derived key. This is a best-effort safety cap, not a billing guarantee or abuse-proof statistic. The relay cannot prove a human consented: a custom client can submit allowed values, so totals can be polluted. Backend failure and client throttling can undercount. OpenLattice3D is a third fixed app with its own consent key and RPC entrypoint; its Optional events are workspace opens, export outcomes, lattice generation outcomes and coarse operation times, plus the fixed codes and ranges of the [targeted subset](#review-openlattice3d-targeted-subset-adr-0001) once it asks for the broader consent. No new identifying dimensions are introduced. Counts are not transactional business records.

The service stores daily aggregates for 90 UTC calendar days, removes older rows on its daily cron, and excludes expired rows from reads even if the cron is delayed. Infrastructure/database backups may have separate retention; review these before launch. Dashboard access uses Cloudflare Access with server-side signature, issuer, audience, expiry validation, and no application identity storage. Authentication necessarily uses the identity provider's own authentication data/cookies, separate from analytics.

## Consent law is broader than cookies

The [ICO guidance on storage and access technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/) covers technologies beyond cookies and describes conditional exceptions, including statistical purposes. “Cookieless” is not a legal conclusion. This implementation deliberately avoids relying on a statistical exception for browser usage collection and requires opt-in instead.

The [CNIL guidance on cookies and trackers](https://cnil.fr/fr/cookies-et-autres-traceurs/que-dit-la-loi) distinguishes consent requirements and conditional audience-measurement exemptions. No general exemption is asserted here. The [CNIL consent guidance](https://cnil.fr/fr/les-bases-legales/consentement) informs the affirmative, freely chosen, specific and withdrawable control. Anonymous totals alone do not resolve the lawfulness of collection before aggregation.

Backend counting reduces terminal-access and personal-data exposure, but routing a browser event through a server does not itself remove consent obligations. The controller still needs to confirm intended countries/audience, applicable law, lawful basis where personal data is processed, controller/processor roles, notices, transfer safeguards, retention, and any applicable right to object. Reassess if the vocabulary, infrastructure, or purposes change.

## Transport and operational limits

A network service necessarily receives source IP and transport headers at the app/edge. The optional client omits credentials and referrer; the relay constructs a fresh RPC containing only the allowed metric. Glimpse disables request logs/traces and stores none of that metadata. Existing app/Cloudflare/Access security logs and database backups are separate systems and may retain metadata; inspect their settings, access and retention before enabling collection. Do not promise “no IP processing anywhere.” Do not add raw telemetry body logging, session joins, URL capture, GeoIP, custom dimensions, error messages/stacks, or consent receipt identifiers without a fresh design and consent review.

Deployments default both collection switches to false. Enabling basic counters requires the documented review of the actual deployment; optional collection additionally requires the explicit browser choice. Neither PR merge nor a local test constitutes production verification.

## Expanded analytics revision

The owner's selected policy is all expanded statistics **after opt-in**, detailed
aggregates plus voluntarily shared reports, and no individual timelines. See
[the exact measurements, consent scopes and rollout](EXPANDED-ANALYTICS.md).
Existing usage choices require fresh consent for this larger scope. Account
statistics have their own explicit, expiring permission in OpenZCAD; Glimpse
receives only aggregate numeric snapshots. OpenFEA has no account census.

Rechecked 2026-10-15 against primary sources: the ICO's [final storage and access
technology guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/)
was updated on 29 April 2026, including exceptions and consent management. Its
coverage includes web storage and scripts; the older cookie overview still
points to an earlier consultation and should not be treated as current detail.
CNIL's [audience-measurement guidance](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications)
conditions exemptions and notes national variation. Neither supports a blanket
claim that removing cookies removes consent obligations. This implementation
uses explicit opt-in rather than asserting an analytics exemption. Consent
withdrawal must be easy; see [GDPR Article 7(3)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).
Jurisdiction, audience (including children), notices, lawful basis, provider logs,
backup retention and deployment-specific configuration still need review before
activation. Technical tests cannot certify legal compliance or anonymity.

## Review: additional diagnostic codes and account activity

**Approved by the owner as drafted, 13 November 2026.** Written 12 November 2026
for roadmap feature candidates 1 and 2 ([roadmap](ROADMAP.md#feature-candidates)),
separately from the 15 October 2026 review above. Glimpse accepts the values
below, but **nothing is collected yet**: OpenZCAD and OpenFEA send them only after
their own adapter changes, which are not made. Until then no new diagnostic code
appears and the dashboard shows the activity counts as "Not collected".

Decisions recorded with the approval:

- The new codes need no consent-version or notice change; they fall within the
  existing v2 description.
- Activity counts use K = 5 with the complement rule below and are **not**
  rounded; the differencing risk described below is accepted given owner-only
  access, one snapshot per UTC day and 90-day retention.
- Whether OpenZCAD's account-statistics permission wording covers save activity
  remains a precondition for the OpenZCAD adapter, as stated under Consent.

### Additional diagnostic codes

| Code | Meaning (decided by the app, never sent as text) |
| --- | --- |
| `error_unresponsive` | The page's main thread was blocked for 5 seconds or more |
| `error_gpu_lost` | The WebGPU or WebGL device or context was lost |
| `error_out_of_memory` | An allocation failed or the browser signalled out of memory |
| `error_worker` | A Web Worker failed or stopped unexpectedly |

- **Shape:** the same as the existing `DIAGNOSTICS` codes in
  [`src/expanded.ts`](../src/expanded.ts): Optional level, bucket `none`, one
  count per UTC day, app and code. OpenZCAD and OpenFEA; unknown codes are
  rejected. (Updated 13 November 2026: OpenLattice3D is also accepted, with a
  new consent version, under the
  [targeted-subset review](#review-openlattice3d-targeted-subset-adr-0001).)
  Local reports accept them under the same rules.
- **Never sent:** error messages, stacks, URLs, GPU, driver or adapter names,
  memory sizes, worker script names, durations, or any timestamp. The 5-second
  threshold is applied in the app; the actual duration stays there.
- **Consent:** after the existing v2 opt-in only. They fall within the v2
  description "fixed codes at explicit failure sites"; the owner should confirm
  that the app notices need no wording change. No consent-version change is
  proposed.
- **Risks:** as for the existing codes. One failure can produce several codes,
  custom clients can spoof them, and a day with a count of one shows that one
  opted-in browser hit that failure that day, without saying which. GPU loss and
  memory failures correlate with hardware, but no hardware detail is sent, so a
  daily count cannot single out a device.
- **Retention:** identical to existing data: `daily_counts` rows for 90 UTC
  calendar days, removed by the daily cron and excluded from reads after that.
  No migration.

### Account activity counts (OpenZCAD census)

| Field | Meaning |
| --- | --- |
| `active7d` | Consenting accounts with a project save in the last 7 days |
| `active30d` | Consenting accounts with a project save in the last 30 days |
| `idle90d` | Consenting accounts with no project save for 90 days or more |

- **Shape:** three integers added to OpenZCAD's existing aggregate snapshot,
  computed inside OpenZCAD over accounts with an unexpired account-statistics
  permission. All three are sent together or not at all, so older OpenZCAD
  versions keep working. Each must be a non-negative integer no larger than
  `accounts`, with `active7d` ≤ `active30d` and `active30d` + `idle90d` ≤
  `accounts`; otherwise the whole snapshot is rejected. The app may send `null`
  for a field it already withholds. Glimpse never receives account IDs,
  last-save dates or per-account rows.
- **k-threshold (K = 5, `ACTIVITY_MIN_COUNT`):** a count is withheld when it is
  below 5, or when fewer than 5 consenting accounts fall outside it (that
  complement is `accounts` minus the count, so it would be just as revealing).
  With fewer than 10 consenting accounts every count is withheld. Glimpse applies
  the rule at ingest and stores a withheld count as `NULL`, never the raw value;
  migration `0005` also rejects any stored count below 5. The rule is applied
  again when `/api/stats` reads rows and in the dashboard, which shows
  "Withheld (fewer than 5)". The OpenZCAD adapter should apply the same rule
  before sending, so small raw values never leave OpenZCAD.
- **Residual risk:** a threshold does not stop differencing. If `active7d` moves
  from 12 to 13 between two days, one consenting account saved in that window.
  Glimpse keeps only the latest snapshot per UTC day, access is owner-only behind
  Cloudflare Access, and rows expire after 90 days, but the owner accepted
  this without rounding when approving this section (13 November 2026).
- **Consent:** the separate OpenZCAD account-statistics permission currently
  describes numeric account and storage totals. Whether save activity is within
  that wording, or the permission text and version must change, is an owner
  decision to make before the adapter ships.
- **Retention:** identical to existing data: the latest snapshot per UTC day in
  `daily_census` for 90 UTC calendar days, removed by the daily cron and
  excluded from reads after that.
- **Schema:** migration `0005_census_activity.sql` adds nullable columns only.
  It is optional for the pending-migration guard: until it is applied,
  `/api/stats` serves everything else and snapshots are stored without activity
  counts.

### Before collection starts

1. Done: owner approval recorded on 13 November 2026.
2. OpenZCAD and OpenFEA adapter PRs send the codes; the OpenZCAD adapter sends
   the activity counts, with its account-permission text reviewed.
3. Migration `0005` is applied to Preview and Production under authorization.

## Review: OpenLattice3D targeted subset (ADR 0001)

**Accepted by the owner on 13 November 2026** through the choice of Option B in
[ADR 0001](decisions/0001-openlattice3d-v2-parity.md), roadmap feature
candidate 3. Glimpse accepts the events below from OpenLattice3D, but **nothing
is collected yet**: OpenLattice3D sends them only after its own adapter, consent
and notice changes, which are in the OpenLattice3D repository and are not made.

### Events

Optional level only, one count per UTC day, app, event and bucket, through the
fixed `OpenLattice3DIngest` entrypoint. The allowlist is `LATTICE_EXPANDED` in
[`src/expanded.ts`](../src/expanded.ts).

| Event | Buckets | Meaning (decided by the app, never sent as text) |
| --- | --- | --- |
| `error_runtime`, `error_import`, `error_export`, `error_storage`, `error_render` | `none` | Fixed failure sites: uncaught error, opening a model or project, writing an export, local project save or restore, viewport rendering |
| `error_unresponsive`, `error_gpu_lost`, `error_out_of_memory`, `error_worker` | `none` | The four codes [reviewed above](#additional-diagnostic-codes), with the same meanings |
| `export_latency` | `lt_100ms`, `100ms_1s`, `1s_10s`, `10s_60s`, `gte_60s` | Export time in the existing timing ranges |
| `project_size` | `lt_1mib`, `1_10mib`, `10_100mib`, `gte_100mib` | Saved project file size in the existing size ranges |
| `feature_category` | `create`, `import`, `export`, `measure`, `other` | Coarse category of a completed action |
| `lattice_cells` | `lt_1k`, `1k_10k`, `10k_100k`, `gte_100k` | Unit cells in a successfully generated lattice |

Rejected from OpenLattice3D: `error_mesh`, `error_solver`, `error_cloud_save`,
`error_cloud_load`, `error_feature`, `cloud_status`, `transfer_upload`,
`transfer_download`, `save_latency`, `mesh_latency`, `solver_latency`,
`solver_backend`, `part_count`, `feature_operation`, the `edit`, `mesh` and
`solve` feature categories, the census and anything unknown. `lattice_cells` is
rejected from OpenZCAD and OpenFEA. Local reports (`schema: 2`) accept
`app: "openlattice3d"` with exactly the same per-app scope.

### Cell-count bounds

- **Ranges:** under 1,000; 1,000–9,999; 10,000–99,999; 100,000 or more. Each is
  an order of magnitude, so a range says how heavy a lattice was without
  describing a particular model.
- **Wide top range:** very large lattices are likely rare among opted-in users.
  A finer top (for example a separate range from 1,000,000 cells) could hold one
  or two people and single out their models. Everything from 100,000 cells up
  shares one open range, which still separates the sizes where browser memory
  and GPU limits start to matter, the planning question this answers.
- **Never sent:** the exact count, beam or node counts, dimensions, unit-cell
  type, parameters, geometry, file names or any timestamp. The app computes the
  range locally and sends only its fixed string.
- **Residual risk:** a day with a count of one in the top range shows that one
  opted-in browser generated a large lattice that day, without saying which.
  Repeated generations count again, so counts are observations, not people or
  models.

### Consent, notice and retention

- **Consent:** a broader scope than OpenLattice3D's legacy grant. It needs a new
  consent version in OpenLattice3D with an updated notice naming diagnostics,
  export times, project sizes, action categories and lattice size ranges;
  existing grants do not carry over, as `granted-v1` did not for the other apps.
  DNT/GPC, withdrawal and cross-tab revocation must behave as in OpenZCAD and
  OpenFEA. These preconditions remain in OpenLattice3D. Glimpse cannot verify
  app-side consent, as for the other apps: a custom client can send allowed
  values.
- **Risks:** as for the existing codes and ranges. One failure can produce
  several codes and also the v1 `generation_failed` or `export_failed` outcome;
  counts can be spoofed or lost. No new dimension is added.
- **Retention:** identical to existing data: `daily_counts` rows for 90 UTC
  calendar days, removed by the daily cron and excluded from reads after that.
  No migration: `daily_counts` already allows `openlattice3d`
  (`0002_openlattice3d.sql`), and events and buckets are validated in code.

### Before collection starts

1. Done: owner acceptance through ADR 0001 Option B, 13 November 2026; Glimpse
   allowlist, reports, dashboard and tests.
2. OpenLattice3D: new consent version and notice, the adapter at its failure
   sites, export and save paths and generation step, the report download, and
   the event list confirmed against its actual failure sites (a code it has no
   site for is simply never sent).
3. Glimpse deployed with this allowlist before the OpenLattice3D adapter
   ships; earlier Glimpse versions reject these events.
