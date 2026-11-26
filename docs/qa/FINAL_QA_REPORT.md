# Final QA report (honest status)

**Browser verification: NOT PERFORMED. No feature in this project is marked VERIFIED in a real browser.**

## Why
The review that produced this package ran in an environment with no access to the npm registry and no way to start the application (dependencies could not be installed, no Playwright browser). Therefore no workflow was executed in a browser, and **no screenshots, traces or videos exist**. None were fabricated. `docs/qa/evidence/screenshots/` is empty on purpose.

## What has real evidence
| Claim | Evidence | Limits |
|---|---|---|
| Backend/API tests pass | Owner ran `npm test` on Windows: 45 test files, 424 tests, 424 passed (terminal output, 2026-11-15) | no log file was stored; re-run `scripts/qa-collect.ps1` to store one |
| No known vulnerable production dependency | Owner ran `npm run audit:prod`: 0 vulnerabilities | point-in-time result |
| Source security review, fixes applied | `docs/security/SECURITY_AUDIT_2026-11.md`, tests `manager-employees`, `twofa-auth`, `billing-no-free-upgrades` | review by one reviewer, no independent verifier; HTTP behaviour confirmed only through the unit/API tests |

## What has NO evidence (not run by anyone, status unknown)
`npm run lint`, `npm run typecheck`, `npm run build`, all Playwright tests, UI/UX review of every route, RTL/LTR and responsive checks, student/customer portal in a browser, per-product browser workflows, load tests, any live integration.

## Not implemented in this review
The product-specialisation, portal-completion, exam-timer, recurring-billing and UI/UX missions were not carried out. They need an environment where the app can run and be iterated on (see "How to continue").

## How to reproduce / continue
1. `npm ci`, then in two terminals `npm run dev:api` and `npm run dev:web`.
2. `.\scripts\qa-collect.ps1 -E2E` stores logs and `docs/qa/TEST_RESULTS.md`, and the Playwright report, screenshots (one per test) and failure traces/videos under `docs/qa/evidence/`.
3. Continue the larger work in a tool that can run commands against this folder (for example Claude Code on your machine) so it can install, run, see failures and fix them in a loop.


## Update 2026-11-24
`npm run check` ✅ (60 files / 510 tests, build ✅). Real-HTTP smoke of 10 published sites ✅. Browser tests ❌ not run (no browser available). Failures fixed this pass: 5 test defects (2-character slugs in `completion.test.ts`; missing `sku` in the pharmacist test). See `docs/BROWSER_TESTING_REPORT.md`, `docs/REMAINING_GAPS.md`.
