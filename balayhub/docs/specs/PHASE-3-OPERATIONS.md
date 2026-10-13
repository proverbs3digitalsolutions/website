# Phase 3: Operations and housekeeping (build spec)

Founder approved 2026-10-13 ("proceed to phase 3"). Source: `docs/research/00-SUMMARY.md` §4 Phase 3 (items 10–14). Read `CLAUDE.md` and `docs/specs/PHASE-2-OWNERS.md` (same conventions) first.

**In scope**
1. Cleaner role: cleaners see their cleaning jobs, checklists, photos, and their own pay. They never see booking money, guest contact details, reports or settings.
2. Cleaning calendar (by day and cleaner) with quick reassignment, and a status board per unit: dirty, clean, inspected.
3. Inspections: pass or fail per checklist item, a score, a quality score per cleaner.
4. Damage reports from the cleaner's phone with photos, which the host can turn into a charge or a deposit deduction.
5. Cleaner pay per clean or per hour, marked paid (cash, GCash, Maya, bank), with a monthly summary.
6. Supplies with par levels per property and low-stock warnings; cleaners record what they used or restocked.
7. Lost and found log per stay.
8. Work orders raised by cleaners (maintenance requests linked to the cleaning task), and recurring preventive maintenance (for example, aircon cleaning every 3 months).

**Out of scope:** SMS, any outside integration, payroll or tax for cleaners, inventory purchasing.

## Shared decisions (record as D-48 to D-54)

- **D-48 Cleaner role (deny by default).** `users.role` and `invitations.role` gain `cleaner`. One middleware, `cleanerGuard` in new `src/lib/cleaner.js`, mounted in `src/server.js` right after `requireWorkspace`, lets a cleaner reach only an allow-list of API paths and returns 403 `CLEANER_FORBIDDEN` for everything else. Allow-list (method + path pattern):
  - `GET /auth/me`, everything under `/account/` and `/push/` and `/support/` and `/help` (their own account, notifications, help), `POST /auth/logout`
  - `GET /cleaning-tasks`, `GET /cleaning-tasks/:id`, `POST /cleaning-tasks/:id/checklist`, `POST /cleaning-tasks/:id/status` (not `cancelled`), `GET /cleaning-calendar`, `GET /cleaning-board`
  - `GET/POST /files` and `GET /files/:id` only for record types `cleaning`, `damage`, `lost_found` (checked in `files.js` via `checkRecord`)
  - `POST /cleaning-tasks/:id/damage`, `POST /cleaning-tasks/:id/lost-found`, `POST /cleaning-tasks/:id/supplies`, `POST /cleaning-tasks/:id/work-order`, `GET /supplies` (names and counts only, no costs)
  - `GET /my-pay`
  Cleaners are scoped to their assigned properties (like staff, via `property_assignments`), and within those see only tasks assigned to them or unassigned. Staff keep today's access. Existing `role === 'staff'` checks that hide data must also hide it for `cleaner` (search the code for `'staff'`); the guard is the safety net, not the only check. Cleaners can't be assigned as managers of anything.
