# Project audit (Phase 0) — baseline against the master prompt

Environment: Node 22, **no network** → no `npm ci`, so lint/typecheck/vitest/build/Playwright could not be run. Findings below come from reading code and docs; the earlier "375/375" result in FINAL_REPORT.md is the user's own run, not re-verified here.

## Already present (per docs and code reading)
Monorepo (Next.js web, Express+Drizzle+SQLite API, shared/design/db packages), auth + sessions + CSRF + 2FA, RBAC, tenant-scoped records, subscriptions/entitlements/add-ons, Paymob + sandbox gateways with signed webhooks, white-label site + domains, search, notification outbox, uploads with magic-byte checks, customer & student portals, backend + board screens for all 10 products, Super Admin API, Docker/Caddy/pm2 deployment files.

## Gaps against the master prompt
| # | Requirement | State |
|---|---|---|
| 1 | Manual InstaPay / Vodafone Cash with receipt review (§9) | **Was missing** (only Paymob/sandbox). Backend now added — see PAYMENT_WORKFLOW.md. UI pending, tests not yet run |
| 2 | Super Admin payment-review screen | Pending (API only) |
| 3 | Browser/E2E, responsive, a11y testing | Never run |
| 4 | Ordering inside customer account (commerce/restaurant) | Not built |
| 5 | Server-side exam timer, video hosting | Not built |
| 6 | Platform-staff self-service password reset | Not built |
| 7 | Live providers (Paymob, e-mail, SMS, WhatsApp, DNS/SSL) | Not verified live |
| 8 | Database is SQLite (single node) | Fine for first customers; PostgreSQL migration plan needed before scale |
| 9 | Fifth-pass code (recovery, student portal, avatars, Docker) | Written offline, never compiled — run `npm run check` first |

## Security notes from reading
Tenant-scoped lookups and CSRF on writes are consistently applied in the files I read (uploads, billing, platform-admin). Not a full audit: the security-audit skill's full workflow (sandboxed execution, six phases) needs a runnable environment and was not performed.

## Next steps
1. Run `npm ci && npm run check` locally; fix the first failures (especially fifth-pass files and the new manual-payments tests).
2. Build UI: tenant "Pay by InstaPay / Vodafone Cash" form + history; Super Admin "Payments review" page; payment-instructions settings form.
3. Playwright run of the journey register → trial → pay → approve → active.
4. Then the remaining items in the gap table.
