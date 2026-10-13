# BalayHub: Technical Requirements (as built)

BalayHub is rental and staycation management software for Filipino hosts. It covers short-term stays (listings, reservations, calendar sync, guest messaging, housekeeping, direct booking) and long-term rentals (tenants, leases, rent, expenses, maintenance). It runs as one Node.js/Express service with a PostgreSQL database and a vanilla-JS single-page app.

This document describes what is actually built, as checked against the code. Anything not confirmed in the code is marked **unverified**.

Last updated: 2026-10-13

---

## 1. Stack and libraries

| Layer | Technology | Version (source) |
|---|---|---|
| Runtime | Node.js | 22 (Docker image `node:22-alpine`; `package.json` engines says `>=20`) |
| Web framework | express | ^4.22.3 (package.json), 4.22.3 installed |
| Database driver | pg | ^8.23.1 |
| Database | PostgreSQL | 16 (`postgres:16-alpine` in `docker-compose.prod.yml`). Extensions: `pgcrypto`, `btree_gist` |
| Outbound email | nodemailer | ^10.0.16 (10.1.0 installed) |
| Inbound email (IMAP) | imapflow | ^2.4.0 |
| Email parsing | mailparser | ^3.9.38 |
| Web Push | web-push | ^3.6.7 |
| AI assistant | @anthropic-ai/sdk | ^0.133.0 |
| Reverse proxy / TLS | Caddy | 2 (`caddy:2-alpine`) |
| Frontend | Vanilla JS ES modules, no build step | n/a |
| Fonts | Inter and Poppins, self-hosted in `public/fonts` | n/a |
| Tests | `node:test` (built in), Playwright for browser journeys | Playwright is **not** in `package.json`; it must be installed separately |

There are no dev dependencies in `package.json`. Module type is CommonJS on the server and ES modules in the browser.

---

## 2. Architecture

```
Browser (SPA + service worker)
   │  HTTPS, cookie session, JSON /api/*
   ▼
Caddy (automatic HTTPS, gzip)  ──►  app (Node/Express, port 3000)  ──►  PostgreSQL (db)
                                         │
                                         ├── STORAGE_DIR (private files volume)
                                         ├── in-process scheduler (background jobs)
                                         └── outbound: SMTP, IMAP, PayMongo, Anthropic, Google, Web Push, channel iCal URLs
```

### 2.1 Server (`src/`)

| Part | File | What it does |
|---|---|---|
| Entry | `src/index.js` | Runs database migrations, then starts the HTTP server and the scheduler |
| App | `src/server.js` | Security headers, `/api` router, the PayMongo webhook, the public iCal feed, static files, error handler |
| Config | `src/config.js` | Reads all environment variables (section 4) |
| DB | `src/db.js` | `pg` pool (max 10 connections, 15 s connection wait). NUMERIC is returned as strings (exact money) and DATE as `YYYY-MM-DD` |
| Migrations | `scripts/migrate.js` | Applies `db/migrations/*.sql` in name order, each in a transaction, and records them in `schema_migrations`. Runs automatically on every start |

**Request pipeline for `/api`:** JSON body parser (100 KB) → `Cache-Control: no-store` → CSRF header check → `loadSession` → `planGuard` → public and auth routers → `requireWorkspace` (signed in, email verified, member of a workspace) → workspace routers → 404.

Routers mounted **before** `requireWorkspace` (no workspace needed): auth, Google sign-in, platform admin, account, and the guest-facing public routers (check-in, direct booking, balance payment, review, gate pass) plus the platform support admin router.

Mounted **outside** `/api`:
- `POST /api/public/paymongo/webhook`: raw body (200 KB), no session, no CSRF header (the signature is checked instead).
- `GET /ical/<token>.ics`: the private calendar export that channels poll.
- Static files from `public/`.

**Error format:** `{ error, code, fields? }`. Unexpected errors return 500 with a generic message and email an alert to the platform admins (section 3.10).

### 2.2 Single-page app (`public/`)

