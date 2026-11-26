# Codela Commerce — management system acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `ecommerce.test.ts, portal-returns.test.ts, board-ecommerce.test.ts` and shared suites `governance.test.ts, platform.test.ts, security.test.ts, customer-payments.test.ts, manager-employees.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Authentication works | SHARED | ✅ API | `platform`: pagination + validation + auth; `security`: GET ${p} -> 401 without a session |
| 2 | Role permissions work | API | ✅ API | `ecommerce`: stock movements adjust stock; cannot go negative; ledger immutable; `ecommerce`: employee: orders yes; coupons/refunds/suppliers no; KPIs and reports are real |
| 3 | Create operations work | API | ✅ API | `ecommerce`: quote, checkout (creates customer+order), tracking requires matching phone, tenant isolation; `ecommerce`: payments are recorded against the order; they add up to the total, then the order is paid; no o |
| 4 | Read operations work | API | ✅ API | `ecommerce`: variants: unique SKU, readonly stock, ledger-driven stock; `ecommerce`: catalog shows only active products with filters; no private fields |
| 5 | Update operations work | API | ✅ API | `ecommerce`: transitions, invoice on confirm, restock on cancel, refund required if paid, terminal immutable; `board-ecommerce`: points at the real order entity and its status values |
| 6 | Delete operations work where permitted | API | ✅ API | `ecommerce`: transitions, invoice on confirm, restock on cancel, refund required if paid, terminal immutable; `ecommerce`: gross profit = net sales - cost of goods from the cost snapshot; cancelled orders drop out; onl |
| 7 | Validation works | API | ✅ API | `ecommerce`: stock movements adjust stock; cannot go negative; ledger immutable; `ecommerce`: rejects inactive products, invalid/expired/overused coupons, cross-tenant variants |
| 8 | Database persistence works | API | ✅ API | `ecommerce`: variants: unique SKU, readonly stock, ledger-driven stock; `ecommerce`: stock movements adjust stock; cannot go negative; ledger immutable |
| 9 | Business workflows work end-to-end | API | ✅ API | `ecommerce`: transitions, invoice on confirm, restock on cancel, refund required if paid, terminal immutable; `ecommerce`: only delivered orders; full flow restocks and refunds exactly once |
| 10 | Reports reflect actual data | API | ✅ API | `ecommerce`: employee: orders yes; coupons/refunds/suppliers no; KPIs and reports are real; `ecommerce`: gross profit = net sales - cost of goods from the cost snapshot; cancelled orders drop out; onl |
| 11 | Search works | API | ✅ API | `ecommerce`: global search finds products, variants (SKU), customers, orders |
| 12 | Tenant isolation works | API | ✅ API | `ecommerce`: rejects inactive products, invalid/expired/overused coupons, cross-tenant variants; `ecommerce`: quote, checkout (creates customer+order), tracking requires matching phone, tenant isolation |
| 13 | Error handling works | API | ✅ API | `ecommerce`: rejects inactive products, invalid/expired/overused coupons, cross-tenant variants; `ecommerce`: checkout rejects insufficient stock atomically |
| 14 | Important actions are audited | SHARED | ✅ API | `governance`: needs <module>.export; neutralises spreadsheet formulas; never includes another tenant; is audi |
| 15 | Plan limits are enforced | SHARED | ✅ API | `platform`: seeds 10 products x 3 plans and add-ons, idempotently; `platform`: new tenant starts a Starter trial with read of limits |

## All automated tests for this product (23)

- `ecommerce` — variants: unique SKU, readonly stock, ledger-driven stock
- `ecommerce` — stock movements adjust stock; cannot go negative; ledger immutable
- `ecommerce` — computes totals with integer math, ignores client totals, decrements stock
- `ecommerce` — free shipping over the threshold; fixed coupon capped at subtotal
- `ecommerce` — is atomic: a failing line leaves stock and coupon untouched
- `ecommerce` — rejects inactive products, invalid/expired/overused coupons, cross-tenant variants
- `ecommerce` — transitions, invoice on confirm, restock on cancel, refund required if paid, terminal immutable
- `ecommerce` — only delivered orders; full flow restocks and refunds exactly once
- `ecommerce` — catalog shows only active products with filters; no private fields
- `ecommerce` — quote, checkout (creates customer+order), tracking requires matching phone, tenant isolation
- `ecommerce` — checkout rejects insufficient stock atomically
- `ecommerce` — employee: orders yes; coupons/refunds/suppliers no; KPIs and reports are real
- `ecommerce` — global search finds products, variants (SKU), customers, orders
- `ecommerce` — gross profit = net sales - cost of goods from the cost snapshot; cancelled orders drop out; only finance-level roles see profit
- `ecommerce` — low stock is flagged from the reorder level (and follows every stock movement)
- `ecommerce` — compare-at price and featured are public; only active policies are public
- `ecommerce` — payments are recorded against the order; they add up to the total, then the order is paid; no overpay; cancelled orders take none
- `ecommerce` — an exchange restocks the returned goods and ends with a replacement order of the same customer, never with a refund
- `portal-returns` — only for own delivered orders, one open request at a time, quantities checked, refunds stay with the merchant
- `board-ecommerce` — points at the real order entity and its status values
- `board-ecommerce` — only offers transitions the API allows
- `board-ecommerce` — the shipping step is a legal transition and uses editable fields
- `board-ecommerce` — record-payment moves unpaid -> paid, the only payment change the API accepts

## Known gaps
See `docs/REMAINING_GAPS.md` (browser run, a11y automation, product-specific screens still on generic entity pages).

## Browser evidence (Playwright)

Product-specific tests from the last run:

- ✅ `a11y.spec.ts` — ecommerce: published site, dashboard and keyboard focus [chromium]
- ✅ `all-products.spec.ts` — public site: renders, has no script errors / failed requests, fits every viewport [chromium]
- ✅ `all-products.spec.ts` — dashboard: owner sees it, logout works, the session is gone afterwards [chromium]
- ✅ `all-products.spec.ts` — tenant isolation: a second business of the same product cannot see the first one’s records [chromium]
- ✅ `product-sites-responsive.spec.ts` — ecommerce: site + dashboard at desktop / tablet / mobile, working menu links [chromium]

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
