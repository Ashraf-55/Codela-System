# IMPLEMENTATION_PLAN — seventh pass (2026-11-27)

Prioritised from the audit (baseline: green unit tests, but 10 failing browser tests and a generic-looking UI). Every item is resolved or listed as external in REMAINING_GAPS.md.

| Priority | Finding | Resolution | Status |
|---|---|---|---|
| Critical | `tick()` grants one full-access request to long-lapsed subscriptions | catch-up transitions + regression tests (TDD) | done |
| Critical | browser suite not reproducible (82/10/1) despite docs claiming 91/0 | root-cause each failure; fix app or test (never weaken) | done — 99 passed, 0 failed, 0 flaky, 0 skipped (2026-11-27) |
| High | Super Admin navigation unreachable on phones | menu button + drawer + backdrop | done, browser-tested |
| High | duplicate sidebar links | de-duplicate by href | done, browser-tested |
| High | visual quality below commercial standard (166 lines of CSS, no icons, monospace numbers, emoji controls, wrapping KPIs) | design system v3 (DESIGN_SYSTEM.md) | done |
| Medium | `window.confirm` / no feedback after save/delete | accessible `<dialog>` + toasts | done |
| Medium | click-only sorting, form errors not linked to inputs | buttons + `aria-sort`; `aria-invalid` + `aria-describedby` | done |
| Medium | pricing ticks on unavailable features; ambiguous nav labels | fixed | done |
| Low | RTL hero punctuation with Latin names; off-screen helpers widening RTL pages | bidi isolates; clipped helpers | done (new sites) |
| External | gateway, messaging, DNS/TLS, monitoring, backups | documented | blocked by credentials |

---
# IMPLEMENTATION_PLAN — final status per phase

| Phase | Planned scope | Status |
|---|---|---|
| 1 Discovery & planning | skills read, architecture, schema, roadmap | Done (docs) |
| 2 Design system & UX foundation | tokens, RTL/LTR, components, 10 identities | Done: per-product tokens (WCAG-AA tested), RTL/LTR, CSS component kit, per-product theming. **Not done:** separate static design previews / Canvas Design deliverables |
| 3 Core infrastructure | monorepo, DB, auth, tenant isolation, errors | Done |
| 4 Core SaaS | tenants, roles, plans, subscriptions, entitlements, add-ons, white-label, domains, search, notifications | Done (add-on charging not wired to gateway) |
| 5 Internal administration | Super Admin, departments, analytics | Done (API + UI: tenants, plans, analytics, leads; tasks/settings/staff are API-only) |
| 6–10 Ten products | Medical, Real Estate, E-Commerce, Restaurant, Automotive, Learning, Construction, Booking, Fleet, Business | Backends + schema-driven dashboards done and tested; bespoke UIs (storefront cart, booking calendar, student portal, POS screen, kanban boards) **not built** |
| 11 Commercial & integrations | payments, messaging, domains, white-label, localization, tax | Boundaries + sandbox done; **no live provider verified**; AI add-on boundary not built |
| 12 QA & security audit | build, tsc, lint, tests, e2e, security | Done except browser e2e (no browser available) |
| 13 Optimisation, docs, delivery | docs, .env.example, clean tree, fresh-install check | Done (see FINAL_REPORT.md) |