- `index.html` loads `js/theme.js` and the ES module `js/app.js` (hash router). There are no inline scripts.
- `js/api.js` is the API client. `js/ui.js` builds the DOM. There are 31 screen modules in `js/views/`, plus `i18n.js` (English/Taglish for guest pages), `charts.js`, `filters.js`, `notifications.js` and `assistant.js`.
- Guest-facing screens (reached by private link) are `checkin`, `book`, `pay`, `review` and `gatepass`.
- Caching: `.html/.js/.css/.webmanifest` are sent as `no-cache` (revalidated with ETag on every load). Fonts and images are cached for 1 day.

### 2.3 Service worker (`public/sw.js`)

- It never caches the app itself, so updates reach users immediately.
- It pre-caches only `offline.html`, `offline.css` and one icon. Page loads (navigations) go to the network and fall back to the offline page.
- It handles `push` (shows a notification) and `notificationclick` (focuses or opens the app at the URL in the notification).
- The app is installable as a PWA through `manifest.webmanifest`.

### 2.4 Scheduler jobs (`src/lib/scheduler.js`)

Jobs run inside the app process. A job never overlaps itself. After 3 failures in a row it emails an alert to the platform admins.

| Job name | Interval | First run after start | What it does |
|---|---|---|---|
| `ical` | 30 min | 60 s | Imports every connected channel calendar (Airbnb, Booking.com, Agoda, Vrbo, Expedia, Trip.com, other) |
| `messages` | 1 min | 20 s | Sends scheduled messages (up to 50 per run), then runs stay automations |
| `inbox` | 2 min | 30 s | Polls IMAP for guest replies (only when `IMAP_URL` is set) |
| `housekeeping` | 15 min | 40 s | Creates cleaning tasks for today's and tomorrow's departures |
| `gate-pass` | 15 min | 55 s | Emails condo gate passes that are due to building admins |
| `guest-ids` | 6 h | 70 s | Deletes guest ID photos after the retention period (section 5.1) |
| `billing` | 10 min | 80 s | Re-checks pending platform plan checkouts with PayMongo (20 per run) and expires checkouts older than 2 days |
| `direct-booking` | 2 min | 25 s | Confirms guests' online bookings whose payment went through but who didn't return to the page |
| `balance-pay` | 3 min | 35 s | Same for online balance payments |
| `support` | 60 min | 95 s | Closes support tickets 7 days after they were resolved |
| `account` | 60 min | 90 s | Permanently deletes workspaces whose 14-day deletion grace period has passed |
| `demo` | 60 min | 50 s | Moves the public demo workspace's sample dates forward |
| `auth-cleanup` | 60 min | 100 s | Deletes expired or idle team sessions and old one-time tokens, and the same for owner portal sessions and sign-in links |
| `owner-statements-reminder` | 60 min | 105 s | From the 3rd of the month (Manila time): drafts last month's owner statements (drafts only) and emails each workspace owner that n are ready to review. Once per workspace per month (an `audit_logs` row, `owner_statements.reminder_sent`, so no new table). Skipped when email is off. Demo and read-only workspaces are skipped |

Note: in `scheduler.js` the comment "Workspaces whose owner asked for deletion" sits above the `support` job instead of the `account` job.

### 2.5 Deployment

| Item | As built |
|---|---|
| Host | Hostinger VPS, https://balayhub.proverbs3digitalsolutions.com |
| Compose file | `docker-compose.prod.yml`: services `db` (Postgres 16, health-checked), `app` (built from `Dockerfile`, runs as user `node`), `caddy` (ports 80/443) |
| Volumes | `pgdata` (database), `uploads` (mounted at `/data/storage` = `STORAGE_DIR`), `caddy_data`, `caddy_config` |
| TLS | Caddy obtains and renews the certificate for `DOMAIN` automatically (`deploy/Caddyfile`) |
| Settings | `deploy/.env` on the server (template: `deploy/.env.production.example`) |
| Deploy | `./deploy/update.sh`: runs `deploy/backup.sh`, then `git pull --ff-only`, then `docker compose ... up -d --build`, then prunes images. Migrations run when the app starts |
| Health | `GET /api/health` (also runs `SELECT 1`). Used by the Docker `HEALTHCHECK` |
| Proxy trust | `TRUST_PROXY` is fixed to 1 hop in the production compose file, so client IPs (used for rate limits) come from Caddy's `X-Forwarded-For` |

