# Phase 4: Guest experience and direct booking (build spec)

Founder approved 2026-10-13 ("proceed to phase 4"). Source: `docs/research/00-SUMMARY.md` §4 Phase 4 (items 15–20). Read `CLAUDE.md` and `docs/specs/PHASE-3-OPERATIONS.md` (same conventions) first.

**In scope**
1. Digital guidebook per listing (English and Taglish), opened by the guest from a private link, with Wi-Fi and door code shown only around the stay.
2. House rules accepted on the booking page and the check-in form, with the time and the exact text recorded.
3. Paid add-ons (for example airport pickup, early check-in, extra bed, breakfast) on the booking page and before arrival on the guest's pay page.
4. Quotes: the host prepares a price for an inquiry (Facebook, Messenger, Viber), sends a link, and the guest accepts and pays online.
5. Share links per listing with a source tag ("from Facebook"), recorded on the booking and shown in reports.
6. Reviews: the private rating first; happy guests (4–5 stars) are then invited to post a public review on the host's own Google, Facebook or other pages. An automatic personal returning-guest code. One follow-up email when a guest starts a direct booking but doesn't pay.
7. Search-friendly listing pages with real web addresses, a sitemap and robots.txt.

**Out of scope:** any outside integration (no posting to Facebook, Google or OTAs), AI, SMS, guest accounts or logins, multi-unit cart.

## Shared decisions (record as D-57 to D-63)

- **D-57 Guidebook.** One guidebook per listing (`unit_guides`): arrival and directions, parking, building and gate notes, local tips, emergency contacts, plus the existing listing fields (Wi-Fi name and password, check-in instructions, house rules). Each text field has an English and an optional Taglish version (`*_tl`); the guest's language follows the workspace setting with a switch. Door code is a new secret, stored encrypted with `src/lib/secretbox.js`. Guests open it with a private per-booking link `#/guide/:token` (new `bookings.guide_token`, made on first use like `pay_token`). The link works from 14 days before check-in until 2 days after check-out, and only for confirmed stays. Wi-Fi password and door code are shown only from the day before check-in to check-out day (Manila time); outside that window the page says when they'll appear. Message variables: `{{guidebook_link}}` and `{{door_code}}` (same time window; otherwise "(shared the day before check-in)"). `{{wifi_password}}` follows the same window from now on.
- **D-58 House rules acceptance.** The listing's `house_rules` must be accepted (checkbox) on the booking page before paying and on the guest check-in form before submitting, if the listing has rules. Store `rules_accepted_at` and `rules_text` (the exact text accepted, ≤4000) on `direct_checkouts` and copy to the booking; the check-in form sets `bookings.rules_accepted_at`/`rules_text` if not already set. The reservation shows "House rules accepted on …" to owners and managers, with the accepted text.
- **D-59 Add-ons.** `listing_addons` per workspace, optionally limited to some listings: name (EN), name (TL, optional), description, price, pricing `per_stay` | `per_night` | `per_guest` | `per_guest_night`, max quantity (1–20), active, `on_booking_page`, `before_arrival`. On the booking page the guest picks add-ons; their total is added to what's paid (full) or included in the total (deposit = deposit % of accommodation only, add-ons are paid in full upfront together with the deposit). When the booking is created, each add-on becomes a Phase 1 `booking_charges` row with new category `addon` (so bills, receipts, balance, reports and owner statements include them). Before arrival (from booking until check-in day), the guest's pay page lists `before_arrival` add-ons; choosing one creates the charge and the guest pays through the existing balance payment. Add-ons are refunded like other money (Phase 1 refunds). No stock or capacity tracking.
- **D-60 Quotes.** Owners and managers create a quote: listing, dates, guests, guest name and contact (email or phone, optional), price (prefilled from the pricing engine, editable: accommodation, cleaning, add-ons, discount), payment (full or deposit as the listing allows), expiry (default 48 hours, max 14 days), a note. The quote gets a private link `#/quote/:token`. The dates are **not** held until the guest pays. The guest sees the quote, accepts the house rules, enters missing details and pays through the host's PayMongo exactly like a direct booking (same hold, same confirmation path); the confirmed booking gets `channel = 'direct'` and `source = 'quote'`. Quotes expire automatically; the host can cancel one; a paid quote shows the booking. Needs the host's PayMongo key (same as direct booking).
- **D-61 Sources and share links.** Allowed sources: `facebook`, `instagram`, `messenger`, `viber`, `tiktok`, `google`, `whatsapp`, `email`, `referral`, `quote`, `other`. Share links are the existing booking page links with `?src=<source>` (the booking page passes it to checkout). Stored on `direct_checkouts.source` and copied to `bookings.source`. Stay reports get a "by source" breakdown for direct bookings. No tracking cookies.
- **D-62 Reviews, returning guests, follow-up.**
  - After the private rating (unchanged), if the rating is 4 or 5 and the workspace has public review links set (`organizations.review_links` jsonb: up to 4 `{ label, url }`, https only), the thank-you page invites the guest to share on those pages. Ratings of 3 or less never see the links (they stay private and alert the host, as today).
  - Returning-guest code: when on (`organizations.returning_guest_pct` 1–50, null = off), each guest who checked out gets one personal single-use code (a `discount_codes` row, `returning_only`, `max_uses 1`, valid 12 months, `issued_to_booking_id`), created on first use of `{{returning_guest_code}}` in a message (e.g. the thank-you template). Without the setting the variable is empty.
  - Abandoned direct booking: when a checkout ends `expired` or `failed` and the same email has no confirmed booking or newer pending checkout at that host, send **one** plain email 2 hours later (setting `organizations.abandoned_followup` boolean, default false) with a link back to the listing with the same dates. Never more than one per checkout, never for demo or read-only workspaces. Stored as `direct_checkouts.followup_sent_at`.
