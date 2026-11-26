# IMPLEMENTATION PROGRESS (updated 2026-11-20)

Verified on the author's machine with `npm run check`: lint, typecheck, 47 test files / 465 tests, production build. **No browser tests have been run anywhere.**

| Product | Specialised public website | Specialised dashboard / workflows | Notes |
|---|---|---|---|
| Booking | booking wizard, manage booking | calendar day/week/month | advance online payment not built |
| Med | doctors directory + profile pages, online booking, branches/map, FAQ, articles | calendar, visit→invoice, pharmacy stock + dispensing, radiology, labs | pharmacy/radiology use generic screens; e-mail needs a provider |
| Restaurant | digital menu, cart, online ordering, tracking | POS, kitchen display, split bills, table transfer, profit, suppliers/payments | online card payment blocked (merchant gateway); stock per branch not built |
| Commerce | storefront (search, variants, cart, coupon, checkout, tracking, policies) | order board (carrier/tracking, record payment), payments, returns + exchanges, profit, low stock | online card payment blocked; no customer-initiated returns from the portal |
| Estate | property search, listing details, projects/units, viewing request | deals, leads and viewings boards | see ACCEPTANCE_estate.md |
| Auto, Learn, Build, Fleet, Business | generic tenant site + catalogues/forms | backend complete and tested; generic entity screens + simple boards | specialised UIs NOT built yet |

Shared platform: Super Admin, plans/trial/limits, manual payments, add-ons, RBAC, audit logs, search, notifications outbox (no fake sends), uploads, custom domains, 2FA, lock-out, password reset: implemented and API-tested.

Next: Estate → Auto → Learn → Build → Fleet → Business (specialised UIs and gap closing), browser e2e, DB hardening (see DATABASE.md).


## 2026-11-20 pass (nothing below was executed: no network, no browser in the authoring environment; syntax-parsed only)
* Customer manual payments (InstaPay / Vodafone Cash) for e-commerce, learning, medical, booking: API layer, receipt upload, staff review screen, customer Pay section, test `customer-payments.test.ts`. See PAYMENT_WORKFLOW.md.
* Estate API additions: property address / map / video fields, client requirements, `viewing` (broker clash prevention, lead stage follows), `followUp` history, public `viewingRequest` action. The Estate public search UI is NOT built yet.
* Commerce: customer return requests from the portal (`/portal/returns`, `ReturnsCard`), test `portal-returns.test.ts`.
* Not started: booking deposits, specialised UIs for Estate/Auto/Learn/Build/Fleet (incl. driver portal)/Business, restaurant per-branch stock, server-side catalogue filtering, medical role screens, add-on auto-renewal, Super Admin settings/ads/templates screens, builder audit, Playwright runs, final audit.


## 2026-11-20 (verified: check passes, 49 files / 471 tests)
* Customer InstaPay / Vodafone Cash payments now also cover restaurant (orders), automotive (invoices), construction (invoices) and business (invoices), in addition to e-commerce, learning, medical, booking. Tests added; PayPanel on the sites of all eight.
* Estate: public search/details/projects/viewing-request UI, leads and viewings boards (`/app/board?b=leads|viewings`).


## 2026-11-21 pass (NOT executed: no network/browser) — Auto
* Auto public site (`AutoSite.tsx`): services, server-side parts search/sort/paging, maintenance booking, quote requests; `bookingRequest.kind`; requests board; `auto-site.test.ts`; `ACCEPTANCE_auto.md`.
* Fleet driver portal (`/driver`, driver logins, proof of delivery, COD reconciliation, `/app/proofs`), `fleet-driver.test.ts`, `ACCEPTANCE_fleet.md` — written, NOT executed.
* Verified by owner: Auto + Fleet pass (51 files / 473 tests, build OK).
* Learn: FAQ, reviews (verified, moderated), class groups, `LearnSite`, review board, `learn-site.test.ts`, `ACCEPTANCE_learn.md` — written, NOT executed.
* Verified by owner: Learn pass (52 files / 474 tests, build OK).
* Build: contracts, progress claims, team/services, inspection requests, before/after, `BuildSite`, project cockpit, `build-site.test.ts`, `ACCEPTANCE_build.md` — written, NOT executed.
* Verified by owner: Build pass (see v13 check). Business pass (written, NOT executed): job roles mechanism, quotations, attendance, public company content + careers, `BusinessSite`, attendance page, boards, `business-site.test.ts`, `ACCEPTANCE_business.md`.

## 2026-11-24 — completion pass
Implemented and tested (API): public-site default copy for all 10 products; website builder fields (SEO, hours/holidays, team, gallery, items, theme, socials, `site` uploads); server-side store catalogue wiring; `approve`/`export` permissions + CSV export; custom roles; add-on monthly lifecycle; Super Admin announcements / notification templates / customer detail / manual subscription actions / exports; medical lab + imaging portal results; booking refunds; driver GPS point.
Implemented (UI, typechecked + built, public sites smoke-tested over HTTP, **not browser-tested**): builder page, `StoreSite`, `/app/roles`, `/app/pharmacy|lab|radiology`, admin settings/add-ons/announcements/templates/customer detail, billing add-on states, driver offline queue.
Totals: 60 test files / 510 tests passing; migration `0019`. See `docs/REMAINING_GAPS.md` for what is still open.

## 2026-11-24 — second pass
Customer payments (`refunded`, Fleet invoices, portal list); business stock-per-warehouse; learn rating aggregate; screens for work orders, warranties, estimates + printable claims, commissions, driver cash, contracts, course builder; property compare + own URL; 20 split acceptance reports. 513 tests pass. See `docs/REMAINING_GAPS.md`.