---

## 3. External services and integrations

For every variable, see the full list in section 4. Hosts' own PayMongo keys are **not** environment variables (section 3.3).

### 3.1 Email: SMTP (outbound) and IMAP (inbound)

| Aspect | As built |
|---|---|
| Providers | Gmail / Google Workspace or Hostinger email (examples in `.env.production.example`, `docs/EMAIL-SETUP.md`, `docs/INBOX-SETUP.md`) |
| Outbound | `nodemailer` with one `SMTP_URL`. Used for verification, password reset, invitations, guest messages and receipts, deposit statements, gate passes, owner statements, owner portal sign-in links, owner date-block alerts, the monthly owner statement reminder, support notifications and alerts. A malformed `SMTP_URL` disables email with a log message instead of crashing. If `SMTP_URL` is missing in production, sends are skipped and the app warns at startup |
| Test mode | `SMTP_URL=test://` stores messages in memory (outside production only) |
| Inbound | Guest replies go to `INBOUND_ADDRESS` with a `+bh-<token>` plus-address tag. `imapflow` polls the mailbox every 2 min. Only messages carrying a BalayHub tag are imported; other mail is left untouched. Progress is kept in `mail_sync_state` |
| Env vars | `SMTP_URL`, `MAIL_FROM`, `IMAP_URL`, `INBOUND_ADDRESS`, `REQUIRE_EMAIL_VERIFICATION`, `EXPOSE_DEV_LINKS` |

### 3.2 Google sign-in

| Aspect | As built |
|---|---|
| Flow | OAuth 2.0 authorization code with `state` and a PKCE verifier kept in a short-lived (10 min) flow cookie. Scopes: `openid email profile` |
| Endpoints | `GET /api/auth/options`, `GET /api/auth/google/start`, `GET /api/auth/google/callback` (redirect URI = `APP_URL` + `/api/auth/google/callback`) |
| Data | The Google `sub` is stored in `users.google_sub` (unique). New Google sign-ups record privacy and terms consent |
| Enabled when | Both env vars are set; otherwise the button is hidden |
| Env vars | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

### 3.3 PayMongo (two separate uses)

| | Platform billing (BalayHub charges hosts) | Hosts' direct booking and balance payments (guests pay hosts) |
|---|---|---|
| Whose account | BalayHub's | Each host's own PayMongo account |
| Key source | `PAYMONGO_SECRET_KEY` env var | Pasted by the workspace owner in Settings. It must look like `sk_live_…` or `sk_test_…`. Stored encrypted in `organizations.paymongo_key_enc` (AES-256-GCM, section 3.7). Only a hint (`paymongo_key_hint`) is ever shown back. The encrypted key is copied onto each checkout (`direct_checkouts.key_enc`, `balance_checkouts.key_enc`) so a later key change can't lose a payment |
| Checkout | Hosted Checkout Session. Payment methods from `PAYMONGO_METHODS` | Hosted Checkout Session |
| Records | `billing_payments` | `direct_checkouts` → `bookings` + `booking_payments`; `balance_checkouts` → `booking_payments` |
| Confirmation | Webhook `POST /api/public/paymongo/webhook` (HMAC-SHA256 signature using `PAYMONGO_WEBHOOK_SECRET`, timestamps older than 3 days rejected). The webhook only triggers a re-check: the payment is trusted only after BalayHub asks PayMongo for the checkout status with the secret key. A 10-minute job catches missed webhooks | No webhook (the webhook handler only looks up `billing_payments`). The guest's return page polls, and the `direct-booking` (2 min) and `balance-pay` (3 min) jobs re-check with the host's key |
| Test mode | n/a | A host key starting `sk_test_` marks checkouts and payments as TEST MODE |
| Env vars | `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `PAYMONGO_METHODS` | `DATA_ENCRYPTION_KEY` (protects the stored host keys) |

Plans and prices live in `src/lib/plans.js`: trial, starter, growth, pro, comped. Each has a listing limit and an AI flag. Paid plans get a 7-day grace period after `paid_until`. Billing periods are 1, 3 or 12 months (12 months are charged as 10).

### 3.4 Anthropic (AI)

| Feature | As built |
|---|---|
| AI reply drafts (Inbox) | `src/lib/ai.js` calls the Messages API over plain `fetch` to `https://api.anthropic.com/v1/messages` with model `AI_MODEL`: max_tokens 1024, 45 s timeout, at most 60 drafts per workspace per hour (in memory). The draft is shown to the host and never sent automatically. Only on plans with `ai: true`. Owners and managers only (Inbox is limited to them) |
| In-app assistant (Help & support) | `src/routes/assistant.js` uses `@anthropic-ai/sdk` with model `ASSISTANT_MODEL`: max_tokens 16000, 60 s timeout, 1 retry. It keeps the last 12 chat turns (user text up to 2000 characters). Limits: 40 questions per user per hour and 300 per workspace per day (in memory). The system prompt is built from the help-center articles for the user's role and is cached with `cache_control`. For some models it asks for server-side fallback. Turned off for the demo workspace |
| Data sent | Drafts: the reservation, listing details (including Wi-Fi password and check-in instructions) and the last 20 messages of the conversation. Assistant: the user's questions, their role, workspace type and plan |
| Env vars | `ANTHROPIC_API_KEY`, `AI_MODEL`, `ASSISTANT_MODEL`, `ANTHROPIC_BASE_URL` |