- **D-63 Search-friendly pages.** Server-rendered HTML at `/stay/:slug` (host page) and `/stay/:slug/:unitSlug` (listing), only for workspaces with direct booking on and not read-only or demo. `units.public_slug` (unique per workspace, from the listing name, editable). Each page has a proper `<title>`, meta description, canonical link, Open Graph tags (first photo via the existing public photo URL), the listing's description, price from, max guests, location (city, province — never the street address), photos, house rules summary, cancellation policy, and a "Check dates and book" link to the SPA (`/#/book/:slug/:unitId`). Uses `/css/app.css` only (no inline styles or scripts, CSP stays strict). `GET /sitemap.xml` lists all such pages; `GET /robots.txt` allows `/stay/` and disallows `/api/` and the app. HTML-escape every value.

**General:** money NUMERIC (strings, centavos), audit every host write, validate with `src/lib/validate.js`, rate-limit every public route, guest-facing text in English and Taglish (`public/js/i18n.js` `extendTranslations`), tokens 24+ random bytes base64url, sentence case, colour tokens, light and dark.

## Database: migration `db/migrations/031_phase4_guests.sql` (Lane 0, first)

- `unit_guides`: `unit_id uuid PK → units`, `organization_id`, text fields each ≤2000 with a `_tl` twin: `arrival`, `parking`, `building_notes`, `local_tips`, `emergency_contacts`; `door_code_enc text`; `updated_at`, `updated_by → users`.
- `bookings` add: `guide_token text` (unique where not null), `rules_accepted_at timestamptz`, `rules_text text` (≤4000), `source text` CHECK in D-61 list (NULL allowed).
- `direct_checkouts` add: `rules_accepted_at`, `rules_text`, `source` (same CHECK), `addons jsonb NOT NULL DEFAULT '[]'` (snapshot `[{addon_id, name, quantity, unit_price, amount}]`), `addons_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (>= 0)`, `quote_id uuid` (FK added below), `followup_sent_at timestamptz`. Index for the follow-up job on `(status, followup_sent_at)`.
- `booking_charges.category` CHECK: add `addon`. Add `addon_id uuid → listing_addons` NULL.
- `listing_addons`: `addon_id uuid PK`, `organization_id`, `name text` 1–80, `name_tl text` ≤80, `description text` ≤300, `price numeric(12,2) > 0`, `pricing text CHECK IN ('per_stay','per_night','per_guest','per_guest_night')`, `max_quantity smallint 1–20 default 1`, `unit_ids uuid[]` (empty = all listings), `on_booking_page boolean default true`, `before_arrival boolean default true`, `active boolean default true`, `sort_order smallint default 0`, `created_at`, `updated_at`.
- `booking_quotes`: `quote_id uuid PK`, `organization_id`, `unit_id`, `public_token text UNIQUE`, `check_in`, `check_out`, `num_guests smallint 1–50`, `guest_name text` ≤120, `guest_email text`, `guest_phone text`, `accommodation_total numeric(12,2) >= 0`, `cleaning_fee >= 0`, `addons jsonb default '[]'`, `addons_total >= 0`, `discount_amount >= 0`, `total_amount > 0`, `pay_type` CHECK IN ('full','deposit'), `note text` ≤1000, `expires_at timestamptz`, `status` CHECK IN ('open','paid','expired','cancelled') default 'open', `booking_id → bookings` NULL, `created_by → users`, `created_at`, `cancelled_at`. CHECK `check_out > check_in`. Index `(organization_id, status)`.
- `direct_checkouts.quote_id → booking_quotes` NULL.
- `organizations` add: `review_links jsonb NOT NULL DEFAULT '[]'`, `returning_guest_pct smallint CHECK (1–50)` NULL, `abandoned_followup boolean NOT NULL DEFAULT false`.
- `discount_codes` add `issued_to_booking_id uuid → bookings` NULL (unique where not null).
- `units` add `public_slug text` (unique per workspace via index on `(… organization)` — units has no organization_id; use a unique index on `(property_id… )`? No: add the uniqueness check in code across the workspace and a plain index on `public_slug`). Backfill: slugify `unit_name` (lowercase a–z0–9 and hyphens, ≤60), de-duplicate within each workspace by appending `-2`, `-3`.
- `src/lib/account.js`: new tables in `PURGED_TABLES`, `purgeOrganization()` (FK-safe), `exportOrganization()` (export `unit_guides` without `door_code_enc`).

