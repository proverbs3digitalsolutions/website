# BalayHub — Project Plan (Stage 1: Project Initiation)

## Goal
Build, test and deploy BalayHub at high quality with no critical issues, ready for real Filipino landlords.

**Problem:** Landlords managing 5–100 units track tenants, rent, leases, repairs and expenses across Excel, paper, Messenger and bank screenshots. Payments get missed, repairs get forgotten, and profit has to be worked out by hand.

**Success moment:** The owner opens BalayHub and immediately sees how many units are occupied, how much rent has been collected, and how much is still unpaid.

## Users
- **Primary:** landlords and property managers, aged 30–60, in Metro Manila, Cavite, Laguna and other growing rental markets, with basic-to-intermediate smartphone skills.
- **Workspace roles:** Owner, Property Manager, Staff / Accountant. A tenant portal comes later.

## Scope (MVP) — status

| # | Must-have user story | Status |
|---|---|---|
| 1 | Add, edit, view and archive properties | ✅ |
| 2 | Record each property's rental units | ✅ |
| 3 | Add and manage tenant profiles | ✅ (with duplicate warning) |
| 4 | Assign tenants to units with lease details | ✅ (one active lease per unit, enforced in the DB) |
| 5 | Record monthly rent amounts and due dates | ✅ (monthly charges generated from leases) |
| 6 | Record rent payments and payment dates | ✅ (cash, bank, GCash, Maya, check; reference no.; receipt) |
| 7 | View unpaid, partially paid and overdue rent | ✅ |
| 8 | Record property expenses | ✅ (categories, unit, vendor, receipt) |
| 9 | Create and update maintenance requests | ✅ (priority, status workflow, costs, photos) |
| 10 | Central dashboard | ✅ |
| 11 | Income, expense and outstanding reports | ✅ (by property, month and category; CSV export; print) |
| 12 | Secure login and role-based access | ✅ (Owner / Manager / Staff, per-property assignment) |

Should-have items already delivered as part of the core: lease end dates and a 30-day "ending soon" list, security deposit amounts, attaching receipts and lease documents, filters by status, property and search, multiple properties per account, staff invitations with permissions, maintenance costs by property and unit, rental performance by property, Excel-compatible export, and an audit log.

Deferred (should-have and nice-to-have): automated SMS and email reminders, tenant portal, digital receipts sent to tenants, online payments (GCash or Maya through a provider), deposit refund tracking, utilities allocation, e-signatures, calendar, in-app messaging, AI summaries, push notifications, multiple currencies and languages.

## Timeline (build order)
1. Foundation: auth, schema, permissions, responsive shell
2. Property setup
3. Tenant management and leases
4. Financial tracking: charges, payments, partials, expenses, balances
5. Dashboard
6. Maintenance and reports
7. Quality assurance: automated API tests, browser end-to-end journey, code review
8. User testing with real landlords before public launch (**pending**: needs real users)

## Agent roster → how each stage was covered

| Stage | Owner (agent) | Deliverable in this repo |
|---|---|---|
| 1 Project initiation | Product Manager | this file |
| 2 Design & planning | UX/UI Design | screen map below, `public/` UI |
| 3 System architecture | Solution Architect | `docs/ARCHITECTURE.md`, `db/migrations/001_init.sql` |
| 4 Development | Development | `src/`, `public/` |
| 5 Code review & critic | Code Critic | independent review pass; findings and fixes in `docs/QA-REPORT.md` |
| 6 Testing & QA | QA | `test/` (API), browser end-to-end run; results in `docs/QA-REPORT.md` |
| 7 Final review | Checker | requirements traceability in `docs/QA-REPORT.md` |
| 8 Deployment | DevOps | `Dockerfile`, `docker-compose.yml`, README deployment checklist. Production hosting is **not yet provisioned** |
| 9–10 Monitoring and improvement | Support / PM | post-launch backlog above |

## Screen map (Stage 2)
```
Welcome ──Get Started──▶ Sign up ──▶ Verify email ──▶ Create workspace ──▶ Add property ──▶ Add units
   └──Log In──▶ Log in ──(forgot)──▶ Reset password                                              │
                                                                                                 ▼
                         ┌────────────────────────── Dashboard ◀────────────────────────────────┘
                         │  Add Property · Add Tenant · Record Payment · Maintenance · Reports
      ┌──────────┬───────┴──────┬──────────────┬─────────────┬────────────┐
 Properties   Tenants &      Rent &         Reports      Maintenance   Settings
 & Units      Leases         Expenses                                  (team, audit, privacy)
  └ detail     └ profile       └ payment / expense detail   └ request detail
    └ Assign     └ Assign unit, Record payment, End lease, Documents
      Tenant
```

## Acceptance criteria for awkward cases (from the blueprint)

| Situation | Implemented behaviour |
|---|---|
| No properties yet | Dashboard and Properties show an empty state with Add Property (managers and staff see "ask the owner to assign you") |
| No tenants yet | Empty state with Add Tenant plus "Go to Properties" hint. Assigning with no vacant units explains why |
| No payments | Dashboard and Reports show explanatory empty states, not zero charts |
| Wrong password | One generic message whether or not the account exists. Retry or reset |
| No internet | Offline banner. Form input is kept. Saves aren't reported until the server confirms. Retry works |
| Nothing found | "No results found" with Clear search / Clear filters |
| Duplicate property or tenant | 409 with the matching records listed. User can review them or "save anyway" |
| Invalid payment | Negative, zero, malformed and future-dated amounts are rejected on the server |
| Partial payment | Amount is recorded, and the remaining balance and status are recalculated |
| Double-click Save | Button is disabled during the save, plus an idempotency key and a unique index in the DB |
| Unauthorized access | Server scoping returns 404 or 403 with a clear message. Hiding buttons isn't relied on |
| Session expires | Form drafts are kept in sessionStorage. Login returns to the same page and the draft is restored |
| Delete a record | Archive, void or cancel with confirmation. Financial history is never hard-deleted |
