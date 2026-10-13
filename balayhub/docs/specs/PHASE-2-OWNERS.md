# Phase 2: Owners and co-hosts (build spec)

Founder approved 2026-10-13 ("keep your choices, proceed to phase 2"). Source: `docs/research/00-SUMMARY.md` §4 Phase 2. Read `CLAUDE.md` (project rules) and `docs/specs/PHASE-1-MONEY.md` (same conventions) before any work.

**In scope**
1. Owner portal: unit owners sign in and see their published statements, bookings, payouts, an activity feed, and block their own dates.
2. Fee types: % of gross, % of net (today's rule), flat monthly fee.
3. Expenses with receipts on statements (owners can open the receipt).
4. Review-then-send statements: draft, publish (numbers frozen), email with a link, printable page (browser "Save as PDF").
5. Payout record (GCash, Maya, bank, cash, other, with reference).
6. Repairs reserve per owner.
7. Profit and loss per unit per month.
8. Monthly reminder: on the 3rd (Manila), draft last month's statements and email the workspace owner "n statements ready to review".

**Out of scope:** server-generated PDF files (no new dependency; the printable page covers it), automatic sending to owners without review, BIR documents, any outside integration.

## Shared decisions (record as D-39 to D-44)

- **D-39 Owner portal is a separate sign-in, not a team member.** Unit owners never get a `users` row and never pass `requireWorkspace`. They sign in with a one-time link emailed to them (no password). A separate cookie `bh_owner` (HttpOnly, SameSite=Lax, Secure in prod, Path=/) points at a separate `owner_sessions` table. All portal API routes live under `/api/owner-portal/*` and are mounted **before** `requireWorkspace`. The host turns portal access on per owner ("Invite to owner portal") and can turn it off, which deletes that owner's sessions. Owners see only their own units. Owners never see guest contact details (first name only), payment proofs, other owners, or the workspace's other data.
- **D-40 Fee types.** `unit_owners.fee_model` in (`net_pct`, `gross_pct`, `flat`), default `net_pct` so existing owners don't change. `net_pct` = today's rule (% of net after channel fees, cleaning when the manager keeps it, and refunds). `gross_pct` = % of gross after refunds (gross − refunds). `flat` = `flat_monthly_fee` (₱, ≥0), charged in any month the owner has at least one unit assigned, even with no stays. The fee is never negative.
- **D-41 Review then send.** Statements are drafted live (as today). "Publish" stores a frozen copy (`owner_statements.snapshot` jsonb, the full `ownerStatement()` result) and that's what the owner portal and the email show. One row per owner per month. The host can "Unpublish to correct" (audited), which hides it from the owner until published again. Sending email requires a published statement; the email has the plain-text statement plus a link to the portal (if portal access is on). The printable page is a print stylesheet on the statement view, not a PDF library.
- **D-42 Payouts are records.** `owner_payouts`: amount > 0, paid_on date, method in (`gcash`, `maya`, `bank_transfer`, `cash`, `other`), reference, note, optional `month` (YYYY-MM) it pays for. Voided, never deleted. The statement page shows "Paid ₱X of ₱Y" for that month.
- **D-43 Repairs reserve.** Per owner: `reserve_target` (₱, default 0 = off) and `reserve_monthly` (₱, default 0). On a statement, "Repairs reserve top-up" = min(reserve_monthly, target − current balance, payout before top-up), never below 0; it's deducted from the payout. Publishing writes a `deposit` entry to `owner_reserve_entries` (unpublishing voids it). The host records `withdrawal` entries manually (amount, date, note) when the reserve pays for a repair; balance = deposits − withdrawals (non-voided). Withdrawals can't take the balance below 0.
- **D-44 Profit and loss per unit.** Owners and managers (scoped by `propertyScope`) see, per unit per month: stays, nights, gross (`total_amount` of confirmed reservations that checked out in the month), channel fees, refunds (same overpayment rule as statements), expenses (non-voided, by expense_date, on that unit), and net = gross − channel fees − refunds − expenses. Workspace-level expenses with no unit are shown as one "Not linked to a unit" row. Staff get 403. Owners in the portal see the same table for their own units only.

**General:** money is NUMERIC (strings from `pg`; work in centavos). Every write is audited (`audit(...)`; portal actions use a null user and `{ owner_id }` in details, if `audit` allows that, otherwise extend `audit` minimally). Validate with `src/lib/validate.js`. Sentence-case UI, colour tokens, light and dark mode, `filterBar()` on list pages. Owner portal text is English (owners are business people; no Taglish needed).

## Database: migration `db/migrations/029_phase2_owners.sql` (Lane 0, done first)

- `unit_owners` add:
  - `fee_model text NOT NULL DEFAULT 'net_pct' CHECK (fee_model IN ('net_pct','gross_pct','flat'))`
  - `flat_monthly_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (>= 0)`
  - `reserve_target numeric(12,2) NOT NULL DEFAULT 0 CHECK (>= 0)`
  - `reserve_monthly numeric(12,2) NOT NULL DEFAULT 0 CHECK (>= 0)`
  - `portal_enabled boolean NOT NULL DEFAULT false`
  - `portal_invited_at timestamptz`, `portal_last_seen_at timestamptz`
- `owner_sessions`: `token_hash text PK`, `owner_id → unit_owners ON DELETE CASCADE`, `organization_id`, `created_at`, `last_seen_at`, `expires_at`, `user_agent`. Index on owner_id.
- `owner_login_tokens`: `token_hash text PK`, `owner_id → unit_owners ON DELETE CASCADE`, `expires_at` (30 minutes), `used_at`, `created_at`.
- `owner_statements`: `statement_id uuid pk`, `organization_id`, `owner_id → unit_owners`, `month text CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$')`, `status text CHECK in ('draft','published')` default 'draft', `snapshot jsonb` (NULL while draft), `published_at`, `published_by → users`, `sent_at`, `sent_to text`, `created_at`, `updated_at`. UNIQUE (owner_id, month).
- `owner_payouts`: `payout_id uuid pk`, `organization_id`, `owner_id`, `month text` NULL (same CHECK), `amount numeric(12,2) > 0`, `paid_on date`, `method` CHECK in (`gcash`,`maya`,`bank_transfer`,`cash`,`other`), `reference_number text` (≤100), `note text` (≤500), `recorded_by → users`, `created_at`, `voided_at`, `voided_by`, `void_reason`, CHECK ((voided_at IS NULL) = (void_reason IS NULL)). Index (owner_id, paid_on).
- `owner_reserve_entries`: `entry_id uuid pk`, `organization_id`, `owner_id`, `kind` CHECK in (`deposit`,`withdrawal`), `amount > 0`, `entry_date date`, `note text` (≤300), `statement_id → owner_statements` NULL, `recorded_by → users` NULL, `created_at`, `voided_at`, `voided_by`, `void_reason`. Index (owner_id).
- `bookings.owner_block_by uuid REFERENCES unit_owners(owner_id) ON DELETE SET NULL` — set on blocks an owner made in the portal.
- `src/lib/account.js`: add the new tables to `PURGED_TABLES` and `purgeOrganization()` (delete `owner_sessions`, `owner_login_tokens`, `owner_reserve_entries`, `owner_payouts`, `owner_statements` before `unit_owners`; bookings' `owner_block_by` is cleared by deleting bookings first, as today). Add `owner_statements`, `owner_payouts`, `owner_reserve_entries` to `exportOrganization()` (never export session or token rows).
- Existing rows keep identical statement numbers (default `net_pct`, reserve 0).

## Lane A: owner portal backend (sign-in, data, date blocks)

**Owns:** new `src/lib/ownerauth.js`, new `src/routes/ownerportal.js` (exports `{ publicRouter, router }`), the `checkRecord`-free receipt download inside it, one line in `src/lib/auth.js` `PLAN_EXEMPT`? **No** — portal routes are mounted before `planGuard` matters: put `/owner-portal/` in `planGuard`'s early return the same way `/public/` is (that one-line change in `src/lib/auth.js` is owned by Lane A), new `test/ownerportal.test.js`. One line in `src/lib/scheduler.js`? No — add the owner session clean-up to `purgeExpiredAuth` in `src/lib/auth.js` (Lane A owns that function's change).

**Host side (workspace owner only, `requireRole('owner')`, in `router`, mounted after `requireWorkspace`):**
- `POST /unit-owners/:id/portal-invite` — needs an email; sets `portal_enabled = true`, `portal_invited_at = now()`, emails a sign-in link (same as below). 409 `NO_EMAIL` without email.
- `POST /unit-owners/:id/portal-disable` — `portal_enabled = false`, deletes the owner's sessions and unused tokens.

**Public (in `publicRouter`, mounted before `requireWorkspace`), all under `/owner-portal/`:**
- `POST /owner-portal/login` `{ email }` — rate limited (per IP and per email). For every non-archived owner with that email, `portal_enabled`, and a workspace not scheduled for deletion, create a token (sha256 hashed) and email one message listing each workspace's link `${config.appUrl}/#/owner/signin?token=...`. Always respond `{ sent: true }` (no account probing).
- `POST /owner-portal/session` `{ token }` — exchanges an unused, unexpired token for a session (30-day expiry, 7-day idle), sets `bh_owner`, marks token used. 400 `INVALID_LINK` otherwise.
- `POST /owner-portal/logout`.
- Middleware `requireOwnerSession` (in `ownerauth.js`): reads `bh_owner`, loads session + owner (not archived, `portal_enabled`), updates `last_seen_at` at most every 5 min, sets `req.portalOwner = { owner_id, organization_id, full_name, email, workspace_name }`. 401 `OWNER_SIGNED_OUT` otherwise.
- `GET /owner-portal/me` → owner name, workspace name, units (id, name, property name).
- `GET /owner-portal/statements` → published statements `[{ month, month_label, payout, published_at, paid }]` newest first. `paid` = sum of non-voided payouts with that month.
- `GET /owner-portal/statements/:month` → the published snapshot + payouts for that month. 404 if not published.
- `GET /owner-portal/bookings?from&to` → reservations and blocks on their units in the range (default today − 30 to today + 90, max 400 days): dates, unit, channel, status, guest first name only, nights, gross (`total_amount`), channel fee. No guest contact, notes, codes or payments detail.
- `GET /owner-portal/payouts` → their non-voided payouts.
- `GET /owner-portal/reserve` → balance, target, monthly, and entries (non-voided).
- `GET /owner-portal/activity?limit=30` → newest-first feed built from: check-ins/check-outs (bookings `checked_in_at`/`checked_out_at`), cleanings completed (`cleaning_tasks` done on their units — read the table for column names), maintenance requests on their units (title + status, no tenant data), expenses on their units, published statements, payouts. Each item `{ at, kind, title, unit_name }`.
- `GET /owner-portal/pnl?month=YYYY-MM` → `unitPnl(orgId, month, { unitIds })` from Lane D's `src/lib/pnl.js` (Lane A imports it; if it doesn't exist yet when you test, stub the call behind a `try`/require and leave a test marked for the integration lane).
- `GET /owner-portal/receipts/:fileId` → streams the file only if it is an `expense` file whose expense is on the owner's unit and appears in one of their **published** statements' expenses (`snapshot->'expenses'` contains that expense_id). Use the storage helpers from `src/lib/storage.js` the way `src/routes/files.js` does. `Content-Disposition: inline`, correct type.
- `POST /owner-portal/blocks` `{ unit_id, check_in, check_out, reason }` — unit must be theirs; inserts a `kind='block'` booking with `owner_block_by`, `block_reason` (≤200, default "Owner stay"), `created_by` NULL; respects the no-overlap constraint (409 `DATES_TAKEN` on conflict, check how `stays.js` maps the exclusion error); not in the past; max 60 nights. Audit `owner_portal.block_created`. Notify the workspace owner by email ("{owner} blocked {unit} from … to …").
- `POST /owner-portal/blocks/:id/cancel` — only blocks with `owner_block_by` = them, not started yet; sets status cancelled. Audit.

