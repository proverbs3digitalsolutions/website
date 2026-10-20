# BalayHub: Backend Schema and Data Access (as built)

This document describes BalayHub's PostgreSQL schema as it stands after migrations `001`–`026` in `db/migrations/`, where uploaded files are stored, and who can see or change each kind of data. It was checked against the migrations and the route code in `src/routes/*.js` and `src/lib/*.js`. Anything not confirmed in the code is marked **unverified**.

Last updated: 2026-10-21 (QA round 24: section 30 and the receipt note in 2.5; D-106). Before that: 2026-10-21 (QA round 23: section 29, paid-day weighting, owner-only Team count, discount-code route; D-105). Before that: 2026-10-21 (QA round 22: section 28, markPaid free-day rule; D-104). Before that: 2026-10-21 (QA round 21: section 27; D-103). Before that: 2026-10-20 (QA round 20: migration 039, section 26, 2.15 card columns, support tickets row; D-102). Before that: 2026-10-20 (QA round 19: section 25, section 6 guest_has_email, billing 'attached' and expiry notes; D-101). Before that: 2026-10-19 (QA round 18: section 24, admin delete routes in matrix 6.4, null-workspace platform audit rows; D-100). Before that: 2026-10-15 (QA round 17: migrations 037 and 038, section 2.19, matrix 6.5, section 23; D-98 and D-99)

---

## 1. Conventions

