# BalayHub: Backend Schema and Data Access (as built)

This document describes BalayHub's PostgreSQL schema as it stands after migrations `001`–`026` in `db/migrations/`, where uploaded files are stored, and who can see or change each kind of data. It was checked against the migrations and the route code in `src/routes/*.js` and `src/lib/*.js`. Anything not confirmed in the code is marked **unverified**.

Last updated: 2026-10-13

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
| created_at, last_seen_at, expires_at | timestamptz | Idle and absolute expiry are checked on each request |
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
| Pricing helpers | weekend_rate, holiday_rate (≥ 0), weekly_discount (0–50 %), monthly_discount (0–70 %) |
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
| accommodation_total, cleaning_fee, other_fees, channel_fee | numeric | All ≥ 0 |
| total_amount | numeric | **Generated**: accommodation + cleaning + other fees. Guest balance = total − channel_fee − non-voided payments |
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
| `booking_refunds` | booking_id, amount (> 0), refund_date, method, reference_number, reason (required), recorded_by, idempotency_key (unique per workspace), voided_at/by/reason | A record of money returned. The total of non-voided refunds can't exceed the non-voided payments. It doesn't change the balance. |
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
| consent_at, submitted_at, updated_at | timestamptz | |
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

**audit_logs**: audit_id (bigserial), organization_id, actor_user_id, action, record_type, record_id (text), details (jsonb), created_at. Indexed on `(organization_id, created_at DESC)`. Platform admin plan changes are written into the target workspace's log with the admin as the actor.