## Lane A: guidebook (backend)

**Owns:** new `src/routes/guidebook.js` (`{ router, publicRouter }`), new `src/lib/guidebook.js`, `src/lib/messaging.js` (variables `{{guidebook_link}}`, `{{door_code}}`, `{{returning_guest_code}}`, the time window for `{{wifi_password}}`; and add `{{guidebook_link}}` to the English and Taglish check-in templates' default text for new workspaces only), new `test/guidebook.test.js`.
- Host: `GET /units/:id/guide`, `PUT /units/:id/guide` (owners, managers; scoped by `loadUnit`). Response includes `has_door_code` (never the code) and a `door_code` field only to owners and managers on GET. `POST /reservations/:id/guide-link` (owners, managers) returns `{ url }` (creates the token).
- Public: `GET /public/guide/:token` → listing name, property name, city, check-in/out dates and times, guest first name, language, sections (EN and TL), Wi-Fi name, and `wifi_password`/`door_code` only inside the window (else `secrets_from: 'YYYY-MM-DD'`). 404 outside the link's valid period or if cancelled. Rate-limited.
- `{{returning_guest_code}}`: `require('./returning').codeFor(bookingId)` from Lane E (lazy; empty string if missing or setting off).

## Lane B: add-ons, rules on check-in, pre-arrival add-ons (backend)

**Owns:** new `src/routes/addons.js`, new `src/lib/addons.js` (export `priceAddons(db, { orgId, unitId, nights, guests, selections, context: 'booking'|'before_arrival' })` → `{ items: [{addon_id, name, quantity, unit_price, amount}], total }` with validation errors as `HttpError 400` fields `addons`; and `createAddonCharges(db, bookingId, items, user|null)` which inserts `booking_charges` rows category `addon`, recomputes `extras_total` like `src/routes/charges.js`), `src/routes/checkin.js` (rules acceptance), `src/routes/balancepay.js` (pre-arrival add-ons), new `test/addons.test.js`.
- Host: `GET /addons`, `POST /addons`, `PATCH /addons/:id`, `POST /addons/:id/archive` (owners; managers read-only).
- Public: `GET /public/pay/:token/addons` (only `before_arrival` add-ons for that listing, only until check-in day) and `POST /public/pay/:token/addons { selections: [{addon_id, quantity}] }` → creates charges, closes open balance checkouts (as charges.js does), returns the updated bill. Rate-limited. Not for cancelled stays.
- Check-in form (`/public/checkin/:token`): GET returns `house_rules` and `rules_accepted_at`; POST requires `accept_rules: true` when the listing has rules and none accepted yet; stores time + text.

## Lane C: booking page backend — add-ons, rules, sources, quotes, follow-up

**Owns:** `src/routes/directbooking.js`, new `src/routes/quotes.js` (`{ router, publicRouter }`), new `test/directbooking-phase4.test.js`, new `test/quotes.test.js`, one job line in `src/lib/scheduler.js` (`abandoned-followup`, every 15 minutes).
- Public listing responses include `house_rules`, `addons` (active, `on_booking_page`, for that listing: id, name, name_tl, description, price, pricing, max_quantity), and `public_url` (`/stay/:slug/:unitSlug`).
- Quote endpoint accepts `addons` (JSON in a query param or a POST alternative — choose and document) and returns `addons_total` and a total including them.
- Checkout accepts `addons: [{addon_id, quantity}]`, `accept_rules` (required when rules exist), `source` (allow-list; anything else ignored). Uses Lane B's `priceAddons` (lazy require; fail closed with 503 if missing). `amount_due_now` = (full: total incl. add-ons) or (deposit: deposit + add-ons). On confirmation, create the booking as today, then `createAddonCharges`, copy `source`, `rules_*`. The booking's `total_amount` must end up = accommodation + cleaning + add-ons (via extras_total).
- Quotes: host `GET /quotes?status=`, `POST /quotes` (validate availability now but don't hold), `GET /quotes/:id`, `POST /quotes/:id/cancel`, `POST /quotes/:id/send` (emails the link if `guest_email`), `GET /units/:id/price-preview?check_in&check_out&guests` (reuse `priceStay`). Public `GET /public/quote/:token`, `POST /public/quote/:token/checkout` (name, email, phone required if missing on the quote; `accept_rules`; creates a `direct_checkouts` row with the quote's amounts and `quote_id`, then PayMongo like checkout). Confirmation (shared with the direct path) marks the quote `paid` and links the booking. Expired quotes → 410 `QUOTE_EXPIRED`.
- Follow-up job: export `sendAbandonedFollowups(now)` per D-62. Plain-text email, English or Taglish per workspace language, with the listing link and dates, and "If you already booked, please ignore this".

## Lane D: search-friendly pages (backend)

**Owns:** new `src/routes/seo.js` (an Express router for `/stay/*`, `/sitemap.xml`, `/robots.txt`; the orchestrator mounts it on `app` before the static files), `src/routes/properties.js` (accept and validate `public_slug` on unit update — unique within the workspace, lowercase a–z0–9 and hyphens, 3–60), new `test/seo.test.js`.
- Per D-63. Cache headers: `Cache-Control: public, max-age=300`. 404 page (plain, styled) for unknown or disabled hosts/listings. Server-side HTML escaping helper; tests must include a listing name with `<script>` to prove escaping. Never include the street address, guest data or prices other than "from ₱X / night".

## Lane E: reviews, returning guests, sources report (backend)

**Owns:** `src/routes/guestcare.js`, new `src/lib/returning.js` (`codeFor(bookingId)` per D-62: only for confirmed stays that have checked out, only when the setting is on; idempotent via `issued_to_booking_id`; code like `WELCOME-` + 6 uppercase chars), the workspace settings endpoints for `review_links`, `returning_guest_pct`, `abandoned_followup` (add to guestcare.js as `GET/PATCH /workspace/guest-settings`, owners only; URLs must be https and ≤300 chars), `src/routes/stayreports.js` (by-source breakdown: direct bookings by `source`, count, nights, revenue), new `test/guestcare-phase4.test.js`.
- `POST /public/review/:token` response adds `share_links` (the workspace's review links) only when rating ≥ 4.

## Lane F: guest-facing booking and quote screens (frontend)

**Owns:** `public/js/views/book.js` (add-ons picker with live total, house rules shown with an "I agree to the house rules" checkbox required before paying, read `?src=` from the hash query and send it as `source`), new `public/js/views/quote.js` (exports `quoteView` for `#/quote/:token`: the offer, expiry, rules, details form, pay button; expired/paid states), CSS block `/* Phase 4: booking */` at the end of `app.css`. English and Taglish.

## Lane G: guest-facing guidebook, pay, check-in, review screens (frontend)

**Owns:** new `public/js/views/guide.js` (exports `guideView` for `#/guide/:token`: phone-first sections with icons, Wi-Fi and door code cards with copy buttons, "available from …" note, EN/TL switch), `public/js/views/pay.js` (pre-arrival add-ons section), `public/js/views/checkin.js` (house rules + required checkbox), `public/js/views/review.js` (after a 4–5 star rating, show "Would you share your experience?" with the host's links), CSS block `/* Phase 4: guest pages */`. English and Taglish.

## Lane H: host screens (frontend)

**Owns:** `public/js/views/listings.js` (per listing: guidebook editor with EN/TL tabs and door code field (masked, reveal button), public page address (`public_slug`) with "View page" link, share links builder: pick a source, copy the link), new `public/js/views/addons.js` (`addonsView` for `#/addons`), new `public/js/views/quotes.js` (`quotesView` `#/quotes` list + "New quote" modal with price preview and editable amounts; `quoteDetailView` `#/quotes/:id` with copy link, send, cancel), `public/js/app.js` (routes for Lanes F, G and H views, nav entries "Quotes" and "Add-ons" for owners and managers in short-term workspaces), `public/js/views/settings.js` (Guest experience card: public review links editor, returning-guest discount %, abandoned-booking follow-up toggle), `public/js/views/reservations.js` (show source, house rules accepted time with the text in a details toggle, add-ons appear as charges already; "Send guidebook link" copy button), `public/js/views/stayreports.js` (by-source table), CSS block `/* Phase 4: host */`.

## Lane I: integration (after all)

Mounts in `src/server.js` (orchestrator: `guidebook.publicRouter`, `quotes.publicRouter` before `requireWorkspace`; `guidebook.router`, `addons`, `quotes.router` after; `seo` on `app` before static), cleaner guard unchanged (none of these are allowed for cleaners), help articles, canon docs (PRD, APP-FLOW, BACKEND-SCHEMA, TRD for the new job, DECISIONS D-57 to D-63, IMPLEMENTATION-PLAN).

## Acceptance

- `npm test` passes (orchestrator, once at the end); lanes test only their own files on their own database.
- Door codes never leave the server outside the window or to staff/cleaners; guide links don't work for cancelled stays or outside their period.
- Totals exact to the centavo: a booking with add-ons has total = accommodation + cleaning + add-ons, and its bill, receipt, balance and owner statement agree.
- A quote can't be paid after expiry or twice; a quote never double-books (same hold/confirm path as direct booking).
- SEO pages escape all host text and never show the street address.
- Security review PASS. Browser check of the booking page with add-ons and rules, a quote, the guidebook, the pay page add-ons, the check-in form, the review share step, the SEO page, and the host screens, at phone and desktop, light and dark, English and Taglish.
