# Codela Estate — acceptance report (product 5 of 10 specialised)

Date: 2026-11-20. `npm run check` passes (lint, typecheck, tests, build). **No browser tests were run.**

| Component | Status |
|---|---|
| Public website | Specialised: property search (purpose, location, type, project, keyword, price range, min area, bedrooms, sort, load more — all filtering/sorting done by the server), listing details (gallery, specs, features, address, Google map embed / map link, video link), projects & compounds with available units, sales team, viewing request for a property or a unit (creates/reuses the lead, creates a `requested` viewing, notifies the sales team). Not built: comparison/favourites, an interactive map of all listings, separate URL per listing |
| Website dashboard management | Complete via entity screens (properties with images/map/video, projects, units, brokers, locations, types) |
| Specialised management system | API (earlier passes, tested): CRM leads + follow-up history, viewings with broker clash prevention, sale deals with exact commissions, rentals, clients with requirements. Dashboard: Deals pipeline, **Leads pipeline** and **Viewings** boards (new). Not built: commissions payout screen, contract document generation |
| Customer portal | Not required |
| Subscription integration | Complete (shared core) |
| Security & tenant isolation | Passed (API tests; the generic isolation suite covers every Estate entity) |
| Functional tests | API passed; the new web screens are typechecked/built only |
| Browser tests | Not tested |
