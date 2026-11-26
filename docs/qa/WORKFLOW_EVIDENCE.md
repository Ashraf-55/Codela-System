# Workflow evidence

Status legend: **NOT VERIFIED** = no real execution evidence exists.

| Product | Browser journey exists? | Executed in a browser? | Evidence |
|---|---|---|---|
| Medical | yes: `e2e/tests/medical-journey.spec.ts` | no (README says never run) | none |
| Real estate | no | no | none |
| E-commerce | no | no | none |
| Restaurant | no | no | none |
| Automotive | no | no | none |
| Learning | no | no | none |
| Construction | no | no | none |
| Booking | no | no | none |
| Fleet & delivery | no | no | none |
| Business | no | no | none |

Other specs present (never executed): `responsive.spec.ts` (horizontal overflow, RTL attribute), `security-and-isolation.spec.ts` (tenant isolation, route protection, lock-out, disguised upload).

API-level workflows for all ten products are covered by the passing backend tests (e.g. restaurant order pricing, ecommerce checkout with stock, medical appointments and billing). That is API evidence, not a user-experience check.

Missing: browser journeys for nine products, customer and student portals, super admin, mobile/tablet, console and failed-network capture.
