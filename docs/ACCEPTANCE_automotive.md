# Codela Auto — acceptance report

Authoring environment of this pass: no network, no browser. Lint, typecheck, tests and build were **not run by the author**; the owner runs `npm run check`. Browser tests: none.

## Backend (already verified: `automotive.test.ts`, 11 tests, and the isolation sweep)
Customers and vehicles (plate/VIN unique per tenant, history), spare parts with ledger-driven stock, suppliers and purchasing, appointments with technician/vehicle clash prevention, work orders (integer totals, parts reserved/consumed atomically, cancel returns parts, invoice, payments, delivery updates odometer), tracking by plate + phone, KPIs, reports, search, tenant isolation, role limits. Customer InstaPay / Vodafone Cash payments on invoices (see PAYMENT_WORKFLOW.md).

## Added in this pass (written, not executed)
| Area | What | Status |
|---|---|---|
| API | `bookingRequest.kind` (booking / quote) + `partId`; public form `quote` (kind forced server-side, foreign part refused) | written; test `auto-site.test.ts` written, **not run** |
| Website | `AutoSite.tsx`: services with prices, spare-parts catalogue with **server-side** search (name/SKU/brand/compatibility), brand chips, price/name sorting and paging (12 per page), stock badge, maintenance booking form, quote request (optionally for a chosen part) | written; **not browser-tested** |
| Website | Tracking by plate + phone and the Pay section already exist on the site | existing |
| Dashboard | `Booking & quote requests` board (`/app/board?b=requests`: new → converted / rejected); workshop board for work orders (existing) | written; **not run** |

## Component status
| Component | Status |
|---|---|
| Public website | Partial: specialised sections written; not browser-tested |
| Website dashboard management | Existing entity screens (services, parts, vehicles, …) |
| Specialised management system | Partial: workshop board + requests board; **no** dedicated work-order screen (lines, parts, technician assignment use the generic entity form) |
| Customer portal | Not required (tracking by plate + phone) |
| Subscription integration | Complete (shared core) |
| Security & tenant isolation | API-level passed earlier; new code adds no new surface beyond the public form |
| Functional tests | Previous 471 passed; this pass's new test not yet run |
| Browser tests | Not tested |

## Known gaps
Converting a request into an appointment/work order is manual (staff create the record; the board only marks it converted). No dedicated work-order screen; no warranty screen beyond the generic entity; no responsive/browser verification.