Note: `ANTHROPIC_BASE_URL` is only used by the assistant (the drafts code ignores it), and it is not passed through `docker-compose.prod.yml`, so it cannot be set in production as deployed.

### 3.5 Web Push (VAPID)

| Aspect | As built |
|---|---|
| Library | `web-push` |
| Keys | From `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. If either is empty, a key pair is generated once and kept in `STORAGE_DIR/.vapid.json` (mode 0600). Changing keys forces every device to subscribe again |
| Contact | `mailto:` uses `SALES_CONTACT_EMAIL` or the `MAIL_FROM` address |
| Types | new_booking, guest_message, checkin_form, payment (owners and managers); cleaning (all roles). Sent only to active members who can see the property and haven't turned the type off (`users.notify_prefs`) |
| Storage | `push_subscriptions`. Dead endpoints are deleted |
| Env vars | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SALES_CONTACT_EMAIL` |

### 3.6 iCal channel calendars

| Direction | As built |
|---|---|
| Export | One private feed per listing at `/ical/<token>.ics` (`units.ical_token`, 20–64 characters). It contains confirmed stays and blocks from 7 days ago onward, without guest names. Owners and managers can rotate the token |
| Import | `ical_feeds` per listing. Synced every 30 min and on demand. Only `https://` URLs without credentials are accepted. DNS results pointing at private or internal networks are refused (SSRF guard). 15 s timeout, 2 MB maximum, up to 3 redirects. Imported events become `bookings` with `ical_feed_id` and `external_uid`. Events that disappear are cancelled (stays) or deleted (blocks) |
| Env vars | None (uses `APP_URL` to build links) |

### 3.7 Encryption of stored secrets (`DATA_ENCRYPTION_KEY`)

- `src/lib/secretbox.js` uses AES-256-GCM. The stored format is `v1.<iv>.<tag>.<ciphertext>`.
- The key is SHA-256 of `DATA_ENCRYPTION_KEY`. If that variable is empty, a random 32-byte key is generated once and written to `STORAGE_DIR/.data-key` (mode 0600, written atomically). A damaged key file stops the app instead of being replaced silently.
- Encrypted values: hosts' PayMongo secret keys (`organizations.paymongo_key_enc`, `direct_checkouts.key_enc`, `balance_checkouts.key_enc`).
- Not encrypted: `units.wifi_password` and other listing details. Password hashes and tokens are hashed, not encrypted (section 5.1).

### 3.8 Backups

