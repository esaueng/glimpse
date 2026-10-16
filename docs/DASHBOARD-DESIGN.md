# Dashboard implementation contract

Direction: compact technical dark console, refined from the concept by the
owner's request to replace side navigation with a top bar. Native React/CSS and
SVG; no new chart/UI dependency, imagery, gradients, tracking or fonts fetched.

Top bar: G / Glimpse, Overview, Storage, Diagnostics, Privacy, Cloudflare Access /
Only you. Main: heading and refresh/update state, app/collection/UTC date filters,
scope notice, divided metrics strip, Daily activity / Application totals, Cloud
document size / Diagnostics, collapsed Performance, local user-shared reports.
Dynamic values and privacy/measurement corrections replace illustrative text.
No unsupported OpenFEA accounts/storage totals, invented percent changes or
unique visitor counts. Empty, unavailable and unsupported are distinct states.

Palette: canvas #10151f, panel #192332, text #e8eef7, muted #a2b0c4, border
#334154, control border #60718a, teal #56d8be, comparison #a9c9fa, error #ff97a6.
System sans UI (14px, 1.45 line height), 28px headings, 18px panel headings,
30px tabular monospace metric values. 4-6px radii, 16px gutters, 24-40px outer
margins, 36px table rows. Top nav underline marks selection; keyboard focus is
visible and charts provide tables/text alternatives.

Analytical job: operational monitoring and comparison over time, category ranking
and distributions. Primary route: React-owned SVG line charts and semantic HTML
tables/bars; fallback is an expandable daily-data table. At most one time-series
chart (90 points per app), three histograms and finite ranked tables visible.
No live animation or polling; manual refresh shows last successful UTC update.
Failed refresh preserves prior results marked stale and their applied scope.
No automatic external request on report inspection.

App, collection, date range and view are URL-backed; popstate restores them.
Draft filters apply together. Storage/Diagnostics select Optional collection.
On mobile, navigation stays in a top row with wrapping; the main values remain
above charts, filters collapse with a native disclosure, and wide detailed tables
scroll inside labelled containers. No hover-only essential values.

Reports are strict local files limited to 64 KiB and 128 unique aggregate rows,
validated by the same schema as producers. Invalid files clear prior report state.
Report rows never enter service totals. Clear and reload remove local report UI.

Final fidelity ledger: top-bar navigation replaced the initial side rail at the
owner's request; compact panels, 28px headings, 30px monospace metrics, original
dark tokens and native filters are retained. Chart labels were enlarged; bar
lengths now agree with percent shares. Applied scope is explicit. The merged
third-app integration adds a comparison line and completed-outcome table column;
no new third-app tracking is introduced. Daily data tables and Paste JSON are
intentional accessible/local-report affordances. Native-size desktop and mobile
renders were inspected with the concept using view_image; no material mismatch
or mobile page overflow remains. Dynamic counts and native date formatting are
intentional differences from illustrative concept data.

Overview copy was reduced at the owner's request: no subtitle, chart caption,
explanatory panel paragraphs or footer. One compact applied-scope line retains
opt-in, app/date and OpenZCAD snapshot context. Report inspection lives only in
Diagnostics; definitions and privacy details remain in detailed views.
