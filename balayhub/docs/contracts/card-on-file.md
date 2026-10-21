# Card on file and automatic payment: contract

Status: QA round 17, written 2026-10-15 by the docs lane from the card-on-file plan (section 3, verbatim below) and then checked against what landed (the "As built" notes at the end say where the build differs). Decision number: D-98. Extends `docs/contracts/platform-coupons.md` (D-94) and changes only what D-98 says.

In plain words: a new host saves a payment card with PayMongo by paying ₱20 once before the 14-day trial starts. The card number goes from the browser straight to PayMongo; BalayHub keeps only PayMongo ids, the card brand and the last 4 digits. At trial end the host pays with the saved card in one tap (Stage 1, built and on). Stage 2, PayMongo charging the card every month, is built but switched off until PayMongo approves Subscriptions (`PAYMONGO_SUBSCRIPTIONS=on`). Tables: columns on `organizations` and `billing_payments`, plus `paymongo_plans` (migration 037, BACKEND-SCHEMA 2.19). Exact on-screen copy lives in APP-FLOW 5.10, 28 and 30.

## Contract

All routes are under `/api`, need a signed-in, verified workspace member, and (for POST) the `X-Requested-With: BalayHub` header. Errors use the existing shape `{ error: "<message>", code: "<CODE>", fields?: {...} }`.

### 3.1 `GET /api/auth/me` (changed)

`user.plan` (from `planStatus`) gains, when the gate is on:

```json
{ "plan": "trial", "read_only": true, "reason": "card_check", "card_check_due": true, "trial_days_left": 14, "trial_ends_at": null }
```

`user` gains (owners only; other roles get `null` for these):

```json
{ "card": { "brand": "visa", "last4": "4242" } }
```