**Tests:** login always 200 and only emails enabled owners; token single use and expiry; session cookie works and wrong owner gets 404 on another owner's statement/receipt/block; draft statements invisible; disabled owner's session stops working; guest contact never in bookings response; block overlap 409; host invite needs owner role (manager 403) and email.

## Lane B: statements engine, fee types, publish and send (backend)

**Owns:** `src/lib/statements.js`, `src/routes/owners.js`, new `test/owner-statements.test.js`. Mention in a code comment that `snapshot` is the published copy.

- `ownerStatement()`:
  - Apply `fee_model` (D-40). Keep the returned shape; add `owner.fee_model`, `owner.flat_monthly_fee`, and `totals.fee_label` (e.g. "Management fee (20% of net)", "(15% of gross)", "(flat)").
  - Add `totals.reserve_topup` per D-43 (reserve balance read from `owner_reserve_entries`, excluding any deposit for this same statement) and make `totals.payout` the payout **after** the top-up. Add `reserve: { balance, target, monthly }`.
  - Expenses include `receipt_file_id` (and `has_receipt`).
  - `statementText()` shows the fee label, the reserve line when non-zero.
- `ownerSpec` accepts `fee_model` (allow-list), `flat_monthly_fee`, `reserve_target`, `reserve_monthly` (money ≥ 0). Existing `GET /unit-owners` returns them.
- `GET /unit-owners/:id/statement?month` → `{ statement (live), record: { status, published_at, sent_at, sent_to } | null, published: snapshot | null }`.
- `POST /unit-owners/:id/statement/publish { month }` — the month must have ended (Manila); upserts `owner_statements` with status published + snapshot; writes the reserve `deposit` entry if `reserve_topup > 0`. Transaction, audited.
- `POST /unit-owners/:id/statement/unpublish { month }` — back to draft, snapshot NULL, voids that statement's reserve deposit. Audited.
- `POST /unit-owners/:id/statement/send { month }` — now requires published (409 `NOT_PUBLISHED`), emails the **snapshot**, adds a portal link line if `portal_enabled`, stores `sent_at`, `sent_to`.
- `GET /owner-statements?month=` (owner role) → for every non-archived owner: name, units count, status, payout (snapshot if published else live), sent_at. Used by the review list and by Lane D's reminder.
- Export `draftMonth(orgId, month)` that ensures a draft `owner_statements` row exists for every non-archived owner with units, without publishing — used by Lane D.

