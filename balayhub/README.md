# BalayHub

BalayHub is a rental property management app for Filipino landlords and property managers (5–100 units). It keeps properties, units, tenants, leases, rent, expenses, repairs and reports in one place, so they no longer have to piece things together from spreadsheets, notebooks and Messenger threads.

This folder holds the MVP: a Node.js + PostgreSQL web app. It is mobile-first and online-first, and needs no build step.

## Quick start

Requirements: Node.js 20 or newer, and PostgreSQL 14 or newer.

```bash
cd balayhub
npm install
createdb balayhub                       # or point DATABASE_URL at any empty database
cp .env.example .env                    # then edit it; export the variables or use your process manager
npm run seed                            # optional demo data (demo@balayhub.test / demo-password-1)
npm start                               # runs migrations, then serves http://localhost:3000
npm test                                # API tests (uses the balayhub_test database)
```

In development, email isn't sent unless `SMTP_URL` is set. Verification and reset links are printed to the server log, and the UI shows them on screen. Both behaviours turn off when `NODE_ENV=production`.

## Short-term rentals (Airbnb / staycations)

Workspaces can run **short-term**, **long-term** or **both**. The short-term module includes:
- a homepage with a daily overview, trends and revenue
- a multi-calendar with nightly prices and blocks
- reservations with saved views, payments and check-in/out
- listings with cleaning status
- guests
- Airbnb/Booking.com/Agoda calendar (iCal) sync

See [`docs/SHORT-TERM-GUIDE.md`](docs/SHORT-TERM-GUIDE.md).

## What's in the MVP (long-term)

| Screen | What it does |
|---|---|
| 1. Welcome | Explains the product, with Get Started and Log In |
| 2. Sign up / Log in | Account, email verification, password reset, Privacy Notice acceptance, then workspace setup |
| 3. Dashboard | Properties, occupied/vacant units, rent collected this month, outstanding and overdue rent, this month's rent status, recent payments, and a "Needs attention" list (overdue tenants, leases ending, open repairs) |
| 4. Properties & Units | Add, edit, archive or restore properties and units. Occupancy comes from leases. Assign a tenant from a vacant unit |
| 5. Tenants & Leases | Tenant profiles, search, duplicate warnings, assigning a unit (creates a lease), changing terms, ending or cancelling a lease, lease documents, payment history, monthly charges |
| 6. Rent & Expenses | Rent due by status (overdue, partial, due, paid), recording payments (full or partial, with receipts), voiding with a reason, expenses with receipts, corrections, voids |
| 7. Reports | Any date range, by property, by month, by expense category, outstanding balances, CSV export (opens in Excel), print to PDF |
| 8. Maintenance | Requests by property and unit, priority, status workflow, repair costs (saved as expenses), photos |
| Settings | Team invitations, roles, per-property access, audit history, privacy |

## How the money works

- **Charges** (what is due) are created monthly from each lease, up to and including the current month (Asia/Manila time). If the due day doesn't exist in a month (say the 31st), rent is due on that month's last day.
- **Payments** (what was received) are stored separately. A lease's payments go to its oldest charge first. A charge's status is `paid`, `partial`, `unpaid` or `overdue` (past due with a balance left).
- The dashboard, rent screen and reports all calculate from these two tables, so no total is ever typed in or stored.
- Money is stored as `NUMERIC(12,2)` in PHP. Negative and zero amounts are rejected.
- Payments are never edited or deleted. A mistake is voided with a reason (which is logged) and then re-entered. Expenses can be corrected (old values go to the audit log) or voided.
- A double-clicked or retried save is recorded only once. Each form sends an `Idempotency-Key`, and the database enforces it with a unique index.

## Security & access

- Multi-tenant: every query is scoped to the user's workspace on the server. Records in another workspace return 404.
- Roles:
  - **Owner** has full access.
  - **Property manager** works only on the properties they're assigned. They can't create properties or manage the team.
  - **Staff / accountant** works only on assigned properties. They can record payments, expenses and repair requests. They can't see tenant contact details or lease documents, and can't edit or void anything.
- Passwords are hashed with scrypt. Sessions use HttpOnly SameSite cookies with absolute and idle expiry, and a password reset signs out every session. Login errors don't reveal whether an account exists, and login attempts are rate-limited.
- Mutating API calls must send a custom header (CSRF defence). The app sets a strict Content-Security-Policy, and all UI rendering uses text nodes (no `innerHTML`).
- Uploads (PDF, JPG, PNG, WEBP up to 10 MB) are checked by their file signature, stored outside the web root, and served only after a permission check.
- Data Privacy Act support: Privacy Notice acceptance is recorded at sign-up (`consent_records`), owners can export a tenant's data for access requests, and important actions are audit-logged.

## Configuration

See `.env.example`. Important settings for production:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public URL, used in email links |
| `SMTP_URL` / `MAIL_FROM` | Transactional email for verification, password reset and invitations |
| `STORAGE_DIR` | Private directory for uploads. Use a persistent volume and back it up |
| `TRUST_PROXY` | Number of reverse-proxy hops to trust (`1` behind a single HTTPS proxy). Keep `0` if the app is exposed directly |
| `NODE_ENV=production` | Secure cookies, HSTS, and hides development links |

## Deploying

**Hostinger VPS (or any Ubuntu server):** follow [`docs/DEPLOY-HOSTINGER.md`](docs/DEPLOY-HOSTINGER.md). It uses `docker-compose.prod.yml` (Caddy with automatic HTTPS, the app, and PostgreSQL) plus `deploy/backup.sh` and `deploy/update.sh`.


`docker compose up --build` runs the app with PostgreSQL. To use a managed host (Render, Railway, Fly.io, a VPS), build the `Dockerfile` and set the environment variables. Before launch, also set up:

1. Managed PostgreSQL with automated daily backups and point-in-time recovery.
2. A persistent, backed-up volume for `STORAGE_DIR` (or switch `src/routes/files.js` to private S3-compatible storage).
3. HTTPS in front of the app; set `TRUST_PROXY=1` so rate limiting sees real client IPs.
4. An SMTP provider (Postmark, SES, Mailgun or similar) for verification and reset emails.
5. Error monitoring and uptime checks.
6. Privacy review: see `docs/PRIVACY-CHECKLIST.md`.

This app runs separately from the static marketing site in the repository root.

## Project layout

```
balayhub/
  db/migrations/      SQL schema (applied automatically at start)
  src/
    server.js         Express app, security headers, error handling
    lib/              auth & sessions, access scoping, ledger (charges/balances), validation, audit, mail
    routes/           auth, team, properties/units, tenants/leases, money (rent/payments/expenses), maintenance, reports, files
  public/             the web app (vanilla ES modules, no build step)
  scripts/            migrate, seed
  test/               API tests (node:test, real PostgreSQL)
  docs/               plan, architecture, QA report, privacy checklist
```

## Not in this MVP (planned next)

Automated SMS and email rent reminders, a tenant portal, online payments (GCash or Maya through a payment provider), push notifications, deposit refund tracking, utility billing, and e-signatures. These are listed as should-have and nice-to-have in `docs/PROJECT-PLAN.md`.
