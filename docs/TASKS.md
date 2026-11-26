# TASKS — master checklist (updated per phase)
- [x] P1 Read 5 skills (writing-plans, TDD, frontend-design, ui-ux-pro-max, canvas-design)
- [x] P1 ARCHITECTURE.md · DATABASE_SCHEMA.md · IMPLEMENTATION_PLAN.md · TASKS.md
- [ ] P2 Design system / RTL-LTR / components / 10 identities
- [ ] P3 Infra: monorepo, Prisma+SQLite, auth, tenantDb, logging
- [ ] P4 Core SaaS: tenants, roles, subscriptions, entitlements, add-ons, search, notifications
- [ ] P5 Super Admin + internal ops + revenue reports
- [ ] P6 Medical · Real Estate
- [ ] P7 E-Commerce · Restaurant
- [ ] P8 Automotive · Learning
- [ ] P9 Construction · Booking
- [ ] P10 Fleet · Business
- [ ] P11 Payments/notifications/domains/white-label/localization/marketing
- [ ] P12 Full QA + security audit
- [ ] P13 Optimize, docs, fresh-install check, ZIP

## Progress log
- P2 (partial): design tokens for 10 products (WCAG AA tested), RTL/LTR direction util — DONE & tested. UI component library + representative screens — PENDING (needs Next.js app).
- P3 (partial): Drizzle+better-sqlite3 (Prisma engines blocked in sandbox → equivalent ORM allowed by spec), migrations, tenant-scoped repos, auth/session/CSRF/RBAC API, money utils — DONE & tested (68 tests). Pending: logging, env config, server.ts entry.
- P4 (partial): subscription state machine (trial/active/past_due/suspended/expired/canceled, grace, read-only access policy), seeded products/plans/add-ons, backend entitlement enforcement (employees, records), downgrade guard, sandbox activation (flagged simulated), add-ons marketplace with product compatibility, global search (tenant+permission aware, Arabic digit normalization, LIKE-escaped, paginated), in-app notifications — DONE & tested (106 tests, tsc clean). PENDING in P4: white-label/site config, custom-domain verification foundation, branches usage, employee invitation flow, file management, audit-log API.
- P4 (rest) DONE & tested: white-label site (draft/publish, https-only URLs, hex colors, template entitlement), custom-domain add/verify (DNS TXT via injectable resolver)/primary/remove with global hostname uniqueness and routing only for VERIFIED domains, tenant audit-log API. SSL provisioning NOT implemented (status stays `pending_provisioning`; needs infra e.g. Caddy/Cloudflare).
- P5 (partial) DONE & tested: separate platform auth (psid cookie, short sessions), staff roles (super_admin/support/finance) + departments, tenants list/search/filter/detail, suspend/activate (enforced immediately), plan/product/add-on admin (configurable, integer prices), analytics (MRR/ARR/counts from subscription records, flagged simulated), staff creation, platform audit log, create-admin CLI. PENDING P5: internal departments' workflows (leads/demo requests/sales pipeline/tasks), notification settings & integration config UI, system settings, UI dashboard (needs Next.js).
- Verification this session: vitest 130/130 passed, tsc clean. NOT yet run: lint, e2e, production build (no frontend yet).
- P5 (rest) DONE & tested: public lead/demo capture (honeypot + rate limit), sales pipeline (stages, conversion rate), internal tasks per department, platform settings (secrets rejected). Still PENDING in P5: Super Admin UI.
- P6 DONE & tested (backend): declarative product framework (typed validation, refs, unique keys, restrict-delete, immutability, hooks, KPIs, reports, public catalog/forms, audit of sensitive reads) + MEDICAL (specialties, doctors, schedules, services, patients, appointments w/ conflict+schedule checks, medical records/history/prescriptions/labs, invoices w/ integer totals, payments w/ overpay guard, inquiries, appointment requests) + REAL ESTATE (types, locations, projects, properties, units, brokers, clients, leads, sale deals w/ availability locking + exact commission, rentals, commissions, documents, advanced public search). Product UIs NOT built (no frontend yet).
- Verification: vitest 181/181 passed, tsc clean. NOT run: lint, e2e, production build.
- P7 DONE & tested (backend): E-COMMERCE (categories, suppliers, products, variants w/ ledger-driven stock, coupons, shipping/payment methods, customers, orders with catalog-priced integer totals + atomic stock reservation + lifecycle + invoices, returns/refunds with restock and over-refund guard, storefront catalog/quote/checkout/tracking) and RESTAURANT (menu with extras, branches, tables, ingredients+recipes with automatic kitchen deduction, orders dine-in/takeaway/delivery with service/tax math, kitchen workflow, payment+invoice, cashier shifts with cash reconciliation, reservations with table-clash checks, public menu/online order/tracking/reservation form).
- Known gaps P7: storefront customer accounts (end-customer login) NOT implemented; online payment capture needs gateway (P11); online order tax/service default to 0 until site-level tax settings exist; no purchase orders for suppliers; no UI.
- Verification: vitest 208/208 passed, tsc clean. NOT run: lint, e2e, production build.
- P8 DONE & tested (backend): AUTOMOTIVE (customers, plate-normalised vehicles, service catalogue, technicians, spare parts + ledger, maintenance appointments w/ overlap checks, work orders w/ catalogue-priced totals, parts consumption on start (atomic), invoices on ready, payments, delivery gated on payment + odometer update, public services/parts/booking/tracking) and LEARNING (categories, instructors, courses w/ publish rule, lessons, live sessions, students, enrollments w/ capacity+price snapshot, payments, lesson progress → completion %, exams/questions/attempts with exact grading + attempt limits, attendance, certificates with eligibility + public verification, public catalogue/registration).
- P9 DONE & tested (backend): CONSTRUCTION (clients, suppliers, materials+ledger, projects w/ server-owned budget/actual/progress/over-budget flags, milestones, tasks, budget lines, expenses ledger, quotations→project on acceptance, purchase orders (receiving adds stock + books cost), workers, non-overlapping assignments, work logs → labour expense, invoices/payments, public portfolio + quote requests) and BOOKING (branches, categories, services w/ buffer, staff skills, schedules, time off, customers unique by phone, cancellation policy fees, appointments with full slot validation, payments, public availability/book/status/cancel with auto staff assignment and in-app notification).
- Known gaps P8/P9: Learning student accounts/portal and Booking customer accounts need end-customer auth (NOT implemented); customer-facing reminders (SMS/WhatsApp/email) need providers (P11); Automotive/Construction have no multi-branch support yet; times are UTC-based (tenant time zones P11); no UI.
- Verification: vitest 251/251 passed, tsc clean. NOT run: lint, e2e, production build.
- P10 DONE & tested (backend): FLEET & DELIVERY (branches, customers, drivers w/ licence check, vehicles w/ capacity, rate rules + integer fee calc incl. COD fee, shipments with tracking codes + ordered event timeline, dispatch assignments (licence/vehicle/capacity/one-active rules), full delivery state machine, failed attempts → automatic return after 3, COD cash collection + settlement, fleet expenses, public tracking portal/quote/shipping request) and BUSINESS (customers, warehouses, suppliers, products with per-warehouse stock ledger + transfers, purchase orders with receiving → stock + expense + ledger, sales invoices priced from catalogue with atomic stock deduction on issue, payments → ledger income, CRM leads (win → customer, dedupe) and deal pipeline w/ weighted value, expenses, immutable ledger + cash-flow, HR records (audited reads), tasks, public catalogue/inquiry).
- ALL 10 PRODUCTS now have tested backends. Verification: vitest 270/270 passed, tsc clean. NOT run: lint, e2e, production build.
- STILL MISSING (honest): the entire web UI (Next.js: corporate site, product marketing pages, onboarding, tenant dashboards for 10 products, Super Admin UI, tenant public websites/templates, ar/en + RTL runtime i18n), payment gateway + notification providers (P11), end-customer accounts, tenant time zones/tax settings UI, lint/e2e/production build/final docs (P12/P13).

