# Codela Estate — management system acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `realestate.test.ts` and shared suites `governance.test.ts, platform.test.ts, security.test.ts, customer-payments.test.ts, manager-employees.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Authentication works | SHARED | ✅ API | `platform`: pagination + validation + auth; `security`: GET ${p} -> 401 without a session |
| 2 | Role permissions work | API | ✅ API | `realestate`: a deal targets exactly one of property/unit; rent properties cannot be sold; `realestate`: employees cannot see commissions or delete; manager can |
| 3 | Create operations work | API | ✅ API | `realestate`: meta lists realestate entities; CRUD with code, filters, search; `realestate`: reserving a property blocks a second deal; completing marks sold and creates an exact commissio |
| 4 | Read operations work | API | ✅ API | `realestate`: meta lists realestate entities; CRUD with code, filters, search; `realestate`: a deal targets exactly one of property/unit; rent properties cannot be sold |
| 5 | Update operations work | API | ✅ API | `realestate`: cancelling a deal releases the property; invalid transitions rejected; `realestate`: commissions are system-created; only payment status can change |
| 6 | Delete operations work where permitted | API | ✅ API | `realestate`: cancelling a deal releases the property; invalid transitions rejected; `realestate`: employees cannot see commissions or delete; manager can |
| 7 | Validation works | API | ✅ API | `realestate`: cross-tenant references are rejected; `realestate`: cancelling a deal releases the property; invalid transitions rejected |
| 8 | Database persistence works | API | ✅ API | `realestate`: reserving a property blocks a second deal; completing marks sold and creates an exact commissio; `realestate`: commissions are system-created; only payment status can change |
| 9 | Business workflows work end-to-end | API | ✅ API | `platform`: expired trial -> read-only: reads work, writes 402, data kept; `security`: GET ${p} -> 401 without a session |
| 10 | Reports reflect actual data | API | ✅ API | `realestate`: KPIs and broker performance come from real records |
| 11 | Search works | API | ✅ API | `realestate`: meta lists realestate entities; CRUD with code, filters, search; `realestate`: global search covers properties, clients, brokers, leads, deals |
| 12 | Tenant isolation works | API | ✅ API | `realestate`: cross-tenant references are rejected; `realestate`: brokers and projects are public; sold properties disappear; inquiry links to a property of the  |
| 13 | Error handling works | API | ✅ API | `realestate`: cross-tenant references are rejected; `realestate`: cancelling a deal releases the property; invalid transitions rejected |
| 14 | Important actions are audited | SHARED | ✅ API | `governance`: needs <module>.export; neutralises spreadsheet formulas; never includes another tenant; is audi |
| 15 | Plan limits are enforced | SHARED | ✅ API | `platform`: seeds 10 products x 3 plans and add-ons, idempotently; `platform`: new tenant starts a Starter trial with read of limits |

## All automated tests for this product (15)

- `realestate` — meta lists realestate entities; CRUD with code, filters, search
- `realestate` — cross-tenant references are rejected
- `realestate` — projects and units: units belong to a project and track availability
- `realestate` — reserving a property blocks a second deal; completing marks sold and creates an exact commission
- `realestate` — cancelling a deal releases the property; invalid transitions rejected
- `realestate` — a deal targets exactly one of property/unit; rent properties cannot be sold
- `realestate` — units can be sold too
- `realestate` — commissions are system-created; only payment status can change
- `realestate` — contract occupies the property; ending releases; dates validated; no double rental
- `realestate` — pipeline stages; terminal stages are final
- `realestate` — KPIs and broker performance come from real records
- `realestate` — employees cannot see commissions or delete; manager can
- `realestate` — global search covers properties, clients, brokers, leads, deals
- `realestate` — advanced property search shows only available listings with public fields
- `realestate` — brokers and projects are public; sold properties disappear; inquiry links to a property of the same tenant

## Known gaps
See `docs/REMAINING_GAPS.md` (browser run, a11y automation, product-specific screens still on generic entity pages).

## Browser evidence (Playwright)

Product-specific tests from the last run:

- ✅ `a11y.spec.ts` — realestate: published site, dashboard and keyboard focus [chromium]
- ✅ `all-products.spec.ts` — public site: renders, has no script errors / failed requests, fits every viewport [chromium]
- ✅ `all-products.spec.ts` — dashboard: owner sees it, logout works, the session is gone afterwards [chromium]
- ✅ `all-products.spec.ts` — tenant isolation: a second business of the same product cannot see the first one’s records [chromium]
- ✅ `estate-map.spec.ts` — Estate: map plots only listings with real coordinates, rejects bad ones, links to each property URL [chromium]
- ✅ `lead-performance.spec.ts` — Estate lead performance screen shows real totals, per-source and per-broker win rates [chromium]
- ✅ `product-sites-responsive.spec.ts` — realestate: site + dashboard at desktop / tablet / mobile, working menu links [chromium]

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