- **D-49 Unit status.** `units.cleaning_status` gains `inspected` (`dirty`, `clean`, `inspected`). Check-out → dirty (as today); task done → clean; inspection passed → inspected; inspection failed → dirty and the task reopens (`todo`) with the failed items unticked. Anything that treats "not dirty" as ready keeps working.
- **D-50 Inspections.** Owners and managers inspect a done task: each checklist item pass or fail, optional notes and photos. Score = passed ÷ items × 100, rounded. Pass = no failed items. Stored in `cleaning_inspections`. Cleaner quality score = average score of their inspected tasks in the period.
- **D-51 Damage reports.** Anyone working the task (cleaner, staff, managers, owners) can report damage on a task's stay or a unit: description, optional estimated cost, photos. Owners and managers resolve it: **Charge the guest** (creates a Phase 1 `booking_charges` row, category `damage`, and links it), **Deduct from deposit** (the deposit settle form pre-fills the open damage total as the deduction), or **Waive**. Cleaners never see the resolution amounts.
- **D-52 Cleaner pay.** Rates per cleaner (a team member, or an outside cleaner by name): per clean or per hour. When a task is marked done, `pay_amount` is set from the rate (per hour = hours between started and completed, rounded up to the next 15 minutes, at most 12 hours); owners and managers can edit it until it's paid. **Mark paid** takes several tasks at once with date, method (cash, gcash, maya, bank_transfer) and reference. An optional tick "Also record as cleaning expenses" creates one `cleaning` expense per unit for the paid tasks (these then show on profit and loss and owner statements). Cleaners see only their own pay (`GET /my-pay`).
- **D-53 Supplies.** Per property: item name, unit label (pcs, rolls, bottles), par level, on hand. Movements are logged (`used`, `restocked`, `count`) and update on hand. Low stock = on hand below par; shown on Home for owners and managers and on the supplies page. No costs or purchasing.
- **D-54 Lost and found and work orders.** Lost and found: item, where found, date, linked stay and unit, photos, status held → returned or disposed. Guest contact for returning items stays on the reservation (owners and managers). Work orders: a cleaner raises a maintenance request from a task (title, description, priority, photos); it's a normal maintenance request with `cleaning_task_id`. Recurring maintenance: a schedule per property or unit (title, every N days or months, next due date); an hourly job creates the maintenance request when due and moves the next due date forward.

**General:** money is NUMERIC (strings, centavos). Every write audited. Validate with `src/lib/validate.js`. Scope with `propertyScope`. Sentence-case UI, tokens, light and dark, `filterBar()` on list pages, phone first for anything cleaners use. Cleaner-facing screens are in English and Taglish (cleaners in the Philippines often prefer Taglish): use `public/js/i18n.js` `extendTranslations` like the guest pages, following the workspace's `guest_language` setting.

## Database: migration `db/migrations/030_phase3_operations.sql` (Lane 0, first)

- `users.role` CHECK and `invitations.role` CHECK: add `cleaner` (drop and re-add the constraints; find their names with `\d users`).
- `units.cleaning_status` CHECK: add `inspected`.
- `cleaning_tasks` add: `pay_amount numeric(12,2) CHECK (>= 0)`, `pay_status text NOT NULL DEFAULT 'unpaid' CHECK IN ('unpaid','paid')`, `paid_on date`, `paid_method text CHECK IN ('cash','gcash','maya','bank_transfer')`, `paid_reference text` (≤100), `paid_by uuid → users`, `pay_expense_id uuid → expenses`. Index on `(organization_id, pay_status)`.
- `cleaner_rates`: `rate_id uuid pk`, `organization_id`, `user_id → users` NULL, `assignee_name text` NULL (≤120), `rate_type` CHECK IN ('per_clean','per_hour'), `amount numeric(12,2) >= 0`, `updated_at`. CHECK exactly one of user_id / assignee_name. Unique (organization_id, user_id) where user_id not null; unique (organization_id, lower(assignee_name)) where assignee_name not null.
- `cleaning_inspections`: `inspection_id uuid pk`, `organization_id`, `task_id → cleaning_tasks`, `inspected_by → users`, `items jsonb` ([{text, pass}]), `score smallint 0–100`, `passed boolean`, `notes text` (≤1000), `created_at`. Index on task_id.
- `damage_reports`: `report_id uuid pk`, `organization_id`, `unit_id → units`, `booking_id → bookings` NULL, `task_id → cleaning_tasks` NULL, `description text` (1–1000), `estimated_cost numeric(12,2) >= 0` NULL, `status` CHECK IN ('open','charged','deducted','waived') default 'open', `charge_id → booking_charges` NULL, `resolution_note text` (≤500), `reported_by → users`, `resolved_by → users`, `created_at`, `resolved_at`. Index (organization_id, status).
- `lost_found_items`: `item_id uuid pk`, `organization_id`, `unit_id`, `booking_id` NULL, `task_id` NULL, `description text` (1–300), `found_where text` (≤200), `found_on date`, `status` CHECK IN ('held','returned','disposed') default 'held', `status_note text` (≤300), `found_by → users`, `updated_by → users`, `created_at`, `updated_at`. Index (organization_id, status).
- `supplies`: `supply_id uuid pk`, `organization_id`, `property_id → properties`, `name text` (1–80), `unit_label text` (≤20, default 'pcs'), `par_level int >= 0`, `on_hand int >= 0`, `archived_at`, `created_at`, `updated_at`. Unique (property_id, lower(name)) where archived_at null.
- `supply_movements`: `movement_id uuid pk`, `organization_id`, `supply_id`, `kind` CHECK IN ('used','restocked','count'), `quantity int` (>0 for used/restocked; >=0 for count — count sets on hand), `task_id` NULL, `note text` (≤200), `recorded_by → users`, `created_at`.
- `maintenance_requests` add `cleaning_task_id uuid → cleaning_tasks` NULL, `schedule_id uuid` NULL (FK added after the next table).
- `maintenance_schedules`: `schedule_id uuid pk`, `organization_id`, `property_id`, `unit_id` NULL, `title text` (1–150), `description text`, `every_n int` 1–365, `every_unit` CHECK IN ('days','months'), `next_due date`, `priority` (same allow-list as requests) default 'medium', `active boolean` default true, `last_created_at`, `created_by`, `created_at`.
- `files.related_record_type`: add `damage`, `lost_found`, `inspection`.
- `src/lib/account.js`: new tables in `PURGED_TABLES`, `purgeOrganization()` (FK-safe order: supply_movements before supplies; inspections, damage_reports, lost_found_items before cleaning_tasks; maintenance_requests reference schedules — clear in the right order), `exportOrganization()` (all new tables).

