# Codela Auto — management system acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `automotive.test.ts, auto-site.test.ts` and shared suites `governance.test.ts, platform.test.ts, security.test.ts, customer-payments.test.ts, manager-employees.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Authentication works | SHARED | ✅ API | `platform`: pagination + validation + auth; `security`: GET ${p} -> 401 without a session |
| 2 | Role permissions work | API | ✅ API | `automotive`: cancel after start returns the parts; cannot cancel when ready; `automotive`: employee works on work orders but cannot see supplier costs ledger edits or delete; KPIs real |
| 3 | Create operations work | API | ✅ API | `automotive`: prevents overlapping bookings for the same technician or vehicle; transitions validated; `automotive`: services and spare-parts catalogue; booking form; tracking by plate+phone; isolation |
| 4 | Read operations work | API | ✅ API | `automotive`: vehicles normalise plates, are unique per tenant, searchable by plate/VIN/make; `automotive`: computes labour+parts totals from the catalogue with integer math |
| 5 | Update operations work | API | ✅ API | `automotive`: prevents overlapping bookings for the same technician or vehicle; transitions validated; `automotive`: lines are editable only before work starts; starting consumes parts atomically |
| 6 | Delete operations work where permitted | API | ✅ API | `automotive`: cancel after start returns the parts; cannot cancel when ready; `automotive`: employee works on work orders but cannot see supplier costs ledger edits or delete; KPIs real |
| 7 | Validation works | API | ✅ API | `automotive`: spare parts: ledger-driven stock, unique SKU, no negative stock; `automotive`: prevents overlapping bookings for the same technician or vehicle; transitions validated |
| 8 | Database persistence works | API | ✅ API | `automotive`: spare parts: ledger-driven stock, unique SKU, no negative stock; `automotive`: computes labour+parts totals from the catalogue with integer math |
| 9 | Business workflows work end-to-end | API | ✅ API | `automotive`: invoice on ready, payments with overpay guard, delivery requires payment and updates odometer; `automotive`: vehicle maintenance history = work orders filtered by vehicle |
| 10 | Reports reflect actual data | API | ✅ API | `automotive`: employee works on work orders but cannot see supplier costs ledger edits or delete; KPIs real |
| 11 | Search works | API | ✅ API | `automotive`: vehicles normalise plates, are unique per tenant, searchable by plate/VIN/make; `automotive`: global search: customers, vehicles (plate/VIN), work orders, parts |
| 12 | Tenant isolation works | API | ✅ API | `automotive`: vehicles normalise plates, are unique per tenant, searchable by plate/VIN/make; `automotive`: services and spare-parts catalogue; booking form; tracking by plate+phone; isolation |
| 13 | Error handling works | API | ✅ API | `governance`: the owner builds a role from the product catalogue; reserved names, wildcards and owner-only po; `governance`: a role with payments.update but not payments.approve is refused; with approve it works |
| 14 | Important actions are audited | SHARED | ✅ API | `governance`: needs <module>.export; neutralises spreadsheet formulas; never includes another tenant; is audi |
| 15 | Plan limits are enforced | SHARED | ✅ API | `platform`: seeds 10 products x 3 plans and add-ons, idempotently; `platform`: new tenant starts a Starter trial with read of limits |

## All automated tests for this product (12)

- `automotive` — vehicles normalise plates, are unique per tenant, searchable by plate/VIN/make
- `automotive` — spare parts: ledger-driven stock, unique SKU, no negative stock
- `automotive` — prevents overlapping bookings for the same technician or vehicle; transitions validated
- `automotive` — computes labour+parts totals from the catalogue with integer math
- `automotive` — lines are editable only before work starts; starting consumes parts atomically
- `automotive` — cancel after start returns the parts; cannot cancel when ready
- `automotive` — invoice on ready, payments with overpay guard, delivery requires payment and updates odometer
- `automotive` — vehicle maintenance history = work orders filtered by vehicle
- `automotive` — services and spare-parts catalogue; booking form; tracking by plate+phone; isolation
- `automotive` — employee works on work orders but cannot see supplier costs ledger edits or delete; KPIs real
- `automotive` — global search: customers, vehicles (plate/VIN), work orders, parts
- `auto-site` — filters, sorts and pages the parts catalogue on the server; quote and booking land in one inbox told apart by kind

## Known gaps
See `docs/REMAINING_GAPS.md` (browser run, a11y automation, product-specific screens still on generic entity pages).

## Browser evidence (Playwright)

Product-specific tests from the last run:

- ✅ `a11y.spec.ts` — automotive: published site, dashboard and keyboard focus [chromium]
- ✅ `all-products.spec.ts` — public site: renders, has no script errors / failed requests, fits every viewport [chromium]
- ✅ `all-products.spec.ts` — dashboard: owner sees it, logout works, the session is gone afterwards [chromium]
- ✅ `all-products.spec.ts` — tenant isolation: a second business of the same product cannot see the first one’s records [chromium]
- ✅ `product-sites-responsive.spec.ts` — automotive: site + dashboard at desktop / tablet / mobile, working menu links [chromium]

Shared tests (site builder, platform features, security & isolation):

- ✅ `platform-features.spec.ts` — a new site already explains who we are and what we do; the owner's edits (SEO, hours, team, theme) appear after publishing and drafts stay hidden [chromium]
- ✅ `platform-features.spec.ts` — the builder screen saves what the owner types [chromium]
- ✅ `platform-features.spec.ts` — 30 products: page 1 of 3, Next requests page 2 from the API, search narrows the result [chromium]
- ✅ `platform-features.spec.ts` — the owner creates a role in the UI and the API enforces it for a staff member [chromium]
- ✅ `platform-features.spec.ts` — a lab technician only sees the laboratory screen; results appear in the patient portal [chromium]
- ✅ `platform-features.spec.ts` — settings, add-ons, announcements and templates load and save without console errors [chromium]
- ✅ `platform-features.spec.ts` — business: /app/stock [chromium]
- ✅ `platform-features.spec.ts` — fleet: /app/cash [chromium]
- ✅ `platform-features.spec.ts` — automotive: /app/workorders, /app/warranties [chromium]
- ✅ `platform-features.spec.ts` — construction: /app/estimates [chromium]
- ✅ `platform-features.spec.ts` — realestate: /app/commissions, /app/contracts [chromium]
- ✅ `platform-features.spec.ts` — learning: /app/course-builder [chromium]
- ✅ `platform-features.spec.ts` — medical: /app/pharmacy, /app/lab, /app/radiology [chromium]
- ✅ `platform-features.spec.ts` — realestate: the stand-alone property page has its own URL and unknown ids are 404 [chromium]
- ✅ `security-and-isolation.spec.ts` — tenant isolation: business B cannot read or change business A records [chromium]
- ✅ `security-and-isolation.spec.ts` — protected routes: anonymous users are bounced and admin APIs refuse tenant sessions [chromium]
- ✅ `security-and-isolation.spec.ts` — login lock-out after repeated wrong passwords [chromium]
- ✅ `security-and-isolation.spec.ts` — uploads: a script disguised as an image is rejected [chromium]
- ✅ `site-builder.spec.ts` — drag-and-drop section order is saved in the database and used by the published site [chromium]
- ✅ `site-builder.spec.ts` — per-page SEO slugs: create, validate duplicates and reserved words, publish, route, title, menu link [chromium]
- ✅ `site-builder.spec.ts` — image cropping: choose, adjust, preview, save the cropped file, show it on the published site [chromium]
