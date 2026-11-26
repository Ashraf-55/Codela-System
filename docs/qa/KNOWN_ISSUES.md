# Known issues and limitations

## Open
1. **Registration error "Business address already taken"** reported by the owner on fresh databases: root cause not found. Extra logging was added (`[register-business] unique violation:` in the API log). Needs that log line.
2. **Production configuration**: set `PUBLIC_WEB_URL`; keep API port 4000 closed to the internet (reset links are built from request headers otherwise).
3. **No automatic recurring billing**; add-ons and paid upgrades are blocked (not billed) when a real gateway is active.
4. **Paymob never exercised live**; the comment next to `PAYMOB_API_KEY` in `.env.example` is stale.
5. **Browser coverage**: only three Playwright specs (one product), never run. Console and failed-network capture is not implemented.
6. **Not reviewed**: UI/UX of every route, RTL/responsive, per-product specialisation, student/customer portal completeness, exam timers, performance and load.
7. **SQLite**: single node, one writer; do not claim horizontal scaling.
8. Security review was done by one reviewer without an independent verifier.

## Fixed during this review (backed by passing tests)
Manager gained owner-only `employees.manage` in the Business product; 2FA endpoints returned 500; backup left `-wal/-shm` files; free add-on activation and free paid upgrades outside sandbox; outdated fleet and Resend test setups.
