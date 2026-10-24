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

## Two distinct purposes

**Basic statistics** count API requests, server failures (HTTP 5xx), and response time buckets inside each app Worker. They observe work the server already performs. They never read browser storage, add a client ping, or receive model/project attributes. Static asset requests and health probes are excluded. They are operation counts, not visits, users, sessions, or adoption estimates. Browser-local exports and solves cannot be counted this way: the dashboard marks these as opt-in only in Basic mode.

**Optional analytics** count fixed feature/workflow actions and local outcomes only after an affirmative checkbox choice. They start off for every browser, including browsers with an old default-on analytics preference. OpenZCAD and OpenFEA save only `granted-v2` under their own consent keys; the earlier `granted-v1` choice does not authorize expanded collection. OpenLattice3D retains its separate legacy scope and consent version. No identifier is generated. The choice is separate across apps, not synchronized to an account. Refusal has no effect on the application. The same control withdraws consent immediately; pending requests are aborted, future sends recheck storage, and other open tabs follow storage events. DNT/GPC suppress sends. If saving withdrawal fails, collection stops in that page and the UI explains that site storage must be cleared to remove an older saved grant. Requests already received cannot be recalled; anonymous aggregate counts cannot be attributed to a person for deletion. The client has no event queue, retries, replay, or session recording.

Optional totals represent **opted-in users only**. They are not representative of all users. No consent rate, funnel per person, unique count, returning-visitor metric, or cross-app join is possible. “Workflow” means independent counts of steps; it does not reconstruct a sequence.

## Strict data boundary

The browser sends exactly `event` and `bucket`. The app relay rejects extra fields, unknown values, cross-origin requests, oversized streamed bodies, and unsupported methods/content types. The app adds `level: optional`; fixed service-binding entrypoints select the app. Basic measurements are generated only on the backend. Glimpse revalidates the entire vocabulary and immediately upserts `(UTC day, app, level, event, bucket, count)` in D1. There is no raw event store, exact timestamp, unique key, cookie, IP, user agent, referrer, URL, filename, project/model name, email, geometry, model content, account key, or persistent visitor identifier in the analytics schema.

Optional ingress is capped at 120 requests/minute per app/Cloudflare rate-limit location using one constant key, without an IP-derived key. This is a best-effort safety cap, not a billing guarantee or abuse-proof statistic. The relay cannot prove a human consented: a custom client can submit allowed values, so totals can be polluted. Backend failure and client throttling can undercount. OpenLattice3D is a third fixed app with its own consent key and RPC entrypoint; its only Optional events are workspace opens, export outcomes, lattice generation outcomes and coarse operation times. No new identifying dimensions are introduced. Counts are not transactional business records.

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
