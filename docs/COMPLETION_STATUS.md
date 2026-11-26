# Completion status vs CODELA_FINAL_PROMPT.md (v14 -> v15 pass)

Environment of this pass: no `node_modules`, no network, no browser. **Nothing below was executed** (no lint, vitest, build or Playwright). The only check done was a syntax/in-file `tsc` pass over the edited files (no errors reported in them; imports could not be resolved, so it is not a typecheck). Run `npm install && npm run check` first. If a test fails, the failure is most likely in the new tests' assumptions (e.g. cross-tenant `ref` validation returning 400, plan staff limits), not necessarily in the feature.

## Implemented in code (API/entities + tests written, NOT run)
| # | Item | What was added | Still missing |
|---|---|---|---|
| 2 | Restaurant per-branch inventory | `branchId` on orders/movements; `branchStockLedger`; atomic `ingredientTransfer`; order deductions per branch; `stockByBranch` report; tests | UI screen, branch-scoped staff permissions |
| 4 | Medical roles | roles `pharmacist`, `lab_technician`, `radiology_technician` (module-scoped, API-enforced); `labTest` catalogue; per-parameter lab results; public `reschedule` action; tests | Role-specific dashboards/screens, patient result view in the portal, a separate Visit entity (`medicalRecord` is still used) |
| 3 | Commerce | API already supported q/category/price range (`basePrice_from/_to`)/sort/pagination; test with 120 products added | `StoreSite.tsx` still filters in the browser — UI refactor not done |
| 9/12 | Fleet | `area` (public coverage areas), `invoice` + `payment` | returned-shipments flow, driver cash review screen, portal payment wiring, refunded status |
| 9/12 | Auto | `branch`, `supportedMake`, battery `category`, `purchaseOrder` (receiving adds stock once), `warranty`, booking request -> appointment conversion | quote request -> work order, work-order screen |
| 9/12 | Build | `warehouse` + per-warehouse ledger + atomic transfers, `boqEstimate` (finalising creates the quotation with markup) | BOQ/warehouse screens, photo upload, printable claim |
| 8 | Playwright | `e2e/tests/all-products.spec.ts` (10 products x public site/responsive/dashboard/logout/isolation) + `docs/E2E.md` | Product-specific UI journeys, payments, uploads, builder, Super Admin screens |

## Already in v14 (not re-verified)
Business: quotations, attendance, warehouses, job roles, BusinessSite, business-site tests.

## NOT done
- 5 Add-on renewal lifecycle (needs DB columns + scheduled job)
- 6 Super Admin settings / advertisements / notification templates (+ announcements, subscription history UI, add-ons page)
- 7 Website builder audit and gaps (SEO, working hours/holidays, team, gallery, typography/layout) + `WEBSITE_BUILDER_AUDIT.md`
- Platform: `approve` / `export` permission actions, CSV export, tenant custom roles API + UI
- Booking refund policy
- Learn: course-builder screen, video upload, rating aggregate; Estate extras; Fleet GPS/offline queue
- 10/11 Security audit refresh, DATABASE.md addendum, split website/management acceptance reports, BROWSER_TESTING_REPORT, FINAL_QA_REPORT, SUPER_ADMIN_COMPLETION_REPORT, accessibility pass, README/.env.example refresh
- Dashboard screens for every entity added above (they appear through the generic entity screens only)
