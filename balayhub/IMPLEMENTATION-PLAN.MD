# IMPLEMENTATION-PLAN

What gets built, in what order. Below the plan:

- **Build record:** what each round shipped.
- **Session notes:** dated, append-only.

BalayHub is an existing, deployed app, so "Sprint 0" (mockup) and "Sprint 1" (provisioning) from the Proverbs3 template are already behind us. The plan starts from where the app is today.

Last updated: 2026-10-13

## Plan

### Now — before launch (founder items, see BLOCKERS.MD)

1. Rotate the exposed Gmail app password, and decide on the database password.
2. Backups and Hostinger snapshots, uptime monitor, PayMongo test booking, confirm prices.
3. Founder reviews the eight canon docs and corrects anything that's wrong.

### Next — Sprint A: SMS reminders to guests

**Goal:** guests get texts they actually read, for check-in, check-out, balance due and booking confirmation.

| # | Atom | Done looks like |
|---|---|---|
| A1 | SMS provider adapter (provider chosen in BLOCKERS), configured by env var and a test mode | Sending in tests writes to an outbox. A missing key turns SMS off with a clear message. |
| A2 | Workspace SMS settings: on/off per reminder type, English or Taglish, monthly limit | Owners and managers can change them. Staff can't. |
| A3 | Scheduler sends due reminders, at most once per stay per type, and only to guests with a mobile number | No duplicates after a restart. Cancelled stays are skipped. |
| A4 | SMS log on the reservation, plus a usage count against the monthly limit | Each text shows its time, type and status. Sending stops at the limit and warns the owner. |
| A5 | Phone number normalising (09xx → +639xx) and opt-out ("STOP") handling if the provider supports it | Invalid numbers are flagged, not sent. |
| A6 | Tests, a browser check, and doc updates (PRD, TRD, APP-FLOW, BACKEND-SCHEMA, DECISIONS) | `npm test` passes. The docs match the code. |

Before starting, run `/proverbs3-dfss` analysis on this feature so the requirements (CTQs) are written into DECISIONS.MD and the atoms above can be checked against them.

### Small fixes found while writing these docs (do alongside Sprint A)

- **Starter plan:** show an "upgrade for AI drafts" hint. The server already says so, but the app ignores it.
- **Google sign-in:** check that a brand-new Google sign-up lands on workspace setup and not the landing page. Needs a browser check.
- **Launchpad footer:** point "contact support" to Help & support.
- **Trial banner:** show it only in the last few days, not the whole trial.
- **Dead code:** remove the unused `welcomeView`.
- **Old docs:** update `docs/ARCHITECTURE.md`, `docs/PROJECT-PLAN.md` ("Deferred" list) and `docs/SHORT-TERM-GUIDE.md` (the Launchpad replaced the Home checklist). Align README on 1–10 units and Node 22.
- **Design polish:** fix the dark-mode contrast and hard-coded colour list at the end of DESIGN-BRIEF.MD (soft-green text pairs, login caption, modal background, printing in dark mode, channel colour drift, small tap targets).

### Security and privacy fixes found while writing BACKEND-SCHEMA (do before or with Sprint A)

- ✅ 2026-10-13: Staff no longer receive the guest's private check-in link (it exposed guest phone and email). Covered by a test.
- ✅ 2026-10-13: Gate pass link hides guest ID photos when "Include guest ID photos" is off. The setting now covers both the email and the link, and applies to passes already sent.
- ✅ 2026-10-13: An hourly clean-up job deletes expired or idle sessions and old one-time sign-in tokens.
- ✅ 2026-10-13: The workspace export now includes support messages (without internal staff notes), ticket events and consent records.
- Open: when a stay moves to a unit in another property, its open cleaning task keeps its assignee, who may not be able to see the new property. The fix is to clear the assignee in that case.
- **Encryption key backups:** keep the encryption key out of the uploads backup by always setting DATA_ENCRYPTION_KEY and the VAPID keys in `deploy/.env`. The founder action is in BLOCKERS.
- **Lower priority:**
  - Store guest link tokens hashed.
  - Tighten the file path check.
  - Pass ANTHROPIC_BASE_URL through compose only if ever needed.

### Later

- **Sprint B: Facebook Messenger inbox.** Page messages appear in the Inbox next to email, with replies sent from BalayHub. Needs a Meta app and app review (BLOCKERS).
- **Candidate improvements**, not yet agreed:
  - booking page upgrades (gallery, map, reviews, share link)
  - smarter reports (month-to-month and year-to-year, best and worst listings)
  - recurring expenses
  - an owner portal for unit owners
- **Quality passes:**
  - `/proverbs3-e2e` (journeys per role) and `/proverbs3-qa` (full click-through) on the live site, once a test workspace exists (BLOCKERS)

## Build record

| Date | What shipped |
|---|---|
| 2026-10-10 | MVP for long-term rentals: properties, units, tenants, leases, rent, payments, expenses, maintenance, reports. Hostinger deployment. Review fixes and the first QA report. |
| 2026-10-12 | Short-term module: listings, reservations, guests, multi-calendar, rates and blocks, iCal sync, Home overview. Inbox with templates, automatic messages and AI drafts. Housekeeping. Receipts. Plans, trial, demo, platform admin. Landing page. Google sign-in. Email setup. |
| 2026-10-13 (later) | Eight canon docs and CLAUDE.md. Staff no longer receive guests' check-in links. Discount codes and message templates are owner-only (D-28). Cleaning tasks can only go to people who can see the property (D-29). The gate pass link respects the guest ID setting. Expired logins are cleaned up hourly. The export is fuller. 182 tests pass. |
| 2026-10-13 | Onboarding Launchpad and guest check-in form. PayMongo plan payments. Launch readiness (terms, password change, export, deletion, health check). Direct booking page and pay-the-balance links. New brand. Installable app and push notifications. Pricing helpers. Owner statements. Reviews, repeat guests and discount codes. Condo gate pass. Security deposits. Short-term reports and tax summary. Taglish for guests. Four-agent QA sweep with fixes. New landing page with a 3-step Get started and EN/TL. Light and dark mode. Help center and support tickets. BalayHub assistant (off until a key is added). Filters on every list page. My account page and the hidden Log out fix. 169 automated tests pass. |

## Session notes

- **2026-10-13** · Founder parked the AI chatbot: it stays off until ANTHROPIC_API_KEY is set (D-15).
- **2026-10-13** · Adopted the Proverbs3 toolkit. The eight canon docs and the project CLAUDE.md were written from the existing code. Next feature: SMS reminders (Sprint A), pending founder choices in BLOCKERS.MD.