| Aspect | As built |
|---|---|
| Script | `deploy/backup.sh`: `pg_dump --clean --if-exists` gzipped, plus a tar.gz of the uploads volume. Files older than 14 days are deleted |
| Location | `BACKUP_DIR` (script variable; defaults to a folder in the server user's home) |
| When | Before every deploy (`update.sh`). A daily cron job is documented in `docs/DEPLOY-HOSTINGER.md`; whether it is installed on the server is **unverified** |
| Off-site copy | None in the repo (**unverified** on the server) |
| Note | When `DATA_ENCRYPTION_KEY` or the VAPID keys aren't set, `.data-key` and `.vapid.json` live in the uploads volume, so the uploads backup holds the encryption key next to the database dump that holds the encrypted data |

### 3.9 Platform administration

- Platform admins are the verified accounts whose email is in `PLATFORM_ADMIN_EMAILS`. This is not a workspace role.
- They get `/api/admin/*`: workspaces, plans, trial and paid-until dates, plan notes, and the support inbox. Anyone else gets a 404.

### 3.10 Alerts

- `src/lib/alerts.js` emails all `PLATFORM_ADMIN_EMAILS` on server errors (500s) and on background jobs that fail 3 times in a row.
- At most one email per kind every 30 minutes. No alerts are sent in tests.

---

## 4. Environment variables (names and purpose only)

Production values live in `deploy/.env` on the server. No values are listed here. Phase 2 (owners, 2026-10-13) added no new variables: it uses `APP_URL` for portal links and the existing mail settings.

| Variable | Used by | Purpose |
|---|---|---|
| `NODE_ENV` | app | `production` turns on secure cookies and HSTS, and disables dev links and test mail |
| `PORT` | app | HTTP port inside the container |
| `APP_URL` | app | Public base URL for links in emails, iCal export links, OAuth redirect. Set from `DOMAIN` in production |
| `DATABASE_URL` | app | PostgreSQL connection string. Built from `DB_PASSWORD` in production |
| `STORAGE_DIR` | app | Private file storage folder (uploads, `.data-key`, `.vapid.json`) |
| `TRUST_PROXY` | app | Number of reverse-proxy hops to trust for client IPs |
| `DOMAIN` | compose, Caddy | Public hostname; Caddy gets its certificate |
| `DB_PASSWORD` | compose | Postgres password for the `balayhub` database user |
| `SMTP_URL` | mail | Outbound SMTP connection URL (or `test://` outside production) |
| `MAIL_FROM` | mail | Sender name and address |
| `REQUIRE_EMAIL_VERIFICATION` | auth | Whether users must verify email before using a workspace |
| `EXPOSE_DEV_LINKS` | auth | Outside production, return verification and reset links in API responses |
| `SESSION_TTL_HOURS` | auth | Absolute session lifetime |
| `SESSION_IDLE_HOURS` | auth | Idle timeout for sessions |
| `GOOGLE_CLIENT_ID` | Google sign-in | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google sign-in | OAuth client secret |
| `IMAP_URL` | inbox | IMAP mailbox URL for reading guest replies |
| `INBOUND_ADDRESS` | inbox | Address guests reply to (falls back to the `MAIL_FROM` address) |
| `ANTHROPIC_API_KEY` | AI | API key for reply drafts and the assistant |
| `AI_MODEL` | AI | Model for Inbox reply drafts |
| `ASSISTANT_MODEL` | AI | Model for the in-app assistant |
| `ANTHROPIC_BASE_URL` | AI | Optional API base URL (assistant only; not wired into the production compose file) |
| `PLATFORM_ADMIN_EMAILS` | admin, alerts, support | Comma-separated emails of platform admins |
| `TRIAL_DAYS` | plans | Free trial length for new workspaces |
| `SALES_CONTACT_EMAIL` | landing page, VAPID | Contact shown on the landing page; VAPID contact |
| `PAYMONGO_SECRET_KEY` | billing | BalayHub's own PayMongo secret key (plan payments) |
| `PAYMONGO_WEBHOOK_SECRET` | billing | Signing secret for the PayMongo webhook |
| `PAYMONGO_METHODS` | billing | Payment methods offered at plan checkout |
| `GUEST_ID_RETENTION_DAYS` | privacy | Days after check-out before guest ID photos are deleted |
| `DATA_ENCRYPTION_KEY` | secretbox | Key material for encrypting hosts' PayMongo keys |
| `VAPID_PUBLIC_KEY` | push | Web Push public key |
| `VAPID_PRIVATE_KEY` | push | Web Push private key |
| `BACKUP_DIR` | `deploy/backup.sh` | Where backups are written |
| `TEST_DATABASE_URL` | tests | Database for `npm test` (defaults to a local `balayhub_test`) |
| `BASE_URL`, `PLAYWRIGHT_PATH`, `SHOTS_DIR` | e2e scripts | Target server, Playwright module location, screenshot folder |

Fixed in code (not configurable): privacy policy version, terms version, time zone `Asia/Manila`, 10 MB upload limit.

---

## 5. Non-functional requirements (as implemented)

### 5.1 Security and privacy

| Control | Implementation |
|---|---|
| HTTPS | Caddy with automatic certificates. HSTS (1 year, includeSubDomains) in production |
| Security headers | CSP `default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy` (camera, microphone and geolocation off). `x-powered-by` is disabled |
| CSRF | Every non-GET/HEAD/OPTIONS `/api` request must carry `X-Requested-With: BalayHub`, else 403 `CSRF`. CORS is not enabled. Cookies are `SameSite=Lax`. The PayMongo webhook is exempt (it is signature-checked) |
| Passwords | scrypt (N=16384, r=8, p=1, 16-byte salt). Timing-equal compare. Unknown-email logins run a dummy hash check so timing doesn't reveal accounts |
| Sessions | 256-bit random token in cookie `bh_session` (HttpOnly, SameSite=Lax, Secure in production). Only its SHA-256 is stored. Absolute lifetime `SESSION_TTL_HOURS` (default 7 days), idle timeout `SESSION_IDLE_HOURS` (default 12 h). `last_seen_at` is refreshed at most every 5 min. Revoked users are rejected. Changing the password signs out other devices; a password reset signs out all devices. Users can sign out individual devices. The user agent is stored per session |
| Owner portal sessions | Cookie `bh_owner` with the same flags as `bh_session`. Only the SHA-256 of the token is stored (`owner_sessions`). 30 days absolute, 7 days idle. Sign-in links: one use, 30 minutes, hashed (`owner_login_tokens`). Owners have no `users` row. `/api/owner-portal/*` skips the plan guard and checks this cookie instead of the team session |
| One-time tokens | Email verification 48 h, password reset 1 h, invitations 7 days. All are stored hashed |
| Rate limits | In-memory, fixed window, per process (table below) |
| Plan / read-only guard | `planGuard` blocks writes (402) for an ended trial, overdue payment or scheduled deletion, and (403) for the demo. Account, billing, support, push, assistant and auth paths are exempt so a lapsed workspace can still pay, get help and export |
| Data scoping | Every workspace query is filtered by `organization_id`. Managers and staff are further limited to properties in `property_assignments` (`propertyScope`, `tenantScope`, `guestScope`). Out-of-scope IDs return 404 |
| Staff redaction | `redactTenant` (`src/lib/access.js`) removes tenant email, phone, emergency contact and notes. `redactGuest` (defined in `src/routes/stays.js`, not in `access.js`) removes guest email, phone, notes, review and pay tokens. Guest lists also hide `total_spent` from staff. Lease documents and guest ID files are refused for staff |
| Guest ID retention | ID photos uploaded on the guest check-in form are deleted `GUEST_ID_RETENTION_DAYS` (default 30) after check-out, or 3 days after a cancellation. The job runs every 6 h and sets `guest_registrations.ids_purged_at` |
| Encrypted secrets | Hosts' PayMongo keys are encrypted with AES-256-GCM (section 3.7) and never returned (hint only). The workspace export strips password hashes, token hashes, storage keys, link tokens, encrypted keys and push endpoints |
| File uploads | MIME allow-list (PDF, JPEG, PNG, WEBP) plus a magic-byte check. 10 MB limit. Random storage keys outside the web root, mode 0600. Every download is permission-checked and sent `private, no-store`. Downloads of lease documents and guest IDs are audited |
| Audit log | `audit_logs` records important actions (money recorded/voided/corrected, leases, team changes, files, cleaning, deposits, settings, exports, deletion requests, platform plan changes) with JSON details. Owners see all entries; managers see their own (latest 200) |
| Data rights | Owners can export the whole workspace as JSON (10 per hour) and request deletion. Deletion makes the workspace read-only, emails the owner, and permanently deletes everything after 14 days (cancellable). Owners can also export a single tenant's record |
| Consent | Privacy notice and terms acceptance (with versions) are stored in `consent_records` at sign-up (password and Google). Guests give consent on the check-in form and direct booking checkout (`consent_at`) |
| CSV exports | Formula-injection guard on report and reservation CSVs |
| Outbound fetch safety | iCal import SSRF guard (section 3.6). PayMongo calls time out after 20 s. AI calls after 45 s or 60 s |

**Rate limits (as configured in code)**

| Endpoint group | Limit | Key |
|---|---|---|
| Sign-up, login | 60 per 15 min, and 20 per 15 min | IP; IP plus email |
| Verify email, reset password | 20 per 15 min | IP plus email |
| Resend verification, forgot password | 5 per 15 min | IP |
| Demo sign-in | 30 per hour | IP |
| Change password | 10 per 15 min | user |
| Google sign-in | 40 per 15 min | IP |
| Owner portal sign-in request | 40 per 15 min; 5 per 15 min per email | IP; email (case-insensitive) |
| Owner portal link exchange | 60 per 15 min | IP |
| Workspace export | 10 per hour | workspace |
| Plan checkout | 15 per hour | workspace |
| Support tickets | 10 new tickets per hour | user |
| AI drafts | 60 per hour | workspace |
| Assistant | 40 per hour per user; 300 per day per workspace | user, workspace |
| Guest check-in page | 60 per 15 min; ID uploads 30 per hour | IP; link |
| Direct booking pages | 300 per 15 min; checkouts 20 per hour; at most 2 open 30-minute holds | IP; IP; visitor or email |
| Balance payment page | 60 per 15 min; checkouts 10 per hour; status refresh 120 per 15 min | IP; link; link |
| Review page | 40 per 15 min | IP |
| Gate pass page (building admin) | 60 per 15 min | IP |

### 5.2 Performance and limits

| Item | Value as built |
|---|---|
| Deployment model | One app process, one database. Rate limits, AI limits and the scheduler are in-process, so running more than one app instance would need changes |
| DB pool | 10 connections; a request waits at most 15 s for a free connection |
| Request bodies | JSON 100 KB (`/api`); check-in form 50 KB; uploads 10 MB; webhook 200 KB |
| List sizes | Most lists are capped server-side (for example 500 payments or expenses, 1000 reservations, 300 cleaning tasks, 200 audit entries or reviews, 500 deposits, 1000 admin workspaces) |
| Calendar view | 7–62 days per request |
| Stays | Up to 366 nights. No double booking: a database exclusion constraint on confirmed stays and blocks |
| Listing photos | Up to 12 per listing |
| Discount codes | Up to 50 active per workspace |
| Message sending | Up to 50 due messages per minute |
| Money | `numeric(12,2)` in PHP, returned as strings. Client totals are summed in centavos |
| Static caching | App code revalidated every load; fonts and images cached 1 day; API responses `no-store` |
| Response time or uptime targets | None defined in the code or docs (**unverified**) |

### 5.3 Testing

| Suite | How it runs |
|---|---|
| API tests | `npm test` runs `node --test --test-concurrency=1 test/*.test.js`: 27 files, about 169 top-level tests. `test/helpers.js` sets `NODE_ENV=test`, points `DATABASE_URL` at `TEST_DATABASE_URL` or a local `balayhub_test`, **drops and recreates the `public` schema**, runs all migrations, and starts the app on a random port with a temporary `STORAGE_DIR`. Email goes to the in-memory `test://` outbox |
| Schema coverage guard | `test/account.test.js` fails if any table (other than `schema_migrations` and `mail_sync_state`) is missing from `PURGED_TABLES` |
| Browser journeys | Playwright (Chromium) scripts, run by hand against a running, seeded server (`npm run seed`): `test/e2e-browser.js` (long-term), `e2e-stays-browser.js`, `e2e-inbox-browser.js` (server started with `SMTP_URL=test://`), `e2e-selling-browser.js` (with a platform admin email set), `e2e-booking-browser.js`, `e2e-checkin-browser.js`. Phone-sized viewport. Screenshots go to `SHOTS_DIR` |
| CI | No CI configuration in the repository (**unverified** elsewhere) |