`card` is `null` when no card is saved. Non-owners also get `owner_name` (the owner's full name) only while `card_check_due` is true, for the waiting page.

### 3.2 `GET /api/billing/card-check` (new, owner)

Response 200:

```json
{
  "required": true,
  "status": "required",
  "amount": "20.00",
  "trial_days": 14,
  "trial_would_end": "2026-10-29",
  "public_key": "pk_test_...",
  "paymongo_api": "https://api.paymongo.com/v1",
  "subscriptions": false,
  "plans": [{ "key": "starter", "name": "Starter", "price": 499 }, { "key": "growth", "name": "Growth", "price": 999 }, { "key": "pro", "name": "Pro", "price": 1799 }],
  "renewal_plan": "growth",
  "pending": { "billing_id": "uuid", "status": "pending" }
}
```

- `status`: `"required" | "passed" | "waived" | "not_required"`. When not `"required"`, `public_key` and `paymongo_api` are omitted.
- `trial_would_end`: Manila date of today plus `TRIAL_DAYS`.
- `paymongo_api`: `https://api.paymongo.com/v1` always in production; `PAYMONGO_BROWSER_API` only when `NODE_ENV !== 'production'` (local fake).
- `pending`: the live pending card check, or `null`.

### 3.3 `POST /api/billing/card-check/start` (new, owner)

Request:

```json
{ "renewal_plan": "growth", "consent": true }
```

- `renewal_plan`: required, enum `starter|growth|pro`.
- `consent`: boolean; **required true only when `PAYMONGO_SUBSCRIPTIONS=on`** (else ignored).

Response 200:

```json
{ "billing_id": "uuid", "amount": "20.00" }
```

Server: creates (or reuses) the PayMongo Customer and the pending card check row and its Payment Intent (amount 2000, `payment_method_allowed: ['card']`, `payment_method_options.card.request_three_d_secure: 'any'`, `currency: 'PHP'`, `description: 'BalayHub card check'`, `statement_descriptor: 'BALAYHUB'`, `setup_future_usage: { session_type: 'on_session', customer_id }`, `metadata: { billing_id, organization_id, kind: 'card_check' }`). Stores `renewal_plan` (and in Stage 2, `auto_renew = true`, `auto_renew_consented_at = now()`). Reuses an existing pending row (same `billing_id`) if its Payment Intent is still `awaiting_payment_method`.

Errors: 403 `FORBIDDEN` (not owner); 409 `CARD_CHECK_NOT_REQUIRED` ("Your card is already confirmed." / or "Your workspace doesn't need a card check."); 409 `CARD_CHECK_OFF` ("Card checks are off right now. Please try again later."); 400 `VALIDATION` (field `consent`: "Tick the box to agree to automatic payment."); 429 `RATE_LIMITED`; 502 `BILLING_FAILED` ("We couldn't reach the payment service. Nothing was charged. Please try again in a moment."). *The body carries `retry_after` (seconds left in the window; D-111). The start limit does not count a press that ended 502 or 503.* *The message names the wait: "Too many tries. Please try again in N minutes." (or "about an hour", "about N hours"; D-112).* *Also answered, before anything is started, while the day's attach limits are used up; `retry_after` is that longer wait (D-113).*

409 `DELETION_SCHEDULED` (D-116) while the workspace is scheduled for deletion: "This workspace is scheduled for deletion, so the card check is turned off. Cancel the deletion first." Checked before the limiter counts, so a refused press counts nothing. No pending card-check row is made and no PayMongo call is sent.

### 3.4 Browser to PayMongo (not BalayHub)

The page calls `POST {paymongo_api}/payment_methods` with `Authorization: Basic base64(public_key + ':')`:

```json
{ "data": { "attributes": { "type": "card",
  "details": { "card_number": "4120000000000007", "exp_month": 12, "exp_year": 2030, "cvc": "123" },
  "billing": { "name": "Ana Reyes", "email": "ana@example.com" } } } }
```

and gets back `{ data: { id: "pm_..." } }`. On a PayMongo 400 it shows the field message (section 5.2). The card values are then cleared from memory and the inputs.

### 3.5 `POST /api/billing/card-check/:id/attach` (new, owner)

Request: `{ "payment_method_id": "pm_..." }` (string, `^pm_[A-Za-z0-9]{6,64}$`).

Server attaches it to the row's Payment Intent with the **secret key** (`POST /payment_intents/:pi/attach` with `payment_method` and `return_url = {APP_URL}/#/confirm-card?check={billing_id}`), then answers by the Payment Intent status:

```json
{ "status": "passed", "trial_ends_at": "2026-10-29T15:59:59.000Z" }
{ "status": "action_required", "redirect_url": "https://..." }
{ "status": "pending" }
{ "status": "failed", "message": "Your card was declined. Try another card, or ask your bank." }
```

- `passed`: Payment Intent `succeeded` and verified (amount 2000, metadata matches); the trial has started.
- `action_required`: `awaiting_next_action` with `next_action.redirect.url`; the URL must be `https:` (else treated as `failed`).
- `pending`: `processing`.
- `failed`: `awaiting_payment_method` with `last_payment_error`; the row stays pending until the owner retries. *(Round 18, D-100: the retry does not reuse the Payment Intent; `start()` expires the old pending row and creates one new intent, so there are never two charges. See "As built".)*

Errors: 404 `NOT_FOUND` (not this workspace's row, or not a card check); 409 `CARD_CHECK_NOT_REQUIRED`; 400 `VALIDATION`; 429 `RATE_LIMITED`; 502 `BILLING_FAILED`. *The body carries `retry_after` (seconds left in the window; D-111). This route's limit counts a press that ended 502 or 503; only the start limit gives those back.* *The message names the wait: "Too many tries. Please try again in N minutes." (or "about an hour", "about N hours"; D-112).*

### 3.6 `POST /api/billing/card-check/:id/refresh` (new, owner)

No body. Re-reads the Payment Intent with the secret key, applies a success. Response: `{ "status": "passed" | "pending" | "failed" | "expired", "trial_ends_at"?: "...", "message"?: "..." }`. A PayMongo error answers `{ "status": "pending" }` (like `/billing/:id/refresh`). 404 `NOT_FOUND` for another workspace's row.

### 3.7 `GET /api/billing` (changed, owner)

Adds:

```json
{
  "card": { "brand": "visa", "last4": "4242" },
  "renewal_plan": "growth",
  "saved_card_pay": true,
  "subscriptions": false,
  "auto_renew": { "on": false, "status": null, "consented_at": null, "next_charge_on": null }
}
```

- `saved_card_pay`: true when online billing is on, a card is saved, and research R3 is not answered "no" (constant `SAVED_CARD_PAY` in `billing.js`, default true).
- `history` items gain `kind: "plan" | "card_check"`; card check rows have `plan: null, months: null`.
- `auto_renew.status`: `null | "active" | "past_due" | "unpaid" | "cancelled" | "incomplete"`; `next_charge_on`: the day after `paid_until` (or trial end) when on.

### 3.8 `POST /api/billing/pay-saved` (new, owner; Stage 1 one-tap)

Request: `{ "plan": "growth", "months": "1", "coupon_code": "OPTIONAL" }` (same validation and limiters as `/billing/checkout`).

Responses:

```json
{ "billing_id": "uuid", "activated": true, "plan": "growth", "paid_until": "2026-11-28" }
{ "billing_id": "uuid", "status": "paid", "paid_until": "2026-11-28" }
{ "billing_id": "uuid", "status": "action_required", "redirect_url": "https://..." }
{ "billing_id": "uuid", "status": "pending" }
```

Errors: everything `/billing/checkout` can answer (`COMPED`, `BILLING_OFF`, `COUPON_*`, `RATE_LIMITED`, `BILLING_FAILED`), plus 409 `SAVED_CARD_NONE` ("There is no saved card. Pay another way.") and 402 `SAVED_CARD_FAILED` ("Your saved card couldn't be charged. Pay another way, or use a different card."). On `SAVED_CARD_FAILED` the row is failed and its coupon slot released (existing `failCheckout`). 3-D Secure return URL: `{APP_URL}/#/settings?billing={billing_id}` (the existing return handler, which calls `/billing/:id/refresh`).

409 `DELETION_SCHEDULED` (D-116) while the workspace is scheduled for deletion: "This workspace is scheduled for deletion, so plan payments are turned off. Cancel the deletion first, then pay." Nothing is recorded, no coupon is redeemed and nothing is charged.

### 3.9 `PATCH /api/billing/renewal` (new, owner)

Request (partial): `{ "renewal_plan": "pro", "auto_renew": false, "consent": true }`.

- `auto_renew: true` needs `consent: true` and `PAYMONGO_SUBSCRIPTIONS=on` (else 409 `SUBSCRIPTIONS_OFF`) and a saved card (else 409 `SAVED_CARD_NONE`).
- `auto_renew: false` cancels a live PayMongo subscription (Stage 2). `paid_until` is unchanged.
- Changing `renewal_plan` while a subscription is live cancels it; the job creates the new one at `paid_until`.

Response: the `GET /billing` additions (section 3.7). Audit: `billing.renewal_changed` (fields only).

### 3.10 `DELETE /api/billing/card` (new, owner)

Forgets `card_payment_method_id`, `card_brand`, `card_last4` (keeps the customer id), cancels automatic payment (Stage 2), tries the PayMongo detach (R5). Response `{ "ok": true }`. Audit `billing.card_removed`. `card_check` stays `passed`.

### 3.11 `POST /api/admin/workspaces/:id/card-check` (new, platform admin)

Request: `{ "action": "waive" }`. Sets `card_check = 'waived'`, `card_checked_at = now()`, and `trial_ends_at = now() + TRIAL_DAYS` when it is empty. Response `{ "ok": true, "trial_ends_at": "..." }`. Errors: 404; 409 `DEMO`; 409 `CARD_CHECK_NOT_REQUIRED` (status is not `required`). Audit `platform.card_check_waived`. `GET /api/admin/workspaces` rows gain `card_check`, `card_brand`, `card_last4`; the status filter gains `card_pending`.

### 3.12 Gate (every API route)

While `planStatus(org).reason === 'card_check'`: any non-GET request whose path does not match

```
^/(auth/|account/|support/|admin/|invitations/|billing/card-check(/|$)|push/unsubscribe$|workspace/delete(/cancel)?$)
```

answers **402 `CARD_CHECK_REQUIRED`**: "Confirm your payment card to start your free trial." GETs pass (the workspace is empty; the page guard handles screens).

### 3.13 Webhook `POST /api/public/paymongo/webhook` (changed)

Signature check unchanged. New event handling (body never trusted, each triggers a re-read with the secret key):

- `payment.paid`, `payment.failed`: `data.attributes.data.attributes.payment_intent_id` → `billing_payments.payment_intent_id` → `cardcheck.refresh` (kind `card_check`) or `billing.refresh` (kind `plan`).
- `subscription.*` events: `subscriptions.handleEvent(event)` when `PAYMONGO_SUBSCRIPTIONS=on`; otherwise ignored with 200.

### 3.14 Configuration (TRD)

| Variable | Default | Meaning |
|---|---|---|
| `PAYMONGO_PUBLIC_KEY` | empty | BalayHub's own public key (`pk_live_` / `pk_test_`), used by the browser to send the card to PayMongo. Card check is off while empty. |
| `CARD_CHECK` | `on` | `off` stops new workspaces needing the card check. |
| `PAYMONGO_SUBSCRIPTIONS` | `off` | `on` turns on Stage 2 automatic monthly charges. Only after PayMongo approves Subscriptions. |
| `PAYMONGO_BROWSER_API` | `https://api.paymongo.com/v1` | Development and tests only (ignored in production): where the browser sends the card, e.g. the local fake. |

---

## As built (checked against the code, 2026-10-15)

Where the build differs from, or adds to, the plan text above:

- **A declined card on attach answers HTTP 402, not 200.** `POST /billing/card-check/:id/attach` returns the body `{ "status": "failed", "message": "..." }` with status 402, so the failed-only rate limiters count it. `passed`, `action_required` and `pending` answer 200. (Section 3.5 shows only the bodies.)
- **Limits (section 9 of the plan, as coded):** `start` 10 per hour per workspace; failed `attach` calls 8 per day per workspace and 30 per 15 minutes per IP. `pay-saved` shares the checkout limiter (15 per hour) and the coupon try limits.
- **The gate also lets a support screenshot through.** While `reason = 'card_check'`, `POST /api/files?record_type=support` is allowed (and nothing else under `/files`), so a host who is waiting on a card can still send a ticket with a picture. The path allow-list in section 3.12 is otherwise exact (`CARD_CHECK_EXEMPT` in `src/lib/auth.js`).
- **`GET /billing/card-check` plans carry `listings`** (the plan's listing limit, for "Up to 2 listings"), added in the route from `PLANS`.
- **`GET /api/public/plans`** gains `card_check: boolean` (true when `cardcheck.enabled()`), which the sign-up page reads for its one muted line.
- **Admin list:** the status filter value is `card_pending`; the Card column reads Waiting, Visa 4242, Skipped or a dash; rows carry `card_check`, `card_brand`, `card_last4`. The panel shows "Waiting for the owner to save a card. The trial has not started." with the Skip card check button only while Waiting.
- **Plan & billing buttons:** Remove card, Change, Turn on automatic payment and Cancel automatic payment are `btn--secondary btn--sm` buttons (not link-style buttons), so they meet the 44px phone rule. With a saved card the Pay button is primary and Pay another way is secondary; with no saved card it is the old single button.
- **Stage 2 "Next charge" amount ignores a coupon discount** (it shows the plan price). Carried to round 18.
- **Scheduler jobs:** `trial-reminders` (hourly) and `subscriptions` (hourly, does nothing unless `PAYMONGO_SUBSCRIPTIONS=on`). The card check reconcile (expire a pending check after 24 hours, after one last look) runs inside the existing 10-minute `billing` job.
- **Local browser checks:** outside production the browser may post the card to `PAYMONGO_BROWSER_API`, and a 3-D Secure redirect to `http://127.0.0.1` or `localhost` is accepted; production accepts only `https:`.
- **Open research (R1 to R6)** is coded to the defaults in section 2 of the plan; the questions are in BLOCKERS.MD ("Card on file and automatic payment").

### Round 18 (2026-10-19, D-100)

- **`attach()` locks the row.** The attach runs in a transaction that takes `SELECT ... FOR UPDATE` on the `billing_payments` row first and the `organizations` row second (the same order `markPassed` uses), and it needs `status = 'pending'` and a Payment Intent; anything else answers `CARD_CHECK_NOT_REQUIRED`. Two attach calls at the same moment cannot both pass.
- **`start()` re-checks the earlier intent.** After a decline the earlier pending row is re-read under its lock: if it moved (paid, expired by the reconcile job) `start()` follows that; if still pending and failed, the row is marked `expired` and one new Payment Intent is created. Never two live intents, never two charges. If PayMongo cannot be reached, 503 and nothing is charged. *This replaces the line in section 3.5 that says the owner retries "on the same Payment Intent".*
- **Bank "Fail" copy.** On the bank's 3-D Secure page, **Fail** returns to the card page, and the card page shows the declined message ("Your card was declined. Try another card, or ask your bank."), not the "bank check wasn't finished" copy. A returned check that is still pending shows the waiting copy. After a pass, the success panel takes focus on its heading (it waits for the attach before focusing).
- **`DELETE /billing/card`:** `auto_renew` goes false in the database before the PayMongo subscription is cancelled; a repeat removal with no card writes no second audit row.
- **Workspace purge** (admin Delete now, the owner's delete after 14 days) cancels the subscription first, locks the workspace row, deletes, then detaches the card and deletes the PayMongo customer after the commit.
- **Stage 1 coupon note** on Plan & billing keeps only "BalayHub never charges your card on its own; you renew here."; the "applied automatically" sentence shows only when automatic payment is on.
- **Still open:** the Stage 2 **Next charge** amount ignores a coupon discount; the local fake PayMongo cannot answer 401 on refresh, and its "unreachable" switch does not cover `payment_intents`.
