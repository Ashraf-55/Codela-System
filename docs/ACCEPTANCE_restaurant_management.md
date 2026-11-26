# Codela Restaurant — management system acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `restaurant.test.ts` and shared suites `governance.test.ts, platform.test.ts, security.test.ts, customer-payments.test.ts, manager-employees.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Authentication works | SHARED | ✅ API | `platform`: pagination + validation + auth; `security`: GET ${p} -> 401 without a session |
| 2 | Role permissions work | API | ✅ API | `restaurant`: cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order; `restaurant`: employee runs orders but cannot see recipes/ingredient ledger edits/shifts reports; KPIs real |
| 3 | Create operations work | API | ✅ API | `restaurant`: menu CRUD with extras validation; ingredient stock is ledger-driven; `restaurant`: payment sets paidAt and creates one invoice; completion requires payment and frees the table |
| 4 | Read operations work | API | ✅ API | `restaurant`: cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order; `restaurant`: menu shows only available items; branches public; tables/recipes private |
| 5 | Update operations work | API | ✅ API | `restaurant`: deducts recipe ingredients when preparing; insufficient stock blocks the transition atomically; `restaurant`: cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order |
| 6 | Delete operations work where permitted | API | ✅ API | `restaurant`: cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order; `restaurant`: profit = sales - cost of goods (recipe qty x purchase cost) - waste; cancelling while preparing |
| 7 | Validation works | API | ✅ API | `restaurant`: menu CRUD with extras validation; ingredient stock is ledger-driven; `restaurant`: validates order shape: table for dine-in, delivery contact, unknown extras, unavailable items,  |
| 8 | Database persistence works | API | ✅ API | `restaurant`: menu CRUD with extras validation; ingredient stock is ledger-driven; `restaurant`: computes extras, discount, service charge and tax exactly; ignores client prices |
| 9 | Business workflows work end-to-end | API | ✅ API | `restaurant`: validates order shape: table for dine-in, delivery contact, unknown extras, unavailable items, ; `restaurant`: cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order |
| 10 | Reports reflect actual data | API | ✅ API | `restaurant`: employee runs orders but cannot see recipes/ingredient ledger edits/shifts reports; KPIs real; `restaurant`: profit = sales - cost of goods (recipe qty x purchase cost) - waste; cancelling while preparing |
| 11 | Search works | API | ✅ API | `restaurant`: global search: menu items, tables, reservations, orders |
| 12 | Tenant isolation works | API | ✅ API | `restaurant`: online order (takeaway/delivery only) and tracking by phone; reservation form; isolation; `restaurant`: a POS order that does not state a tax rate gets the tenant default; an explicit rate wins |
| 13 | Error handling works | API | ✅ API | `restaurant`: an open dine-in order can move to a free table; the old table is freed and the new one occupied; `governance`: the owner builds a role from the product catalogue; reserved names, wildcards and owner-only po |
| 14 | Important actions are audited | SHARED | ✅ API | `governance`: needs <module>.export; neutralises spreadsheet formulas; never includes another tenant; is audi |
| 15 | Plan limits are enforced | SHARED | ✅ API | `platform`: seeds 10 products x 3 plans and add-ons, idempotently; `platform`: new tenant starts a Starter trial with read of limits |

## All automated tests for this product (22)

- `restaurant` — menu CRUD with extras validation; ingredient stock is ledger-driven
- `restaurant` — computes extras, discount, service charge and tax exactly; ignores client prices
- `restaurant` — validates order shape: table for dine-in, delivery contact, unknown extras, unavailable items, out-of-service tables
- `restaurant` — deducts recipe ingredients when preparing; insufficient stock blocks the transition atomically
- `restaurant` — cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order type
- `restaurant` — payment sets paidAt and creates one invoice; completion requires payment and frees the table
- `restaurant` — kitchen display = orders filtered by status; delivery goes out_for_delivery
- `restaurant` — one open shift; closing computes expected cash and difference; closed shifts are immutable
- `restaurant` — closing requires closingCash
- `restaurant` — prevents table clashes and oversize parties; confirmation needs a table
- `restaurant` — menu shows only available items; branches public; tables/recipes private
- `restaurant` — online order (takeaway/delivery only) and tracking by phone; reservation form; isolation
- `restaurant` — employee runs orders but cannot see recipes/ingredient ledger edits/shifts reports; KPIs real
- `restaurant` — global search: menu items, tables, reservations, orders
- `restaurant` — a POS order that does not state a tax rate gets the tenant default; an explicit rate wins
- `restaurant` — a purchase computes its total on the server and receiving it adds each ingredient to stock exactly once; terminal purchases are immutable
- `restaurant` — waste is recorded through the ledger and cannot exceed stock; only active offers are public
- `restaurant` — profit = sales - cost of goods (recipe qty x purchase cost) - waste; cancelling while preparing gives the cost back; supplier debt is tracked
- `restaurant` — a bill can be split into several payments; the order is paid and invoiced only when they add up to the total
- `restaurant` — an open dine-in order can move to a free table; the old table is freed and the new one occupied; busy/other-type moves are refused
- `restaurant` — branch stock is separate: movements, order deductions and transfers never touch another branch
- `restaurant` — the ledger is system-written only and isolated between tenants

## Known gaps
See `docs/REMAINING_GAPS.md` (browser run, a11y automation, product-specific screens still on generic entity pages).

## Browser evidence (Playwright)

Product-specific tests from the last run:

- ✅ `a11y.spec.ts` — restaurant: published site, dashboard and keyboard focus [chromium]
- ✅ `all-products.spec.ts` — public site: renders, has no script errors / failed requests, fits every viewport [chromium]
- ✅ `all-products.spec.ts` — dashboard: owner sees it, logout works, the session is gone afterwards [chromium]
- ✅ `all-products.spec.ts` — tenant isolation: a second business of the same product cannot see the first one’s records [chromium]
- ✅ `product-sites-responsive.spec.ts` — restaurant: site + dashboard at desktop / tablet / mobile, working menu links [chromium]

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
