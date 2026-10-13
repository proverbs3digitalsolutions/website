# Phase 5: Pricing rules, team tools and bigger properties (build spec)

Founder approved 2026-10-13 ("proceed to phase 5"). Source: `docs/research/00-SUMMARY.md` §4 Phase 5 (items 21–24). Read `CLAUDE.md` and `docs/specs/PHASE-4-GUESTS.md` (same conventions) first.

**Already in BalayHub (build on it, don't duplicate):** seasons with their own rate and minimum stay; a built-in Philippine holiday list used by the holiday rate; weekend rate; weekly (7+) and monthly (28+) discounts; per-night custom prices on the calendar; conversation assignment (`conversations.assigned_to`, "mine"/"unassigned" filters); moving a reservation to another listing through its edit form; per-type push notifications; iCal sync status per feed (`last_synced_at`, `last_status`, `last_message`, and skipped overlapping events).

**In scope**
1. Pricing rules: event price changes by percentage, last-minute and far-out rules, gap-night rule, a 14+ night discount, a lowest-price floor, a price preview, and bulk price and block changes across listings.
2. Listing tags (for filtering and bulk changes) and room types.
3. Team: an activity log on each reservation, notify on assignment, @mentions in internal notes, notification settings per person (by type and by property).
4. Bigger properties: group bookings across several listings, "pick a free room of this type" when creating a reservation, drag a booking to another listing on the calendar, and a daily close checklist.
5. Sync health: clear warnings when a channel calendar hasn't refreshed or reports an overlapping booking, with one alert per problem.

**Out of scope:** occupancy-based automatic pricing (founder decision pending in BLOCKERS), room types on the public booking page, group payments in one checkout, shift scheduling, any outside integration, AI.

## Shared decisions (record as D-66 to D-73)

- **D-66 Pricing rules.** Order for each night: (1) a custom price set on the calendar wins as is — no rule changes it; (2) holiday rate; (3) a season: either its fixed nightly rate or, new, `adjust_pct` (−90 to +300) applied to the price the night would otherwise have (weekend or base); (4) weekend rate; (5) base rate. Then booking-window rules from `pricing_rules` (workspace-wide or for one listing; a listing rule replaces the workspace rule of the same kind):
  - `last_minute`: check-in within `days` (0–30) of today (Manila) → `adjust_pct` (−90..+300, usually negative).
  - `far_out`: check-in more than `days` (31–540) away → `adjust_pct`.
  - `gap_night`: the stay exactly fills a free gap of 1..`days` (1–7) nights between two confirmed bookings or blocks → `adjust_pct`, and the listing/season minimum stay is waived for that gap.
  At most one of last-minute/far-out applies; gap applies on top. Rule adjustments apply to non-custom nights and multiply. Each night's price is then raised to `units.min_price` if set (never below). Stay discount ladder: monthly (28+) › new `units.fortnight_discount` (14+) › weekly (7+). Every night in a quote carries `kind` and `label` and a list of applied rules, so the preview can explain the price. The same engine is used by the direct booking page, quotes, the host's new-reservation price suggestion and the calendar prices. Prices already agreed on existing bookings never change.
- **D-67 Bulk changes.** Owners and managers (managers only on their properties) pick listings (by checkbox or tag) and a date range (≤ 366 days, ≤ 50 listings): **set price**, **change by %** (writes custom prices = today's computed price × (1 + pct)), **clear custom prices**, **block** (creates blocks, skipping listings/nights that overlap a booking and listing what was skipped), **unblock** (cancels manual blocks fully inside the range; never touches reservations, channel blocks or owner blocks). Every action has a **preview** (`dry_run: true`) showing exactly what will change, then **apply**. Audited as one entry with counts.
- **D-68 Tags and room types.** `units.tags text[]` (lowercase, 1–30 chars each, ≤ 10 per listing) and `units.room_type text` (≤ 40, e.g. "Studio", "1-bedroom"). Tags filter listings, the calendar, bulk changes and P&L. Room types are used when creating a reservation ("any free Studio in Azure") and for group bookings.
- **D-69 Team tools.**
  - **Activity log:** each reservation shows a newest-first list of what happened, in plain English, from `audit_logs` for the booking and its related records (charges, payments, refunds, payment proofs, deposits, damage reports, cleaning task, guest messages sent, check-in form, quote) with who and when. Owners and managers only; staff never see money lines.
  - **Assignment:** assigning a conversation notifies the assignee (push, plus email if they have no push device). Home shows "Assigned to you (n)".
  - **@mentions:** in internal notes, `@` + a team member's name (autocomplete in the app; stored as `@[Full Name](user_id)`) notifies that person by push or email with the note text and a link — only if they can see that reservation's property; otherwise the mention is refused with a clear message. Staff and cleaners can't be mentioned (they can't open the inbox).
  - **Notification settings:** in My account, each person turns each notification type on or off and (owners) chooses "all properties" or specific properties. Stored in `users.notify_prefs jsonb`. Applies to push and to the new email fallbacks. Default: everything on, all properties.
- **D-70 Group bookings.** A group = one lead guest, a name ("Santos family reunion"), and 2–20 reservations (one per listing) that are normal bookings linked by `bookings.group_id`. Create from "New group booking": choose listings (or a room type + count, auto-picking free listings), dates (same for all, editable per room), guests per room, price per room (suggested by the engine). All-or-nothing: if any room is taken, nothing is created and the taken rooms are named. The group page shows rooms, per-room and total amounts, paid and balance, and actions: add a room, remove a room (cancels that booking), cancel the whole group. Payments stay per reservation (no group checkout this phase). Channel-imported bookings can't join groups.
- **D-71 Moving a booking on the calendar.** Owners and managers can drag a reservation to another listing's row on the same dates; a confirm dialog shows from/to and keeps the price ("Price stays the same"); it uses the existing reservation update. Not allowed for channel-managed stays (existing rule) or onto a taken listing (409 shown). Keyboard and phone: a "Move to another listing" button on the reservation does the same. Moving keeps the cleaning task in step (existing behaviour).
- **D-72 Daily close.** A page for owners and managers (scoped) for a chosen day (default today, Manila): arrivals not checked in, departures not checked out, cleanings not done, payments recorded that day by method with totals, balances due within 2 days, pending payment proofs, open damage reports, sync problems. "Close the day" stores a `daily_closes` row (date, property scope, summary snapshot, note, closed_by); one per workspace per date (re-closing updates it, audited). Home shows "Day not closed yet" after 9 PM if enabled. History list of past closes.
- **D-73 Sync health.** A channel feed is **stale** when `last_synced_at` is older than 3 hours (sync runs every 30 minutes) and **failing** when `last_status = 'error'`. Overlaps: when a sync skips an event because the dates are taken in BalayHub, record it in `ical_conflicts` (feed, dates, external uid, first_seen, resolved_at) instead of only text. Home, the calendar and Listings show a warning with the listing, channel and what to do. Owners (and managers of that property) get **one** alert (push + email) per new problem, not every 30 minutes; a problem that clears is marked resolved. `GET /sync-health` lists current problems.

**General:** money NUMERIC (strings, centavos), audit every write, validate with `src/lib/validate.js`, scope with `propertyScope`, cleaners denied by the guard (no new allow-list entries), sentence case, colour tokens, light and dark, `filterBar()` on list pages.

## Database: migration `db/migrations/032_phase5_pricing_team.sql` (Lane 0, first)

- `seasons` add `adjust_pct smallint CHECK (adjust_pct BETWEEN -90 AND 300)`; relax the existing CHECK so a season needs at least one of `nightly_rate`, `min_nights`, `adjust_pct`, and can't have both `nightly_rate` and `adjust_pct`.
- `pricing_rules`: `rule_id uuid PK`, `organization_id`, `unit_id → units ON DELETE CASCADE` NULL (= all listings), `kind` CHECK IN ('last_minute','far_out','gap_night'), `days smallint` (validated per kind in code; CHECK 0–540), `adjust_pct smallint CHECK (-90..300)`, `active boolean default true`, `created_by`, `created_at`, `updated_at`. Unique `(organization_id, kind, unit_id)` treating NULL as a value (use `COALESCE(unit_id, '00000000-0000-0000-0000-000000000000')` in a unique index).
- `units` add `fortnight_discount numeric(5,2) NOT NULL DEFAULT 0 CHECK (0..90)` (match the type of `weekly_discount` — check it), `min_price numeric(12,2) CHECK (>= 0)` NULL, `tags text[] NOT NULL DEFAULT '{}'`, `room_type text` (≤40). GIN index on tags.
- `users` add `notify_prefs jsonb NOT NULL DEFAULT '{}'`.
- `booking_groups`: `group_id uuid PK`, `organization_id`, `name text` 1–120, `guest_id → guests`, `notes text` ≤1000, `created_by`, `created_at`, `cancelled_at`. `bookings` add `group_id → booking_groups` NULL + index.
- `daily_closes`: `close_id uuid PK`, `organization_id`, `close_date date`, `property_ids uuid[]` (scope used; empty = all), `summary jsonb`, `note text` ≤1000, `closed_by → users`, `closed_at`, `updated_at`. Unique `(organization_id, close_date)`.
- `ical_conflicts`: `conflict_id uuid PK`, `organization_id`, `feed_id → ical_feeds ON DELETE CASCADE`, `unit_id`, `external_uid text`, `check_in date`, `check_out date`, `first_seen_at`, `last_seen_at`, `alerted_at`, `resolved_at`. Unique `(feed_id, external_uid)`.
- `ical_feeds` add `alerted_at timestamptz` (last stale/failing alert), `problem_since timestamptz`.
- `src/lib/account.js`: new tables in `PURGED_TABLES`, `purgeOrganization()` (FK-safe), `exportOrganization()`.

## Lane A: pricing engine and rules (backend)

**Owns:** `src/lib/pricing.js`, `src/routes/pricing.js`, new `test/pricing-rules.test.js`. Existing pricing tests must pass unchanged.
- Engine per D-66. `quote()` keeps its shape and adds per-night `applied: [{kind, label, adjust_pct}]`, `fortnight` in the discount ladder, `gap_night: true` and the waived minimum when it applies. Load neighbouring confirmed bookings/blocks for the gap rule in the same query style.
- Routes (owners, managers; managers only for their listings; workspace-wide rules owners only): `GET /pricing` adds `rules`; `POST /pricing/rules`, `PATCH /pricing/rules/:id`, `POST /pricing/rules/:id/remove`; seasons accept `adjust_pct`; `GET /pricing/preview?unit_id&from&days` (≤ 120 days) → `{ nights: [{ date, price, kind, label, applied, booked }] }`.

## Lane B: bulk changes, tags, room types (backend)

**Owns:** new `src/routes/bulk.js`, `src/routes/properties.js` (unit fields `tags`, `room_type`, `min_price`, `fortnight_discount`; `GET /listings?tag=` filter if listings live there — find where `/listings` is served and own only the tag filter in that file if it's not properties.js, list it in your report), new `test/bulk.test.js`.
- `POST /bulk/prices { unit_ids | tag, from, to, action: 'set'|'percent'|'clear', price?, percent?, dry_run }` → `{ changes: [{ unit_id, unit_name, date, from_price, to_price }], count }` (preview capped to the first 500 rows plus totals).
- `POST /bulk/blocks { unit_ids | tag, from, to, action: 'block'|'unblock', reason?, dry_run }` → `{ created|cancelled: [...], skipped: [{ unit_id, unit_name, reason }] }`.
- `GET /tags` → `{ tags: [{ tag, count }] }`, `GET /room-types` → `{ room_types: [{ property_id, room_type, count }] }`.

## Lane C: activity log (backend)

**Owns:** new `src/routes/activity.js`, new `src/lib/activity.js` (`describe(row)` → plain-English line), new `test/activity.test.js`.
- `GET /reservations/:id/activity` (owners, managers; scoped) → `{ items: [{ at, who, text, kind }] }`, newest first, max 200. Read `audit_logs` actions used across `src/routes/*.js` (grep `audit(`) and map each relevant action to a sentence; unknown actions → a generic line with the action name humanised. Include related records by joining on their ids (charges, payments, refunds, proofs, deposits, damage reports, cleaning task, quote) — check how each audit call records `record_type`/`record_id`/details.

## Lane D: inbox assignment and mentions, notification settings (backend)

**Owns:** `src/routes/inbox.js`, `src/lib/push.js`, `src/routes/push.js`, new `src/lib/notify.js` (`notifyUser(userId, type, payload)` → push if devices, else email; respects `notify_prefs`; and a helper used by push.notify to filter recipients by prefs and property), new `test/team-notify.test.js`.
- Assignment change → `notifyUser(assignee)` (not when assigning yourself).
- Notes (`direction = 'note'`): parse `@[Name](uuid)` mentions; each must be an active owner/manager of the workspace who can see the booking's property, else 400 `fields.body`; notify each once. Return `mentions` in the message.
- `GET /account/notify-prefs` / `PATCH /account/notify-prefs` (any signed-in member; property list limited to what they can see): `{ types: { <type>: boolean }, property_ids: [] | null }`. Add the mention and assignment types to `push.TYPES` (`mention`, `assignment`; roles owner, manager).
- `GET /inbox/assigned-count` → `{ count }` for Home.

## Lane E: group bookings, room-type pick (backend)

**Owns:** `src/routes/stays.js`, new `test/groups.test.js`.
- `POST /reservations` accepts `room_type` + `property_id` instead of `unit_id` → picks the first free active listing of that type (by name), 409 `NO_FREE_ROOM` if none.
- Groups: `POST /booking-groups { name, guest (existing guest_id or new guest fields), rooms: [{ unit_id | room_type+property_id, check_in, check_out, num_guests, accommodation_total, cleaning_fee }], notes }` (all-or-nothing in one transaction, row locks on units; 409 lists taken rooms); `GET /booking-groups?status=`, `GET /booking-groups/:id` (rooms with amounts, paid, balance; totals), `POST /booking-groups/:id/rooms` (add one), `POST /booking-groups/:id/rooms/:bookingId/remove` (cancels that booking with the normal cancel path), `POST /booking-groups/:id/cancel`, `PATCH /booking-groups/:id { name, notes }`. Reservation detail includes `group: { group_id, name, rooms }` when grouped. Staff see groups without money (like reservations).

## Lane F: daily close (backend)

**Owns:** new `src/routes/dailyclose.js`, new `test/dailyclose.test.js`.
- `GET /daily-close?date=` → the checklist sections per D-72 (each item with a link target), plus `closed` (the stored close if any). `POST /daily-close { date, note }` stores/updates the snapshot. `GET /daily-closes?from&to` history. Owners and managers, scoped by property; a manager's close records their property scope.

## Lane G: sync health (backend)

**Owns:** `src/lib/ical.js`, new `src/routes/synchealth.js`, one job line in `src/lib/scheduler.js` (`sync-health` every 15 minutes: alert stale/failing feeds per D-73), new `test/synchealth.test.js`.
- During sync, upsert skipped overlaps into `ical_conflicts` (and set `resolved_at` for ones no longer present or no longer overlapping); alert owners and managers of the property once per new conflict (use `require('./notify')` from Lane D lazily; fall back to `push.notify` + `sendMail`).
- `GET /sync-health` (owners, managers; scoped) → `{ problems: [{ kind: 'stale'|'failing'|'overlap', feed_id, unit_id, unit_name, channel, since, message, check_in?, check_out? }] }`.

## Lane H: pricing and listings screens (frontend)

**Owns:** `public/js/views/pricing.js` (rules editor: last-minute, far-out, gap-night per workspace or listing; seasons with "fixed price" or "% change"; price preview calendar for a listing with colour-coded kinds and a legend + tooltip/explainer per night; bulk tool modal with listing picker (checkboxes + tag), date range, action, **Preview** table, **Apply**), `public/js/views/listings.js` (tags chips input, room type, lowest price, 14+ night discount fields; tag filter in the filter bar), CSS block `/* Phase 5: pricing */`.

## Lane I: inbox mentions, notification settings, home (frontend)

**Owns:** `public/js/views/inbox.js` (assignment select already exists? keep; add @mention autocomplete in the internal note box that inserts `@[Full Name](id)` and renders mentions as names), `public/js/views/account.js` (Notifications card: per type toggles, property choice for owners), `public/js/views/home.js` ("Assigned to you (n)", sync problems banner from `/sync-health`, "Day not closed yet" link after 9 PM Manila), CSS block `/* Phase 5: team */`.

## Lane J: reservations, groups, calendar, daily close screens (frontend)

**Owns:** `public/js/views/reservations.js` (Activity card; group badge and link; "Move to another listing" modal; new reservation can pick "any free room of type"), new `public/js/views/groups.js` (`groupsView` `#/groups`, `groupDetailView` `#/groups/:id`, "New group booking" modal), `public/js/views/calendar.js` (drag a reservation bar to another listing row → confirm → PATCH; tag filter; sync warning chip on affected rows), new `public/js/views/dailyclose.js` (`dailyCloseView` `#/daily-close`), `public/js/app.js` (routes and nav: Groups, Daily close for owners/managers in short-term workspaces), CSS block `/* Phase 5: operations */`.

## Lane K: integration (after all)

Mount new routers in `src/server.js` (orchestrator), help articles, canon docs (PRD, APP-FLOW, BACKEND-SCHEMA, TRD for the new job, DECISIONS D-66 to D-73, IMPLEMENTATION-PLAN), run `chk-imports.js` and the full browser check.

## Acceptance

- `npm test` passes (orchestrator, once at the end); lanes test only their own files on their own database (never the dev database).
- Existing booking prices never change; a custom calendar price is never altered by rules; prices are never below the floor.
- Bulk preview equals what apply does.
- Group creation is all-or-nothing; no double booking possible.
- Mentions only reach people who can see the reservation.
- Sync alerts fire once per problem.
- Security review PASS. Browser check of pricing (rules, preview, bulk), listings, inbox mention, account notifications, reservation activity, groups, calendar drag, daily close and sync warnings at phone and desktop, light and dark.