## Lane A: cleaner role and guard (backend)

**Owns:** new `src/lib/cleaner.js` (`cleanerGuard`, `isCleaner`), `src/routes/team.js` (invite and edit roles allow `cleaner`; cleaners must have at least one property), the `'staff'`-based hiding checks elsewhere **only by adding `|| role === 'cleaner'` style changes in files no other lane owns** (list each file you touch in your report; do NOT edit `housekeeping.js`, `files.js`, `maintenance.js`, `deposits.js`), new `test/cleaner-role.test.js`. The orchestrator mounts `cleanerGuard` in `server.js`.
- Tests: a cleaner invited, accepted, signs in; every non-allow-listed route family returns 403 (`/reservations`, `/guests`, `/listings`, `/reports/*`, `/payments`, `/expenses`, `/unit-owners`, `/inbox`, `/settings`-type routes, `/team`); allow-listed ones work; staff and managers unchanged.

## Lane B: housekeeping backend (board, calendar, scoping, inspections)

**Owns:** `src/routes/housekeeping.js`, `src/lib/housekeeping.js`, new `test/housekeeping-phase3.test.js`.
- Cleaner scoping in `GET /cleaning-tasks` and `loadTask`: properties assigned + (assigned to them or unassigned). Cleaners can't cancel and can't see `departing_guest` beyond first name; never booking money.
- `GET /cleaning-board?property_id=` → `{ units: [{ unit_id, unit_name, property_name, cleaning_status, cleaning_updated_at, current_stay: { check_in, check_out, guest_first_name } | null, next_check_in, open_task: { task_id, status, assignee } | null, last_inspection: { score, passed, at } | null }] }`.
- `GET /cleaning-calendar?from&to` (max 31 days) → `{ days: [{ date, tasks: [...task summary incl. assignee, unit, status, next_check_in] }], assignees: [...] }`. Owners and managers see all; cleaners only theirs.
- `PATCH /cleaning-tasks/:id` (managers) accepts `assigned_to` / `assignee_name` as today, plus `pay_amount` (only while unpaid).
- On `done`: call `require('../lib/cleanerpay').computePay(db, taskId)` (Lane C writes it; require lazily, skip if missing).
- `POST /cleaning-tasks/:id/inspect` (owners, managers; task must be `done`) `{ items: [{ index, pass }], notes }` → stores inspection, sets unit status per D-49; on fail reopens the task and unticks failed items. Returns `{ inspection, task }`. `GET /cleaning-tasks/:id` includes `inspections`.
- `GET /cleaner-scores?month=` (owners, managers) → per cleaner: tasks done, inspected, average score, fails.

