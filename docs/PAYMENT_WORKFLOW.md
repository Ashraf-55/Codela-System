# Payment workflow — InstaPay & Vodafone Cash (manual verification)

Production mode = `PAYMENT_PROVIDER` empty. `sandbox` is DEV ONLY (add-ons and upgrades are free there).

1. Super Admin → Payments → "Payment instructions": enable InstaPay (address) and/or Vodafone Cash (Egyptian mobile `01[0125]XXXXXXXX`). Nothing is hard-coded; a method is offered only when enabled **and** filled in. Secrets are rejected.
2. Customer → Billing → "Pay": chooses **what** (current plan renewal, another plan, or an add-on), monthly/annual, method. The exact amount (from the plan/add-on price) is shown.
3. Customer transfers outside the platform, uploads the receipt (PNG/JPG/WEBP/PDF ≤ 5 MB, validated by content) and enters the transfer reference.
4. A `pending` request + `issued` invoice are created. **Nothing is activated.** Max 3 pending per tenant; duplicate reference or identical receipt file (any tenant) is refused; one pending request per add-on.
5. Super Admin (role with `payments.review`) opens the receipt (access is audited) and types the amount shown on it. It must equal the invoice amount, otherwise approval is refused.
6. **Approve** → invoice paid; plan: the paid plan is applied (blocked if current usage exceeds its limits) and the subscription is activated/renewed; add-on: the add-on is activated, the subscription period is NOT touched. Customer gets an in-app notification and an e-mail (when a mail provider is connected).
7. **Reject** (reason required) → invoice void, subscription/plan/add-on untouched, customer can resubmit.
8. Every submission, receipt view, approval and rejection is audit-logged with the reviewer id; the review list shows reviewer name, time, plan/add-on.

Known limits: recurring add-ons do not expire automatically (renewal is a new payment); no automatic reconciliation with the wallet/bank; e-mail/WhatsApp notices need a connected provider.

## Customer → business payments (InstaPay / Vodafone Cash) — added 2026-11-20, NOT yet run

Separate from the subscription flow above. Products: e-commerce (order), learning (enrolment), medical (invoice), booking (appointment).

1. The business adds its own InstaPay / Vodafone Cash details (`paymentAccount`, dashboard → entity screen; one per method, can be deactivated). Nothing is hardcoded; the details are shown only to a customer who proves ownership of an item.
2. The customer opens the "Pay" section of the business site, enters the item code + their phone, sees the amount due and the business's details, transfers outside the system, then submits amount + reference and/or receipt (PNG/JPG/WEBP/PDF ≤ 5 MB, type detected from the bytes). Receipts are stored privately (purpose `receipt`, hidden from the generic file routes) and viewable only by staff with `payments.read` (every view audited).
3. A `paymentRequest` (Pending) is created. Pending requests count against the amount still payable; the same reference (any case/spacing) or the same receipt cannot be submitted twice unless the earlier one was rejected.
4. Staff (`payments.update`) open Dashboard → Customer payments: filter by status / method / date / search, view the receipt, **approve** or **reject (reason required)**. Approval creates the product's normal `payment` record (method `transfer`) through its own hooks inside the same transaction (overpayment and status rules apply; a failure rolls the approval back), so the balance and paid status update exactly once. Reviewed requests are final.
5. The customer is notified (e-mail, or SMS when only a phone exists) through the outbox; delivery is honest (`no_provider` without a connected provider). The customer sees status and the rejection reason in the same Pay section.

Not built yet: refunds of approved customer payments (statuses are pending / approved / rejected only); booking deposits (configurable deposit amount/percentage that gate confirmation); other products (automotive, construction, business, restaurant); per-method amount verification field; payment requests inside the customer portal (only the site's Pay section).