## FINAL VERIFICATION (clean-room, executed)
Empty copy of the repository (no node_modules/.next/data/.env) → `npm ci` (with the committed `.npmrc`: `ignore-scripts=true`, because better-sqlite3 ships prebuilt binaries and `node-gyp` fails in environments without a compiler) → `eslint .` **0 problems** · `npm run typecheck` **0 errors** · `vitest run` **340/340 passed (27 files)** · `npm run build` **OK** · `scripts/smoke.sh` **30/30 PASS**. `npm audit --omit=dev`: **0 vulnerabilities**.
Finding fixed during verification: `npm ci` failed on a machine without a C++ toolchain because npm tried `node-gyp rebuild` for better-sqlite3 → solved by `.npmrc`.
Not verified anywhere: browser rendering/interaction/accessibility, live payment/SMS/WhatsApp/email, DNS/SSL, load.

## Fifth pass
- [x] Staff/owner password reset + e-mail verification
- [x] Student portal: lessons, assignments, exams (+ certificate request)
- [x] Customer portal: notifications list, payment history; profile picture (customers and staff)
- [x] Database audit (indexes, FKs, integrity test, doc)
- [x] Resend delivery receipts
- [x] Error monitoring adapter (Sentry protocol)
- [x] Docker / compose / Caddy / pm2 / systemd files
- [x] Updated final report
- [ ] Ordering from inside the customer account (e-commerce, restaurant)
- [ ] Automatic monthly card charging (needs Paymob tokenisation enabled on the merchant account)
- [ ] Platform-staff self-service password reset
- [ ] Server-side exam timer; video hosting (lessons link to external URLs)
- [ ] Browser (Playwright) run of the whole journey; live-provider verification (Paymob, Resend, Twilio, WhatsApp, Sentry)

## Sixth pass (this session, no network)
- [x] Phase 0 audit → docs/PROJECT_AUDIT.md
- [x] Manual InstaPay/Vodafone Cash backend (schema, migration 0016, routes, `payments.review` permission, 9 tests written) → docs/PAYMENT_WORKFLOW.md — **tests not executed**
- [x] Manual payment UI written: tenant panel in /app/billing (components/ManualPayment.tsx), Super Admin /admin/payments (review + payment instructions form) — **never compiled or opened in a browser**
- [ ] Run all tests, browser tests, remaining gaps