## Lane C: cleaner pay (backend)

**Owns:** new `src/lib/cleanerpay.js` (exports `computePay(db, taskId)`, `rateFor(db, orgId, task)`), new `src/routes/cleanerpay.js`, new `test/cleanerpay.test.js`.
- `GET/PUT /cleaner-rates` (owners): list and upsert `{ user_id | assignee_name, rate_type, amount }`; `DELETE /cleaner-rates/:id`.
- `GET /cleaner-pay?month=&cleaner=&status=` (owners, managers, scoped): tasks done in the month with pay, grouped totals per cleaner (`unpaid`, `paid`).
- `POST /cleaner-pay/mark-paid` (owners, managers) `{ task_ids[], paid_on, method, reference, record_expense }` — all tasks must be done, unpaid, in scope, have a pay_amount; one transaction; optional expenses per unit (category `cleaning`, description "Cleaning pay: {cleaner}, {n} cleans", `recorded_by` the user, linked via `pay_expense_id`).
- `POST /cleaner-pay/:taskId/unpay` (owners) — reverses: voids the linked expense only if every task on it is being unpaid; otherwise 409 with a clear message.
- `GET /my-pay?month=` (any role, own tasks only by `completed_by`/`assigned_to` = user): tasks, amounts, paid status, totals.

## Lane D: damage reports and lost and found (backend)

**Owns:** new `src/routes/damage.js`, new `src/routes/lostfound.js`, `src/routes/deposits.js` (suggested deduction only), the `checkRecord` cases for `damage`, `lost_found`, `inspection` and the cleaner file-type restriction in `src/routes/files.js`, new `test/damage-lostfound.test.js`.
- `POST /cleaning-tasks/:id/damage` and `POST /reservations/:id/damage` and `POST /units/:id/damage` `{ description, estimated_cost }` → 201 `{ report }`. Cleaners only via the task route.
- `GET /damage-reports?status=&unit_id=` (owners, managers), `GET /reservations/:id/damage` (owners, managers).
- `POST /damage-reports/:id/charge` `{ amount, description }` (owners, managers) — creates the booking charge through the same logic as `src/routes/charges.js` (reuse its exported helper if any; otherwise call the same SQL including `extras_total` recompute and closing open checkouts — read charges.js) and marks `charged`. `POST /damage-reports/:id/deduct` marks `deducted` (the deduction itself is recorded when settling the deposit). `POST /damage-reports/:id/waive` `{ note }`.
- `GET /reservations/:id/deposit` adds `suggested_deduction` = sum of estimated_cost of that stay's `open` + `deducted` reports.
- Lost and found: `POST /cleaning-tasks/:id/lost-found`, `POST /reservations/:id/lost-found` `{ description, found_where, found_on }`; `GET /lost-found?status=&q=` (owners, managers); `PATCH /lost-found/:id` `{ status, status_note }` (owners, managers); `GET /reservations/:id/lost-found`.
- Files: `damage` and `lost_found` uploads allowed for whoever can see the record (cleaners: only records they created on tasks they can see); `inspection` for owners and managers.

## Lane E: supplies, work orders, recurring maintenance (backend)

