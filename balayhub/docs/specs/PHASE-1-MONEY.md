# Phase 1: Money done right (build spec)

Founder approved 2026-10-13 ("Phase 1 first, go ahead"). Source: `docs/research/00-SUMMARY.md` §4 Phase 1. Read `CLAUDE.md` (project rules) before any work.

**In scope**
1. Itemised stay bill (extra charges)
2. Payment proofs (GCash, Maya or bank transfer, checked by the host)
3. Cancellation policies and refund log
4. Payment schedule: deposit percentage per listing
5. Host net per booking

**Out of scope (blocked):** BIR invoices and the monthly tax summary. These wait for a tax practitioner (BLOCKERS.MD). Don't call anything "BIR-compliant" or "official receipt".

## Shared decisions

- **Money is NUMERIC.**
  - Compare and sum money in SQL or with fixed 2-decimal maths. Never use floating-point equality.
  - `pg` returns NUMERIC as strings.
- **Balance stays** `total_amount - channel_fee - sum(non-voided booking_payments)`.
  - Extras raise `total_amount`, through a new `extras_total` column that is part of the generated `total_amount`.
  - Refunds do **not** change the balance formula. They are recorded separately: money returned to the guest, usually after a cancellation.
- **Roles.**
  - Owners and managers add or void charges, confirm or reject proofs, record refunds, and set policies.
  - Staff can view charges, but never edit money. Staff never see the proof images or the payer's contact details.
  - Everything is scoped with `propertyScope` / `loadBooking`.
- **Whenever a booking's money changes** (charge added or voided, proof confirmed), call the existing logic that closes open PayMongo balance checkouts. Find `closeOpenCheckouts` (or its equivalent) used in `src/routes/stays.js` and `src/routes/balancepay.js`, so a guest can't pay a stale amount.
- **Every write is audited** with `audit(...)`.
- **Validation and design.**
  - Validate every input with `src/lib/validate.js`. Use allow-lists for enums.
  - UI text is sentence case. Use the tokens from `public/css/app.css` and work in light and dark mode.
  - Guest-facing text goes through `public/js/i18n.js` (EN + Taglish via `extendTranslations`).

## Database: migration `db/migrations/027_phase1_money.sql` (Lane 0, done first)

- **`booking_charges`**
  - `charge_id uuid pk`
  - `organization_id`
  - `booking_id → bookings`
  - `category text` CHECK in (`early_checkin`, `late_checkout`, `extra_guest`, `extra_bed`, `airport_transfer`, `damage`, `extra_cleaning`, `other`)
  - `description text` (≤200)
  - `quantity int` default 1, between 1 and 99
  - `unit_price numeric(12,2)` > 0
  - `amount numeric(12,2)`, generated as `quantity * unit_price`, stored
  - `created_by → users`, `created_at`
  - `voided_at`, `voided_by`, `void_reason`
  - index on `(booking_id)`
- **`bookings.extras_total`**
  - `numeric(12,2) NOT NULL DEFAULT 0 CHECK (>= 0)`
  - Redefine the generated `total_amount` as `accommodation_total + cleaning_fee + other_fees + extras_total`. PostgreSQL 16 can't alter a generated expression, so drop and re-add the column inside the migration.
  - First check for anything that depends on `bookings.total_amount` (views, indexes, constraints) and recreate it.
  - Existing rows must keep identical totals.
- **`booking_refunds`**
  - `refund_id`, `organization_id`, `booking_id`
  - `amount > 0`
  - `refund_date date`
  - `method` (same allow-list as `booking_payments.payment_method`, minus `channel_payout`)
  - `reference_number`, `reason text` (required, ≤300)
  - `recorded_by`, `created_at`
  - `voided_at`, `voided_by`, `void_reason`
- **`payment_proofs`**
  - `proof_id`, `organization_id`, `booking_id`
  - `amount > 0`
  - `method` in (`gcash`, `maya`, `bank_transfer`, `other`)
  - `reference_number`, `payer_name` (≤120), `note` (≤500)
  - `status` in (`pending`, `confirmed`, `rejected`), default `pending`
  - `submitted_at`
  - `reviewed_by`, `reviewed_at`, `reject_reason`
  - `payment_id → booking_payments` (set on confirm)
  - Partial index on pending.
- **`files.related_record_type`**: add `payment_proof` and `booking_payment` to the CHECK list.
- **`units`**
  - `cancellation_policy text` CHECK in (`flexible`, `moderate`, `strict`, `non_refundable`, `custom`). NULL means "not set" and shows nothing.
  - `cancellation_policy_text text` (≤1000, used when `custom`)
  - `deposit_pct smallint NOT NULL DEFAULT 50 CHECK (deposit_pct BETWEEN 10 AND 90)`. First check how the direct-booking deposit is computed today: if it's not 50%, use the current value as the default so nothing changes.
- **`organizations`**
  - `manual_payments_enabled boolean NOT NULL DEFAULT false`
  - `manual_payment_instructions text` (≤1000). For example: GCash number and name, bank name, account name and number.
- **Account lifecycle:** add the new tables to `PURGED_TABLES`, `purgeOrganization()` (delete before `bookings`) and `exportOrganization()` in `src/lib/account.js`.

## Lane A: itemised stay bill (charges)

**Owns:**
- new `src/routes/charges.js`, mounted in `src/server.js` next to the other workspace routers. Only that one line in `server.js`.
- new `public/js/views/charges.js`
- `src/lib/receipts.js`
- new `test/charges.test.js`

