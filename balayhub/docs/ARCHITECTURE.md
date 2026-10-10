# BalayHub — System Architecture (Stage 3)

## Overview
```
 Browser (phone / desktop)                       Server (Node.js 22, Express 4)                 Data
 ┌──────────────────────────┐   HTTPS + cookie   ┌───────────────────────────────────┐   SQL   ┌──────────────┐
 │ public/ SPA (ES modules) │ ─────────────────▶ │ security headers · CSRF header     │ ──────▶ │ PostgreSQL   │
 │ hash router, 8 screens   │   JSON /api/*      │ session → req.user                 │         │ (one schema, │
 │ drafts in sessionStorage │ ◀───────────────── │ requireWorkspace (verified + org)  │         │  org-scoped) │
 └──────────────────────────┘                    │ routes → access.js scoping         │         └──────────────┘
                                                 │ ledger.js (charges & balances)     │   fs    ┌──────────────┐
                                                 │ files.js (private uploads)         │ ──────▶ │ STORAGE_DIR  │
                                                 │ mailer (SMTP)                      │         └──────────────┘
                                                 └───────────────────────────────────┘
```

**Why this stack:** it is a single deployable service with a relational database, as the spec requires (PostgreSQL, multi-tenant, auditable money). There is no frontend build step, matching the rest of this repository. There are only three runtime dependencies (express, pg, nodemailer).

## Multi-tenancy & permissions
- Each user belongs to one organization (workspace) with role `owner`, `manager` or `staff`.
- `src/lib/access.js` builds every WHERE clause:
  - `propertyScope`: owners get `organization_id = $org`. Other roles also need a row in `property_assignments`.
  - `tenantScope`: tenants with a lease in an assigned property, or not yet placed in a unit.
  - `loadProperty`, `loadUnit`, `loadTenant` and `loadLease` return 404 for anything out of scope, so other workspaces' IDs aren't revealed.
- Role gates (`requireRole`) cover the actions: only owners create or archive properties and manage the team; only owners and managers edit, void, end leases or change maintenance status; staff can create payments, expenses and maintenance requests.
- Staff responses have tenant contact fields removed (`redactTenant`), and lease files are blocked for them.

| Data | Owner | Manager | Staff |
|---|---|---|---|
| Properties & units | Full | Assigned: edit, add units | Assigned: read |
| Tenants | Full | Assigned: full | Assigned: names only |
| Leases & documents | Full | Assigned | Read lease terms; no documents |
| Payments | Record, void | Record, void | Record |
| Expenses | Record, correct, void | Record, correct, void | Record |
| Maintenance | Full | Full | Create, view |
| Reports & dashboard | All | Assigned | Assigned |
| Team | Full | — | — |
| Audit log | All | Own actions | — |

## Data model
See `db/migrations/001_init.sql`. Key decisions:
- `rent_charges` (due) and `payments` (received) are separate tables. Balances are derived using FIFO allocation with a window function (`src/lib/ledger.js`).
- `UNIQUE(lease_id, period)` makes charge generation idempotent. `leases_one_active_per_unit` is a partial unique index.
- `payments` and `expenses` have nullable `idempotency_key` columns with a partial unique index per organization.
- Payments and expenses are voided (`voided_at`, `void_reason`, `voided_by`), never deleted. Properties, units and tenants are archived.
- Occupancy isn't stored; it is derived from active leases. `units.availability` only marks units that are off the market.
- `audit_logs` (JSONB details, before and after values for corrections) and `consent_records`.
- Money is `numeric(12,2)` and is returned to the client as strings. Totals in JS are summed in integer centavos.

## API (all JSON under `/api`, cookie session)
| Area | Endpoints |
|---|---|
| Auth | `POST auth/signup, auth/login, auth/logout, auth/verify-email, auth/resend-verification, auth/forgot-password, auth/reset-password`, `GET auth/me`, `POST workspace`, `GET invitations/:token` |
| Team | `GET team`, `POST team/invitations`, `POST team/invitations/:id/revoke`, `PATCH team/members/:id`, `POST team/members/:id/remove`, `GET audit` |
| Properties | `GET/POST properties`, `GET/PATCH properties/:id`, `POST properties/:id/archive, /restore, /units`, `GET units`, `PATCH units/:id`, `POST units/:id/archive, /restore` |
| Tenants & leases | `GET/POST tenants`, `GET/PATCH tenants/:id`, `POST tenants/:id/archive, /restore`, `GET tenants/:id/export`, `POST leases`, `GET/PATCH leases/:id`, `POST leases/:id/end, /cancel`, `GET leases-expiring` |
| Money | `GET rent`, `GET rent/leases`, `GET/POST payments`, `GET payments/:id`, `POST payments/:id/void`, `GET/POST expenses`, `GET/PATCH expenses/:id`, `POST expenses/:id/void` |
| Maintenance | `GET/POST maintenance`, `GET/PATCH maintenance/:id`, `POST maintenance/:id/costs` |
| Reports | `GET dashboard`, `GET reports?from&to[&property_id]`, `GET reports/export` (CSV) |
| Files | `POST files?record_type&record_id` (raw body), `GET files/:id` |

Errors use `{ error, code, fields? }`. 400 means validation (with per-field messages), 401 means a missing or expired session, 403 means not allowed by role, 404 means not found or out of scope, 409 means a conflict or duplicate (with `duplicates`), and 429 means rate-limited.

## Security plan
- scrypt password hashing. Session tokens are 256-bit random values stored as SHA-256 hashes, with 7-day absolute and 12-hour idle expiry. Cookies are HttpOnly, SameSite=Lax, and Secure in production. A password reset revokes all sessions.
- Single-use verification and reset tokens (48 h and 1 h). Responses don't reveal whether an account exists. Auth endpoints are rate-limited.
- CSRF: mutating requests must include `X-Requested-With: BalayHub`, and CORS is not enabled.
- CSP `default-src 'self'` with no inline scripts or styles, `frame-ancestors 'none'`, nosniff, and HSTS in production.
- XSS: the UI only builds DOM through `h()` with text nodes. CSV export guards against formula injection.
- Uploads: MIME allow-list plus magic-byte check, 10 MB limit, random storage keys outside the web root, mode 0600, permission check on every download, `Cache-Control: no-store`.

## Offline behaviour
The app is online-first. It shows an offline banner, keeps form input (sessionStorage drafts, never passwords), and never reports a save until the server confirms it. Retries are safe because of idempotency keys.

## Known limitations / next steps
- The rate limiter is in-memory, per process. Use Redis or the proxy when running more than one instance.
- File storage is the local filesystem. Move to private S3-compatible storage for multi-instance hosting.
- Rent is billed by calendar month. Prorating partial first months is not supported (set the due day to the move-in day to bill full months in advance).
- Single workspace per user account.
