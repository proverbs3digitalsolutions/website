# DECISIONS

Every decision made on BalayHub, with the date and the reason. Newest decisions go at the bottom. When a decision changes, add a new entry and mark the old one **Superseded by D-xx**. Never delete history.

Last updated: 2026-10-13

---

## Product

**D-01 · 2026-10-10 · Who BalayHub is for.** Filipino hosts with about 1–10 units: condo staycations on Airbnb, Booking.com and Agoda, plus small long-term landlords (apartments, boarding houses, dorms, bedspaces). *Why:* the big global tools (Guesty, Hostaway) are priced and built for large operators, and nothing local fits a 3-unit condo host who collects by GCash.

**D-02 · 2026-10-12 · One app, two modules.** Short-term stays and long-term rentals live in one workspace. The owner chooses short-term, long-term or both, and the menu follows that choice. *Why:* many hosts run both. Two separate products would mean two logins and two bills.

**D-03 · 2026-10-12 · Plans and prices.** 14-day free trial (10 listings, AI on); Starter ₱499/month (2 listings); Growth ₱999 (5 listings, AI); Pro ₱1,799 (10 listings, AI); Complimentary for special cases. Only short-term listings (units with a nightly rate) count toward the limit. *Why:* priced for a 1–10 unit host, and long-term rooms shouldn't push a landlord into a higher plan. Final prices are still to be confirmed (see BLOCKERS).

**D-04 · 2026-10-12 · Ended trials and overdue plans become view-only.** The data is never locked away or deleted for non-payment. Grace period: 7 days after paid-until. Support, billing, sign-in and account pages stay usable. *Why:* hosts must never lose their bookings, and must always be able to pay or ask for help.

**D-05 · 2026-10-12 · A public read-only demo workspace.** *Why:* lets prospects try BalayHub before signing up, with nothing they do saved.

**D-06 · 2026-10-12 · Channel sync uses iCal calendar links, not channel APIs.** *Why:* Airbnb, Booking.com and Agoda APIs need partner approval that small hosts can't get. iCal works for everyone today. Trade-off: guest names and prices from channels aren't imported, and sync runs every 30 minutes.

**D-07 · 2026-10-13 · Guests pay the host directly through the host's own PayMongo account** (direct booking page and pay-the-balance links). BalayHub never holds guest money. *Why:* no money-handling licence needed, and hosts get paid straight away. Platform plan payments go through BalayHub's own PayMongo account.

**D-08 · 2026-10-13 · Security deposits are tracked separately from booking income.** *Why:* a deposit is the guest's money until it's returned. Counting it as income would overstate earnings and taxes.

**D-09 · 2026-10-13 · Host screens are in English; guest-facing pages and messages offer English or Taglish/Tagalog.** *Why:* hosts are comfortable in English, while many guests prefer Tagalog. Translating the whole host app would slow every future feature.

**D-10 · 2026-10-13 · Staff see only what their job needs.** No guest phone or email, no inbox, no stay reports, no pricing changes, and only their own sections in Settings. Long-term staff can see the dashboard and reports for their assigned properties. Managers see only their assigned properties. *Why:* the Data Privacy Act and owners' trust. Cleaners and front-desk staff don't need guest contact details.

**D-11 · 2026-10-13 · Guest ID photos are deleted automatically after the retention period** (default 30 days after check-out, GUEST_ID_RETENTION_DAYS). Only owners and managers can view them. *Why:* Data Privacy Act data minimisation.

**D-12 · 2026-10-13 · Workspace deletion has a 14-day grace period** before data is permanently removed, and the owner can cancel it. *Why:* protects against mistakes and account takeover.

**D-13 · 2026-10-13 · Light and dark mode follow the brand palette** (Forest Green, Sage, Sand). The default is "match device". *Why:* the user asked for a choice that stays on-brand.

**D-14 · 2026-10-13 · Support is built in.** A help center, plus tickets with a visible progress tracker (Received → In progress → Waiting for you → Resolved), reopen within 14 days, auto-close 7 days after resolved, and a 1–5 rating. Support replies show as "BalayHub Support". *Why:* the user wanted hosts to see every step of their request.