| Topic | Rule as built |
|---|---|
| Keys | `uuid` primary keys with `gen_random_uuid()` (`pgcrypto`), except `audit_logs` and `consent_records` (`bigserial`), `sessions` and `auth_tokens` (token hash), and a few composite keys |
| Multi-tenancy | One database and one schema. Nearly every business table has `organization_id` (the workspace). Units, nightly rates and rent charges inherit the workspace through their parent |
| Money | `numeric(12,2)` in PHP. `pg` returns it as a string |
| Dates | Calendar dates are `date`. Moments are `timestamptz`. "Today" is Manila time |
| Deletion | Financial records are voided (`voided_at`, `voided_by`, `void_reason`), never deleted. Properties, units and tenants are archived (`status`). Unit owners are archived (`archived_at`). Hard deletes happen only where listed in section 4.3, and in the full workspace purge |
| Foreign keys | Default `ON DELETE NO ACTION` (a parent can't be deleted while referenced) unless noted otherwise |
| Polymorphic links | `files.related_record_id` and the `*_file_id` columns on `leases`, `payments` and `expenses` have **no** foreign key. `messages.automation_id` has no foreign key either. Integrity is kept in code |
| Text checks | Most name fields have `CHECK (length(trim(x)) BETWEEN 1 AND n)` |
| Migrations | Applied in name order on app start. Each is recorded in `schema_migrations(name, applied_at)` |

---

## 2. Tables by area

### 2.1 Accounts and auth

**users**: a person's login. One workspace per user.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK | |
| full_name | text | 1–120 characters |
| email | text | Unique, case-insensitive (`users_email_uq` on `lower(email)`) |
| phone | text | |
| password_hash | text | scrypt string. Google sign-ups get a random unusable hash |
| organization_id | uuid → organizations | NULL until the user creates or joins a workspace |
| role | text | `owner`, `manager` or `staff`. `CHECK ((organization_id IS NULL) = (role IS NULL))` |
| account_status | text | `active` or `revoked` (removed members are revoked, not deleted) |
| email_verified_at | timestamptz | |
| google_sub | text | Unique when set (`users_google_sub_uq`) |
| notify_prefs | jsonb | Push notification types turned off. Default `{}` (all on) |
| created_at | timestamptz | |

**sessions**

| Column | Type | Notes |
|---|---|---|
| token_hash | text PK | SHA-256 of the cookie token |
| user_id | uuid → users | **ON DELETE CASCADE** |
| created_at, last_seen_at, expires_at | timestamptz | Idle and absolute expiry are checked on each request (idle `SESSION_IDLE_HOURS`, default 12 h; absolute `SESSION_TTL_HOURS`, default 7 days; see TRD security) |
| user_agent | text | At most 300 characters (shown on My account) |

**auth_tokens**: one-time email links.

| Column | Type | Notes |
|---|---|---|
| token_hash | text PK | SHA-256 |
| user_id | uuid → users | **ON DELETE CASCADE** |
| purpose | text | `verify_email` (48 h) or `reset_password` (1 h) |
| expires_at, used_at, created_at | timestamptz | |

**invitations**

| Column | Type | Notes |
|---|---|---|
| invitation_id | uuid PK | |
| organization_id | uuid → organizations | |
| email | text | |
| role | text | `manager` or `staff` |
| token_hash | text | Unique |
| invited_by | uuid → users | |
| property_ids | uuid[] | Properties assigned when the invite is accepted |
| expires_at (7 days), accepted_at, revoked_at, created_at | timestamptz | |

**consent_records**

| Column | Type | Notes |
|---|---|---|
| consent_id | bigserial PK | |
| user_id | uuid → users | **ON DELETE CASCADE** |
| consent_type | text | `privacy_notice` or `terms_of_service` as written by the code |
| policy_version | text | |
| consent_timestamp, withdrawn_at | timestamptz | |

**push_subscriptions**

| Column | Type | Notes |
|---|---|---|
| subscription_id | uuid PK | |
| user_id | uuid → users | **ON DELETE CASCADE** |
| organization_id | uuid → organizations | |
| endpoint | text | Unique |
| p256dh, auth | text | Browser push keys |
| device, created_at, last_sent_at | | |

### 2.2 Workspace

**organizations**: one row per workspace. Columns were added over many migrations.

| Group | Columns |
|---|---|
| Identity | organization_id (uuid PK), name (1–120 characters), currency (`char(3)`, default PHP), timezone (default Asia/Manila), created_at |
| Modules | business_type: `short_term`, `long_term` or `both` |
| Plan | plan: `trial`, `starter`, `growth`, `pro` or `comped`; trial_ends_at; paid_until (date); plan_note; is_demo; demo_anchor (date) |
| Onboarding | onboarding_dismissed_at, onboarding_skipped (jsonb array), signup_profile (jsonb: units band, mobile) |
| Housekeeping | cleaning_checklist (jsonb array of default checklist items) |
| Direct booking | booking_slug (unique, case-insensitive, when set), booking_enabled, booking_intro, paymongo_key_enc (encrypted host key), paymongo_key_hint |
| Guest pages | guest_language: `en` or `tl` |
| Deletion | deletion_scheduled_at (deleted for good after this time) |

**property_assignments**: which properties a manager or staff member can see.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid → users | **ON DELETE CASCADE** |
| property_id | uuid → properties | No action |
| | | PK (user_id, property_id) |

### 2.3 Properties, units and pricing

**properties**

| Column | Type | Notes |
|---|---|---|
| property_id | uuid PK | |
| organization_id | uuid → organizations | Indexed |
| property_name | text | 1–120 characters |
| property_type | text | `apartment`, `boarding_house`, `condominium`, `house`, `commercial`, `dormitory` or `other` |
| address, city, province, postal_code, description | text | Address, city and province required |
| status | text | `active` or `archived` |
| admin_email, gatepass_enabled, gatepass_days_before (0–7), gatepass_attach_ids, gatepass_authorized_by, gatepass_notes | | Condo gate-pass settings (019) |
| created_at | timestamptz | |

**units**: a long-term rental unit and/or a short-term listing.

| Group | Columns and checks |
|---|---|
| Identity | unit_id (PK), property_id → properties, unit_name (1–60 characters; unique per property among active units: `units_name_uq` on `(property_id, lower(unit_name)) WHERE status = 'active'`), unit_type (`room`, `studio`, `apartment`, `bedspace`, `house`, `commercial_space`, `other`), status (`active`/`archived`), created_at |
| Long-term | monthly_rent (≥ 0, default 0), security_deposit_amount (≥ 0), availability (`available`/`unavailable`), availability_date |
| Short-term | nightly_rate (≥ 0; a non-NULL rate makes the unit count as a listing for plan limits), cleaning_fee, max_guests (1–50), checkin_time, checkout_time, min_nights (1–60), balance_due_days (0–60), bookable_online, payment_option (`full`, `deposit`, `either`), description |
| Price extras (shown in the app as "Price extras"; was "Pricing helpers") | weekend_rate, holiday_rate (≥ 0), weekly_discount (0–50 %), monthly_discount (0–70 %) |
| Guest info | wifi_name, wifi_password (plain text), checkin_instructions, house_rules |
| Housekeeping | cleaning_status (`clean`/`dirty`), cleaning_updated_at |
| Channels | ical_token (unique; private export feed token) |
| Owner | owner_id → unit_owners, **ON DELETE SET NULL** |

**nightly_rates**: per-night price overrides.

| Column | Type | Notes |
|---|---|---|
| unit_id | uuid → units | |
| rate_date | date | PK (unit_id, rate_date) |
| price | numeric | ≥ 0 |

**seasons**: date ranges with their own rate and/or minimum stay.

| Column | Type | Notes |
|---|---|---|
| season_id | uuid PK | |
| organization_id | uuid → organizations | |
| unit_id | uuid → units | NULL means every listing. **ON DELETE CASCADE** |
| name | text | 1–80 characters |
| start_date, end_date | date | First and last night. `end_date >= start_date`, at most 366 days |
| nightly_rate, min_nights | | At least one must be set (CHECK) |
| created_by, created_at | | |

### 2.4 Short-term bookings

**bookings**: reservations and owner blocks in one table, so the database itself prevents double booking.

| Column | Type | Notes |
|---|---|---|
| booking_id | uuid PK | |
| organization_id | uuid → organizations | |
| unit_id | uuid → units | |
| kind | text | `reservation` or `block` |
| guest_id | uuid → guests | Nullable. `guest_label` holds a name without a guest record (for example, from a channel) |
| channel | text | `direct`, `airbnb`, `booking`, `agoda`, `vrbo`, `expedia`, `tripcom` or `other` |
| status | text | `confirmed` or `cancelled` |
| check_in, check_out | date | `check_out > check_in`; at most 366 nights |
| num_guests | smallint | 1–50 |
| accommodation_total, cleaning_fee, other_fees, channel_fee | numeric | All ≥ 0. `channel_fee` must be 0 when `channel` is `direct`: the app refuses a fee on create and on any edit that leaves the booking direct with a fee (legacy rows may still hold one; it is ignored for what is owed and still counted as a cost in reports) |
| total_amount | numeric | **Generated**: accommodation + cleaning + other fees. Guest balance = total − channel fee − non-voided payments, where the channel fee counts as 0 on a `direct` booking (D-78) |
| confirmation_code | text | Unique per workspace |
| block_reason, notes, cancel_reason | text | |
| checked_in_at, checked_out_at, cancelled_at, created_at, updated_at | timestamptz | |
| ical_feed_id | uuid → ical_feeds | **ON DELETE SET NULL** |
| external_uid | text | Unique per feed (`bookings_feed_uid_uq`) |
| checkin_token, pay_token, review_token | text | Private guest-link tokens, each unique when set. Stored in plain text |
| created_by | uuid → users | |

**Owner-made blocks** (migration 029): `owner_block_by` (uuid → `unit_owners`, ON DELETE SET NULL) is set on blocks an owner makes in the owner portal. Those blocks are `kind = 'block'`, have `created_by` NULL, and can be cancelled by that owner until they start. Owners see guests by first name only, and blocks as "Blocked" unless they made them.

Key constraint: **`bookings_no_overlap`** is an `EXCLUDE USING gist (unit_id WITH =, daterange(check_in, check_out) WITH &&) WHERE (status = 'confirmed')` constraint (needs `btree_gist`). It applies to stays and blocks alike.

**ical_feeds**: channel calendars imported per listing.

| Column | Type | Notes |
|---|---|---|
| feed_id | uuid PK | |
| organization_id, unit_id | uuid | |
| channel | text | Same list as bookings, minus `direct` |
| url | text | Unique per unit |
| last_synced_at, last_status (`ok`/`error`), last_message, created_at | | |

**direct_checkouts**: a guest's online booking attempt on the host's booking page. Dates are held for 30 minutes.

| Column | Type | Notes |
|---|---|---|
| checkout_ref | uuid PK | |
| public_token | text | Unique; in the guest's return link |
| organization_id, unit_id | uuid | |
| check_in, check_out, num_guests | | |
| guest_name, guest_email, guest_phone, notes | text | |
| pay_type | text | `full` or `deposit` |
| accommodation_total, cleaning_fee, total_amount, amount_due_now (> 0), discount_amount | numeric | |
| discount_code_id | uuid → discount_codes | |
| status | text | `pending`, `confirmed`, `expired`, `conflict` or `failed` |
| provider_checkout_id | text | Unique (PayMongo checkout session) |
| key_enc | text | The host's encrypted PayMongo key used for this checkout |
| client_hash | text | Hashed guest IP, to cap open holds |
| test_mode | boolean | |
| booking_id | uuid → bookings | Set once confirmed |
| payment_method, hold_until, last_checked_at, consent_at, created_at, confirmed_at | | |

**discount_codes**: direct-booking promo codes.

| Column | Type | Notes |
|---|---|---|
| code_id | uuid PK | |
| organization_id | uuid | `(organization_id, code)` unique |
| code | text | `^[A-Z0-9-]{3,20}$` |
| percent_off (1–90) / amount_off (> 0) | | Exactly one must be set (CHECK) |
| min_nights, valid_from, valid_until, max_uses, returning_only, active, description, created_by, created_at | | |

### 2.4a Phase 4 guests (migration 031, 2026-10-13)

**Column and constraint changes**

| Where | Change |
|---|---|
| `bookings` | Add `guide_token` (unique where set; the private guidebook link), `rules_accepted_at`, `rules_text` (≤ 4000, the exact house rules accepted), `source` (facebook, instagram, messenger, viber, tiktok, google, whatsapp, email, referral, quote, other; null allowed). |
| `direct_checkouts` | Add `rules_accepted_at`, `rules_text` (≤ 4000), `source` (same list), `addons` (jsonb snapshot: addon_id, name, quantity, unit_price, amount), `addons_total` (≥ 0), `quote_id` → booking_quotes, `followup_sent_at`. Index on `(status, followup_sent_at)`. |
| `booking_charges` | `category` now also allows `addon`. Add `addon_id` → listing_addons and `request_key` (unique per booking where set; a pre-arrival purchase stores `<idempotency key>:<addon_id>`, so a retried request can't add a charge twice). |
| `organizations` | Add `review_links` (jsonb, up to 4 `{label, url}`, https only), `returning_guest_pct` (1 to 50, null = off), `abandoned_followup` (boolean, default false). |
| `discount_codes` | Add `issued_to_booking_id` → bookings (unique where set). A personal returning-guest code. |
| `units` | Add `public_slug` (listing page address). Indexed, not unique in the database, because `units` has no organization column; uniqueness is checked in code under a per-workspace lock (`pg_advisory_xact_lock`). Existing listings were backfilled from their names. |

**New tables**

| Table | Key columns and rules |
|---|---|
| `listing_addons` | `addon_id` PK, `organization_id`, `name` (1 to 80), `name_tl` (≤ 80), `description` (≤ 300), `price` > 0, `pricing` (per_stay, per_night, per_guest, per_guest_night), `max_quantity` 1 to 20, `unit_ids` (uuid array; empty means every listing), `on_booking_page`, `before_arrival`, `active`, `sort_order`, `created_at`, `updated_at`. |
| `unit_guides` | `unit_id` PK → units, `organization_id`. Five text sections, each ≤ 2000 with a `_tl` twin: `arrival`, `parking`, `building_notes`, `local_tips`, `emergency_contacts`. `door_code_enc` (encrypted with `src/lib/secretbox.js`), `updated_at`, `updated_by`. |
| `booking_quotes` | `quote_id` PK, `organization_id`, `unit_id`, `public_token` (unique, 24 random bytes, base64url), `check_in`, `check_out` (check_out after check_in), `num_guests` 1 to 50, `guest_name` (≤ 120), `guest_email`, `guest_phone`, `accommodation_total` ≥ 0, `cleaning_fee` ≥ 0, `addons` (jsonb snapshot), `addons_total` ≥ 0, `discount_amount` ≥ 0, `total_amount` > 0, `pay_type` (full or deposit), `note` (≤ 1000), `expires_at`, `status` (open, paid, expired, cancelled), `booking_id` → bookings (set when paid), `created_by`, `created_at`, `cancelled_at`. Indexes on `(organization_id, status)`, `unit_id`, and `booking_id`. |

**Money rules for these tables.** All amounts are `numeric(12,2)`. Add-on amounts are worked out in centavos. A booking's `total_amount` is accommodation + cleaning + other fees + extras (add-ons are extras), so owner statements and P&L include them with no extra code.

**Purge and export.** The three new tables are in `PURGED_TABLES` and in the purge order in `src/lib/account.js`. The export includes `unit_guides` without `door_code_enc`, and includes `booking_quotes` (the public token is removed by the secret-key filter). `listing_addons` is included in the export by workspace.

---

### 2.4b Phase 5 pricing and team (migration 032, 2026-10-13)

**Column and constraint changes**

| Where | Change |
|---|---|
| `seasons` | Add `adjust_pct` smallint, −90 to 300. A season needs one of a nightly rate, a minimum stay or a percentage, and can't have both a nightly rate and a percentage. The old "rate or minimum stay" check is replaced. |
| `units` | Add `fortnight_discount` smallint 0 to 90 (same type as `weekly_discount`), `min_price` numeric(12,2) ≥ 0 (null = no floor), `tags` text[] (default empty; GIN index `units_tags_idx`), `room_type` text ≤ 40. |
| `users` | No change. `notify_prefs` jsonb was added in migration 015. Its shape is now: one boolean per notification type (`new_booking`, `guest_message`, `checkin_form`, `payment`, `cleaning`, `mention`, `assignment`, `sync_problem`), and an optional `property_ids` list. No list means all properties. |
| `bookings` | Add `group_id` → booking_groups (null for normal reservations; indexed where set). |
| `ical_feeds` | Add `alerted_at` (when the last stale or failing alert was sent) and `problem_since` (when the current problem started). |

**New tables**

| Table | Key columns and rules |
|---|---|
| `pricing_rules` | `rule_id` PK, `organization_id`, `unit_id` → units (null = every listing; deleted with the listing), `kind` (last_minute, far_out, gap_night), `days` smallint 0 to 540 (checked per kind in code: 0 to 30, 31 to 540, 1 to 7), `adjust_pct` smallint −90 to 300, `active`, `created_by`, `created_at`, `updated_at`. Unique on `(organization_id, kind, unit_id)` with null treated as a value. |
| `booking_groups` | `group_id` PK, `organization_id`, `name` (1 to 120), `guest_id` → guests, `notes` (≤ 1000), `created_by`, `created_at`, `cancelled_at`. Indexed by organization and guest. |
| `daily_closes` | `close_id` PK, `organization_id`, `close_date`, `property_ids` uuid[] (the properties the close covers; empty = whole workspace), `summary` jsonb (counts per section and payment totals by method, as they were at close), `note` (≤ 1000), `closed_by`, `closed_at`, `updated_at`. Unique on `(organization_id, close_date)`. |
| `ical_conflicts` | `conflict_id` PK, `organization_id`, `feed_id` → ical_feeds (cascade delete), `unit_id`, `external_uid`, `check_in`, `check_out`, `first_seen_at`, `last_seen_at`, `alerted_at`, `resolved_at` (null = open). Unique on `(feed_id, external_uid)`. Open rows are indexed by organization. |

**Money rules.** The price engine works in whole centavos. Rule and season percentages are applied once to each night, rounded to the centavo. A custom calendar price is never changed by a rule. Stored amounts are numeric, and `pg` returns them as strings.

**Purge and export.** The four new tables are in `PURGED_TABLES` in `src/lib/account.js`, and the purge removes them before the tables they point to.

**Migration.** The migration is forward only. Its header comment has the rollback statements, for use as a new migration or from the pre-deploy backup.

---

### 2.5 Payments and receipts (short-term)

**booking_payments**: money received for a reservation. Voided, never deleted.

| Column | Type | Notes |
|---|---|---|
| payment_id | uuid PK | |
| organization_id, booking_id | uuid | |
| amount | numeric | > 0 |
| payment_date | date | Can't be in the future (code check) |
| payment_method | text | `cash`, `bank_transfer`, `gcash`, `maya`, `card`, `channel_payout` or `other` |
| reference_number, notes | text | |
| recorded_by | uuid → users | Nullable: online payments are recorded "by BalayHub" |
| idempotency_key | text | Unique per workspace when set |
| receipt_number | text | Unique per workspace when set |
| receipt_sent_at | timestamptz | |
| voided_at, voided_by, void_reason | | CHECK: `voided_at` and `void_reason` are set together |

**receipt_counters**: `organization_id` (PK → organizations), `last_number` (integer). Gives sequential receipt numbers per workspace.

*Receipt figures (D-106).* A receipt's charge lines, extras total, booking total and remaining balance are computed as of the payment: charges count when their `created_at` is on or before the payment's `created_at` and they are not voided, or were voided after it; the total is the stay's total with those charges in place of today's; the balance counts only payments and refunds up to that payment. The stay's own price (accommodation, cleaning, other fees) is read live, so a later price edit shows on a re-print (known limit; no snapshot column). No table changes.

**balance_checkouts**: a guest paying the remaining balance online through the host's PayMongo account.

| Column | Type | Notes |
|---|---|---|
| checkout_ref | uuid PK | |
| organization_id, booking_id | uuid | |
| amount | numeric | > 0 |
| status | text | `pending`, `paid`, `expired` or `failed` |
| provider_checkout_id | text | Unique |
| checkout_url | text | Reused for up to 30 minutes |
| key_enc | text | Not null; encrypted host key |
| test_mode | boolean | |
| payment_id | uuid → booking_payments | Set when paid |
| payment_method, last_checked_at, created_at, paid_at | | |

#### Phase 1 money tables (migrations 027–028, 2026-10-13)

| Table / column | Key fields | Notes |
|---|---|---|
| `booking_charges` | booking_id, category (`early_checkin`, `late_checkout`, `extra_guest`, `extra_bed`, `airport_transfer`, `damage`, `extra_cleaning`, `other`), description, quantity (1–99), unit_price (> 0), amount (generated: quantity × unit_price), created_by, voided_at/by/reason | Extra charges on a stay. Their non-voided sum is kept in `bookings.extras_total`. |
| `bookings.extras_total` | numeric ≥ 0 | Part of the generated `total_amount` (= accommodation + cleaning + other fees + extras). |
| `booking_refunds` | booking_id, amount (> 0), refund_date, method, reference_number, reason (required), recorded_by, idempotency_key (unique per workspace), voided_at/by/reason | A record of money returned. The total of non-voided refunds can't exceed the non-voided payments. It doesn't change the balance. *2026-10-14 (D-85): refunds now count in the guest balance; the cap stands.* |
| `payment_proofs` | booking_id, amount (> 0), method (`gcash`, `maya`, `bank_transfer`, `other`), reference_number, payer_name, note, status (`pending`, `confirmed`, `rejected`), reviewed_by/at, reject_reason, payment_id → booking_payments | Sent by the guest from the pay page. Confirming creates a `booking_payment`. There are at most 5 pending per booking. |
| `units` | cancellation_policy (`flexible`, `moderate`, `strict`, `non_refundable`, `custom`, or NULL), cancellation_policy_text, deposit_pct (10–90, default 50) | Policy presets live in `src/lib/policies.js`. |
| `organizations` | manual_payments_enabled, manual_payment_instructions | Owner-only setting. Shown on the guest pay page. |
| `files.related_record_type` | adds `payment_proof`, `booking_payment` | Owners and managers only. Downloads are audited. |

### 2.6 Messaging (guest inbox)

**conversations**: one thread per reservation.

| Column | Type | Notes |
|---|---|---|
| conversation_id | uuid PK | |
| organization_id | uuid | |
| booking_id | uuid → bookings | **Unique** (one thread per booking) |
| guest_id | uuid → guests | |
| subject | text | |
| reply_token | text | Unique; routes `+bh-<token>` email replies to the thread |
| status | text | `open` or `archived` |
| assigned_to | uuid → users | |
| snoozed_until, unread, last_message_at, created_at | | |

**messages**

| Column | Type | Notes |
|---|---|---|
| message_id | uuid PK | |
| conversation_id | uuid → conversations | **ON DELETE CASCADE** |
| organization_id | uuid | |
| direction | text | `in`, `out` or `note` |
| kind | text | `message`, `receipt`, `confirmation` or `automated` |
| from_name, from_email, to_email, subject, body | text | Body required |
| status | text | `scheduled`, `sending`, `sent`, `failed`, `received`, `cancelled` or `note` |
| error, scheduled_at, sending_started_at, sent_at, sent_by, email_message_id, automation_id, created_at | | Inbound messages are unique per `(organization_id, email_message_id)` |

**message_templates**: name (1–80), subject (1–200), body (1–5000), `system_key` (built-in template; unique per workspace when set), archived, created_by, created_at, updated_at.

**automations**: template_id → message_templates; trigger_event (`booking_created`, `before_check_in`, `check_in_day`, `before_check_out`, `after_check_out`); offset_days (0–30); send_time; enabled (default false).

**automation_runs**: one automatic message per automation per stay. PK `(automation_id, booking_id)`. `automation_id` **ON DELETE CASCADE**; `message_id` **ON DELETE SET NULL**; `skipped` (reason).

**mail_sync_state**: IMAP poller position. `mailbox` (PK), uid_validity, last_uid, last_run_at, last_error. Global, not per workspace.

### 2.7 Housekeeping

**cleaning_tasks**

| Column | Type | Notes |
|---|---|---|
| task_id | uuid PK | |
| organization_id, unit_id | uuid | |
| booking_id | uuid → bookings | The departing stay. Unique when set (one auto task per stay) |
| due_date, next_check_in | date | |
| status | text | `todo`, `in_progress`, `done` or `cancelled` |
| assigned_to | uuid → users | Or `assignee_name` for a cleaner without a login |
| checklist | jsonb | Items with a `done` flag, copied from the workspace default |
| notes, started_at, completed_at, completed_by, created_by, created_at | | |

Related columns: `units.cleaning_status` and `organizations.cleaning_checklist`.

### 2.7a Phase 3 operations (migration 030, 2026-10-13)

**Column and constraint changes**

| Where | Change |
|---|---|
| `users.role`, `invitations.role` | Add `cleaner`. Invitations: manager, staff or cleaner. |
| `units.cleaning_status` | Add `inspected` (dirty, clean, inspected). |
| `cleaning_tasks` | Add `pay_amount` (≥ 0), `pay_status` (unpaid or paid, default unpaid), `paid_on`, `paid_method` (cash, gcash, maya, bank_transfer), `paid_reference` (≤ 100), `paid_by` → users, `pay_expense_id` → expenses. |
| `files.related_record_type` | Add `damage`, `lost_found`, `inspection`. |
| `maintenance_requests` | Add `cleaning_task_id` → cleaning_tasks and `schedule_id` → maintenance_schedules (both nullable). |

**New tables**

| Table | Key columns and rules |
|---|---|
| `cleaner_rates` | `rate_id` PK, `organization_id`, `user_id` → users or `assignee_name` (≤ 120; exactly one set), `rate_type` (per_clean or per_hour), `amount` ≥ 0. Unique per user, and per name (case-insensitive). |
| `cleaning_inspections` | `inspection_id` PK, `organization_id`, `task_id` → cleaning_tasks, `inspected_by` → users, `items` (jsonb: text and pass per item), `score` 0 to 100, `passed`, `notes` (≤ 1000), `created_at`. |
| `damage_reports` | `report_id` PK, `organization_id`, `unit_id`, `booking_id` (nullable), `task_id` (nullable), `description` (1 to 1000), `estimated_cost` ≥ 0 (nullable), `status` (open, charged, deducted, waived), `charge_id` → booking_charges (nullable), `resolution_note` (≤ 500), `reported_by`, `resolved_by`, `created_at`, `resolved_at`. |
| `lost_found_items` | `item_id` PK, `organization_id`, `unit_id`, `booking_id` and `task_id` (nullable), `description` (1 to 300), `found_where` (≤ 200), `found_on`, `status` (held, returned, disposed), `status_note` (≤ 300), `found_by`, `updated_by`, `created_at`, `updated_at`. |
| `supplies` | `supply_id` PK, `organization_id`, `property_id`, `name` (1 to 80), `unit_label` (≤ 20, default pcs), `par_level` ≥ 0, `on_hand` ≥ 0, `archived_at`, `created_at`, `updated_at`. Unique name per property while not archived. |
| `supply_movements` | `movement_id` PK, `organization_id`, `supply_id`, `kind` (used, restocked, count), `quantity` (> 0 for used and restocked; ≥ 0 for count, which sets on hand), `task_id` (nullable), `note` (≤ 200), `recorded_by`, `created_at`. |
| `maintenance_schedules` | `schedule_id` PK, `organization_id`, `property_id`, `unit_id` (nullable), `title` (1 to 150), `description` (≤ 1000), `every_n` 1 to 365, `every_unit` (days or months), `next_due` date, `priority` (low, medium, high, urgent), `active`, `last_created_at`, `created_by`, `created_at`. |

Money in these tables is `numeric(12,2)`. Cleaner pay is recorded on the job (`pay_amount`), and mark-paid writes `expenses` rows with category `cleaning` (one per unit).

---

### 2.8 Guests and reviews

**guests**: workspace-level guest profiles.

| Column | Type | Notes |
|---|---|---|
| guest_id | uuid PK | |
| organization_id | uuid | Index on `(organization_id, lower(email))` |
| full_name, email, phone, notes | text | |
| vip, do_not_rebook | boolean | |
| created_by, created_at | | |

**guest_registrations**: the guest's check-in form.

| Column | Type | Notes |
|---|---|---|
| registration_id | uuid PK | |
| organization_id | uuid | |
| booking_id | uuid → bookings | Unique |
| lead_name, phone, email | text | |
| guests | jsonb | Other guests' full names |
| arrival_time, vehicle_plate, notes | text | |
| consent_at, submitted_at, updated_at | timestamptz | **`submitted_at` is nullable (migration 036, D-95).** NULL means a **draft**: the guest saved answers but no ID photo has been stored yet. The first stored ID photo sets it (and sends the host one alert and inbox note). The gate pass (`has_form`), the Reservations check-in form filter and the Launchpad count only treat rows with `submitted_at` set as finished. Rows from before migration 036 keep their value |
| ids_purged_at | timestamptz | When ID photos were deleted under the retention rule |

**guest_reviews**: private reviews from guests.

| Column | Type | Notes |
|---|---|---|
| review_id | uuid PK | |
| organization_id | uuid | |
| booking_id | uuid → bookings | Unique (one review per stay) |
| guest_id | uuid → guests | |
| rating | smallint | 1–5 |
| cleanliness | smallint | 1–5 |
| comment | text | At most 2000 characters |
| created_at | timestamptz | |

### 2.9 Security deposits and gate passes

**stay_deposits**: refundable deposits, kept apart from booking income.

| Column | Type | Notes |
|---|---|---|
| deposit_id | uuid PK | |
| organization_id | uuid | |
| booking_id | uuid → bookings | Unique |
| amount | numeric | > 0 |
| received_date | date | |
| method, reference_number | text | |
| status | text | `held`, `refunded`, `partly_refunded` or `kept` |
| deduction_amount (≥ 0), deduction_reason, refund_amount (≥ 0), refund_method, refund_reference | | CHECK: `refund_amount IS NULL OR refund_amount + deduction_amount = amount` |
| settled_at, recorded_by, settled_by, created_at | | |

**gate_passes**: condo gate pass sent to a building admin.

| Column | Type | Notes |
|---|---|---|
| gatepass_id | uuid PK | |
| organization_id | uuid | |
| booking_id | uuid → bookings | Unique |
| property_id | uuid → properties | The building it was sent for (021; backfilled by 023) |
| token | text | Unique; the building admin's link |
| status | text | `sent`, `acknowledged` or `failed` |
| sent_to, sent_at, send_count, acknowledged_at, last_error, missing_form_noted_at, created_at | | |

### 2.10 Long-term rentals

**tenants**: full_name (1–120), email, phone, emergency_contact, notes, status (`active`/`archived`), created_by, created_at. Workspace-level.

**leases**

| Column | Type | Notes |
|---|---|---|
| lease_id | uuid PK | |
| organization_id, unit_id, tenant_id | uuid | |
| start_date, end_date | date | `end_date IS NULL OR end_date >= start_date` |
| monthly_rent | numeric | > 0 |
| due_day | smallint | 1–31 |
| deposit_amount | numeric | ≥ 0 |
| lease_status | text | `active`, `ended`, `terminated` or `cancelled` |
| document_file_id | uuid | No foreign key |
| ended_at, created_by, created_at | | |

Key constraint: **`leases_one_active_per_unit`**, a unique index on `(unit_id) WHERE lease_status = 'active'`. Occupancy is derived from active leases, not stored.

**rent_charges**: what is due. Generated monthly from leases.

| Column | Type | Notes |
|---|---|---|
| charge_id | uuid PK | |
| lease_id | uuid → leases | |
| period | date | First day of the billing month. `UNIQUE (lease_id, period)` makes generation idempotent |
| due_date | date | |
| amount_due | numeric | > 0 |

Payment status (paid, partial, unpaid, overdue) is computed with FIFO allocation in `src/lib/ledger.js`.

**payments** (rent received): lease_id, amount_paid (> 0), payment_date, payment_method (`cash`, `bank_transfer`, `gcash`, `maya`, `check`, `other`), reference_number, notes, receipt_file_id (no FK), recorded_by (not null), idempotency_key (unique per workspace), voided_at/voided_by/void_reason (set together).

**expenses**: property_id, unit_id, maintenance_request_id → maintenance_requests, category (`repairs`, `utilities`, `taxes`, `insurance`, `association_dues`, `supplies`, `salaries`, `cleaning`, `other`), description, amount (> 0), expense_date, vendor_name, receipt_file_id, recorded_by, idempotency_key (unique per workspace), void columns (set together). Indexed on `(organization_id, expense_date)`.

**maintenance_requests**: property_id, unit_id, reported_by (text), title (1–150), description, priority (`low`, `medium`, `high`, `urgent`), status (`open`, `in_progress`, `resolved`, `cancelled`), assigned_to (**text**, for example a vendor name), estimated_cost (≥ 0), created_by, created_at, resolved_at. A repair cost is recorded as a linked expense.

### 2.11 Unit owners (owner statements)

**unit_owners**: people a host manages units for.

| Column | Type | Notes |
|---|---|---|
| owner_id | uuid PK | |
| organization_id | uuid | |
| full_name | text | 1–120 characters |
| email, phone, notes | text | |
| management_fee_pct | numeric(5,2) | 0–100, default 20 |
| cleaning_to_manager | boolean | Cleaning fees go to the manager, not the owner |
| fee_model | text | `net_pct` (default), `gross_pct` or `flat` (migration 029) |
| flat_monthly_fee | numeric(12,2) | ≥ 0. Used when `fee_model = 'flat'` |
| reserve_target, reserve_monthly | numeric(12,2) | ≥ 0, default 0 (0 = repairs reserve off) |
| portal_enabled | boolean | Owner portal access (default false). Set by the host's invite and turn-off actions |
| portal_invited_at, portal_last_seen_at | timestamptz | |
| archived_at, created_at | timestamptz | |

Units link to owners through `units.owner_id` (**ON DELETE SET NULL**). Live statements are computed from the records. A published statement is stored as a frozen copy (section 2.11a).

### 2.11a Owner portal, statements, payouts and repairs reserve (migration 029)

Unit owners have no `users` row. Their portal sessions and sign-in links are separate tables, and only hashes are stored.

| Table | Key columns | Notes |
|---|---|---|
| owner_sessions | token_hash (PK), owner_id → unit_owners (CASCADE), organization_id, created_at, last_seen_at, expires_at, user_agent | Cookie `bh_owner`. 30 days absolute, 7 days idle. Deleted when access is turned off, by the hourly `auth-cleanup` job, and with the owner |
| owner_login_tokens | token_hash (PK), owner_id (CASCADE), expires_at (30 min), used_at, created_at | Single use. Used tokens are kept 7 days, then cleaned up hourly |
| owner_statements | statement_id (PK), organization_id, owner_id, month (`YYYY-MM`), status (`draft` / `published`), snapshot (jsonb, NULL while draft), published_at, published_by, sent_at, sent_to, created_at, updated_at | UNIQUE (owner_id, month). `snapshot` is the full statement result at publish time. Drafts are created by the monthly reminder (`draftMonth`). Opening a statement does not create a row; publishing does |
| owner_payouts | payout_id (PK), organization_id, owner_id, month (nullable), amount (> 0), paid_on (date), method (`gcash`, `maya`, `bank_transfer`, `cash`, `other`), reference_number (≤ 100), note (≤ 500), idempotency_key, recorded_by, created_at, voided_at, voided_by, void_reason | Voided, never deleted. Unique (organization_id, idempotency_key) where the key is set |
| owner_reserve_entries | entry_id (PK), organization_id, owner_id, kind (`deposit` / `withdrawal`), amount (> 0), entry_date, note (≤ 300), statement_id (nullable), recorded_by, created_at, voided_at, voided_by, void_reason | Balance = non-voided deposits − non-voided withdrawals. Deposits come from publishing a statement (voided when it is unpublished). Withdrawals are recorded by hand (voided with a reason) |

Money is `NUMERIC(12,2)` and is worked in centavos in the application. There is one statement per owner per month.

**Idempotency for payouts (open item).** Migration 029 adds `owner_payouts.idempotency_key` with a unique index. The save route in `src/routes/ownerledger.js` still looks for the key in the `audit_logs` row written in the same transaction. It must switch to the column (section 7, item 11).

### 2.12 Support tickets

A sequence `support_ticket_no_seq` starts at 1001 and numbers tickets `T-1001`, `T-1002`, and so on.

| Table | Key columns | Constraints |
|---|---|---|
| **support_tickets** | ticket_id, ticket_no (unique), organization_id, created_by, subject (3–150), category (`question`, `problem`, `payments`, `account`, `feature`, `other`), priority (`normal`/`urgent`), status (`new`, `in_progress`, `waiting_on_customer`, `resolved`, `closed`), context (jsonb), assigned_to, first_response_at, resolved_at, closed_at, rating (1–5), rating_comment (≤ 1000), created_at, updated_at | created_by and assigned_to → users **ON DELETE SET NULL** |
| **support_messages** | message_id, ticket_id, author_id, author_kind (`customer`/`support`), internal (support-only note), body (1–8000), created_at | ticket_id **ON DELETE CASCADE**; author_id **SET NULL** |
| **support_events** | event_id, ticket_id, kind, from_status, to_status, actor_id, actor_kind (`customer`, `support`, `system`), note, created_at | ticket_id **ON DELETE CASCADE**; actor_id **SET NULL** |

### 2.13 Files

**files**: metadata for every stored upload.

| Column | Type | Notes |
|---|---|---|
| file_id | uuid PK | |
| organization_id | uuid → organizations | |
| related_record_type | text | `lease`, `payment`, `expense`, `maintenance`, `cleaning`, `registration` (guest ID), `listing` (photo), `deposit`, `support` |
| related_record_id | uuid | **No foreign key** (polymorphic) |
| storage_key | text | `<organization_id>/<random uuid>.<ext>` |
| file_name, mime_type, size_bytes | | |
| uploaded_by | uuid → users | Nullable (guest uploads) |
| sort_order | smallint | Listing photo order (the first photo is the cover) |
| uploaded_at | timestamptz | |

### 2.14 Audit

**audit_logs**: audit_id (bigserial), organization_id, actor_user_id, action, record_type, record_id (text), details (jsonb), created_at. Indexed on `(organization_id, created_at DESC)`. Platform admin plan changes are written into the target workspace's log with the admin as the actor. *(Round 18, D-100: workspace delete actions also write platform rows with `organization_id` NULL, which survive the purge; see section 24.)*

Phase 2 actions: `owner_portal.invited`, `owner_portal.disabled`, `owner_portal.block_created`, `owner_portal.block_cancelled` (portal actions have no team user; the owner is in `details.owner_id`), `unit_owner.statement_published`, `unit_owner.statement_unpublished`, `unit_owner.statement_sent`, `owner_payout.recorded`, `owner_payout.voided`, `owner_reserve.withdrawal_recorded`, `owner_reserve.withdrawal_voided`, and `owner_statements.reminder_sent` (the monthly reminder's once-per-month record, with `details.month`).

Round 15 actions (D-94): `platform.coupon_created`, `platform.coupon_updated` (field names only), `platform.coupon_switched_off`, `platform.coupon_switched_on` (all with `organization_id` NULL, record type `platform_coupon`), and `billing.coupon_applied` (the workspace, record type `billing_payment`; written when the payment is marked paid). Platform-level rows survive a workspace purge because the purge already sets the deleted users' `actor_user_id` to NULL.

### 2.15 Billing (BalayHub plans)

**billing_payments**: a host paying BalayHub online.

| Column | Type | Notes |
|---|---|---|
| billing_id | uuid PK | |
| organization_id | uuid | |
| plan | text | `starter`, `growth` or `pro` |
| months | smallint | 1, 3 or 12 |
| amount | numeric | > 0, or exactly 0 when `provider` is `coupon` (a free coupon period). Migration 035 |
| status | text | `pending`, `paid`, `expired` or `failed` |
| provider | text | `paymongo` (default) or `coupon` (a free activation with no payment). A CHECK allows only these two (migration 035) |
| checkout_id | text | Unique |
| checkout_url, payment_method, paid_at, period_start, period_end, last_checked_at, created_by, created_at | | |
| card_brand, card_last4 | text, nullable | Migration 039 (D-102). The card used, filled when a card payment is paid (card check passed, or one-tap paid). History reads them from the row and falls back to the workspace's card for older rows. **Remove card does not clear them.** |

Round 15 columns (migration 035, D-94): `list_amount` numeric (the price before any coupon, > 0; NULL on older rows), `discount_amount` numeric NOT NULL default 0 (>= 0), `coupon_redemption_id` uuid → `platform_coupon_redemptions` (NULL when no coupon was used; partly indexed) and `coupon_months` smallint NOT NULL default 0 (how many billed months this payment covered). `amount` is what was actually charged: `list_amount - discount_amount`, raised to the ₱20 floor when a discount would leave less (section 2.18).

*Round 19 (D-101, no migration): `payment_method = 'attached'` marks a card attached during 3-D Secure (a card check that finished, not a way of paying). A pending one-tap plan payment older than 15 minutes is expired (cancelled at PayMongo when allowed) and its coupon claim is released before the next charge is priced; a payment the bank reports failed becomes `failed` and releases its coupon claim the same way.*

Related columns: `organizations.plan`, `trial_ends_at`, `paid_until` and `plan_note`.

*Round 17 (migration 037, D-98): card checks and saved-card payments also use this table (`kind`, `payment_intent_id`, `invoice_id`, `failure_code`, new providers; `plan` and `months` can be NULL on a card check row). See section 2.19.*

### 2.16 System

| Table | Purpose |
|---|---|
| schema_migrations | Migration file names already applied |
| mail_sync_state | IMAP poller position (section 2.6) |

### 2.17 Top bar and PayMongo key check (migrations 033 and 034, QA round 14, 2026-10-15)

Decisions D-90, D-91 and D-92.

**New tables (migration 033)**

| Table | Key columns and rules |
|---|---|
| `bookmarks` | `bookmark_id` uuid PK, `organization_id` → organizations, `user_id` → users (deleted with the user), `path` (must start `#/`, only letters, digits and `. _ ~ / ? = & % -`, at most 302 characters), `label` (1 to 80 characters), `created_at`. **Unique on (`user_id`, `path`)**: saving the same page again updates its label. Index on (`user_id`, `created_at`). At most 20 per person (checked in the API under a row lock on the user) |
| `notifications` | `notification_id` bigserial PK, `organization_id` → organizations, `user_id` → users (deleted with the user), `type` (one of `new_booking`, `guest_message`, `checkin_form`, `payment`, `cleaning`, `mention`, `assignment`, `sync_problem`, **`owner_activity`**), `property_id` → properties (set to null if the property is deleted), `title` (1 to 200), `body` (up to 500), `url` (must start `/#/`, same character list, at most 303), `created_at`, `read_at` (null = unread). Indexes on (`user_id`, `notification_id` descending) and, for unread rows only, on `user_id`. One row per person who is meant to get the alert, written where the phone alert is sent (`push.notify` through `src/lib/notifyfeed.js`) |

The two CHECK constraints on `path` and `url` keep a stored link on this site: `javascript:` and other outside links cannot be stored. The screen checks again before it uses either as a link.

**Notification categories** (the bell's filters): Reservations (`new_booking`, `checkin_form`, `sync_problem`), Payments (`payment`), Cleaning (`cleaning`), Messages (`guest_message`, `mention`, `assignment`), Owners (`owner_activity`). **`owner_activity`** is the new alert type: a unit owner blocked or unblocked dates in the owner portal. It goes to owners only, and like the others it can be turned off in My account (`users.notify_prefs` gets an `owner_activity` boolean; a missing key means on).

**Column change (migration 034)**

| Where | Change |
|---|---|
| `organizations` | Add `paymongo_key_checked_at` timestamptz (null = the host's PayMongo key is saved but PayMongo has not accepted it yet). Set when PayMongo accepts the key. Cleared when the key is replaced and the new key could not be checked, when the host disconnects PayMongo, and when a guest checkout is refused as unauthorised. The Settings status reads "Connected" only when it is set; otherwise "Saved, not checked yet" |

Rollbacks are forward-only and written in the migration files.

---

### 2.18 Platform plan coupons and check-in drafts (migrations 035 and 036, QA round 15, 2026-10-15)

Decisions D-94 and D-95. The contract the build followed is `docs/contracts/platform-coupons.md`. Both migrations are forward-only; the rollback steps are written in the files.

**New tables (migration 035)**

| Table | Key columns and rules |
|---|---|
| `platform_coupons` | `coupon_id` uuid PK; `code` text (CHECK `^[A-Z0-9-]{3,32}$`, **unique** through `platform_coupons_code_uq`); `name` (1 to 100 characters); `kind` (`percent`, `fixed` or `free`); `percent_off` smallint 1 to 99 (set only for `percent`); `amount_off` numeric > 0 (set only for `fixed`; pesos off each covered month); `duration` (`once`, `months` or `forever`); `duration_months` smallint 2 to 36 (set only for `months`); `plans` text[] (NULL = every paid plan, otherwise a non-empty subset of `starter`, `growth`, `pro`); `max_redemptions` integer > 0 (NULL = no limit); `once_per_workspace` boolean default true; `require_card` boolean default false; `starts_at` timestamptz NOT NULL; `ends_at` timestamptz (after `starts_at`); `active` boolean default true; `note` (up to 1000 characters); `created_by` → users (SET NULL); `created_at`, `updated_at`. CHECKs tie each of `percent_off`, `amount_off` and `duration_months` to its kind or duration. Times are stored as UTC; the admin form takes Manila time |
| `platform_coupon_redemptions` | `redemption_id` uuid PK; `coupon_id` → platform_coupons; `organization_id` → organizations; `status` (`pending`, `active`, `used_up` or `released`); `months_total` smallint > 0 (**NULL means forever**); `months_used` smallint default 0; `redeemed_by` → users (SET NULL); `created_at`, `activated_at`, `released_at`. **Unique on (`coupon_id`, `organization_id`) while the status is `pending` or `active`** (one live redemption per workspace per coupon). Indexes on (`coupon_id`, `created_at` desc) and (`organization_id`, `created_at` desc) |

**Redemption life:** `pending` when the first checkout with the code starts; `active` on the first paid payment; `used_up` when its months are used; `released` when the checkout expires or fails before any payment (a pending row older than 2 days stops counting toward the limit, and the 10-minute billing job releases it). A released row is never revived. A workspace uses **one coupon at a time**.

**Column changes**

| Where | Change |
|---|---|
| `billing_payments` (035) | The amount CHECK now allows 0 only for `provider = 'coupon'`; new provider CHECK (`paymongo` or `coupon`); new columns `list_amount`, `discount_amount`, `coupon_redemption_id`, `coupon_months` (section 2.15); a partial index on `coupon_redemption_id` |
| `guest_registrations` (036) | `submitted_at` loses NOT NULL (section 2.4). Rollback: set NULL rows to `updated_at`, then restore NOT NULL |

**Purge and export.** The purge deletes a workspace's `platform_coupon_redemptions` (after its billing rows, which point at them; deleting a workspace therefore frees a slot under a coupon's limit). `platform_coupons` themselves are kept, as the platform's own data; their `created_by` and the redemptions' `redeemed_by` are SET NULL when a user is deleted. `PURGED_TABLES` lists the redemptions table, the export includes it, and `test/account.test.js` still guards the list.

---

### 2.19 Card on file and automatic payment (migration 037, QA round 17, 2026-10-15)

Decision D-98. The contract is `docs/contracts/card-on-file.md`. Forward-only; the rollback steps are written in the migration file. Workspaces that existed before the migration keep `card_check` NULL (never gated).

**New columns on `organizations`**

| Column | Type | Notes |
|---|---|---|
| card_check | text | `required` (waiting for the ₱20 card check), `passed`, `waived` (a platform admin skipped it) or NULL (not needed: pre-037, check off, demo, platform-admin-made). Partial index `organizations_card_check_pending_idx` on `created_at` where `required` |
| card_checked_at | timestamptz | Set when the check passes or is waived. CHECK: required when `card_check = 'passed'` |
| paymongo_customer_id | text | PayMongo customer id. Never shown |
| card_payment_method_id | text | The saved card's PayMongo payment method id. Never shown |
| card_brand, card_last4 | text | Brand (at most 20 characters) and last 4 digits (`^[0-9]{4}$`). Shown to the owner and to platform admins |
| renewal_plan | text | `starter`, `growth` or `pro`: the plan chosen for after the trial |
| auto_renew | boolean | Default false. Stage 2 automatic payment |
| auto_renew_consented_at | timestamptz | CHECK: set whenever `auto_renew` is true |
| paymongo_subscription_id | text | Unique. Stage 2 only. Never shown |
| subscription_status | text | `active`, `past_due`, `unpaid`, `cancelled` or `incomplete` |

While `card_check = 'required'`, `trial_ends_at` is NULL; a pass sets it to now plus `TRIAL_DAYS`.

**Changes to `billing_payments`**

| Column or rule | Change |
|---|---|
| kind | New, text, default `plan`: `plan` or `card_check` |
| payment_intent_id | New, unique: the PayMongo Payment Intent behind a card check or a one-tap payment |
| invoice_id | New, unique: the Stage 2 invoice (one paid month per invoice) |
| failure_code | New, at most 64 characters |
| plan, months | Now nullable; CHECK `billing_payments_kind_shape`: a `plan` row needs both, a `card_check` row has neither, `provider = 'paymongo_intent'` and `amount = 20` |
| provider | CHECK now allows `paymongo`, `coupon`, `paymongo_intent`, `paymongo_subscription` |
| `billing_payments_one_live_card_check` | Unique index on `organization_id` where `kind = 'card_check'` and `status = 'pending'`: one pending card check per workspace |

**New table `paymongo_plans`** (platform data, no `organization_id`, not purged, Stage 2 cache): `plan_key` (`starter`, `growth`, `pro`), `amount_c` (integer centavos, at least 100), `paymongo_plan_id` (unique), `created_at`; primary key (`plan_key`, `amount_c`). A forever coupon gets its own discounted PayMongo plan, hence the amount in the key.

**PURGED_TABLES impact:** none. `billing_payments` is already purged; `paymongo_plans` holds no workspace data.

**Audit actions:** `billing.card_check_passed`, `billing.card_removed`, `billing.renewal_changed` (field names only), `billing.trial_reminder_sent` (the once-per-day-count record for reminder emails), `platform.card_check_waived`.

**Migration 038 (QA round 17, D-99 O5), `038_refund_reason_500.sql`:** widens the `booking_refunds.reason` CHECK from 300 to 500 characters so a refund reason matches every other audit reason. The `void_reason` columns on the money tables are plain text with no length CHECK (only the API limited them), so nothing else changed in the database.

## 3. Relationships at a glance

```
organizations ─┬─ users ─┬─ sessions / auth_tokens / consent_records / push_subscriptions (CASCADE)
               │         └─ property_assignments (CASCADE on user) ── properties
               ├─ invitations
               ├─ properties ── units ─┬─ nightly_rates
               │                       ├─ seasons (CASCADE on unit; NULL unit = all listings)
               │                       ├─ ical_feeds ── bookings.ical_feed_id (SET NULL)
               │                       ├─ bookings ─┬─ booking_payments ── balance_checkouts.payment_id
               │                       │            ├─ conversations (1:1) ── messages (CASCADE)
               │                       │            ├─ guest_registrations (1:1)
               │                       │            ├─ guest_reviews (1:1)
               │                       │            ├─ stay_deposits (1:1)
               │                       │            ├─ gate_passes (1:1)
               │                       │            ├─ cleaning_tasks (0..1 auto task)
               │                       │            └─ automation_runs
               │                       ├─ direct_checkouts ── bookings, discount_codes
               │                       ├─ leases ─┬─ rent_charges
               │                       │          └─ payments
               │                       └─ unit_owners (units.owner_id, SET NULL)
               ├─ guests ── bookings.guest_id
               ├─ tenants ── leases.tenant_id
               ├─ expenses ── maintenance_requests
               ├─ message_templates ── automations ── automation_runs (CASCADE)
               ├─ files (polymorphic, no FK to parent)
               ├─ audit_logs, billing_payments, receipt_counters, discount_codes
               └─ support_tickets ─┬─ support_messages (CASCADE)
                                   └─ support_events (CASCADE)
```

### 3.1 Important constraints

| Constraint | Effect |
|---|---|
| `bookings_no_overlap` (exclusion, gist) | No two confirmed stays or blocks overlap on one unit |
| `leases_one_active_per_unit` (partial unique) | At most one active lease per unit |
| `rent_charges UNIQUE (lease_id, period)` | Charge generation is idempotent |
| Idempotency unique indexes on `payments`, `expenses`, `booking_payments` | A repeated `Idempotency-Key` returns the original record |
| `bookings_code_uq` | Confirmation codes unique per workspace |
| `bookings_feed_uid_uq` | One booking per channel event |
| `conversations UNIQUE (booking_id)` | One inbox thread per reservation |
| `cleaning_tasks_booking_uq` | One automatic cleaning task per departing stay |
| One-per-booking uniques | `guest_registrations`, `guest_reviews`, `stay_deposits`, `gate_passes` |
| `units_name_uq` | Active unit names unique per property (case-insensitive) |
| `organizations_booking_slug_uq` | Direct booking page slugs unique (case-insensitive) |
| `users_email_uq`, `users_google_sub_uq` | One account per email and per Google identity |
| `users` organization/role CHECK | A user has both a workspace and a role, or neither |
| Void CHECKs | `voided_at` and `void_reason` are set together on all money tables |
| `stay_deposits` refund CHECK | refund + deduction = deposit once refunded |
| `discount_codes` CHECK | Exactly one of percent or amount off |
| `seasons` CHECKs | Valid range of at most 366 days, and a rate or a minimum stay |
| `platform_coupons_code_uq` and the kind CHECKs | One coupon per code; percent, amount and months are set only for the matching kind or length |
| `platform_coupon_redemptions_live_uq` (partial unique) | One pending or active redemption per workspace per coupon |
| `billing_payments_amount_check`, `billing_payments_provider_check` | A zero amount only for a free coupon period (`provider = 'coupon'`); provider is `paymongo` or `coupon` |

### 3.2 ON DELETE behaviour

| Behaviour | Where |
|---|---|
| CASCADE | sessions, auth_tokens, consent_records, push_subscriptions and property_assignments when their **user** is deleted; messages when their conversation is deleted; automation_runs when their automation is deleted; seasons when their unit is deleted; support_messages and support_events when their ticket is deleted |
| SET NULL | platform_coupons.created_by; platform_coupon_redemptions.redeemed_by; bookings.ical_feed_id; automation_runs.message_id; units.owner_id; support_tickets.created_by and assigned_to; support_messages.author_id; support_events.actor_id |
| NO ACTION (default) | Everything else. For example, a property, unit, booking or lease can't be deleted while anything references it. The app archives or voids instead |

---

## 4. Lifecycle, retention and deletion

### 4.1 Retention

| Data | Rule as built |
|---|---|
| Guest ID photos (`files` with type `registration`) | Deleted from disk and database `GUEST_ID_RETENTION_DAYS` after check-out, or 3 days after a cancellation. `guest_registrations.ids_purged_at` is set. The form answers themselves are kept |
| Workspace | After the owner requests deletion: view-only for 14 days, then `purgeOrganization()` deletes every row in `PURGED_TABLES` for that workspace and its stored files. Other workspaces' audit entries that point at deleted users get `actor_user_id = NULL` |
| Expired sessions and used/expired auth tokens | No cleanup job (they are ignored when expired but stay in the table) |
| Backups | 14 days of database dumps and upload archives (`deploy/backup.sh`) |

### 4.2 Workspace purge coverage

`PURGED_TABLES` in `src/lib/account.js` lists every table in migrations 001–029 except `mail_sync_state` (global) and `schema_migrations`. The five owner tables from migration 029 are included, and are deleted before `unit_owners`. `test/account.test.js` fails if a new table is missing. No table is missing at the time of writing.

*2026-10-15 (round 14):* `bookmarks` and `notifications` (migration 033) are in `PURGED_TABLES`. Both are left out of the workspace export (personal saved pages and a rolling alert feed). Notifications older than 90 days are deleted by the daily `notifications-cleanup` job (`notifyfeed.purgeOld`); bookmarks stay until the person removes them or the user is deleted.

*2026-10-15 (round 17, D-98):* migration 037 adds no workspace table. `paymongo_plans` is platform data (no `organization_id`), is not in `PURGED_TABLES`, and is on the ignore list in `test/account.test.js`. A PayMongo subscription must not outlive its workspace, so the subscriptions job cancels the subscription of any workspace with `deletion_scheduled_at` set (deletion is always scheduled before a purge); this runs whenever the PayMongo secret key is set, even with Subscriptions off. *Security review 2026-10-15:* the purge itself also cancels the subscription (if the cancel fails the purge stops and retries later, keeping the workspace row), then detaches the saved card and deletes the PayMongo customer (name, email, phone) outside the database transaction; the last two are best-effort and not retried.

The workspace export (`exportOrganization`) is not complete. It leaves out `support_messages`, `support_events`, `consent_records`, `automation_runs`, `receipt_counters`, `push_subscriptions` (by design), sessions and auth tokens. It also includes file metadata only, not the file contents.

### 4.3 Hard deletes in normal use (outside the purge)

| What | When |
|---|---|
| bookings (blocks only) | A manual block is removed, or a channel stops listing a block, or a channel feed is disconnected |
| ical_feeds | A channel is disconnected (its future unpaid stays are cancelled, not deleted) |
| nightly_rates | A price override is cleared |
| seasons | A season is removed |
| automations | An automation is removed (its runs cascade) |
| rent_charges | Future charges when a lease's end date moves earlier, or when it ends; all charges when a lease is cancelled |
| files | Listing photo removed; guest ID retention purge |
| sessions, property_assignments, push_subscriptions | Sign-out, member removal or reassignment, unsubscribe or dead endpoint |

---

## 5. File storage

| Aspect | As built |
|---|---|
| Location | Local disk under `STORAGE_DIR`. In production that is the Docker volume `uploads` mounted at `/data/storage`. It is outside the web root |
| Layout | `<organization_id>/<random uuid>.<ext>`. Files are written with mode 0600 |
| Also in STORAGE_DIR | `.data-key` (encryption key, if `DATA_ENCRYPTION_KEY` is unset) and `.vapid.json` (push keys, if the VAPID vars are unset) |
| Accepted types | PDF, JPEG, PNG and WEBP, at most 10 MB, with the MIME type and magic bytes both checked. Listing photos and guest IDs accept images only |
| Serving | `GET /api/files/:id` after a permission check on the parent record (section 6); `Cache-Control: private, no-store`. Listing photos for bookable listings are public at `/api/public/listing-photos/:id` (cached 1 day). Guest IDs are also served to the building admin's gate-pass link. Support attachments are served to platform admins at `/api/admin/support/files/:id` |
| Backups | `deploy/backup.sh` tars the whole volume |
| Limits | Single-server disk only; no object storage |

---

## 6. Role × data access matrix

**Roles.** `owner`, `manager`, `staff` and `cleaner` are the four workspace roles (`users.role`). The tables in this section have Owner, Manager and Staff columns; the **cleaner** has its own column in section 6.1, and any row not listed there is No for a cleaner (D-48). *(Corrected 2026-10-15: this paragraph used to list three roles.)* **Platform admin** is not a role: it is any verified user whose email is in `PLATFORM_ADMIN_EMAILS`, and it unlocks the `/api/admin/*` pages. A platform admin who is also in a workspace has that workspace's role there as well. The **guest via token link** column covers people without an account who hold a private link: the guest (check-in, pay, review, booking return links), the building admin (gate-pass link), and channels (iCal export link).

**Scope.** "Assigned" means only properties listed for that user in `property_assignments`, enforced in SQL by `propertyScope()`, `tenantScope()` or `guestScope()`. Records out of scope return 404. Owners always see the whole workspace. "Delete" means a real removal; most data is archived or voided instead (section 4.3).

**Read-only workspaces.** For an ended trial, an overdue plan, a workspace scheduled for deletion, or the demo, `planGuard` blocks every write for every role (except account, billing, support, push and assistant paths).

| Data area | Owner | Manager | Staff | Platform admin | Guest via token link |
|---|---|---|---|---|---|
| Workspace settings (name, type, guest language, cleaning checklist, onboarding) | View, edit | View basic info. Cannot switch the built-in message templates' language (owner only, D-28; *2026-10-14: the earlier manager wording was wrong*) | View basic info | View every workspace (owner name and email, counts, plan); edit plan, paid-until, trial end, note (not the demo) | Sees the host's name and language on guest pages |
| Team, invitations, property assignments | View, invite, change role and properties, revoke invite, remove member (revokes the account and signs it out) | None | None | Member count only | Invitee: view workspace name and role from the invite link |
| Own account (profile, password, devices, notification settings) | Own only | Own only. Also sees the workspace owner's name and email (founder question 4) | Same as manager | Own only | None |
| Properties | View, create, edit, archive and restore (all) | View, edit (assigned); no create or archive | View (assigned) | None | Property name and city on guest pages |
| Units and listings (including Wi-Fi password, instructions, photos) | View, create, edit, archive and restore | Same, assigned; upload, reorder and remove photos | View (assigned, includes Wi-Fi details); mark clean or dirty | None | Booking page: view bookable listings, photos and prices |
| Pricing (nightly rates, seasons) | View, edit; seasons for all listings | View, edit rates and per-listing seasons (assigned); no all-listings seasons | View (pricing page and calendar prices, assigned) | None | Price quotes on the booking page |
| Channel calendars (iCal feeds, export link) | View, add, sync, remove; rotate export link | Same (assigned) | None (sees channel count only) | None | Channels read the export feed (dates only, no names) |
| Reservations and blocks | View, create, edit, cancel; delete manual blocks | Same (assigned) | View (assigned; guest email, phone and notes removed, but the row carries `guest_has_email` true or false, never the address, so staff can tick "Email a receipt" (D-101; intended)); check in and out; CSV export | None | Booking page: create a reservation through paid checkout; view status and cancel a pending checkout via the return link |
| Guest profiles | View, create, edit (VIP, do-not-rebook) | View, create, edit (guests with stays in assigned properties, or no stays) | View names only (email, phone, notes and total spent removed) | None | None |
| Booking payments and receipts | View, record, void, email receipt | Same (assigned) | View, record (and email a receipt when recording); view printable receipt; no void | None | Pay link: view total, paid, refunds (amount and date) and balance; pay the balance online (creates a payment) (2026-10-15, D-86) |
| Security deposits | View, record, settle, undo a settlement; deposits report | View, record, settle; deposits report (assigned) | View per reservation, record, see deposits due (assigned); no settle | None | Receives the deposit emails |
| Guest check-in forms and ID photos | View form and IDs; replace link | Same (assigned) | No access to the form screen; ID files refused | None | Check-in link: submit and edit own form, upload IDs (never shown back); closes after check-out. Gate-pass link: see guest names, phone, plate, arrival time and **ID photos** until the day after check-out |
| Gate passes | Settings per property; view, send | Same (assigned) | None | None | Building admin: view the pass and acknowledge it; guest ID photos only when the property's "Include guest ID photos" setting is on; *2026-10-15 (D-88): staff receive no `admin_email` or `gatepass_*` fields on `GET /properties` and `GET /properties/:id`; owners and managers unchanged* |
| Guest inbox (conversations, messages, AI drafts) | View, send, schedule, cancel, retry, assign, archive, AI draft | Same (assigned) | None | None | Guests reply by email only |
| Message templates and automations | Templates: view, create, edit, archive. Automations: view, create, edit, remove | Templates: view and use only (owner-only edits since 2026-10-13, D-28). Automations: view only | None | None | None |
| Housekeeping (cleaning tasks) | View, create, edit, assign, cancel; edit default checklist | Same except the default checklist (assigned) | View (assigned); tick items; start, finish, reopen; attach photos; no create, edit or cancel | None | None |
| Guest reviews | View (all) | View (assigned) | View (assigned) | None | Review link: submit one review, from check-in until 60 days after check-out |
| Extra charges | View, add, void (with reason) | Same (assigned properties) | View only | None | See the lines on the pay page |
| Refunds | View, record, void (capped at amount paid) | Same (assigned properties) | View only | None | Own booking only: amount and date on the pay link; never the reason, reference or who recorded it (2026-10-15, D-86) |
| Payment proofs and proof files | View, confirm, reject | Same (assigned properties) | None | None | Submit a proof with one screenshot via the pay link, at most 5 pending; refused for cancelled, paid or ended stays |
| Manual payment settings | View, change | None | None | None | Sees the instructions on the pay page when enabled |
| Cancellation policy and deposit % (per listing) | View, change | Same (assigned properties) | View (assigned) | None | Sees the policy and the deposit amount on the booking page; *corrected 2026-10-15 (D-88): the units row already gave staff these* |
| Discount codes | View, create, turn on or off | View only (owner-only changes since 2026-10-13, D-28) | None | None | Apply a code at checkout |
| Direct booking page and the host's PayMongo key | View, edit; the key is write-only (hint shown) | None | None | None | Public booking page by slug |
| Tenants | View, create, edit, archive; export one tenant's record | View, create, edit, archive (tenants with leases in assigned properties, or not placed) | View names only (contact details and notes removed) | None | None |
| Leases and lease documents | View, create, edit, end, cancel; documents | Same (assigned) | View terms and balances (assigned); documents hidden and refused | None | None |
| Rent charges | View (generated by the system; no manual edits) | View (assigned) | View (assigned) | None | None |
| Rent payments | View, record, void | Same (assigned) | View, record, attach a receipt (assigned); no void | None | None |
| Expenses | View, record, correct, void | Same (assigned) | View, record (assigned); no correct or void | None | None |
| Maintenance requests | View, create, edit, add a cost | Same (assigned) | View, create, add a cost (assigned); no edit or status change | None | None |
| Dashboard, financial report and CSV, stays revenue | View (all) | View (assigned) | View (assigned) | None | None |
| Stay reports (including tax) | View (all) | View (assigned) | None | None | None |
| Unit owners (form, fee type, reserve target) | View, create, edit, archive; invite to owner portal and turn it off | None | None | None | None |
| Owner statements (draft, publish, unpublish, send, print) | View, publish, unpublish, send | None | None | None | None |
| Owner payouts and repairs reserve | View, record, void payouts; record and void reserve withdrawals | None | None | None | None |
| Profit and loss (`/reports/pnl`, CSV) | View all units | View assigned properties | None (403) | None | None |
| Owner portal (unit owner, `bh_owner` cookie, not a workspace role) | None (invites and turns access off only) | None | None | None | Unit owner, own units only: published statements (never drafts), payouts, own reserve balance, bookings and activity for own units (guests by first name), own blocks (create, cancel before start), P&L for own units, receipts on published statements. Sees history of units now assigned to them (D-46). Never guest contact details, payment proofs, other owners or other workspace data. Blocks: not while the workspace is view-only; 20 per hour (D-46) |
| Support tickets | All of the workspace's tickets: view, create, reply, resolve, rate, attach files | Own tickets only | Own tickets only (cleaners too: they may list their own tickets, D-102) | All tickets: view, reply, internal notes, change status, assign, view attachments | None |
| Plan and billing payments | View; start and confirm checkout | Plan status only (via session; no price or listing limit, D-83) | Plan status only (same) | Set plan and dates by hand | None |
| Plan coupons (list, create, edit, switch off, see who redeemed; `/api/admin/coupons*`, D-94) | No (404, not a platform admin) | No (404) | No (404) | **Manages them**: list, create, edit (locked fields after use), switch on or off, redemptions. Audit-logged at platform level | None |
| Delete or restore a workspace (`POST /api/admin/workspaces/:id/delete` with `mode` `schedule` or `now`, and `POST .../restore`; D-100) | No (404, not a platform admin) | No (404) | No (404) | **Does it**, with the workspace name typed. Refused for the demo, the admin's own workspace and any workspace with a platform admin member. Audit-logged at platform level (workspace id NULL) | None |
| Using a plan coupon (preview a code, check out with one, see the workspace's own coupon and history) | **Redeems them**: owners only, in their own workspace. Not for the comped plan or the demo | No (403) | No (403) | Only as the owner of their own workspace | None |
| Audit log | View all entries (latest 200) | View own actions only | None | No viewer (plan changes are written into the workspace's log) | None |
| Workspace export and deletion | Export JSON; request and cancel deletion | None | None | None | None |
| Files (generic) | Follows the parent record's rule | Same, assigned | Same, assigned, except lease and guest ID files | Support attachments only | Guest IDs: upload only. Building admin: view guest IDs. Public listing photos |

*2026-10-15 (D-97): the Do not rebook flag is workspace-wide by email. A manager limited to some properties may see `guest_do_not_rebook` on a guest because another guest record with the same email, in a property they cannot open, was flagged. Only the yes or no reaches them, never the other record. Staff still get no flag at all (D-82). This is intended.*
*Note 2026-10-20 (D-101): the flag (yes or no) still reaches a limited manager as above, but the flagged record's name (`guest_do_not_rebook_name` on the create-reservation and create-group answers) is given to a manager only when that guest is inside the manager's property scope; otherwise the manager gets the booking's own guest name. Owners always get the flagged record's name. This closes the round 19 security Low (the name of an out-of-scope guest could leak).*

*2026-10-14 (D-82): staff get `{ guest_id, full_name, limited }` only, on `/guests`, `/guests/:id` (with empty stays and reviews) and a group's lead guest. Reservation rows for staff carry no `guest_vip` or `guest_do_not_rebook`, no review card and no Returning badge. Staff can still read full reviews on `GET /reviews` (the Reviews page; the matrix allows it; BLOCKERS round 6, question 2). Correction 2026-10-14: cleaners are not names only. Cleaners get 403 on guests, guest profiles, reservations, booking groups and reviews (matches 6.2); only staff get names only.*

*2026-10-14 (D-83): managers, staff and cleaners receive plan status (`plan`, `name`, `ai`, `read_only`, `reason`, `is_demo`) and the dates `trial_ends_at`, `trial_days_left`, `paid_until` and `deletion_scheduled_at`, never `price` or `listing_limit`. Staff and cleaners get `document_file_id: null` on a lease. Every team member also receives the workspace owner's name and email (the "Workspace owner" line on the account page).*

---

### 6.1 Phase 3 access matrix (with the Cleaner column)

The cleaner role is denied by default in code (`cleanerGuard`, D-48). Any row not listed here is **No** for a cleaner. "Assigned" means the properties in `property_assignments`. Owners see the whole workspace.

*2026-10-14 (D-83): for cleaners, the lost-and-found and damage lists (the pages) answer 403; a cleaner sees only the items and reports they filed, on the job page, with no amounts or status notes. The cleaning board shows one open job per unit: the first by due date that the viewer may see.*

*2026-10-14 (D-84): unit-level damage reports (`POST /units/:id/damage`) are owners and managers only; staff get 403 and report damage from a job or a stay.*

| Data area | Owner | Manager | Staff | Cleaner |
|---|---|---|---|---|
| Cleaning jobs (list, detail, tick, start, done, reopen) | Full | Assigned; can cancel | Assigned | Own jobs and unassigned jobs in assigned properties. No cancel, no edit, no reassign. Guest first name only. What the job detail returns for each role is in section 6.1a |
| Cleaning board and calendar | Full | Assigned | Assigned | Own and unassigned jobs only |
| Inspect a finished job | Yes | Yes (assigned) | No | No |
| Inspection results and cleaner scores | View | View (assigned) | No (none on the job detail either) | Result on own jobs only; no scores |
| Damage reports: report | Yes | Yes | Yes (jobs and stays they can see; not on a unit with neither, see the note below) | Yes, on own jobs only |
| Damage reports: list and resolve (charge, deduct, waive) | Yes, with amounts | Yes (assigned) | No (list and resolve). On a job they see only the reports they filed, with no amounts | No. Sees only reports it filed, with no amounts |
| Suggested deposit deduction | Yes | Yes | No | No |
| Lost and found: log | Yes | Yes | Yes (stays and jobs they can see) | Yes, on own jobs |
| Lost and found: create from the page (`POST /lost-found`) | Yes | Yes (assigned properties) | No (403) | No (403) |
| Lost and found: list and status | Full | Assigned | No (page). On a job they see only items they logged, with no status note | Own items only |
| Cleaner rates | View, set, delete | No | No | No |
| Cleaner pay list and mark paid | View, mark paid, undo | View and mark paid (assigned); no undo | No | No |
| My pay (page `#/my-pay`) | Not shown. The API refuses with 403 "My pay is for cleaners." | Same (403) | Same (403) | Own pay only (page and API). Cleans they finished that are paid to someone else show as hidden rows with no name and no money (2026-10-14, D-82) |
| Expenses made by mark paid | Yes | Yes (assigned) | No | No |
| Supplies: list (`GET /supplies`) | Full | Assigned | Assigned; the Supplies page opens read-only (no add, edit, count or restock buttons) | **No (403).** *Changed 2026-10-15 (D-95): the cleaner Supplies page is blocked too.* A cleaner sees supplies only on a job, in the next row |
| Supplies on one job (`GET /cleaning-tasks/:id/supplies`) | Yes | Yes (assigned) | Yes (jobs they can see) | **Yes, for a job they may see** (own or unassigned in an assigned property): the supplies of that job's property, names, units and on hand only. No costs, no other property. Feeds the job sheet's "Supplies used" picker. A cancelled job still answers |
| Supplies: add, edit, archive, count, restock | Yes | Yes (assigned) | No | No |
| Supplies: movement history (`GET /supplies/:id/movements`, last 20) | Yes | Yes (assigned) | No | No |
| Supplies: record used or restocked on a job | Yes | Yes | Yes (jobs they can see) | Yes, on own and unassigned jobs |
| Work orders (maintenance requests from a job) | Full | Assigned | As section 6 | Create only. Cannot read the Maintenance page or repair costs. No photos |
| Maintenance schedules | Full | Create, edit, pause (assigned) | No (403) | No |
| Files on cleaning records | Full | Assigned | Assigned | Own and unassigned jobs |
| Files on damage and lost-and-found records | Full | Assigned | Only records they filed (on the job detail) | Only records they filed |
| Files on inspections | Full | Assigned | No | No |
| Guest phone, email and notes on lost items | Yes | Yes | No | No |
| Invite a cleaner (team) | Yes | No | No | No |
| Account, notifications, help and support | Own | Own | Own | Own |

### 6.1a QA round 2 additions (2026-10-14)

**Job detail (`GET /api/cleaning-tasks/:id`) per role.**
- **Owner and manager (assigned):** the whole record: checklist files, inspections, every damage report with `estimated_cost`, `status`, `charge_id`, `resolution_note`, `resolved_at` and `resolved_by_name`, every lost item with `status_note`, and the work orders (`request_id`, `title`, `status`).
- **Staff (assigned properties):** checklist files, and only the damage reports and lost items they filed. Damage reports carry `report_id`, `description`, `created_at`, `reported_by_name` and their photos under `files`; lost items carry `item_id`, `description`, `found_where`, `found_on`, `status`, `created_at`, `found_by_name` and photos. No amounts, charge, resolution, status note or inspections. Work orders as in section 6.
- **Pay fields (dated 2026-10-14, QA round 5):** until round 5 the cleaning-task list and detail routes sent `pay_amount` and `pay_status` to staff on every job. Now staff and cleaners get them only on a job assigned to them, or on an unassigned job they completed. Owners and managers get them on every job (section 11).
- **Cleaner inspections (2026-10-14, D-82):** inspections carry only `inspection_id`, `passed` and `created_at`, and only on jobs assigned to that cleaner.
- **Cleaner (own and unassigned jobs):** the same filed-by-them damage and lost-item fields as staff. Inspections appear only when the job is assigned to that cleaner. `work_orders` is always empty. No estimate, no damage status, no charge, no resolution, no status note.

**Staff pages.** Staff may open Group bookings (rooms and stays, without money, only when every room is in their properties; section 6.3) and the Supplies page (read-only). The screen route block (`public/js/routeaccess.js`) and the menu no longer hide them. Housekeeping is a stay-only page; cleaners keep it.

**Supply movements (`supply_movements`).**
- Using more than is on hand: owners and managers are asked first; a confirmed use logs only the on-hand amount, with "Asked for N, only M on hand." added to the note (the note is shortened to fit its length limit). On hand never goes below zero.
- A use with nothing on hand is refused for owners and managers (a 400 on `quantity`), because the log takes uses of at least 1.
- A cleaner's save from a job skips the short item, saves the others, and names the skipped item.
- Movement history stays owner and manager only (section 6.1).

**Done by you (2026-10-15, D-88).** Every cleaning task from `GET /api/cleaning-tasks` and `GET /api/cleaning-tasks/:id` carries `done_by_viewer`: true when the caller is the person who finished the clean, for every role. The internal `completed_by` id is still never sent. Before this, round 11's "Done by you, no pay" never reached the task page because the server stripped the field. See section 18.

**Owner portal.** The statement responses no longer include `confirmation_code`. The stored snapshot keeps it (D-47, D-77).

**API notes added this round.**
- `POST /booking-groups/:id/rooms {rooms:[]}` adds 1 to 20 rooms, all or nothing. Cancelled rooms do not count.
- `POST /payments` on a tenant returns 409 `PAYMENT_OVER_BALANCE` with the amount owed and the credit after; the retry sends `confirm_over`.
- Voiding a stay payment that refunds depend on returns 409 `REFUNDS_EXCEED_PAYMENTS`: "Void the refund first, then this payment."
- The guest pay token response includes what was bought and what is left per add-on, the Taglish name (`name_tl`) and the cancelled state.
- Assigning a cleaning task to someone who can't see the property returns 400 (D-29).
- Forgot-password sends one reset email per account per 5 minutes; the reply is always the same.
- A PATCH that changes nothing writes no audit row. Audit entries returned to the screen leave out fields ending in `_id`.
- Listing edit: the postal code must be 4 digits; blank required fields return field messages; blank fees and discounts are saved as 0; a blank deposit percentage is left unchanged.
- Manager invitations and later manager edits require at least one property.
- Uploads: the shared check in `src/lib/storage.js` (structure plus a 64-byte minimum for images) covers every upload route.

**Damage report create (QA round 3, 2026-10-14).** `POST /api/cleaning-tasks/:id/damage` answers staff and cleaners with the same trimmed shape as the job detail: `report_id`, `description`, `created_at`, `reported_by_name` and `files` (photos; empty on create because photos are added in a second request). Owners and managers get the full row (estimate, status, charge, resolution).

### 6.2 Phase 4 access matrix (guests, quotes, add-ons, settings)

The cleaner role is denied by `cleanerGuard` (D-48) unless a route is on its allow-list. None of the Phase 4 routes are on that list, so cleaners get 403 on every one. "Assigned" means the properties the manager is assigned to, as in section 6.1.

*2026-10-14 (D-83): staff and cleaner reservation rows are an allow-list (`STAFF_RESERVATION_KEYS` in `src/routes/stays.js`); `source` is not in it, and a new booking column stays hidden from them until it is added to the list.*

| Data area | Owner | Manager | Staff | Cleaner | Public (with the private link or no login) |
|---|---|---|---|---|---|
| Guidebook: read and edit text | Full | Assigned | No | No | No |
| Guidebook: door code (read, set, clear) | Yes (masked; shown on request) | Yes (assigned) | No | No | No |
| Send the guidebook link (create the token) | Yes | Yes (assigned) | No | No | No |
| Guest guidebook page `/#/guide/<token>` | Own view | Own view | No | No | Yes, confirmed stays inside the link window. Wi-Fi and door code only from the day before check-in through check-out day. Otherwise 404 or "shown from …" |
| Add-on catalogue: create, edit, archive | Yes | No (read only) | No | No | No |
| Add-on catalogue: read | Yes | Yes | No | No | No |
| Add-on purchase after booking (pay page) | Yes | Yes | No | No | Yes, with the balance link. Before or on check-in day, confirmed, not demo, not read-only; 20 tries per link per hour |
| Booking page: add-ons, house rules, source | No | No | No | No | Yes. Only add-ons offered on the booking page for that listing |
| House rules accepted (time and text) | Yes (on the reservation) | Yes (on the reservation, assigned) | No | No | Written by the guest on the booking page, quote page or check-in form |
| Quotes: list, create, cancel, send | Yes | Yes (assigned) | No | No | No |
| Quotes: guest name, email and phone on a quote | Yes | Yes (assigned) | No | No | The guest sees the details on their own quote only |
| Quote page `/#/quote/<token>` | No | No | No | No | Yes, with the token. Shows the offer, the rules and the price. No host keys. Pay: 20 tries per IP per hour |
| Booking sources and "By source" report | Yes | Yes (assigned) | No | No | No |
| Guest settings: review links, returning-guest percentage, abandoned follow-up | Yes | No | No | No | No |
| Public review links | Set by owner | No | No | No | Shown to a guest only after a 4 or 5 star rating |
| Personal returning-guest codes | View (discount codes) | View (discount codes) | No | No | Guest receives it in a message. Created by the system, once per booking |
| Listing page address (`public_slug`) | Yes | Yes (assigned) | No | No | Shown in the URL of the public page |
| Public listing pages `/stay/<host>[/<listing>]`, sitemap, robots | — | — | — | — | Yes, no login. Shows name, from-price (lowest of nightly, weekend and holiday), max guests, city and province, photos, house rules, cancellation policy. Never the street address, guest data or other bookings |
| Abandoned-booking follow-up email | Set by owner | No | No | No | Sent by the system to the guest's email, once per unfinished checkout |

---

### 6.3 Phase 5 access matrix (pricing, team, groups, daily close, sync)

Cleaners are denied by `cleanerGuard` on every Phase 5 route. "Assigned" means the properties the manager is assigned to, as in section 6.1. Workspace-wide pricing rules and seasons are owner-only to change.

*2026-10-14 (round 8, D-84): the manager cell below is corrected to match D-83 and `pricing.js`: creating a rule or season for every listing answers 400 with a message; changing or removing one answers 403.*

*2026-10-14 (D-83): a manager's season create for every listing answers 400 on `unit_id` with a clear message (nothing is written); removing or changing an all-listings rule answers 403. Staff group rows and totals carry no `held` figure.*

| Data area | Owner | Manager | Staff | Cleaner | Public |
|---|---|---|---|---|---|
| Pricing rules: read | All | Workspace-wide rules, and rules for assigned listings | View (assigned) | No | No |
| Pricing rules and seasons for every listing: create, change, remove | Yes | No (create: 400 on `unit_id` with a message; change or remove: 403) | No | No | No |
| Pricing rules and seasons for one listing: create, change, remove | Yes | Yes (assigned) | No | No | No |
| Price preview (`GET /pricing/preview`) | Yes | Yes (assigned) | View (assigned; archived listings are 404) | No | No |
| Bulk prices and blocks (preview and apply) | Yes | Yes (assigned listings only; a tag covers only those) | No | No | No |
| Tags and room types: read | Yes | Yes (assigned) | Yes (assigned; the app shows the filter to owners and managers) | No | No |
| Tags, room type, lowest price, fourteen-night discount on a listing | Yes | Yes (assigned) | No | No | No |
| Reservation activity log | Yes | Yes (assigned) | No (403) | No | No |
| Assign a conversation | Yes | Yes, only to someone who can see that property (refused otherwise) | No (inbox hidden) | No | No |
| Mention in an internal note | Yes | Yes, to owners and managers who can see that reservation's property | No | No | No |
| Own notification settings (types) | Yes, for types their role receives | Same | Same | Cleaning only | No |
| Notification property choice | Owner: all or chosen | Any member may choose among properties they can see (wider than the spec; see PRD.MD gaps) | Same | Same | No |
| Groups: list and open | Yes | Yes (only when every room is in their properties) | Yes, without money (only when every room is in their properties) | No | No |
| Groups: create, add room, remove room, cancel, edit | Yes | Yes (assigned) | No | No | No |
| Room type on a new reservation | Yes | Yes (assigned) | No | No | No |
| Move a reservation to another listing | Yes | Yes (assigned) | No | No | No |
| Daily close: view and close a day | Yes (whole workspace) | Yes (assigned; a close covers their properties) | No | No | No |
| Daily close: history | All | Whole-workspace closes, and closes that cover any of their properties | No | No | No |
| Daily close: reopen a day (`POST /daily-close/reopen`) | Yes (any close) | Only a close whose properties are all assigned to them; never a whole-workspace close (409 `ALREADY_CLOSED`) | No | No | No |
| Sync health (`GET /sync-health`) and Home or Calendar warnings | Yes | Yes (assigned) | No (403) | No | No |

### 6.4 Top bar access matrix (QA round 14, D-91)

All three endpoints sit under `/api` and need a signed-in session. Every query also filters on the person's workspace (`organization_id`).

**Global search (`GET /api/search`)**

| Group | Owner | Manager | Staff | Cleaner | Public |
|---|---|---|---|---|---|
| Reservations (guest name, confirmation code; cancelled ones marked) | All | Assigned properties only | Assigned properties only | 403 | No |
| Guests | All | Guests with a stay in an assigned property, plus guests with no stays yet | Same | 403 | No |
| Listings, Properties | All | Assigned only | Assigned only | 403 | No |
| Tenants (long-term workspaces) | All | Assigned properties | Assigned properties | 403 | No |
| Unit owners | Yes | **No group** | **No group** | 403 | No |
| Quotes | Yes | Assigned only | **No group** | 403 | No |
| Repair requests (the old "Maintenance" group, renamed in round 17) | All | Assigned only | Assigned only | 403 | No |
| Cleaning tasks, Supplies, Expenses *(round 17, D-99)* | All (supplies: short-term only) | Assigned only | Assigned only | 403 | No |
| Discount codes, Add-ons *(round 17, D-99)* | Yes | Yes | **No group** | 403 | No |
| Help articles | Yes | Yes | Yes | No server call: the app uses the help list (`/api/help/articles`) | No |

A result carries only `id`, `title`, `sub` and `href`. Search never matches or returns an email, phone number, note, money figure or token, so staff see names, listing names and confirmation codes but no contact details or amounts. Archived listings, properties, tenants and unit owners are left out. Pages and settings are searched in the browser from the menu the role already has and never touch the server.

**Bookmarks (`/api/account/bookmarks`)**

| Action | Owner | Manager | Staff | Cleaner | Public |
|---|---|---|---|---|---|
| List, save, remove | Own only | Own only | Own only | Own only | No |

Every role has them, cleaners and read-only workspaces included (they sit under `/account/`, which is exempt from the plan guard). The demo workspace refuses the save with its usual read-only message. Up to 20 per person. Removing another person's id answers 404.

**Bell notifications (`/api/account/notifications`)**

| Action | Owner | Manager | Staff | Cleaner | Public |
|---|---|---|---|---|---|
| List, count, mark read | Own only | Own only | Own only | Own only | No |

Rows are re-scoped **at read time**, not only when written: a row shows only if its type is one the role receives, the person has not turned that type off in My account, and (when the row has a property) the person is still assigned to that property and has not filtered it out. A person who loses access to a property stops seeing its alerts. Marking read by id touches only the person's own rows, and an id that is not theirs is ignored without an error. **Non-owners see only rows for properties they are assigned to; a row with no property is owner-only** (so a person who loses a property, or an alert written without one, never shows to a manager or staff member). Cleaners get cleaning alerts only. Long-term-only workspaces have no bell in the app.

---

### 6.5 Card on file access matrix (QA round 17, D-98)

| Data | Owner | Manager | Staff | Cleaner | Platform admin |
|---|---|---|---|---|---|
| Card on file (brand, last 4) | See, remove | No | No | No | See (admin list) |
| Card check (start, attach, refresh) | Create | No (403) | No (403) | No (403) | Waive ("Skip card check") |
| Renewal plan, automatic payment | See, edit | No | No | No | See |
| Card check payment rows | See (Plan & billing history) | No | No | No | No |
| PayMongo customer / payment method / subscription ids | Never shown | No | No | No | Never shown |
| `paymongo_plans` | No | No | No | No | No (server only) |

Another workspace's `billing_id` answers 404 on every card check route. Team members of a gated workspace get `owner_name` in `/auth/me` (and nothing else) so their waiting page can name the owner.

---

## 7. Known gaps and risks found while checking

| # | Finding | Where |
|---|---|---|
| 1 | ~~**Staff can reach guest contact details through the check-in link.** `redactGuest` removes email, phone, notes, `review_token` and `pay_token`, but not `checkin_token`. Reservation responses use `SELECT b.*`, so staff receive the check-in token. Opening `/api/public/checkin/<token>` returns the guest's form, including phone and email, and lets them edit it~~ Fixed (checked 2026-10-13): `redactGuest` now also removes `checkin_token` (and `guide_token`), so staff don't receive the check-in link | `src/routes/stays.js` (`redactGuest`, `BOOKING_SELECT`), `src/routes/checkin.js` |
| 2 | The gate-pass page always lists the guest ID photos. `gatepass_attach_ids` only controls the email attachments. A host who turns "Attach IDs" off may not expect the building admin's link to show them | `src/routes/gatepass.js` (`passData`, `GET /public/gatepass/:token`) |
| 3 | `redactGuest` lives in `src/routes/stays.js`, not in `src/lib/access.js` as the project notes say | `src/lib/access.js` |
| 4 | Staff can read financial reports, the dashboard, stays revenue, rent and expense lists and pricing for their assigned properties. `docs/ARCHITECTURE.md` agrees, but the assistant's role text says reports and pricing are hidden from staff. One of them should change | `src/routes/reports.js`, `stays.js`, `pricing.js`, `money.js`; `src/routes/assistant.js` `ROLE_TEXT` |
| 5 | ~~Managers limited to some properties can still create and edit workspace-wide discount codes and message templates, and switch the built-in template language~~ Fixed (D-28, checked 2026-10-13): discount-code creation and changes, message-template changes and the template language switch are owner-only; managers can read the discount codes | `src/routes/guestcare.js`, `src/routes/inbox.js` |
| 6 | A cleaning task can be assigned to any active member, even one not assigned to that property, who then can't see it | `src/routes/housekeeping.js` (`checkAssignee`) |
| 7 | Guest-link tokens (`checkin_token`, `pay_token`, `review_token`, `gate_passes.token`, `units.ical_token`, `direct_checkouts.public_token`) are stored in plain text, unlike session and auth tokens | migrations 002, 007, 010, 014, 018, 019 |
| 8 | ~~No cleanup of expired `sessions` or `auth_tokens`~~ Fixed 2026-10-13: the hourly `auth-cleanup` job deletes expired or idle sessions and old one-time tokens, and the owner portal's sessions and sign-in links too | `src/lib/auth.js` (`purgeExpiredAuth`) |
| 9 | The workspace export leaves out support messages and events, consent records and file contents | `src/lib/account.js` |
| 10 | `GET /api/files/:id` checks the storage path with `startsWith(storageDir)` without the trailing separator (the other file routes include it). Low risk, since storage keys are generated by the server | `src/routes/files.js` |
| 11 | ~~Payout retries not on the new column~~ Fixed 2026-10-13: `POST /unit-owners/:id/payouts` uses `owner_payouts.idempotency_key` (unique per workspace), like refunds | `src/routes/ownerledger.js`, `db/migrations/029_phase2_owners.sql` |
| 12 | Decided 2026-10-13: published statements keep each stay's confirmation code in the stored copy, but screens and emails don't print it (the table is already wide on phones). Owners match stays by dates, unit and guest first name | `src/lib/statements.js`, `public/js/views/ownerportal.js`, `public/js/views/owners.js`, `statementText()` |
| 13 | ~~Rollback note missing `idempotency_key`~~ Not needed: the rollback drops the whole `owner_payouts` table | `db/migrations/029_phase2_owners.sql` |
| 14 | ~~D-46 security items~~ Fixed 2026-10-13: an email change or clear ends the owner's portal sessions and cancels unused links (clearing also turns access off); owner blocks are refused while the workspace is view-only (402) or the demo (403); block create and cancel are limited to 20 per hour per owner; the sign-in link is removed from the address bar after use. Covered by tests | `src/routes/ownerportal.js`, `src/routes/owners.js`, `src/lib/auth.js` (`planGuard`) |
| 15 | ~~Daily close by a manager with no properties~~ Fixed 2026-10-13: such a manager gets 403 on the daily close (D-75) | `src/routes/dailyclose.js` (`POST /daily-close`) |
| 16 | New 2026-10-13 (QA round 1, D-76): add-on names are unique among active add-ons only in the app (`assertNameFree` in `src/routes/addons.js`); there is no database index, because live data may already hold duplicates. Two creates at the same instant could both pass | `src/routes/addons.js` |
| 17 | ~~`GET /api/my-pay` answers any signed-in person, with only that person's own cleans and pay. The page `#/my-pay` is for cleaners only, but the API is not limited to cleaners.~~ **Resolved 2026-10-14 (round 6, D-82):** `GET /api/my-pay` is cleaners only (403 for everyone else). | `src/routes/cleanerpay.js` (`GET /my-pay`), `public/js/routeaccess.js` |
| 18 | ~~Reopening an older clean while a newer clean of the same unit is done still marks the unit dirty.~~ **Fixed 2026-10-14 (round 6, D-82):** reopening, or failing an inspection, leaves the unit alone when a newer clean of it is done. | `src/routes/housekeeping.js` (the status route, the reopen update) |
- Paused maintenance schedules are resumed with `PATCH /maintenance-schedules/:id { active: true }` (the Resume button on the Maintenance page).
- Monthly schedules step from the last due date, so a due date on the 31st can drift to the 28th (`src/lib/maintschedule.js`).
- Section 6 (the older matrix) has no Cleaner column. Cleaners are denied by default by `cleanerGuard`, and section 6.1 covers the Phase 3 rows.

- Phase 4: the `/stay` pages and `/sitemap.xml` share a limit of 300 requests per visitor per 15 minutes, and the sitemap is cached in memory for 5 minutes (D-65).
- Phase 4: the listing's own check-in instructions and house rules have no Taglish text, so the guide shows English for those two sections.
- Phase 4: the Wi-Fi password and the door code are stored as plain text in the inbox history once a message containing them is sent. This is a known trade-off (D-64), not a bug.
- Phase 4: the discount code list shows the welcome codes in their own section, apart from the owner's codes (see D-64).

## 8. API notes from QA round 1 (2026-10-13)

- `GET /api/supplies/:id/movements` (owner, manager; assigned properties): the last 20 movements, newest first, each with `kind`, `quantity`, `note`, `created_at` and `recorded_by_name`. Supply notes now hold up to 200 characters.
- `GET /api/units/:id/channels` (owner, manager): each feed also carries `problem_message`, the plain sentence for the host, or `null` when the feed is fine. `last_message` keeps the raw text.
- `POST /api/unit-owners/:id/payouts`: with a `month`, a payout that takes the month's payouts above the statement's payout (the published copy, or the live figure for a draft) answers 409 `PAYOUT_OVER_DUE` with `due` and `paid`. Resend with `confirm_over: true` to record it.
- `POST /api/cleaning-tasks/:id/inspect`: the response has `pay_cleared`, true when a failed inspection cleared a pay amount that was set. Finishing a clean no longer sets `started_at` (per-hour pay with no real start stays `NULL`, "not set"); `POST /cleaner-pay/mark-paid` refuses it with `NO_PAY_AMOUNT`.
- `POST /api/pricing/seasons`: the response has `overlaps`, the seasons on the same scope that share nights, each with `wins` (`new`, `existing` or `null`). `GET /api/pricing/preview` is open to staff for their own active listings.
- `GET /api/owner-portal/pnl`: the response has `source` (`published` or `live`) and, for a published month, `published_at`; the numbers come from the stored statement.
- `POST /api/bulk/prices`: a 0% change is refused and a nightly price above ₱1,000,000 is refused (preview and apply). `POST /api/bulk/blocks` needs a `reason`.
- Auth limits (`src/routes/auth.js`): sign-in counts failed attempts only (20 per IP and email, 60 per IP, per 15 minutes). Sign-up is different: every attempt counts toward 10 an hour per IP, because each one can send a verification email (corrected in round 4; see section 10). Forgot-password and resend-verification: 5 per email address (or signed-in user), plus 30 per IP, per 15 minutes.
- **Shared rule `src/lib/leases.js`** (`leasedListings`): a unit with an active monthly lease over any of the requested nights can't be booked for a short stay. Used by manual reservations (create and move), room-type and group bookings, the public booking page (availability and checkout) and iCal import. A long-term-only workspace gets 409 `LONG_TERM_ONLY` on short stays.

## 9. API notes from QA round 3 (2026-10-14)

- **Channel fee rule.** `POST /api/reservations` and `PATCH /api/reservations/:id` answer 400 on `channel_fee` ("Direct bookings have no channel fee. If a platform or agent took a cut, set Booked through to that channel or Other.") when the booking's channel is `direct` and the fee is above 0, including a PATCH that moves a booking with a fee to `direct`. The reservation detail carries `channel_fee_ignored` (true when the channel is direct and the stored fee is above 0). Wherever the app works out what is owed, it uses `CASE WHEN b.channel = 'direct' THEN 0 ELSE b.channel_fee END`; P&L, owner statements, stay reports and the owner portal still use the stored fee.
- `DELETE /public/pay/:token/proofs/:proofId` (guest, same rate limit as the screenshot upload): withdraws a pending proof that has no file. Answers 200 `{ ok: true }`; 409 `NOT_PENDING` once reviewed; 409 `HAS_FILE` once a screenshot is saved; 404 for another booking's proof. Audited as `payment_proof.withdrawn` ("Withdrew a payment proof", by Guest). The host is told about a proof only after its screenshot is saved.
- `GET /public/guidebook/:token` before the window opens answers 409 `GUIDE_NOT_YET` with `opens_on` (check-in minus 14 days). Wrong, cancelled and ended links keep the 404.
- `GET /api/stay-reports` carries `month_invalid` (true when a `month` was given that isn't a real `YYYY-MM`; the current month is used).
- Group rooms: `rooms.N.accommodation_total` of 0 or less is refused; blank means the listing's price. A short count reads "Only N <type> rooms are free on these dates (you asked for M). Nothing was saved." (409 `NO_FREE_ROOM`).
- `POST /api/account/password`: the new password, the sign-out of other devices and the retirement of open reset links happen in one transaction under the per-user lock `reset:<user_id>`; `POST /auth/reset-password` takes the same lock.
- `POST /api/bulk/prices`: errors use the on-screen field name ("Change (%) must be at least -90.").

## 10. API notes from QA round 4 (2026-10-14)

- **Money input rule (`parseMoney` in `src/lib/validate.js`).** A comma is accepted only as a thousands separator ("1,000", "12,500.50"). Any other comma ("1,5", "1,50", "1,0000", ",500") is refused with the usual "must be a valid amount" message on that field. This applies to every money field. The browser no longer strips commas before sending the bulk price (`POST /api/bulk/prices`), so the server judges what was typed.
- **`PATCH /api/reservations/:id`:** a blank `cleaning_fee`, `other_fees` or `channel_fee` is stored as 0.00. A blank `accommodation_total` is refused with 400 on that field ("Accommodation total is required. Type 0 for a free stay."). Every 200 answer carries `changed: true` or `changed: false`, so the screen says "Reservation updated." only when something was written, and "No changes to save." otherwise.
- **`POST /api/reservations/:id/payments`:** `payment_method` `channel_payout` on a direct booking is refused with 400 on `payment_method` ("Channel payout is only for bookings made through a channel."). Existing rows are left alone.
- **`PUT /api/rates`:** a price above 1,000,000 is refused with 400 on `price` ("A nightly price can't be more than ₱1,000,000."), the same cap as bulk changes. A blank price over a range answers `{ ok: true, cleared: n }`, where `n` is the number of set prices removed from those nights.
- **`GET /api/reservations/:id/refunds`:** `suggestion` keeps `amount` (the policy share of what was paid) and adds `already_refunded` (refunds recorded so far) and `remaining` (the amount still suggested: never below 0 and never more than is left to refund). The Refunds card and the cancelled alert use these, and Record refund starts at `remaining`.
- **`POST /api/message-templates` and `PATCH /api/message-templates/:id`:** a name already used by another active template in the workspace is refused with 400 on `name`, compared trimmed and case-insensitively. This is an app check only, with no database index, the same approach as add-on names (D-76). Archived templates don't count. The built-in templates and the Taglish template-language switch do not go through this check, so the switch can still create a "(Taglish)" template with the same name as a custom one (accepted in D-79).
- **Automatic messages (`/api/automations`):** `offset_days` is required when the trigger is `before_check_in`, `before_check_out` or `after_check_out`. The check runs after merging with the stored trigger on a PATCH. A blank value is refused with 400 on `offset_days` ("Enter the number of days."). `booking_created` and `check_in_day` store 0 days. A blank send time is stored as 10:00.
- **`GET /public/book/:slug/units/:unitId/quote`:** `guests` above the listing's `max_guests` is refused with 400 on `guests` ("This place allows up to N guests."), the same rule the checkout applies. A listing with no `max_guests` set has no limit here.
- **Notification types (`GET` and `PATCH /api/account/notify-prefs`, `GET /api/push/settings`):** a long-term workspace gets no stay types. The list of types depends on the workspace type: the account route refuses a stay type for a long-term owner with 400 on `types`. Short-term and both-type workspaces are unchanged. Push delivery is not gated by this list.
- **Known gap:** `PATCH /api/push/settings` does not check the workspace type, so a long-term owner who calls it directly can still store a stay type. The settings screen shows none, and delivery is not gated. Carried to round 5 (see IMPLEMENTATION-PLAN Session notes). Fixed in round 5 (section 11).
- **Sign-up (`POST /auth/signup`):** no server change this round. The browser now checks the Terms box first, so an unticked box never reaches the server. The server still counts every attempt toward the sign-up cap (`signupLimiter`), as its comment explains.
- **Browser-only changes this round (no API change):** the Reopen confirmation, the Add rate confirmation, the whole-number check for supplies on the cleaner screen, the name on the copy box, the report date handling, the booking page's guest-count re-price, the order of invite errors, and the calendar's price hint. The access matrix in section 6 is unchanged.

## 11. API notes from QA round 5 (2026-10-14)

- **Pay on cleaning jobs (`GET /api/cleaning-tasks` and `GET /api/cleaning-tasks/:id`).** Owners and managers get the whole record. Staff and cleaners get `pay_amount` and `pay_status` only on a job assigned to them, or on an unassigned job they completed; on every other job both are `null`. The guest first-name rule stays for cleaners only. The rule is in `presentTask` in `src/lib/housekeeping.js`. Sections 6.1 and 6.1a say the same.
- **`GET /api/public/pay/:token`:** `manual_payments.pending` lists this booking's proofs that the host has not checked yet, oldest first, with `proof_id`, `amount`, `method`, `sent_at` and `has_file`. `pending_total` is their sum as a two-decimal string. No reference number, payer name, host note or other booking's proof is sent. `manual_payments` is `null` when manual payments are off.
- **`POST /api/public/pay/:token/proofs`:** after the booking is locked, the amount must not be more than the balance less the proofs still waiting. A larger amount is refused with 400 on `amount`: "You already sent proofs for ₱X that the host hasn't checked yet, so you can send up to ₱Y more." When nothing is left, the message is "Your proofs already cover what you owe. The host will check them soon." At five waiting proofs the answer is 409 `TOO_MANY_PENDING` (D-38).
- **`POST /api/unit-owners/:id/payouts`:** when the month's due is below zero, the answer is 409 `NOTHING_DUE` with `due`, and nothing is recorded, even when `confirm_over` is sent. A due of exactly zero keeps the D-76 confirm. The `PAYOUT_OVER_DUE` message names the month, for example "September 2026".
- **`GET /api/stays/revenue`:** the fees figure is the cleaning fee plus the other fees plus the extras total (the stored sum of the stay's live extra charges), for stays that check in that month. It is the same definition `GET /api/stay-reports` uses.
- **Bulk prices, `set` preview and apply:** a night already at the new price is left out of the change list, so Apply does not write it. An empty list shows "None of these nights would change." on the screen and writes nothing.
- **`PATCH /api/expenses/:id`:** a future `expense_date` is refused with 400 on `expense_date` ("Expense date cannot be in the future."), the same as on create.
- **`PATCH /api/push/settings`:** a notification type the caller can't receive (the list from `typesFor`, by role and workspace type) is refused with 400 on `types`, and nothing is saved. This closes the round 4 known gap.
- **`PUT /api/cleaning-checklist`:** a repeated item (trimmed, any capitals) is refused with 400 on `items`: "This checklist has “Change towels” twice."
- **Reopening a finished clean:** changing a done job back to to-do or in progress sets the unit's `cleaning_status` to `dirty` in the same transaction. A paid clean can't be reopened; the server refuses it, as before. Known gap, carried to round 6 (section 7, row 18).
- **Guest add-on lists** (every list that uses `listAddonsForUnit`): one row per name, with the name trimmed and capitals ignored, showing the oldest active copy. Owner endpoints are unchanged, so the owner's Add-ons page still lists every copy.
- **Add-on maximum quantity:** the browser sends the number as typed. The server's existing minimum of 1 refuses 0 with 400 on `max_quantity`.
- **Room-type and group rooms:** when the accommodation total is left blank, the server prices the booking from the listing it books (`src/routes/stays.js`, about lines 527 to 537). A typed total is used as it is.
- **`GET /api/my-pay`:** answers any signed-in person with that person's own finished or assigned cleans. Each clean carries `pay_visible`, which is true only for the caller's own pay. The `#/my-pay` page is for cleaners only (section 6.1). Known gap: section 7, row 17.
- **Get started, mobile number:** the browser check uses the same pattern as the server's phone check (`src/lib/validate.js`), so no server change was needed.
- **Browser-side changes this round that need no API change:** the paid clean note and the reopen wording, the proof list on the pay page, the phone number check, the "Use ₱X from your rates" button, the stacked-card layout for wide tables, the More dialog, the notification card and the names on controls.

## 12. API notes from QA round 6 (2026-10-14)

- **`GET /api/cleaning-board`:** `last_inspection` per role: owners and managers get the full result, staff get none, a cleaner gets `passed` and `at` only for a unit where she has a job. `current_stay` (the guest) is sent to a cleaner only where she has a visible open job.
- **`GET /api/cleaning-tasks/:id`:** a cleaner's inspections carry `inspection_id`, `passed` and `created_at` only, and only on jobs assigned to her (section 6.1a). Staff get no inspections.
- **`GET /api/files/:id`, damage and lost-and-found photos:** staff and cleaners can open only photos on records they filed (404 otherwise). Owners and managers can open all. A staff member can still add a photo to a report they filed.
- **`GET /api/my-pay`:** cleaners only; everyone else gets 403 "My pay is for cleaners." Rows for cleans paid to someone else are hidden rows: no name and no money. This closes section 7, row 17.
- **`GET /api/guests` and `GET /api/guests/:id`:** staff get `{ guest_id, full_name, limited }`, the profile has empty `stays` and `reviews`, and the `segment` and `guest` filters are ignored for staff (the answer equals the unfiltered list). A group's lead guest has the same limited shape.
- **`GET /api/reservations?guest=`:** ignored for staff. Reservation rows for staff have no `guest_vip` or `guest_do_not_rebook`.
- **Unit create and edit (discount ladder):** among the discounts that are on, weekly <= 14+ night (`fortnight_discount`) <= monthly. A broken order is refused with 400 on the longer-stay field. `PATCH` checks the order only when the request sends a discount field, so an older listing with an inverted ladder can still be edited for other reasons.
- **`POST /api/unit-owners/:id/payouts`:** `month` is required (400 on `month` without it) and must be between 2000 and 2100; the `GET` month filter follows the same range.
- **`GET /api/owner-statements`:** leaves out owners with no units and no saved statement for the month.
- **`POST /api/unit-owners/:id/archive`:** turns portal access off and removes the owner's sessions and unused sign-in links. The invite route answers `sent: false` when the email failed, and the screen says so.
- **`PATCH /api/account/notify-prefs`:** `property_ids: []` is refused with 400 on `property_ids`. Accounts that saved an empty list before this fix stay muted until they save again (BLOCKERS round 6, read-only check).
- **`GET /api/reviews`:** a malformed `unit_id` or `property_id` is ignored (D-77), so the full list comes back instead of a 404. `matched` and `matched_average` count every match, not only the rows sent back (the 200-row limit).
- **`POST /api/support/tickets/:id/rate`:** the first rating is kept; a second one gets 409 `ALREADY_RATED`.
- **Daily close:** balances detail dates are written out ("Oct 15, 2026"), and sync-problem rows carry a link to the listing.
- **Reopening a finished clean, and failing an inspection:** the unit's `cleaning_status` is left alone when a newer clean of that unit is already done (closes section 7, row 18).
- **Supplies:** a quantity above 100,000 is refused (400 on `quantity`) before the "Not enough on hand" question.
- **Amount filters (payments, expenses and similar lists):** an amount that can't be used or a backwards range is refused or ignored with a message on the field; the screen turns the filter off and shows no chip.
- **Section 11, `GET /api/my-pay` bullet** is superseded by the first bullet above of this section.
- **House rules on reservations (C22):** `GET /api/reservations` and `GET /api/reservations/:id` give `rules_text` and `rules_accepted_at` to owners and managers only. Staff do not get them (matrix 6.2). Guest detail redaction is an allow-list: every role except owner and manager is redacted.
- **`POST /api/reservations/:id/payments`:** staff can record a payment, but the response is redacted the same way: no guest email, phone or flags, no other stays, review or house rules. Owners and managers get the full guest.
- **Payment idempotency keys:** `idempotency_key` is internal. It is removed from payment and receipt responses for every role.

## 13. API notes from QA round 7 (2026-10-14)

- **Activity log (`src/lib/auditdiff.js`):** `changedKeys(before, after)` returns the names of the fields that really differ. Every edit action writes `{ fields: [...names], ...identity }` (names only, never values) and writes **no row** when nothing changed. Covered: unit and property edits, guide, gate pass, guest experience, automatic message edit, cleaning task edit, maintenance schedule edit, supply edit. Equality rules: empty and null are the same; text is trimmed; "14:00:00" equals "14:00"; object keys are compared in sorted order and an empty array is a value; text and a real number or yes/no are the same only when the text is that value's plain form ("4200.00" equals 4200), and two pieces of text are never coerced (door codes and Wi-Fi passwords compare as text).
- **`maintenance.schedule_resumed`** is a new action (`{ title }`); the screen reads "Resumed a maintenance schedule". `PATCH /api/maintenance/:id` still writes before and after values and a row on a no-change save (carried to round 8).
- **`GET /api/reservations`, `GET /api/reservations/:id`, `GET /api/stays/overview`:** staff and cleaners get only `STAFF_RESERVATION_KEYS`; owners and managers are unchanged.
- **`POST /api/reservations/:id/payments` and `/booking-payments/:id/receipt`:** a failed receipt email gives staff `receipt.error` as one fixed sentence; owners and managers keep the provider detail. The over-balance question is on the screen only; the server still accepts an overpayment (D-32).
- **`GET /api/booking-groups` and `/:id`:** a group carries `held` (money paid on rooms that are not confirmed, for example in a cancelled group) for owners and managers only.
- **Quotes price preview:** carries `missing_rates` (the nights with no nightly rate). **Bulk price preview:** `below_lowest` is also returned for a set-price change.
- **`PUT /api/cleaner-rates` (typed outside name), `POST /api/cleaning-tasks`, `PATCH /api/cleaning-tasks/:id`:** a typed name equal to an active team member in the same workspace (any role, spaces and capitals ignored) answers 400 on `assignee_name`: "Pick <name> from the team list instead." (`teamMemberByName` in `src/lib/cleanerpay.js`). Rates saved that way earlier are left alone. Security note carried: the message echoes the member's full name to managers.
- **`GET /api/inbox`:** an unknown `unit_id` or `property_id` is ignored (the list is not filtered); an id the manager cannot reach still gives an empty list.
- **`GET /api/auth/me` and `GET /api/account/profile`:** the plan object for managers, staff and cleaners has no `price` or `listing_limit`.
- **`GET /api/leases/:id`:** `document_file_id` is null for staff and cleaners.
- **`POST /api/team/invitations`:** an existing email answers 409 `EMAIL_TAKEN` with `fields.email` = "This email already has a BalayHub account. Use a different email for each workspace."

---

## 14. API notes from QA round 8 (2026-10-14)

Decision D-84. Checked against the code after the fixes landed.

- **Activity log, `{ fields }` shape (`changedKeys` in `src/lib/auditdiff.js`).** Every edit below writes `{ fields: [names], ...identity }` (names only, never values) and writes **no row** when nothing changed: workspace (`workspace.updated`: name, business type, default language), booking page settings (`direct_booking.settings_changed`: enabled, slug, intro, and `paymongo_key` by name only), manual payment details, team access (`member.updated`: role, property ids), profile (`user.profile_updated`: full name, phone), notification settings (`user.notify_prefs_updated`, from both `PATCH /push/settings`, which now audits, and the account notification route), unit owners (`unit_owner.updated`: `{ fields }`, with `unit_ids` named when the set of units changed, in any order), guests, booking groups, tenants, leases, repair requests, pricing rules (`pricing_rule.updated`: `{ kind, fields }`; a no-change save answers the rule and writes nothing), add-ons, message templates and the cleaning checklist. Old rows with `before` and `after` still render.
- **Exception:** `reservation.updated` still stores `{ before, after }` for the fields that changed (a money record). The timeline and `activity.js` read `d.fields` first, then the keys of `d.after`, so the screen shows field names only. `cleaning.task_updated` reads the same way.
- **`PATCH /api/unit-owners/:id`, `POST /api/unit-owners`:** on a percentage fee model (anything but flat), a blank `management_fee_pct` sent is refused (400, `management_fee_pct`: "Management fee is required."). An add that leaves the field out entirely takes the 20% default. A flat-fee owner has no percentage.
- **`GET /api/unit-owners`:** a `unit_id` that is not in the workspace is ignored (the list is not filtered). The `sort` word must be one of the route's own keys.
- **`GET /api/reservations/quote`** (the price quote): the room-type form takes `property_id` and `room_type` instead of `unit_id` and quotes the listing a reservation would take now (free and not on a lease); the answer adds `unit_id` and `unit_name`. With none free: 409 `NO_FREE_ROOM`.
- **Quotes (`POST /api/quotes`):** `num_guests` above the listing's `max_guests` is refused (400, `num_guests`: "This listing allows up to N guests.").
- **Ignored ids:** `/reviews` (unit, property), `/unit-owners` (unit) and `/inbox` (`assigned`, unit, property) ignore ids outside the workspace and return the unfiltered list. Money, tenants, maintenance, stays and damage lists answer an empty list to a direct request with such an id; the pages never send one.
- **Sort and view words (`src/lib/pick.js`, `own(obj, key)`):** `sort`, `view`, `occupancy`, `segment` and `channel` words are looked up on the allow-list's own keys only, so `constructor` and `__proto__` are unknown words (default order), not a 500. Applied across owners, housekeeping, maintenance, money (three lists), inbox, admin, tenants, properties, stays (two), deposits, guestcare, support and stay reports.
- **`GET /api/stay-reports`:** a `from` or `to` that is given but is not a real date answers 400 on that field, instead of falling back to this month. (The year-only fallback is unchanged.)
- **Expenses:** no response (`POST`, `GET`, `PATCH`) carries `idempotency_key`, for any role.
- **Dates (`src/lib/validate.js`):** a `date` field must be between 2000-01-01 and 2100-12-31 ("... must be between 2000 and 2100."). `isValidDate`, used by report and list filters, still accepts years 1900 to 2200 (known, to tighten in a later round).
- **A listing's public page address (`public_slug`, `checkSlugFormat` in `properties.js`):** must match `^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$` (3 to 60 characters, starting and ending with a letter or number). The field message still reads "Use 3 to 60 lowercase letters, numbers or hyphens."
- **Plan limit (`checkListingLimit` in `properties.js`, run when a listing with a nightly rate is added or given one):** answers 402 `PLAN_LIMIT` with the number for the owner; any other role reads "Your plan's listing limit is reached. Ask the workspace owner to upgrade."
- **`POST /api/cleaning-tasks/:id/supplies`:** owners and managers are asked first. A `used` item with nothing on hand is refused on the row key `qty-<supply id>` ("Nothing on hand. Restock it first."); a use above what is on hand is refused unless the item sets `record_on_hand: true` (bool; label "Record what is on hand"). Staff and cleaners are unchanged: an out-of-stock item is skipped and named in `skipped`. The Supplies page's own movement route (`POST /api/supplies/:id/movements`) keeps its cap.
- **`POST /api/units/:id/damage`:** owners and managers only (staff 403).
- **Deposit receipt answer** (the `to` field after returning a deposit): the guest's email address for owners and managers; everyone else gets "the guest".
- **`PUT /api/cleaner-rates` and cleaning-task create or edit:** the refusal for a typed name equal to a team member no longer repeats the name and says how to add the person to the property.
- **Cleaning tasks:** owners and managers can change `notes` with `PATCH /api/cleaning-tasks/:id`; the activity row names the field.
- **Sign-up, Get started:** nothing server-side changed for the saved answers; they live in the browser (`bh-setup`, with the email and a save time) and the server never receives them until the person presses Create. Signing out, "Use a different account" and opening setup as someone who already has a workspace clear them (client behaviour in `auth.js`).
- **Not exercised locally (live stage):** PayMongo checkout and return, expired quote, booking-done success, owner portal with a real link, 4-star public review links, door-code card, iCal overlap on daily close, assistant answers, the recurring maintenance scheduler run.

## 15. API notes from QA round 9 (2026-10-14)

- **The guest balance (D-85):** `total_amount - channel_fee - payments + refunds`. The channel fee counts only on a booking whose channel is not `direct`; payments and refunds count only when not voided. It is written once in `src/lib/balance.js` (`FEE`, `PAID`, `REFUNDED`, `BALANCE`, as SQL snippets for a booking aliased `b`) and used by stays, the pay link (`balancepay`), receipts, the daily close, messaging, the assistant, the inbox, money and reports. Do not write the formula again anywhere. A negative balance means the guest is still overpaid after refunds. A receipt's `balance_after` counts every non-voided refund on the stay, including one recorded after that payment (carried to round 10).
- **Peso text:** all server text with an amount goes through `fmtPeso` in `src/lib/messaging.js` (₱1,500.50, two decimals). `GET /stay` pages use it for the "From" price.
- **Reservation CSV** has a **Refunded** column.
- **`source` on `POST /reservations` and `PATCH /reservations/:id`:** direct bookings only; the value must be on the D-61 list without `quote`. A source on a channel booking: 400 "Only direct bookings have a source." An unknown source: 400 "Choose where they booked from the list." There is no `walk_in` value. Staff don't receive `source` (access table).
- **Automations:** `POST` and `PATCH /inbox/automations` refuse a name already used by another automation in the workspace (case and end spaces ignored): 400 with `fields.name`. The check is not atomic yet (a unique index is a deferred item: live data may already hold duplicates, as with add-on names). New automations are created with `enabled = false` from the form.
- **Unit owners:** assigning units that belong to another owner returns 409 `UNIT_HAS_OWNER` with `units` (unit and current owner names). Sending `move_units: true` moves them. The management fee has no default in the form.
- **Check-in (`POST` and `PATCH` of the guest form):** a blank guest name returns 400 at `fields.guests`: "Enter the name of each guest, or remove the empty row." The host note appends `, booked for N` when `guests.length + 1 < num_guests`.
- **Rent:** `GET /rent/leases` returns `oldest_unpaid_period` per lease (the month a payment reaches first) and `partial_count` counts every month with some money applied and a balance left (`amount_applied > 0 AND balance > 0`), overdue or not.
- **Cleaner pay:** `pay_status` is `unpaid`, `paid` or `self`. `self` is computed, never stored: an unpaid clean with no `pay_amount`, done by the owner, with no rate for the owner. `no_rate` is returned on the manager's `GET` only (cleaners and staff don't get it). `mark-paid` on a `self` row is refused (`NO_PAY_AMOUNT`). *Fixed in round 10: `status=unpaid` no longer returns `self` rows.*
- **Onboarding (`GET /onboarding`):** the `channels` step is done only when an iCal feed has `last_status = 'ok'`; `channels_failing` is true when feeds exist but none synced. `guest_info` is done when check-in instructions, Wi-Fi or house rules exist on any listing.
- **Discount codes:** `POST` and `PATCH /discount-codes` refuse a code containing whitespace (400 at `fields.code`: "Codes can't contain spaces. Try QA-R9-BAD."). The public guest check still forgives a space.
- **Direct booking and pay link:** a PayMongo failure returns 502 `PAYMENT_FAILED` with the neutral sentence "Online payment isn't available right now. Please try again in a few minutes, or contact the host."; the provider's own reason goes to the server log only.
- **`booking_group.updated`:** renaming or editing a group writes one activity row (record type `booking_group`), shown on each room's timeline.
- **Cleaning checklist audit:** an edit records `{ fields: ['items'] }`, shown as "Changed: Checklist items".
- **Refund suggestion and cap:** unchanged (never more than was paid); the app asks before a refund that would leave money owed on a live stay.

## 16. API notes from QA round 10 (2026-10-15)

- **Leases over stays:** `POST /leases`, and `PATCH /leases/:id` when the end date moves later or is cleared, answer 409 `LEASE_OVER_STAYS` when a booking on that unit that is not cancelled overlaps the lease. The body has `error` (the message naming up to 5 stays and "and N more", and the first day the lease could start) and `stays` (`confirmation_code`, `check_in`, `check_out`). Nothing is written. The check is `stayClashes` in `src/lib/leases.js`. Known gap: the check and the write are not locked together (a lease and a stay created at the same instant could both pass), carried to round 11. *Closed 2026-10-15 (D-87): lease create and edit, reservation create and edit, lock the unit row `FOR UPDATE` and re-check inside the transaction.*
- **Lost and found:** `POST /api/lost-found` with `{ unit_id, description, found_where, found_on }`. Owners and managers only (staff and cleaners 403). The unit goes through the scoped loader (another workspace's unit, or a property the manager isn't assigned to: 404). The item has no booking or task, and the audit action is `lost_found.reported`.
- **Pay link bill:** `GET /public/pay/:token` bill gains `refunds` (`amount`, `refund_date` only; non-voided, oldest first) and `refunded`. The top-level `paid` is net of refunds; `bill.paid` is the gross payments. No refund reason and no recorded-by name is sent.
- **Pay checkout failures:** no online payment accepted for the booking is 409 `NOT_ACCEPTING` ("Online payment is not available for this booking. Please contact your host."). An unreadable PayMongo key, or PayMongo failing, is 502 `PAYMENT_FAILED` with "Online payment isn't available right now. Please try again in a few minutes, or contact the host."; the real reason goes to the server log only.
- **Receipts:** `balance_after` counts payments and refunds recorded up to and including that payment (by date, then creation time); later refunds are left out. (The round 9 carry item, now done.) The balance rule in `src/lib/balance.js` is unchanged.
- **Cleaner pay:** `pay_status` is worked out before the `status` filter, so `status=unpaid` excludes `self` rows. The groups in the answer gain a `self` count. `PUT /cleaner-rates` messages: both blank "Choose a team member or type a name for an outside cleaner."; both filled "Pick a team member or type a name, not both."
- **Daily close:** for a day before today the damage section is "Damage reports still open": reports opened on or before that Manila day and still open now. Known gap: cleanings, arrivals and departures on a past day still use their current status (round 11). *Closed 2026-10-15 (D-87): arrivals, departures and cleanings on a past day now use their state at the end of that day (section 17).*
- **Recurring maintenance:** a `next_due` outside the window is 400 with `fields.next_due` "Pick a date between Oct 15, 2025 and Oct 15, 2031." (readable dates).
- **Messages:** `{{property_address}}` leaves out the city or province when the address already names it as a whole word.

## 17. API notes from QA round 11 (2026-10-15)

- **Reopen a day:** `POST /api/daily-close/reopen` with `{ date }`. Owner: any close. Manager: only a close whose `property_ids` is not empty and all assigned to them (the same rule as updating a close); a whole-workspace close, or one with a property they don't manage, is 409 `ALREADY_CLOSED`. No close on that date: 404 `NOT_FOUND` ("This day is not closed."). Staff and cleaners 403. The row is deleted and the answer is `{ closed: null }`. The audit row `daily_close.reopened` keeps `date`, `counts`, the old `note`, `closed_by`, `closed_at`, `property_ids` and the whole `summary`.
- **Past-day checklist:** for a date before Manila today, arrivals are stays with `check_in = date` not checked in by the end of that day and not cancelled by then; departures the same with `check_out`; cleanings due on or before the date that were not done by the end of that day (cancelled tasks left out). Today and later are unchanged.
- **Booking page gate:** `PATCH /api/direct-booking` with `enabled: true` is 409 `NO_LISTING` ("Tick at least one listing for your booking page first.") when the workspace has no active unit that is `bookable_online`, has a nightly rate, and sits in an active property. It is checked after the PayMongo check. Nothing is written. Turning off is never refused.
- **Cleaner rates:** `PUT /cleaner-rates` refuses `per_clean` above 10000.00 and `per_hour` above 1000.00 at `amount` ("That's more than ₱10,000.00 per clean. Check for an extra zero." / "…₱1,000.00 per hour…"), compared in centavos. `PATCH /cleaning-tasks/:id` refuses a `pay_amount` above 10000.00 at `pay_amount` the same way. Rates saved earlier are not changed, and the pay worked out when a clean is marked done is not capped (founder questions).
- **Supplies:** a movement quantity of a use or restock below 1 is 400 at `quantity` "Enter a quantity of at least 1."; `count` may be 0; below 0 is "Quantity must be at least 0." `POST /cleaning-tasks/:id/supplies` answers `{ supplies, skipped, short }`. `short` is `[{ name, unit_label, asked, recorded }]` for each used item from a cleaner or staff member that asked for more than was on hand (the quantity is clamped to `recorded`). Owners and managers never get `short` (they are asked first).
- **Lease rent on a property:** `GET /properties/:id` units gain `lease_rent` (the active lease's monthly rent, null when there is no active lease), `units[].lease_rent`. It goes to owners, managers and staff on their assigned properties (as section 6 already allows staff to see lease rent); cleaners are blocked from the route.
- **Stay quote dates:** `GET /reservations/quote` validates `check_in` and `check_out` with the `date` type (2000 to 2100), so 1900 is a 400 at `check_in`.
- **Validator:** `validate(body, spec, { partial, check })`: `check(out, fields)` runs after the per-field pass and returns null or `{ field: message }`; each message is added only for a field that has no message yet, so one 400 carries every problem. `int` rules accept `message`, used instead of the "whole number" and "at least" texts. `POST` and `PATCH /reservations` pass the check-out-after-check-in rule through it, so a bad date order and a negative total are reported together. `POST /quotes` guests: "Enter a whole number of guests, 1 or more."
- **Locks:** `POST /reservations`, and `PATCH /reservations/:id` when dates or unit change, lock the `units` row `FOR UPDATE` and re-run `assertStayAllowed` inside the transaction. `POST /leases` and `PATCH /leases/:id` lock the unit row before `stayClashes`. Closes the round 10 note in section 16.
- **Public guest limit order:** the public quote and checkout check `min: 1` first, then the listing's own limit ("This place allows up to 4 guests."), then 50 only when the listing has no limit ("Guests must be at most 50.").
- **Receipt:** when `balance_after` is below 0 the receipt email line is "Overpaid by: ₱800.00" (the page shows "Overpaid by" and the amount); otherwise "Remaining balance". Nothing is clamped to 0. `balance_after` itself is unchanged.

## 18. API notes from QA round 12 (2026-10-15)

Decision D-88. Servers changed only where listed; the list pages' habit of always sending their default is a client rule.

- **Stay quote clash:** `GET /api/reservations/quote` accepts `exclude_booking_id` (a booking id; the stay being edited is left out of the clash check, and only the chosen listing's stays are checked, so an id from anywhere else changes nothing). The answer gains `clash`: `null`, or `{ code: 'DATES_TAKEN', message }`. The message is the same sentence `PATCH /reservations/:id` gives (a lease is checked first, then an overlapping stay or block). The screen shows it at Check-out, before the price question.
- **Public quote price rules:** the public quote (`GET /api/public/book/:slug/units/:unitId/quote`) gains `price_rules`, a list of labels, each once, in the order they first apply across the nights: "Booked-early price", "Last-minute price", "Gap-night price", "Weekend price", "Holiday price", "Seasonal price". The booking summary prints them as "Includes: Booked-early price."
- **Daily close:** `GET /api/daily-close` `closed` gains `can_change` (an owner: always; a manager: only when the close covers properties and every one of them is theirs, the same rule the reopen and update refusals use) and `whole_workspace` (true when the close covers every property). Reopen and Update are hidden when `can_change` is false, with a line explaining why; the line's wording depends on `whole_workspace`. A date outside 2000 to 2100 is "That date isn't valid."
- **Tasks:** `done_by_viewer` on every task (section 6.1a).
- **Owner statement:** `GET /api/unit-owners/:id/statement` gains `portal_enabled` (true when the owner's portal is on). The Publish dialog uses it and no longer asks `GET /api/unit-owners` for the same fact.
- **Properties for staff:** `GET /api/properties` and `/api/properties/:id` omit `admin_email`, `gatepass_enabled`, `gatepass_days_before`, `gatepass_attach_ids`, `gatepass_authorized_by` and `gatepass_notes` for staff (section 6, Gate passes). Units are unchanged. *Closes the round 4 question "Staff and property money details" for these fields.* Staff see `deposit_pct` and `cancellation_policy` on units (section 6).
- **Inbox templates and automatic messages:**
  - `POST /api/message-templates/:id/archive` (the app's "delete") is 409 `IN_USE` when any automatic message uses it, on or off: "This template is used by the automatic message \"<name>\". Choose another template for it, or remove it, first."
  - Turning an automatic message on while its template is deleted is 409 `TEMPLATE_DELETED`: "This automatic message's template was deleted. Choose a template first." A `template_id` that points at a deleted template is a 400 at `template_id`.
  - `GET /api/automations` rows gain `template_archived`, and come back in a fixed order: `created_at`, trigger order, `name`, `automation_id` (before this, messages created at the same instant came back in a random order).
  - Snoozed conversations are left out of the Mine, Upcoming and Hosting views until they wake.
  - *Closed in round 13 (section 19): both paths now lock the template row.* *Known gap, carried to round 13:* archiving a template and moving an automatic message onto it at the same instant can leave the message on an archived template. Both paths need to lock the template row.
- **Lease end date:** `PATCH /api/leases/:id` with any `end_date` caps the unpaid move-in charge's due date at the end date, the same as the end-lease handler does. The full month is still billed. Ending a lease early also moves the due date.
- **List defaults (client rule):** every list page sends its default filter to the server (the `apiFilters` helper in `public/js/filters.js`), so "All unpaid" on Rent means unpaid only. The servers did not change.
- **Cleaner job supplies:** the job-route message for a quantity below 1 stays the generic one (D-87); the carry list has the clearer wording.

## 19. API notes from QA round 13 (2026-10-15)

Decision D-89. No table, column or access-matrix change. The role x data matrix in section 6 is unchanged.

- **`POST /api/pricing/seasons`:** an identical season is refused: 409 `DUPLICATE`, message and `fields.name` both "You already saved this season." Identical means the same workspace, the same listing (both empty counts as the same), the same name ignoring capitals and spaces at the ends, and the same dates, nightly price, percentage change and minimum stay (empty values compared as equal). Nothing is written. A different price or dates, or the same name on another listing, saves as before.
  - *Known gap (info from the round 13 security review):* two identical seasons sent at the same instant can both insert, because the check has no lock and there is no unique index. Low; a unique index migration would close it (BLOCKERS round 13).
- **`POST /api/unit-owners`, `PATCH /api/unit-owners/:id`:** a non-empty email equal (ignoring capitals and spaces at the ends) to another **active** owner's email in the same workspace is 409 `EMAIL_IN_USE` ("This email already belongs to <their name>."), with `fields.email` and `data.owner_name`, unless the body has `confirm_duplicate_email: true`. On a PATCH it is checked only when the email changes. Archived owners, owners of other workspaces and the owner's own row never count. The view asks "Save anyway?" and resends with the flag.
- **`PUT /api/cleaner-rates`:** when the typed name matches a saved rate ignoring capitals, the saved spelling is kept and returned (the amount is updated). The ceilings (₱10,000.00 per clean, ₱1,000.00 per hour) are unchanged; the screen now checks them before the "Change this rate?" question, using the server's own sentence.
- **Message templates and automatic messages (inbox):**
  - Archiving a template (`POST /api/message-templates/:id/archive`) and moving or turning on an automatic message (`PATCH /api/automations/:id`) both run in one transaction that locks the template row (`FOR UPDATE`). *Closes the round 12 known gap:* a template can no longer be archived at the same instant an automatic message moves onto it.
  - The 409 `MAIL_OFF` answer (turning on an email message while the server has no mail) now reads in plain words for a host and no longer names server files.
  - Changing the guest language rewrites a built-in template's wording only when the host never edited it, and keeps a name the host gave it (stock names, English and Taglish, are the only ones renamed).
- **Profit and loss (`src/lib/pnl.js`, `src/routes/stayreports.js`):** expenses with no unit are labelled "Whole-property expenses" in the P&L answer, its CSV and the Reports performance CSV (the old "Not linked to a unit" and "Building-level expenses" labels are gone). Still left out of the owner portal. A month sent empty is the client's job: the screen refills it with the current Manila month.
- **Gate pass (public, by token):** unchanged on the server; one guest is shown without a number in the view.
- **Client-only rules this round (no server change):** the "Save anyway?" questions for a season's fixed price, an add-on price and a booking total above ₱50,000 a night (`highStayTotalOk`, `highAddonPriceOk` in `rates.js`); the deposit deduction check before the early-return question (`deductionProblem`).

---

## 20. API notes from QA round 14 (2026-10-15)

Decisions D-91 and D-92. Two migrations (033 top bar, 034 PayMongo key check, section 2.17). The access rules for the top bar are in section 6.4; the role x data matrix elsewhere is unchanged.

**Top bar endpoints**
- **`GET /api/search?q=`:** `q` is trimmed, spaces collapsed and cut to 80 characters. Under 2 characters answers `{ q, groups: [] }` with no database call. Answers `{ q, groups: [{ key, label, items: [{ id, title, sub, href }] }] }`, up to 5 items per group, empty groups left out. Matching is a case-insensitive "contains" with the wildcard characters escaped. Reservations sort exact confirmation code first, then names that start with the text, then nearest check-in date. **60 searches a minute per person (429 `RATE_LIMITED`, counted in memory per process).** A cleaner gets 403 `CLEANER_FORBIDDEN` from the existing cleaner guard.
- **`GET /api/account/bookmarks`:** `{ bookmarks: [{ bookmark_id, path, label, created_at }] }`, oldest first.
- **`POST /api/account/bookmarks`** `{ path, label }`: 201 for a new bookmark, 200 when the page was already saved (label updated). 400 `VALIDATION` with `fields.path` ("This page can't be bookmarked.") or `fields.label`. **409 `BOOKMARK_LIMIT`** at 20 ("You can keep up to 20 bookmarks. Remove one to add another."); re-saving a page already in the list is allowed at the limit.
- **`POST /api/account/bookmarks/:id/remove`:** `{ ok: true }`, or 404 when the id is not the person's own. (No DELETE or PUT is used; every write is a POST.)
- **`GET /api/account/notifications?category=&before=&limit=`:** `category` is `all` (default) or `reservations`, `payments`, `cleaning`, `messages`, `owners`; `limit` 1 to 50 (default 30); `before` is the `next_before` of the last page. Answers `{ items: [{ id, type, category, title, body, url, read, created_at }], unread, categories, next_before }`, where `categories` lists only the filters this person can have. 400 `VALIDATION` for a bad category or limit.
- **`GET /api/account/notifications/count`:** `{ unread }`.
- **`POST /api/account/notifications/read`:** exactly one of `{ ids: [up to 100] }`, `{ all: true }` or `{ category }`; anything else is 400 `VALIDATION`. Answers `{ unread }`.
- **Where alerts come from:** `push.notify` now also writes a `notifications` row for each person who would get the phone alert (same property scope). Unit owner blocks and cancellations in the owner portal write the new `owner_activity` alert. Rows are deleted after 90 days by the daily `notifications-cleanup` job.

**PayMongo key check (`src/routes/directbooking.js`, `src/lib/paymongo.js`)**
- **`GET /api/direct-booking`** adds `paymongo_checked` (true when `organizations.paymongo_key_checked_at` is set), next to the existing `paymongo_connected` and `paymongo_key_hint`.
- **`PATCH /api/direct-booking`, saving a key:** the server asks PayMongo whether the key works. Refused (401 from PayMongo): 400 `VALIDATION` on `paymongo_secret_key` ("PayMongo didn't accept this key…") and **nothing is saved**. Accepted: saved and `paymongo_key_checked_at` set. PayMongo cannot be reached (timeout or any other answer): the key is saved with `paymongo_key_checked_at` empty.
- **`PATCH /api/direct-booking`, turning the page on:** with a saved key that is not yet checked, the server checks again. Refused: **409 `PAYMONGO_REJECTED`** ("PayMongo didn't accept your saved key. Change the key before turning on your booking page."). Still unreachable: **409 `PAYMONGO_UNCHECKED`** unless the body has `confirm_unchecked_key: true`, in which case it turns on. `disconnect_paymongo: true` clears the check.
- **Guest checkout:** when PayMongo refuses the host's key as unauthorised while creating a checkout, `paymongo_key_checked_at` is cleared again.
- With `PAYMONGO_KEY_CHECK=off` (always the case in tests) no call is made: a saved key is "unchecked" and turning the page on needs no confirmation.

**Check-in, owners, bookings**
- **`POST /api/public/checkin/:token`:** a registration with no stored ID photo must send `id_photos` of at least 1; otherwise the one-pass 400 includes `fields.id_photos` ("Add a photo of a valid ID for at least one guest."). A guest who already has a stored photo can edit without sending another. *Known gap:* the server trusts the count the page sends (the files go up in a second request); it does not yet check that a stored file exists.
- **`POST /api/unit-owners`, `PATCH /api/unit-owners/:id`:** an email equal to the login of an active member of the same workspace (the owner included) is 409 `EMAIL_IS_LOGIN` with `fields.email` and `login_name`, unless the body has `confirm_login_email: true`. It works like `EMAIL_IN_USE` (section 19); on a PATCH it is checked only when the email changes.
- **Reservations:** the guest limit of the listing is checked before the overall cap of 50 guests (POST, PATCH, and the stay check); a refund needs a chosen method and an amount above zero (the same sentences the server already used).
- **Workspace export** leaves out `notifications` and `bookmarks`.

**Client-only rules this round (no server change):** the booking page summary's "Pay now" line (`dueNow` in `book.js`; the server already charged the right amount); the scroll keeper and focus guard changes in `ui.js`; the Listings filter bar sizes; the Reports redirect for short-term workspaces; the 44px phone rules; the `?new=` and `?invite=1` openers.

## 21. API notes from QA round 15 (2026-10-15)

Decisions D-94 (plan coupons) and D-95 (round 15 calls). Two migrations (035 coupons, 036 check-in drafts; section 2.18). Access rules for coupons are in the section 6 matrix; the cleaner supplies rows are in 6.1.

**Owner coupon endpoints (`src/routes/billing.js`, owners only; paths under `/billing/` stay open in a read-only workspace)**
- **`POST /api/billing/coupon/preview`** `{ code?, plan, months }`: read-only (nothing is reserved). 200 `{ coupon, plan, months, list_amount, discount_amount, amount, covered_months, free, card_only, min_charge_applied, message }`; `coupon` is null when there is nothing to apply (for example a used-up coupon, with the message "Your coupon's 3 months are used. This payment is the full price."). `code` may be left out when the workspace already has a live redemption. **Check order: online billing on (409 `BILLING_OFF`) first**, then the code and plan, then the 45-day rule.
- **`POST /api/billing/checkout`** now takes optional `coupon_code`. Paid: 200 `{ billing_id, checkout_url }`. Free activation: 200 `{ billing_id, activated: true, plan, paid_until }`. The checkout sends PayMongo one line item in whole centavos (`list - discount`, raised to ₱20 if above 0 and under it) and `payment_method_types: ['card']` only when the coupon requires a card.
- **`GET /api/billing`** adds `coupon: null | { code, name, kind, percent_off, amount_off, duration, duration_months, months_left, plans, require_card, status }` (the latest non-released redemption; `months_left` null = forever) and each history row adds `list_amount`, `discount_amount`, `provider`, `coupon_code`, `coupon_months`.
- **Errors:** 400 `VALIDATION` (plan, months, or a code with characters other than letters, digits and dashes); 400 `COUPON_INVALID` (one generic answer for unknown, off, not started, ended and full: "This code isn't valid right now. Check it and try again."); 409 `COUPON_PLAN` (lists the plans it covers), `COUPON_USED`, `COUPON_OTHER`, `COMPED` (a complimentary workspace), `BILLING_OFF`, `CARD_OFF` (a card-only coupon while `card` is not in `PAYMONGO_METHODS`), **`COUPON_AHEAD`** (a discounted checkout while `paid_until` is more than 45 days after today in Manila: "Your plan is already paid ahead. Your coupon applies at your next renewal."; the preview and checkout share one helper, `couponAheadError`); 429 `RATE_LIMITED`; 403 for non-owners; **403 `DEMO_READ_ONLY` in the demo**.
- **Rate limits:** failed code checks only count, **10 per workspace and 60 per IP, per 15 minutes** (the IP cap was 20 until D-96), on both preview and checkout. When the window is full, valid codes are refused too until it passes (accepted; BLOCKERS). The existing checkout limit (15 per hour per workspace) stays.
- A failed checkout (no checkout URL from PayMongo, or an error on the free path) marks the row `failed` and releases the redemption slot at once. A payment confirmed against a released redemption does not revive it.

**Platform admin coupon endpoints (`src/routes/admin.js`; anyone who is not a platform admin gets 404)**
- **`GET /api/admin/coupons?q=&state=&kind=&plan=&sort=`** → `{ coupons, total, summary: { active, scheduled, ended, off, full } }`. Each coupon adds `state`, `used` (active, used-up and recent pending redemptions) and `discount_total` (a string). A coupon with no plan limit shows under every plan filter. No paging yet.
- **`POST /api/admin/coupons`** → 201 `{ coupon }`; 400 `VALIDATION` with `fields`; 409 `CODE_TAKEN`. `starts_on`, `starts_time`, `ends_on`, `ends_time` are Manila time and stored as UTC.
- **`PATCH /api/admin/coupons/:id`** → 200 `{ coupon }`; 404; 409 `COUPON_LOCKED` once any non-released redemption exists (code, kind, amounts, length, plans and start are locked); 409 `CODE_TAKEN`; 400 `fields.max_redemptions` below the times used. The edit locks the coupon row, so it waits for a redemption in progress.
- **`GET /api/admin/coupons/:id/redemptions`** → `{ coupon, redemptions }` (newest first, up to 500): workspace name, owner email, status, months total and used, dates, `discount_total` and `payments`.

**Other round 15 server rules**
- **`GET /api/cleaning-tasks/:id/supplies`:** the job's property supplies, `{ supplies }`, same shape as the supplies list without money fields; only for people who may see the job. The cleaner allow-list (`src/lib/cleaner.js`) lists this route and no longer lists `GET /supplies`; **`GET /api/supplies` is owner, manager and staff only** (a cleaner gets 403). The web app's route guard sends a cleaner who types `#/supplies` to housekeeping.
- **`POST /api/public/checkin/:token`** and the ID upload: a registration is a draft (`submitted_at` NULL) until a file of type `registration` is stored; the first stored photo sets `submitted_at` and writes the one host alert and inbox note. The guest page and the host card say so (APP-FLOW 28). Gate pass `has_form` and the onboarding count read finished rows only.
- **`POST /api/ical-feeds`:** a link that does not look like a calendar gets 409 `ICAL_NOT_CALENDAR` ("This doesn't look like a calendar link (they usually end in .ics). Save it anyway?"), unless the body has `confirm_unusual_link: true`. A path or query containing `.ics` or `ical` passes.
- **`GET /api/search`:** each group now carries `total` (every match) and `more` (true when the group was cut at 5), so the screen can say "5 of 8 shown". Guest rows name the latest stay in `sub`.
- **`push.notify` with no property and no user** goes to owners only (bell row and phone alert), the same rule the bell applies when reading (section 6.4).
- **Review page (`GET /api/public/review/:token`)** returns the share links for 4 and 5 star reviewed stays; the quote page checks the phone number format. Settings → Direct booking: a key that is too long gets its own sentence, and a balance-payment checkout answered 401 by PayMongo clears `paymongo_key_checked_at` (the balance **refresh** route still swallows a 401; carried).
- **Payout and add-on rules** are client-side only (the Method starts on "Choose…"; an add-on quantity over its limit keeps the typed value and blocks Save).

## 22. API notes from QA round 16 (2026-10-15)

Decision D-97. No table or column changes and no migration.

- **Do not rebook by email.** `guest_do_not_rebook` on reservation reads (`BOOKING_SELECT` in `src/routes/stays.js`) is true when the guest's own record is flagged, or when another guest in the same workspace with the same email (trimmed, case-insensitive) is flagged. Online direct bookings (`src/routes/directbooking.js`) use the same rule for the Inbox note and the push. Staff are still redacted (no flag). Group bookings (`POST /booking-groups`) do not use the rule yet (carried). The flag is workspace-wide, see the footnote under the section 6 matrix.
- **`GET /api/reservations/:id/checkin`** adds `num_guests` (the booked count). The public gate-pass answer adds `registered` (the count the guest registered).
- **`POST /api/unit-owners` and `PATCH /api/unit-owners/:id`:** 409 `NAME_IN_USE` (with `owner_name`) when an active owner has the same name (trimmed, case-insensitive); resend with `confirm_duplicate_name: true` to save. A management fee percentage over 50% asks first in the screen. There is no database guard on the name, so two saves at the same instant could both pass (carried).
- **Discount codes (guest-care discount routes):** a code with both a percent and an amount filled is refused with 400 and "Choose one: a percent off or an amount off, not both." on `percent_off`.
- **Push:** `push.notify` with no property reaches owners whatever their property filter. Managers and staff still get only rows for their properties.
- **`POST /api/public/pay/:token/refresh`:** a PayMongo 401 clears `organizations.paymongo_key_checked_at` only when the 401 came from the key currently saved (`paymongo_key_enc` matches the key the checkout used). The checkout-expire helper in `src/routes/balancepay.js` still swallows a 401 (carried).
- **Coupons:** the preview `message` for a free coupon with `require_card` ends " You pay ₱20.00 once by card." when the ₱20 floor applied. The banner in the owner coupon box builds from the coupon text plus its own card note, so the sentence is not shown twice. See `docs/contracts/platform-coupons.md`.

## 23. API notes from QA round 17 (2026-10-15)

Decisions D-98 and D-99. **Migrations:** 037 (card on file, section 2.19) and 038 (`booking_refunds.reason` limit 300 to 500). No other table or column changes. The card-on-file routes are in `docs/contracts/card-on-file.md`.

- **`GET /api/search`:** new groups `housekeeping` (Cleaning tasks), `supplies`, `expenses`, `discount_codes` (owner, manager) and `addons` (owner, manager); `maintenance` is labelled "Repair requests". Each group is scoped as its page is (cleaning tasks by `taskScope`; supplies and expenses by `propertyScope`; staff get no discount codes or add-ons; long-term owners get no supplies). Items never carry money, contact details or notes; an expense title is the vendor, then the category, never the description; voided expenses and archived supplies are not found.
- **`POST /api/booking-groups`:** answers `guest_do_not_rebook` and `guest_name`; a per-room 400 carries `room_index` (0-based position in `rooms`) so the screen can mark the right room.
- **Audit reasons:** `max 500` on reservation cancel, booking payment void, group room remove and group cancel, refund record and void, charge void, rent payment and expense void, payout and withdrawal void, proof reject. Answer: "Reason must be at most 500 characters." Deposit deduction reasons stay at 1,000 and block reasons at 200. The only database limit that was lower, `booking_refunds.reason`, moved to 500 in migration 038; the `void_reason` columns have no length CHECK.
- **`POST/PATCH /api/admin/coupons`:** 409 `AMOUNT_ABOVE_PLAN` (with `max_plan_price`) for a fixed amount above the highest plan price; resend with `confirm_high_amount: true` (not stored). `GET /api/admin/coupons` adds `summary.discount_total` over the whole list (it does not change with the Status filter). Code length: the message is "Codes are up to 32 characters."
- **`GET /api/admin/workspaces`** rows gain `card_check`, `card_brand`, `card_last4`; the status filter gains `card_pending`. `POST /api/admin/workspaces/:id/card-check` with `{ "action": "waive" }` (audit `platform.card_check_waived`; 409 when not waiting). `GET /api/public/plans` gains `card_check`.
- **Gate pass:** the guest count is `registered` whenever a registration exists, else the booked count; the text adds "(booked for N)" when they differ.
- **Balance pay:** closing a checkout whose key PayMongo refuses (401), or the scheduled balance check, clears `paymongo_key_checked_at` only when that checkout used the key still saved.
- **Role matrix:** the "Search" row of 6.4 lists the new groups per role.

## 24. API notes from QA round 18 (2026-10-19)

Decision D-100. **No migration** this round (no 039: a duplicate owner name is allowed after "Save anyway?", so no unique index). No table or column changes.

- **`POST /api/admin/workspaces/:id/delete`** (platform admin; anyone else 404) `{ mode: "schedule" | "now", confirm_name }`. The name is trimmed and compared exactly to the trimmed workspace name (400 `VALIDATION` on `confirm_name`). 409 `DEMO`, `OWN_WORKSPACE`, `PLATFORM_ADMIN_WORKSPACE` (any user of the workspace has an email in `PLATFORM_ADMIN_EMAILS`), `ALREADY_SCHEDULED`. `schedule` sets `organizations.deletion_scheduled_at = now() + 14 days` and emails the owner: 200 `{ ok, deletion_scheduled_at }`. `now` purges at once: 200 `{ ok, deleted: true }`; 502 `PURGE_FAILED` when the purge throws or reports it did not delete (a workspace already gone counts as done).
- **`POST /api/admin/workspaces/:id/restore`:** clears the date. 409 `NOT_SCHEDULED` when there is none. The owner's own cancel (`POST /api/workspace/delete/cancel`, Settings) works on any scheduled deletion, including one an admin set.
- **`GET /api/admin/workspaces`** rows carry `deletion_scheduled_at` (the table shows **Deleting**).
- **Audit rows with no workspace.** `schedule`, `restore` and `now` each write a platform row with `organization_id` NULL, `actor_user_id` the admin, `record_type` `organization`, `record_id` the workspace id, and details `{ workspace_id, workspace_name, mode }`: `platform.workspace_deletion_scheduled`, `platform.workspace_deletion_cancelled`, `platform.workspace_deleted`. Schedule and restore also write a row in the workspace's own log (`organization_id` set). The "now" row is written before the purge. Null-workspace rows are not shown in any workspace's audit list.
- **Purge order (`purgeOrganization(orgId, { scheduledOnly })` in `src/lib/account.js`):** (1) cancel the PayMongo subscription (failure: rethrow, nothing deleted, the scheduler retries); (2) transaction: `SELECT ... FOR UPDATE` on the `organizations` row (a second purge finds it gone); (3) with `scheduledOnly`, return `{ deleted: false, reason: 'not_due' }` unless `deletion_scheduled_at` is set and past, so a restored workspace is never purged; (4) delete all rows and collect the stored files; (5) commit, delete the files from disk, then detach the saved card and delete the PayMongo customer (best effort). Returns `{ deleted, reason? }` with reason `gone` or `not_due`. The nightly job calls it with `scheduledOnly: true`.
- **`GET /api/stay-reports/missing-fees?month=YYYY-MM[&property_id=]`** (new; owner and manager, `managers` guard; staff and cleaners get 403): `{ missing_fees: [{ channel, label, stays }] }` for confirmed non-direct reservations that check out in the month, up to today, with no channel fee (NULL or 0), within the caller's property scope. Profit and loss reads this. `GET /api/stay-reports` carries the same list as `missing_fees`, counted by check-in date. `month` that is not a real `YYYY-MM` answers 400 on `month`. Counts only, no money.
- **`src/lib/coupons.js`:** a sent code is looked up before the comped check (unknown or unusable: `COUPON_INVALID`; `COMPED` only for a usable code or no code). The limited-months preview `message` is "This payment covers N of your M coupon months." (M is `duration_months`, the total).
- **`DELETE /api/billing/card`:** `auto_renew` is set false in the database before the PayMongo subscription is cancelled; a repeat removal with no card writes no second `billing.card_removed` row.
- **`src/lib/cardcheck.js` `attach()`:** runs in a transaction that locks the `billing_payments` row first and the workspace row second, and requires `status = 'pending'`; otherwise it answers as not required. `start()` expires the earlier pending intent after a decline and creates one new intent.
- **Role matrix:** the platform admin row 6.4 gains the delete and restore routes above.

## 25. API notes from QA round 19 (2026-10-20)

Decision D-101. **No migration** this round.

- **`POST /api/reservations` and `POST /api/booking-groups`** return `guest_do_not_rebook_name` (on the group, at the top of the answer; on a reservation, inside `reservation`) for owners and managers only: the flagged guest record's full name (the booking's own guest if flagged, else the flagged guest with the same email), otherwise null. **For a manager the name is scoped by `guestScope`:** the flagged record's name only if that guest is in the manager's property scope, else the booking's own guest name (`guest_do_not_rebook` stays true). Owners always get the flagged record's name. Staff and cleaners never get it.
- **`POST /api/blocks`** overlap: 409 with the shared overlap sentence ("These dates overlap a block on ... on this listing." or the other stay's code and dates); field errors use `start_date` and `end_date`.
- **`src/lib/billing.js`:** `refreshIntent` returns `failed` (not `pending`) when PayMongo reports a failed payment (awaiting a new payment method with an error, cancelled, failed). A failed or expired row releases its coupon claim (back to usable, `months_used` unchanged) before the next charge is priced. `expirePending` re-reads the intent from PayMongo and expires the row and releases the coupon **only when PayMongo shows it dead**; a pending row still alive after 15 minutes keeps blocking with `PAYMENT_IN_PROGRESS` reading "We're still waiting for your bank to finish an earlier payment. Pay another way, or try again later." The 2-day reconcile uses `expirePending` too. `coupons.reclaim` (called from `markPaid`) takes the coupon back when a payment lands after a release; the use count may then exceed `max_redemptions`, because the money was already taken. **`GET /api/billing` returns `pending_payment`** (set while a one-tap payment is still waiting for the bank; the page uses it to show the waiting notice); the quote and the charge come from the same coupon check. `PAYMENT_IN_PROGRESS` reads "A payment is already in progress. Try again in N minutes." (N minutes message before 15 minutes) `trialEndsAt(org)` is `trial_ends_at`, else `created_at` plus `TRIAL_DAYS`; `trial_days_left` and the start of covered coupon months use it. Old trial workspaces with no `trial_ends_at` can show 0 days left without being made view-only (view-only needs a stored end date; see BLOCKERS).
- **`GET /api/stay-reports/missing-fees`** counts stays that checked out before today.
- **Notification devices (`src/lib/push.js`, `src/routes/push.js`):** the settings list is all 9 types for an owner, 8 for a manager (the seven stay alerts plus Cleaning tasks), the cleaning types for staff.
- **Purge, auto-renew start and card attach:** `purgeOrganization` locks the workspace's `billing_payments` rows before the workspace row; `startOne` also requires `auto_renew`, a saved card and no deletion scheduled; `markPassed` in client mode reads the workspace on the same client.
- **PayMongo key check (`src/routes/directbooking.js`):** a key with the right prefix but too short answers "This key is too short. Paste the full Secret key from PayMongo."

## 26. API notes from QA round 20 (2026-10-20)

Decision D-102. **Migration 039:** `billing_payments.card_brand` and `card_last4` (nullable text); no purge change (`billing_payments` is already purged).

- **One open plan payment per workspace (`src/lib/billing.js`, `src/routes/billing.js`).** A hosted checkout or one-tap request is refused while another plan payment is open. A hosted request while a one-tap intent is pending first cancels the intent at PayMongo and re-reads it, and proceeds only if it is dead; otherwise 409 `PAYMENT_IN_PROGRESS` ("A payment is still waiting for your bank. Finish it there, or try again later."). A one-tap request while a hosted row is pending: 409 "A payment is already open in another window. Finish it there, or try again later." A hosted request against an open hosted row expires that checkout session at PayMongo and proceeds only when it is dead. If the older payment turns out paid: 409 `PAYMENT_RECEIVED`. The final check runs under the workspace lock. *Round 21 to confirm:* the PayMongo cancel and checkout-session expire endpoint paths against the live API.
- **`GET /billing` returns a top-level `paid_until`** (the workspace's stored paid-until date). **`seen_paid_until` contract:** checkout and pay-with-saved-card accept an optional `seen_paid_until` in the body (the page echoes `paid_until`). If present and different from the stored `paid_until`: 409 `PAYMENT_RECEIVED`, no row, no PayMongo call. Absent: no check (API callers unaffected). Paying ahead from a fresh page (value equal) is allowed. `PAYMENT_RECEIVED` is also returned when the earlier payment is found paid during the check.
- **Declined card attach (`src/lib/cardcheck.js`) answers 402** on purpose (the same status as the card gate; deliberate since the card check work). Not a bug.
- **`GET /billing` history** returns each paid row's `card_brand` and `card_last4` from the row.
- **`POST /api/admin/coupons` and update:** when the body carries `limit_on: true`, a missing or blank `max_redemptions` is refused; bodies that omit `limit_on` behave as before. A taken code answers 409 `CODE_TAKEN` with `fields.code`. The code length (up to 32) is checked on save.
- **`GET /api/support/tickets`:** a cleaner gets their own tickets (the route already allowed it; the matrix now says so).

## 27. API notes from QA round 21 (2026-10-21)

Decision D-103. **No migration.**

- **`GET /api/account` `notifications_on`** (`src/routes/account.js`) is now true when the user has at least one row in `push_subscriptions` (it was true when `notify_prefs` was non-empty). The page narrows this to the current browser (service worker registration and subscription, permission granted). The saved `notify_prefs` choices are unchanged.
- **PayMongo intent status (`src/lib/billing.js`).** The "intent is dead" test accepts both `cancelled` and `canceled` (the exact spelling at PayMongo is unconfirmed, see BLOCKERS). When `expirePending` finds an intent still not dead after the cancel call, it logs one line, `[billing] intent for <id> still <status> after cancel` (billing id and status only, no secrets). The hosted checkout still goes ahead only when the older payment is dead (D-102 unchanged).

## 28. API notes from QA round 22 (2026-10-21)

Decision D-104. **No migration.**

- **Billing, plan change at payment (`markPaid` in `src/lib/billing.js`).** When the paid plan differs from the current one, the unused days (today to `paid_until`) are split. *Paid days* are the days inside a `billing_payments` row with `kind = 'plan'`, `status = 'paid'` and `amount > 0` (from `period_start` to `period_end`; overlapping rows count a day once; the ₱20 `card_check` rows never count). They convert at the price ratio: `floor(paidDays x old / new)`. *Free days* are every other unused day (free coupon rows with amount 0, and trial days). They never grow: `floor(freeDays x min(1, old / new))`, so day for day to a cheaper plan and fewer days to a dearer one. The sum is the bonus added after the new period. The pure helper `convertDays({ paidDays, freeDays, oldPrice, newPrice })` holds the maths. Unchanged: renewing the same plan early, paying during a trial, coupon months already used. No new column: the rule uses the existing `period_start`, `period_end`, `amount`, `kind` and `status`. Days bought with a partly discounted coupon still convert at list prices (BLOCKERS a).
- **`PAYMENT_IN_PROGRESS` (409)** is unchanged on the server; the Settings page now refreshes on it (D-104).

## 29. API notes from QA round 23 (2026-10-21)

Decision D-105. **No migration.**

- **Billing, plan change at payment (`markPaid` in `src/lib/billing.js`), paid days weighted by what was paid (BILL23).** Amends section 28. Each unused day (today to `paid_until`) that falls inside a `billing_payments` row with `kind = 'plan'`, `status = 'paid'` and `amount > 0` counts by the share actually paid: `min(1, amount / list_amount)`. Where payments overlap, the highest share wins for that day, and a day counts once. The paid value is the sum of those per-day shares and converts at the price ratio: `floor(paidValue x old / new)`. Days with no paid share are the free remainder; they move at most day for day: `floor(freeDays x min(1, old / new))`. The ₱20 `card_check` rows never count. A full-price payment has share 1, so its days convert as in section 28; a 50% coupon payment converts at half weight. The earlier note that days bought with a partly discounted coupon convert at list prices no longer applies. No new column. A server restart is needed to pick the change up.
- **`GET /api/account`, `workspace.members` is owner-only (section 6).** The Team line in My account is a member count; BACKEND-SCHEMA section 6 gives managers, staff and cleaners no access to Team data. The route adds `members` to `workspace` only when the signed-in user's role is `owner` and does not run the count for anyone else. The view shows the Team line only when `members` is present. The schema and the access matrix are unchanged; the code now matches them.
- **`POST /discount-codes` reports every field problem in one 400.** The space, format (3 to 20 letters, numbers or dashes after trimming and upper-casing), percent-or-amount, and date-order rules run inside `validate(body, spec, { check })`, so a code with a space and a percent of 0 answers `fields.code` and `fields.percent_off` together, with the same wording as before. Each rule runs only when its own inputs passed the spec. The 50-code limit (409) and the duplicate-code answer (`23505`) are unchanged and run after `validate`. There is no PATCH for discount codes today.
- **Field-type rules are also read on the device** (`public/js/ui.js`): money format, negative money, "greater than zero" on a money box marked `positive`, whole numbers with min and max, and the phone pattern `/^[+\d][\d\s()-]{6,19}$/`. They copy `src/lib/validate.js` and are never stricter than the server: every server route with a phone box uses the `phone` type. The server stays the authority.
- **Blank optional monthly rent is stored as 0.00** (`BLANK_TO_ZERO` in `src/routes/properties.js`); "greater than zero" applies only to a rent someone typed.

## 30. API notes from QA round 24 (2026-10-21)

Decision D-106. **No migration.**

- **Receipt data (`receiptData` in `src/lib/receipts.js`) is as of the payment.** See the receipt note in section 2.5. Charge lines are those that existed and were not voided when the payment was recorded; `extras_total` is their sum; `total_amount` is the booking total less today's extras plus that sum; `balance_after` uses that total. The payment and refund parts of the balance are unchanged.
- **Sessions (`sessions` table).** A session ends after `SESSION_IDLE_HOURS` (default 12) idle, or `SESSION_TTL_HOURS` (default 7 days), or by a sign-out action. There is no cap on sessions per person, so signing in on another device or lane does not end an earlier session. Saved QA lane states older than 12 hours must sign in again (SESSION24).
- **Field-type rules are also read on the device for dates** (`public/js/ui.js`): a date box's `min` and `max` are checked on the first Save. The server still refuses the same dates; the device only says it sooner.
- **`PATCH /api/push/settings`** refuses with 400 any known alert type the person cannot receive (stay types for a long-term workspace) and ignores keys that are not alert types. Nothing is stored either way.
- **Draft storage is browser-side only** (session storage); nothing about drafts reaches the database.
