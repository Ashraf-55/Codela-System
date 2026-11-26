# Products overview and honest status

Single source: the statuses below are taken from the acceptance reports in `docs/ACCEPTANCE_*.md`. "Not browser-tested" applies to every product: no real-browser run has ever been done.

| # | Product | Public website | Specialised system | Portal | Notes |
|---|---|---|---|---|---|
| 1 | Booking | Specialised (booking wizard, manage booking) | Calendar day/week/month, scheduling engine | Optional account | Advance online payment not built |
| 2 | Med | Specialised (doctor directory and profile pages, real online booking, FAQ, articles, branches and map) | Pharmacy and radiology flows, invoices, calendar | Patient portal | No dedicated pharmacist / lab-technician roles or screens |
| 3 | Restaurant | Specialised (menu, cart, online order, tracking) | POS, kitchen display, tables, recipes, stock, purchasing, profit report, split bills, table transfer | Not required | Card payment and per-branch stock not built |
| 4 | Commerce | Storefront written this pass (see ACCEPTANCE_ecommerce.md) | Order board with shipping and payment actions | Orders list | **Written without being able to run checks** |
| 5 | Estate | Generic catalogue cards | Generic entity screens + deals board | — | Specialised property search, map and CRM screens not built |
| 6 | Auto | Specialised (services, server-side parts search, booking + quote requests) — written, unverified | Workshop board + requests board | — | See ACCEPTANCE_auto.md |
| 7 | Learn | Specialised (server-side course catalogue, course page, enrolment, reviews, FAQ) — written, unverified | Entity screens, live sessions + review moderation boards | Student portal | See ACCEPTANCE_learn.md |
| 8 | Build | Specialised (services, before/after portfolio, team, quote + inspection requests) — written, unverified | Project cockpit, contracts, progress claims | — | See ACCEPTANCE_build.md |
| 9 | Fleet | Tracking widget, shipment request | Driver portal `/driver` (written, unverified), proofs review, dispatch board | Driver portal | See ACCEPTANCE_fleet.md |
| 10 | Business | Specialised (services, industries, portfolio, team, careers, quote request) — written, unverified | Job roles (sales/warehouse/accountant/hr), quotations, attendance, ERP entities | — | See ACCEPTANCE_business.md |

The back end of all ten products is implemented and covered by API tests (see `docs/TESTING.md`).

## Update 2026-11-24
- All ten public websites now open with an explanation of the business (who we are, what we do, services, working hours), pre-filled per product in Arabic/English and editable from the website builder; the owner can add team, gallery, FAQ, SEO, hours/holidays, fonts/layout.
- Med: pharmacist, laboratory and radiology screens; patients see lab results and imaging reports in the portal once finished. Booking: refunds. Fleet: driver offline queue + GPS point. Commerce: server-side catalogue paging.