Phase 2 actions: `owner_portal.invited`, `owner_portal.disabled`, `owner_portal.block_created`, `owner_portal.block_cancelled` (portal actions have no team user; the owner is in `details.owner_id`), `unit_owner.statement_published`, `unit_owner.statement_unpublished`, `unit_owner.statement_sent`, `owner_payout.recorded`, `owner_payout.voided`, `owner_reserve.withdrawal_recorded`, `owner_reserve.withdrawal_voided`, and `owner_statements.reminder_sent` (the monthly reminder's once-per-month record, with `details.month`).

### 2.15 Billing (BalayHub plans)

**billing_payments**: a host paying BalayHub online.

| Column | Type | Notes |
|---|---|---|
| billing_id | uuid PK | |
| organization_id | uuid | |
| plan | text | `starter`, `growth` or `pro` |
| months | smallint | 1, 3 or 12 |
| amount | numeric | > 0 |
| status | text | `pending`, `paid`, `expired` or `failed` |
| provider | text | Default `paymongo` |
| checkout_id | text | Unique |
| checkout_url, payment_method, paid_at, period_start, period_end, last_checked_at, created_by, created_at | | |

Related columns: `organizations.plan`, `trial_ends_at`, `paid_until` and `plan_note`.

### 2.16 System

| Table | Purpose |
|---|---|
| schema_migrations | Migration file names already applied |
| mail_sync_state | IMAP poller position (section 2.6) |

---

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

### 3.2 ON DELETE behaviour

| Behaviour | Where |
|---|---|
| CASCADE | sessions, auth_tokens, consent_records, push_subscriptions and property_assignments when their **user** is deleted; messages when their conversation is deleted; automation_runs when their automation is deleted; seasons when their unit is deleted; support_messages and support_events when their ticket is deleted |
| SET NULL | bookings.ical_feed_id; automation_runs.message_id; units.owner_id; support_tickets.created_by and assigned_to; support_messages.author_id; support_events.actor_id |
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

**Roles.** `owner`, `manager` and `staff` are workspace roles (`users.role`). **Platform admin** is not a role: it is any verified user whose email is in `PLATFORM_ADMIN_EMAILS`, and it unlocks the `/api/admin/*` pages. A platform admin who is also in a workspace has that workspace's role there as well. The **guest via token link** column covers people without an account who hold a private link: the guest (check-in, pay, review, booking return links), the building admin (gate-pass link), and channels (iCal export link).

**Scope.** "Assigned" means only properties listed for that user in `property_assignments`, enforced in SQL by `propertyScope()`, `tenantScope()` or `guestScope()`. Records out of scope return 404. Owners always see the whole workspace. "Delete" means a real removal; most data is archived or voided instead (section 4.3).

**Read-only workspaces.** For an ended trial, an overdue plan, a workspace scheduled for deletion, or the demo, `planGuard` blocks every write for every role (except account, billing, support, push and assistant paths).

| Data area | Owner | Manager | Staff | Platform admin | Guest via token link |
|---|---|---|---|---|---|
| Workspace settings (name, type, guest language, cleaning checklist, onboarding) | View, edit | View basic info; can switch the built-in message templates' language | View basic info | View every workspace (owner name and email, counts, plan); edit plan, paid-until, trial end, note (not the demo) | Sees the host's name and language on guest pages |
| Team, invitations, property assignments | View, invite, change role and properties, revoke invite, remove member (revokes the account and signs it out) | None | None | Member count only | Invitee: view workspace name and role from the invite link |
| Own account (profile, password, devices, notification settings) | Own only | Own only | Own only | Own only | None |
| Properties | View, create, edit, archive and restore (all) | View, edit (assigned); no create or archive | View (assigned) | None | Property name and city on guest pages |
| Units and listings (including Wi-Fi password, instructions, photos) | View, create, edit, archive and restore | Same, assigned; upload, reorder and remove photos | View (assigned, includes Wi-Fi details); mark clean or dirty | None | Booking page: view bookable listings, photos and prices |
| Pricing (nightly rates, seasons) | View, edit; seasons for all listings | View, edit rates and per-listing seasons (assigned); no all-listings seasons | View (pricing page and calendar prices, assigned) | None | Price quotes on the booking page |
| Channel calendars (iCal feeds, export link) | View, add, sync, remove; rotate export link | Same (assigned) | None (sees channel count only) | None | Channels read the export feed (dates only, no names) |
| Reservations and blocks | View, create, edit, cancel; delete manual blocks | Same (assigned) | View (assigned; guest email, phone and notes removed); check in and out; CSV export | None | Booking page: create a reservation through paid checkout; view status and cancel a pending checkout via the return link |
| Guest profiles | View, create, edit (VIP, do-not-rebook) | View, create, edit (guests with stays in assigned properties, or no stays) | View names only (email, phone, notes and total spent removed) | None | None |
| Booking payments and receipts | View, record, void, email receipt | Same (assigned) | View, record (and email a receipt when recording); view printable receipt; no void | None | Pay link: view total, paid and balance; pay the balance online (creates a payment) |
| Security deposits | View, record, settle, undo a settlement; deposits report | View, record, settle; deposits report (assigned) | View per reservation, record, see deposits due (assigned); no settle | None | Receives the deposit emails |
| Guest check-in forms and ID photos | View form and IDs; replace link | Same (assigned) | No access to the form screen; ID files refused | None | Check-in link: submit and edit own form, upload IDs (never shown back); closes after check-out. Gate-pass link: see guest names, phone, plate, arrival time and **ID photos** until the day after check-out |
| Gate passes | Settings per property; view, send | Same (assigned) | None | None | Building admin: view the pass and acknowledge it; guest ID photos only when the property's "Include guest ID photos" setting is on |
| Guest inbox (conversations, messages, AI drafts) | View, send, schedule, cancel, retry, assign, archive, AI draft | Same (assigned) | None | None | Guests reply by email only |
| Message templates and automations | Templates: view, create, edit, archive. Automations: view, create, edit, remove | Templates: view and use only (owner-only edits since 2026-10-13, D-28). Automations: view only | None | None | None |
| Housekeeping (cleaning tasks) | View, create, edit, assign, cancel; edit default checklist | Same except the default checklist (assigned) | View (assigned); tick items; start, finish, reopen; attach photos; no create, edit or cancel | None | None |
| Guest reviews | View (all) | View (assigned) | View (assigned) | None | Review link: submit one review, from check-in until 60 days after check-out |
| Extra charges | View, add, void (with reason) | Same (assigned properties) | View only | None | See the lines on the pay page |
| Refunds | View, record, void (capped at amount paid) | Same (assigned properties) | View only | None | None |
| Payment proofs and proof files | View, confirm, reject | Same (assigned properties) | None | None | Submit a proof with one screenshot via the pay link, at most 5 pending; refused for cancelled, paid or ended stays |
| Manual payment settings | View, change | None | None | None | Sees the instructions on the pay page when enabled |
| Cancellation policy and deposit % (per listing) | View, change | Same (assigned properties) | None | None | Sees the policy and the deposit amount on the booking page |
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
| Support tickets | All of the workspace's tickets: view, create, reply, resolve, rate, attach files | Own tickets only | Own tickets only | All tickets: view, reply, internal notes, change status, assign, view attachments | None |
| Plan and billing payments | View; start and confirm checkout | Plan status only (via session) | Plan status only | Set plan and dates by hand | None |
| Audit log | View all entries (latest 200) | View own actions only | None | No viewer (plan changes are written into the workspace's log) | None |
| Workspace export and deletion | Export JSON; request and cancel deletion | None | None | None | None |
| Files (generic) | Follows the parent record's rule | Same, assigned | Same, assigned, except lease and guest ID files | Support attachments only | Guest IDs: upload only. Building admin: view guest IDs. Public listing photos |

---

### 6.1 Phase 3 access matrix (with the Cleaner column)

The cleaner role is denied by default in code (`cleanerGuard`, D-48). Any row not listed here is **No** for a cleaner. "Assigned" means the properties in `property_assignments`. Owners see the whole workspace.

| Data area | Owner | Manager | Staff | Cleaner |
|---|---|---|---|---|
| Cleaning jobs (list, detail, tick, start, done, reopen) | Full | Assigned; can cancel | Assigned | Own jobs and unassigned jobs in assigned properties. No cancel, no edit, no reassign. Guest first name only |
| Cleaning board and calendar | Full | Assigned | Assigned | Own and unassigned jobs only |
| Inspect a finished job | Yes | Yes (assigned) | No | No |
| Inspection results and cleaner scores | View | View (assigned) | No | Result on own jobs only; no scores |
| Damage reports: report | Yes | Yes | Yes (jobs and stays they can see) | Yes, on own jobs only |
| Damage reports: list and resolve (charge, deduct, waive) | Yes, with amounts | Yes (assigned) | No | No. Sees only reports it filed, with no amounts |
| Suggested deposit deduction | Yes | Yes | No | No |
| Lost and found: log | Yes | Yes | Yes (stays and jobs they can see) | Yes, on own jobs |
| Lost and found: list and status | Full | Assigned | No | Own items only |
| Cleaner rates | View, set, delete | No | No | No |
| Cleaner pay list and mark paid | View, mark paid, undo | View and mark paid (assigned); no undo | No | No |
| My pay | Own, as worker | Own, as worker | Own, as worker | Own pay only |
| Expenses made by mark paid | Yes | Yes (assigned) | No | No |
| Supplies: list | Full | Assigned | Assigned | Names and counts only (assigned). No costs exist |
| Supplies: add, edit, archive, count, restock | Yes | Yes (assigned) | No | No |
| Supplies: movement history (`GET /supplies/:id/movements`, last 20) | Yes | Yes (assigned) | No | No |
| Supplies: record used or restocked on a job | Yes | Yes | Yes (jobs they can see) | Yes, on own and unassigned jobs |
| Work orders (maintenance requests from a job) | Full | Assigned | As section 6 | Create only. Cannot read the Maintenance page or repair costs. No photos |
| Maintenance schedules | Full | Create, edit, pause (assigned) | No (403) | No |
| Files on cleaning records | Full | Assigned | Assigned | Own and unassigned jobs |
| Files on damage and lost-and-found records | Full | Assigned | Assigned | Only records they filed |
| Files on inspections | Full | Assigned | No | No |
| Guest phone, email and notes on lost items | Yes | Yes | No | No |
| Invite a cleaner (team) | Yes | No | No | No |
| Account, notifications, help and support | Own | Own | Own | Own |

### 6.2 Phase 4 access matrix (guests, quotes, add-ons, settings)

The cleaner role is denied by `cleanerGuard` (D-48) unless a route is on its allow-list. None of the Phase 4 routes are on that list, so cleaners get 403 on every one. "Assigned" means the properties the manager is assigned to, as in section 6.1.

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

| Data area | Owner | Manager | Staff | Cleaner | Public |
|---|---|---|---|---|---|
| Pricing rules: read | All | Workspace-wide rules, and rules for assigned listings | View (assigned) | No | No |
| Pricing rules and seasons for every listing: create, change, remove | Yes | No (403) | No | No | No |
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
| Sync health (`GET /sync-health`) and Home or Calendar warnings | Yes | Yes (assigned) | No (403) | No | No |

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
- Auth limits (`src/routes/auth.js`): sign-in and sign-up count failed attempts only (20 per IP and email, 60 per IP, per 15 minutes). Forgot-password and resend-verification: 5 per email address (or signed-in user), plus 30 per IP, per 15 minutes.
- **Shared rule `src/lib/leases.js`** (`leasedListings`): a unit with an active monthly lease over any of the requested nights can't be booked for a short stay. Used by manual reservations (create and move), room-type and group bookings, the public booking page (availability and checkout) and iCal import. A long-term-only workspace gets 409 `LONG_TERM_ONLY` on short stays.