**D-15 · 2026-10-13 · The BalayHub assistant (chatbot) is built but switched off.** It turns on only when ANTHROPIC_API_KEY is set on the server. It answers only from the help guides and the user's role and page, never from guest or booking data. Default model claude-opus-5-5; ASSISTANT_MODEL=claude-haiku-5-5 is the cheaper option. Limits: 40 questions per person per hour, 300 per workspace per day. *Why:* support at any hour without exposing guest data. **2026-10-13 update:** the founder parked the chatbot ("let's leave the AI chatbot"). It stays off until a key is added.

**D-16 · 2026-10-13 · Every list page gets its own filters, remembered per person in their browser** (localStorage) and reflected in the page address so links can be shared. Voided payments and expenses are hidden by default. *Why:* the user asked for flexible, relevant filters on every tab. Server-side storage of filters wasn't needed.

**D-17 · 2026-10-13 · A My account page** shows profile, workspace and role, assigned properties, signed-in devices with remote sign-out, preferences, support status and recent activity. *Why:* the user couldn't find Log out, and wanted one place to check their own information.

**D-18 · 2026-10-13 · Build order for what's left:** SMS reminders next, then the Facebook Messenger inbox last. *Why:* the founder chose "2 and 6 at last". SMS needs only a local SMS provider. Messenger needs a Meta app review that can take weeks.

## Technical

**D-20 · 2026-10-10 · Stack:** Node.js + Express + PostgreSQL, with a plain-JavaScript single-page app (no framework, no build step). *Why:* small, fast, cheap to host, and easy for one developer to maintain. A strict Content Security Policy is easier without a framework.

**D-21 · 2026-10-10 · Hosting on the founder's Hostinger VPS** with Docker Compose (Caddy for HTTPS, app, Postgres). Updated with `./deploy/update.sh`, which backs up, pulls and rebuilds. Database migrations run automatically on start. *Why:* a predictable monthly cost, and the founder already has the VPS.

**D-22 · 2026-10-10 · Secrets live only in `deploy/.env` on the server** (never in git and never in chat). Hosts' PayMongo keys are encrypted in the database with DATA_ENCRYPTION_KEY. *Why:* security. Passwords were exposed in screenshots more than once, so this rule is strict.

**D-23 · 2026-10-12 · Email through the founder's Google Workspace mailbox** (SMTP to send; IMAP to read guest replies via plus-addressing). *Why:* no extra email service to pay for. This can switch to Hostinger email by changing SMTP_URL.

**D-24 · 2026-10-13 · AI uses Anthropic Claude through the official SDK** (`@anthropic-ai/sdk`). Inbox reply drafts default to claude-haiku-5-5 (AI_MODEL). The assistant defaults to claude-opus-5-5 with server-side refusal fallback. *Why:* reliable, and the default can be swapped per feature in `deploy/.env`.

**D-25 · 2026-10-13 · Quality process.** Every feature ships with automated tests (`npm test`, now 169 passing) and a browser check. Independent review agents are used only for payment and security features, to save cost. *Why:* the founder asked to keep usage costs down.

**D-26 · 2026-10-13 · Work happens on the branch `claude/trusting-hopper-lyg8vu`,** and the server pulls that branch. *Why:* this is the branch the session was set up with. Merging into a main branch is a later decision (see BLOCKERS).

**D-27 · 2026-10-13 · Adopt the Proverbs3 toolkit (p3ds-skills) and its eight canon docs** (PRD, TRD, APP-FLOW, DESIGN-BRIEF, BACKEND-SCHEMA, IMPLEMENTATION-PLAN, DECISIONS, BLOCKERS) at the app root. They are written from the existing code and docs, not from a fresh interview. *Why:* to agree in writing on what BalayHub is and what comes next before more is built. Heavier toolkit commands (sprint, QA, DFSS) are kept for big pieces of work because they cost more.

## Access (founder decisions)

**D-28 · 2026-10-13 · Workspace-wide guest-messaging settings are owner-only.** Only owners can create or change discount codes, edit message templates or switch the template language. Managers can still read and use them. *Why:* a manager may look after only some properties, so they shouldn't change settings that affect every property. Automatic messages were already owner-only.

**D-29 · 2026-10-13 · Cleaning tasks can only be assigned to someone who can see that property.** Owners always qualify. Managers and staff must be assigned to the task's property. Outside cleaners without a login and "not assigned" remain allowed. *Why:* otherwise the assignee can't open their own task. BalayHub blocks it rather than warning.