**Tests:** each fee model to the centavo, flat fee with no stays, fee never negative, reserve top-up capped by monthly/target/payout, publish freezes numbers (add an expense after publishing → snapshot unchanged, live changed), unpublish voids reserve deposit, send requires published, manager gets 403, other workspace 404, the existing statement tests still pass unchanged for `net_pct`.

## Lane C: payouts and repairs reserve (backend)

**Owns:** new `src/routes/ownerledger.js`, new `test/owner-ledger.test.js`. Workspace owner only.
- `GET /unit-owners/:id/payouts?month=` → list incl. voided (flag).
- `POST /unit-owners/:id/payouts` `{ amount, paid_on, method, reference_number, note, month }` — `Idempotency-Key` header supported like refunds (409 if the key was used for a different owner); paid_on not in the future.
- `POST /owner-payouts/:id/void { reason }`.
- `GET /unit-owners/:id/reserve` → `{ balance, target, monthly, entries }`.
- `POST /unit-owners/:id/reserve/withdrawals { amount, entry_date, note }` — note required; can't take the balance below 0 (lock the owner row, then sum).
- `POST /reserve-entries/:id/void { reason }` — only withdrawals (deposits are voided by unpublishing). Voiding a withdrawal is always allowed.
- All audited. Validation with allow-lists.