**Owns:** new `src/routes/supplies.js`, `src/routes/maintenance.js`, new `src/lib/maintschedule.js`, one job line in `src/lib/scheduler.js`, new `test/supplies-maintenance.test.js`.
- Supplies: `GET /supplies?property_id=&low=1` (all roles scoped; cleaners get no `updated_by`), `POST /supplies` / `PATCH /supplies/:id` / `POST /supplies/:id/archive` (owners, managers), `POST /supplies/:id/movements` (owners, managers), `POST /cleaning-tasks/:id/supplies` `{ items: [{ supply_id, kind: used|restocked, quantity }] }` (anyone who can see the task; supply must be in the task's property; on hand can't go below 0 — clamp to 0 and note it). `GET /supplies/low-count` → `{ count }` for Home.
- Work orders: `POST /cleaning-tasks/:id/work-order` `{ title, description, priority }` creates a maintenance request on the task's property and unit with `cleaning_task_id`, `reported_by` = the user's name; notifies owners and managers by push like other notifications. Cleaners can't open `/maintenance` itself (guard), but `GET /cleaning-tasks/:id` will list linked requests (Lane B reads `maintenance_requests.cleaning_task_id`).
- Recurring: `GET/POST /maintenance-schedules`, `PATCH /maintenance-schedules/:id`, `POST /maintenance-schedules/:id/pause` (owners, managers, scoped). Job `maintenance-schedules` hourly: for active schedules with `next_due <= today (Manila)`, create a request (title, description, priority, `schedule_id`) unless one from this schedule is still open, then advance `next_due` by the interval until it's in the future. Export the job function for tests.

## Lane F: housekeeping screens (frontend)

**Owns:** `public/js/views/housekeeping.js`, a CSS block `/* Phase 3: housekeeping */` appended at the end of `public/css/app.css`.
- Tabs on `#/housekeeping`: **Tasks** (today's list as now), **Board** (unit cards coloured by status, with current/next stay and open task; status chip with text, not colour alone), **Calendar** (week view by day; owners/managers can reassign with a select on each task), **Scores** (owners/managers).
- Task detail: checklist (big tap targets), photos, **Report damage**, **Found an item**, **Supplies used**, **Something broken?** (work order) buttons opening small forms; **Inspect** (owners, managers, when done) with pass/fail per item; inspection history; pay amount (owners/managers editable while unpaid; cleaners see their own pay for the task).
- Cleaner view: phone-first, Taglish via `extendTranslations` when the workspace language is Taglish. Never shows money except their own pay.

## Lane G: pay, supplies, lost and found, schedules screens (frontend)

**Owns:** new `public/js/views/cleanerpay.js` (exports `cleanerPayView` for `#/cleaner-pay` — owners/managers: month, filters, select unpaid tasks, **Mark paid** modal with the expense tick; rates editor for owners — and `myPayView` for `#/my-pay`), new `public/js/views/supplies.js` (`suppliesView` `#/supplies`: per property, low-stock highlight, add/edit/archive, record count/restock), new `public/js/views/lostfound.js` (`lostFoundView` `#/lost-found`), the schedules section in `public/js/views/maintenance.js` (list, add, pause; "From cleaning task" badge on requests with `cleaning_task_id`). CSS block `/* Phase 3: operations pages */` at the end of app.css.

## Lane H: app shell, team, reservation cards (frontend)

**Owns:** `public/js/app.js` (routes for Lane G's views; nav entries: Cleaner pay, Supplies, Lost and found for owners/managers; a cleaner sees only Cleaning, My pay, Help, Account; a cleaner's home is `#/housekeeping`), the team invite and edit role select in `public/js/views/settings.js` (adds "Cleaner — sees cleaning jobs only, no money or guest details"), `public/js/views/reservations.js` (damage reports card with Charge / Deduct / Waive, lost and found card), `public/js/views/deposits.js` (pre-fill the deduction from `suggested_deduction`), `public/js/views/home.js` (a "Supplies running low (n)" line for owners and managers, and unit status counts dirty / clean / inspected if there's a suitable slot).

## Lane I: integration (after all)

Mount the new routers in `src/server.js` (orchestrator does the mounts and the `cleanerGuard`), help articles (`src/lib/helpcenter.js`), canon docs (PRD, APP-FLOW, BACKEND-SCHEMA incl. the access matrix with the cleaner role, DECISIONS D-48 to D-54, IMPLEMENTATION-PLAN build record).

## Acceptance

- `npm test` passes (orchestrator, once at the end). Lanes test only their own files on their own database.
- A cleaner can't reach any non-allow-listed API (403) and never receives guest phone, email, booking totals, payments, or other cleaners' pay.
- Existing staff, manager and owner behaviour unchanged.
- Money exact to the centavo. Security review PASS. Browser check at phone and desktop, light and dark, including the cleaner's phone view in Taglish.