**API:**
- `GET /reservations/:id/charges`
- `POST /reservations/:id/charges` (`category`, `description`, `quantity`, `unit_price`)
- `POST /charges/:id/void` (`reason` required)

In one transaction, insert or void the charge and recompute `bookings.extras_total` as the sum of non-voided charges. Not allowed on cancelled bookings.

**UI:** export `async function chargesCard(reservation, rerender)` returning an element. It shows:
- a list with category labels
- "Add charge" (a modal with category presets that prefill the description)
- void with a reason
- the extras total

After adding, offer **"Send pay link"**, which reuses the existing pay-the-balance link endpoint and UI (find it in `reservations.js`/`balancepay.js`; call it, don't duplicate it).

**Receipts:** receipts list the charges as lines.

## Lane B: cancellation policies, refunds, deposit percentage

**Owns:**
- new `src/lib/policies.js`
- new `src/routes/refunds.js` (mounted with one line in `server.js`)
- the unit create and update spec in `src/routes/properties.js`
- `src/routes/directbooking.js`
- `public/js/views/book.js`
- the listing edit form in `public/js/views/listings.js`
- new `public/js/views/refunds.js`
- new `test/policies-refunds.test.js`

**Policy presets** live in `policies.js`. Each preset has a refund % by days before check-in, plus English and Taglish text:
- flexible: full refund up to 1 day before
- moderate: full refund up to 5 days before, 50% after
- strict: 50% refund up to 7 days before, none after
- non-refundable: no refund
- custom: the host's own text, no automatic suggestion

The function `suggestRefund(policy, paidAmount, checkIn, cancelDate)` returns `{ percent, amount, rule }`.

**Listings:** the unit form gets a policy select, custom text, and deposit %.

**Booking page:** `directbooking.js` uses `deposit_pct` instead of any fixed percentage, and exposes the policy text on the public booking page and in the booking confirmation data. `book.js` shows the policy before payment, in English and Taglish.

**Refunds API:**
- `GET /reservations/:id/refunds` returns the list plus a suggestion, if a policy is set and money was paid
- `POST /reservations/:id/refunds`
- `POST /refunds/:id/void`

The refunded total can't exceed the total paid.

**UI:** export `async function refundsCard(reservation, rerender)`. It shows the policy, the suggestion and the refund log, and lets the host record a refund.

## Lane C: payment proofs and pay page

**Owns:**
- new `src/routes/proofs.js` (mounted with one line in `server.js`; it may include its own public router mounted before `requireWorkspace` the way `balancepay` does)
- `src/routes/balancepay.js`
- the `checkRecord` cases in `src/routes/files.js`
- `public/js/views/pay.js`
- new `public/js/views/proofs.js`
- a new "Manual payments" card in `public/js/views/settings.js`
- new `test/proofs.test.js`

**Workspace setting (owner only):**
- `PATCH /workspace/manual-payments` with `{ enabled, instructions }`

**Pay page:**
- The public pay page (by pay token) shows the **itemised bill**: nights, cleaning, other fees, each non-voided charge, payments and the balance. It reads `booking_charges` directly.
- When manual payments are enabled, show the instructions and a form: amount, method, reference, payer name, and a proof image (JPG/PNG/WEBP/PDF) upload.
- Follow the public upload pattern used by the guest check-in ID upload, including its rate limits and magic-byte checks.
- Submitting creates a pending proof and notifies the host by push notification and an inbox note, if those helpers exist.

**Host side:**
- `GET /payment-proofs?status=pending`
- `GET /reservations/:id/proofs`
- `POST /payment-proofs/:id/confirm`: creates a `booking_payment` with the method, reference and date, plus a link to the proof. It optionally sends the receipt, the same way recording a payment does.
- `POST /payment-proofs/:id/reject` with a reason, emailed to the guest if an email exists.

Host-side proofs are viewable via `files` with record type `payment_proof`, for owners and managers only. Hosts can also attach a file to a recorded payment (record type `booking_payment`).

**UI:** export `async function proofsCard(reservation, rerender)`, showing pending proofs with image, confirm and reject. Show a "Payments to check (n)" banner/link on Home if Home has a suitable slot. If not, leave Home alone and report it.

## Lane D: integration (after A, B and C)

- Mount `chargesCard`, `refundsCard` and `proofsCard` in the reservation detail view (`public/js/views/reservations.js`).
- Add a **"You keep"** line: total − channel fee. For direct bookings, add "No channel fee — about ₱X saved vs a 15% channel fee", computed from `accommodation_total`.
- Check that stay reports and owner statements still add up with extras and refunds:
  - extras are revenue through `total_amount`
  - show refunds as a line in the stay reports, if reports exist per booking
- Update the canon docs (PRD, APP-FLOW, BACKEND-SCHEMA, TRD if env changes, IMPLEMENTATION-PLAN build record) and the help center articles in `src/lib/helpcenter.js`.

## Acceptance (all lanes)

- `npm test` passes, run once by the orchestrator at the end. Lanes run only their own test files against their own database (`TEST_DATABASE_URL`).
- Staff can't add charges, confirm proofs or record refunds, and get 403. Another workspace gets 404.
- A guest can't upload to a cancelled booking or with an invalid token.
- Totals are exact to the centavo.
- The browser check is done by the orchestrator at desktop and phone width, in light and dark mode.