**Tests:** create/void payouts, idempotency, future date 400, withdrawal over balance 409, void deposit 409, manager 403, cross-workspace 404.

## Lane D: profit and loss per unit, monthly reminder (backend)

**Owns:** new `src/lib/pnl.js` (export `unitPnl(orgId, month, { unitIds, user })`), new `src/routes/pnl.js`, one job line in `src/lib/scheduler.js`, new `test/pnl.test.js`.
- `unitPnl` per D-44; with `user` it scopes by `propertyScope`; with `unitIds` it limits to those units and leaves out the "Not linked to a unit" row. Returns `{ month, rows: [{ unit_id, unit_name, property_name, stays, nights, gross, channel_fees, refunds, expenses, net }], totals }`.
- `GET /reports/pnl?month=YYYY-MM&property_id=` — owner and manager; staff 403.
- `GET /reports/pnl.csv?month=` — same, CSV (escape like the existing CSV exports).
- Job `owner-statements-reminder` hourly: when Manila date is the 3rd or later of the month and the workspace hasn't been reminded for last month (store in `audit_logs` action `owner_statements.reminder_sent` with `{ month }`, or a small column — your choice, but no new table), for workspaces with ≥1 non-archived owner with units, not demo, not read-only: call Lane B's `draftMonth`, then email the workspace owner "Owner statements for {Month} are ready to review (n)" with a link to `#/owners/statements?month=`. Skip silently when email isn't configured.

**Tests:** P&L numbers including refunds rule and unlinked expenses, scoping for a manager with one property, staff 403, CSV, the reminder runs once per month per workspace (call the job function directly).

## Lane E: host screens (frontend)

**Owns:** `public/js/views/owners.js`, owner-related CSS appended at the end of `public/css/app.css` under a `/* Phase 2: owners (host) */` comment.
- Owner form: fee type select (Net % / Gross % / Flat monthly), the matching field (show/hide), repairs reserve target and monthly top-up, hint text in plain English.
- Owner list: portal status chip (Off / Invited / Active — last seen), actions "Invite to owner portal" / "Turn off portal access".
- New view `ownerStatementsView` at `#/owners/statements?month=` (export it; Lane F adds the route): month picker, list from `GET /owner-statements` with status chip, payout, sent date; links to each statement.
- Statement view (`ownerStatementView`): status bar (Draft / Published on … / Sent to … on …), buttons Publish, Unpublish to correct, Send to owner, Print (calls `window.print()`); fee label and reserve top-up lines; expense rows with a "Receipt" link when `has_receipt` (open via the existing files download URL); "Payouts" card: list, "Record payout" modal (amount prefilled with remaining payout), void with reason; "Paid ₱X of ₱Y".
- Reserve card on the statement view: balance, target, entries, "Record withdrawal".
- Print stylesheet: `@media print` hides app chrome and buttons, shows statement on white, black text.

## Lane F: owner portal screens + routes (frontend)

**Owns:** new `public/js/views/ownerportal.js`, `public/js/app.js` (routes only), owner-portal CSS appended at the end of `public/css/app.css` under `/* Phase 2: owner portal */` (Lane E appends its own block; append, don't rewrite).
- Routes (access `OPEN`, the portal manages its own sign-in): `#/owner` (sign-in form: email → "Check your email"), `#/owner/signin` (reads `?token=`, POSTs `/owner-portal/session`, then goes to `#/owner/home`), `#/owner/home`, `#/owner/statements/:month`, `#/owner/bookings`, `#/owner/money` (payouts + reserve), `#/owner/pnl`. Also add host routes `#/owners/statements` → `ownerStatementsView` (from `owners.js`, Lane E) and `#/pnl` → `pnlView` (from `pnl.js`, Lane G) with APP access, and a nav entry "Profit and loss" (owners and managers, not staff) next to Stay reports.
- Portal layout: its own simple top bar (workspace name, owner name, Sign out), tabs Home / Statements / Bookings / Money / Profit and loss. No app sidebar. Phone first.
- Home: this month at a glance (upcoming stays count, nights booked next 30 days), latest published statement with payout, activity feed.
- Bookings: list + simple month calendar strip per unit; "Block dates" modal (unit, from, to, reason); cancel own future blocks.
- Statement page: read-only snapshot with the same lines as the host view, receipt links (`/api/owner-portal/receipts/:fileId`), payouts for the month, Print button.
- 401 `OWNER_SIGNED_OUT` from any portal call → go to `#/owner`.
- Add a small "Are you a unit owner? Sign in here" link on the login page footer → `#/owner` (in `public/js/views/auth.js` — allowed one-line change for Lane F).

## Lane G: profit and loss screen (frontend)

**Owns:** new `public/js/views/pnl.js` exporting `pnlView`. Month picker + property filter with `filterBar()`, table per unit with totals row, negative net in the danger token, "Download CSV" link, empty state. Mobile: stacked cards.

## Lane H: integration (after all)

- Mount in `src/server.js`: `ownerportal.publicRouter` before `requireWorkspace`; `ownerportal.router`, `ownerledger`, `pnl` after.
- Run all tests, fix seams (Lane A's P&L import, Lane D's `draftMonth` import), help articles in `src/lib/helpcenter.js` (owner portal, fee types, publishing statements, payouts and reserve, profit and loss), canon docs (PRD, APP-FLOW, BACKEND-SCHEMA, DECISIONS D-39 to D-44, IMPLEMENTATION-PLAN build record).

## Acceptance (all lanes)

- `npm test` passes, run once by the orchestrator at the end. Lanes run only their own test files against their own database (`TEST_DATABASE_URL`).
- A unit owner can never reach workspace routes; a team member's cookie can't reach portal data; owner A gets 404 for owner B's anything.
- Drafts are never visible in the portal or in emails.
- Totals exact to the centavo; existing owner statements unchanged for `net_pct` with no reserve.
- Browser check by the orchestrator at desktop and phone width, light and dark, for host screens and the portal.
