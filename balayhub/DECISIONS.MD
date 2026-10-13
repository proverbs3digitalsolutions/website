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

## Product direction

**D-30 · 2026-10-13 · BalayHub aims to be "a Guesty for Filipino hosts", built in-house.** It will cover services, features, scheduling and finance on one platform, for hosts with 1–10 units. New work excludes integrations (channel-manager APIs, an open API, marketplaces, smart locks, accounting sync) and new AI features. *Why:* founder request. Competing on peso pricing, local payments, condo and BIR needs, Taglish and simplicity beats copying Guesty's integration ecosystem. The roadmap comes from the research in `docs/research/00-SUMMARY.md`. Official two-way channel APIs (previously "later phase") are excluded for now.

## Phase 1: money (2026-10-13)

**D-31 · 2026-10-13 · Extra charges raise the stay total.** A new `extras_total`, the sum of non-voided extra charges, is part of `total_amount`, so the existing balance, pay links, receipts and reports include extras automatically. Only owners and managers add or void charges; staff can view them. Charges can be added after check-out, because damage is often found after the guest leaves. Any charge change closes open online-payment links so a guest can't pay an old amount.

**D-32 · 2026-10-13 · Voiding a charge after the guest paid is allowed.** The reservation then shows "Guest overpaid by ₱X — record a refund" to owners and managers. *Why:* blocking the void would leave a wrong bill. A visible warning plus the refund log keeps the money traceable.

**D-33 · 2026-10-13 · Cancellation policy presets.**
- Flexible: full refund up to 1 day before check-in.
- Moderate: full refund up to 5 days before; 50% after that, including after check-in.
- Strict: 50% up to 7 days before; nothing after.
- Non-refundable: nothing.
- Custom: the host's own text, with no automatic suggestion.

Suggested refunds round half a centavo up. The suggestion uses the listing's *current* policy, not the one in force when the guest booked. Saving the policy at booking time is a possible later improvement.

**D-34 · 2026-10-13 · Refunds are a record, not a balance change.** Refunds are logged separately (amount, date, method, reference, reason) and capped at the amount paid. They don't change the balance formula. Refunds are protected against double saving.

**D-35 · 2026-10-13 · Deposit percentage per listing (10–90%, default 50%).** This replaces the fixed 50% for direct bookings. Existing listings keep 50%.

**D-36 · 2026-10-13 · Manual payments with proof.**
- Owners turn on manual payments and write their GCash, Maya or bank details.
- Guests send a proof (amount, method, reference, screenshot) on the pay page. The host confirms it, which records the payment and can send a receipt, or rejects it with a reason, which is emailed to the guest.
- Proofs are refused for cancelled stays, fully paid stays, or after check-out, matching the online checkout rule.
- A proof larger than the current balance can't be confirmed. The host records the right amount by hand instead.
- Proof screenshots are visible to owners and managers only.

*Why:* many Filipino guests pay by GCash or bank transfer, and hosts need these payments inside BalayHub's records.

**D-37 · 2026-10-13 · Reports and owner statements with extras and refunds.**
- Extras count as revenue, in the stay's check-in month, like cleaning and other fees. Average nightly rate stays accommodation-only.
- The income summary shows payments received, refunds (by refund date) and net received.
- Owner statements include extras in the owner's gross, as other fees already are, and have a "Less refunds" line for refunds on the owner's confirmed stays in that month. A refund that only returns an overpayment doesn't reduce the owner.
- The management fee is worked out after refunds.

*Why:* this follows the existing logic, and owners shouldn't be paid for money that went back to guests. These choices are open to founder change (see BLOCKERS, owner fees).

**D-38 · 2026-10-13 · Payment-proof safeguards (from the security review).**
- At most 5 pending proofs per booking.
- A proof can't be confirmed if its reference number matches one already confirmed on the same booking.
- The balance check runs after the booking lock, so two proofs confirmed at the same moment can't both be recorded.
- A refund retry key that was already used on another booking is refused (409).
- The guest's bill no longer shows the booking platform's commission. Anything already settled outside BalayHub shows as one neutral "Adjustments" line, so the bill still adds up.
- Downloads of payment proofs and payment files are recorded in the audit log.


**D-37 confirmed · 2026-10-13 · Founder kept the D-37 owner-statement choices and the manual-payment cutoff at check-out** ("keep your choices"). Phase 2 starts on that basis.

**D-39 · 2026-10-13 · Owner portal is a separate sign-in, not a team member.**
- Unit owners never get a `users` row and never sign in to the workspace. They sign in with a one-time link emailed to them (no password). The link is valid for 30 minutes and works once.
- A sign-in creates a separate session: cookie `bh_owner` (HttpOnly, SameSite=Lax, Secure in production), stored in `owner_sessions` as a hash. A session lasts 30 days, or 7 days if idle.
- Portal routes live under `/api/owner-portal/*`, mounted before the workspace sign-in. They check the owner cookie, and the plan guard doesn't apply to them.
- Owners see only their own units. They never see guest phone numbers or emails (guests appear by first name), payment proofs, other owners, or the workspace's other data.
- The host turns access on with "Invite to owner portal" (needs the owner's email) and off with "Turn off portal access". Turning access off signs that owner out everywhere.

*Why:* an owner is not staff. They need their own numbers and nothing else, and a link is easier for a business owner than a password they might lose.

**D-40 · 2026-10-13 · Fee types per owner.**
- Each owner has one fee type: `net_pct` (the default, and the rule BalayHub already used), `gross_pct`, or `flat`.
- `net_pct`: the fee is a percentage of net rental income, after channel fees, cleaning fees the manager keeps, and refunds.
- `gross_pct`: the fee is a percentage of gross bookings after refunds only.
- `flat`: a fixed monthly fee, charged in any month the owner has at least one active unit, even with no stays checked out.
- The fee is never negative. Existing owners stay on `net_pct`, so their statements don't change.

*Why:* some owners pay a fixed fee, and some hosts charge on gross. The default keeps every existing statement the same.

**D-41 · 2026-10-13 · Review, then publish and send.**
- Statements are still worked out live while they are drafts. "Publish" stores a frozen copy (`owner_statements.snapshot`, the full statement result). The owner portal and the emailed statement show that copy, never the live numbers.
- There is one statement per owner per month. A month can be published only after it has ended (Manila time).
- Sending needs a published statement. The email has the plain-text statement and, if portal access is on, a link to the portal.
- Print is a print stylesheet on the statement page (browser "Save as PDF"). No PDF file is generated on the server.
- On the 3rd of each month (Manila time), an hourly job drafts last month's statements for every owner with an active unit and emails the workspace owner "n statements ready to review". It runs once per workspace per month, and it never publishes or sends anything to an owner.

*Why:* the owner must see the same numbers that were checked, and nothing reaches an owner without a person's review.

**D-42 · 2026-10-13 · Payouts are records.**
- A payout is a record of money already paid to an owner: amount above zero, date paid (not in the future), method (`gcash`, `maya`, `bank_transfer`, `cash` or `other`), reference number, note, and an optional month it pays for.
- Payouts are voided with a reason, never deleted.
- The statement shows "Paid ₱X of ₱Y" for its month. Saving a payout accepts an `Idempotency-Key`, so a retry doesn't record the payout twice.

*Why:* BalayHub records payments; it does not move money. Voiding keeps the trail that an owner or the tax record may need.

**D-43 · 2026-10-13 · Repairs reserve.**
- Each owner has a reserve target and a monthly top-up (both default 0, which switches the reserve off).
- On a statement, the top-up is the smallest of: the monthly amount, what is left to reach the target, and the payout before the top-up. It is never below zero and is taken from the payout.
- Publishing adds a deposit to the reserve. Unpublishing voids that deposit.
- The host records withdrawals by hand, with a date and a required note, when the reserve pays for a repair. The balance can't go below zero.

*Why:* owners keep money aside for repairs, and the host should not pay out money that is needed for them.

**D-44 · 2026-10-13 · Profit and loss per unit.**
- For each unit, for one month: stays (checked out in the month), nights, gross bookings, channel fees, refunds (same overpayment rule as the statements), expenses (not voided, by expense date), and net (gross − channel fees − refunds − expenses).
- Expenses with no unit appear as one "Not linked to a unit" row. This row is left out of the owner portal.
- Owners and managers see it (managers only for their properties). Staff get 403. The CSV has the same table.
- Owners see their own units only in the portal.

*Why:* hosts want to know which unit makes money, and expenses that are not linked to a unit must not disappear.

**D-45 · 2026-10-13 · Agreed changes to the Phase 2 spec, as built.**
- Publishing a month that is already published returns 409 (`ALREADY_PUBLISHED`). To correct it, unpublish first, then publish again.
- Unpublishing clears the sent record (date and address). It is refused (409) if the repairs reserve has already paid out money that this statement added. Void that withdrawal first.
- A flat-fee owner with no stays still owes the fee. The statement and the owner screens say the owner owes the host, and there is nothing to pay out.
- The P&L counts guest cleaning fees as unit income. The owner statement does not count cleaning fees the manager keeps. P&L is the whole unit's result; the statement is the owner's share.
- The owner portal's block-overlap message doesn't name the guest or the booking.
- Owner statements keep each booking's confirmation code, so owners can match them with their Airbnb or Booking.com payouts. As built, the code is kept in the published statement data, but no screen or email shows it yet. This is open; see BACKEND-SCHEMA section 7.
- Payout notes are visible to the owner. Hosts write them for the owner.

*Why:* these came up while building Phase 2, and the founder agreed each one.

**D-46 · 2026-10-13 · Owner portal history follows the unit; security review additions to D-39 and D-45.**
- Portal history belongs to the unit. If a unit moves to a new owner, the new owner sees that unit's past bookings and activity in the portal. A host who doesn't want that uses a new listing.
- Changing or clearing an owner's email signs out that owner's portal sessions and cancels their unused sign-in links. Clearing the email also turns portal access off.
- Owners can't block or unblock dates while the workspace is view-only (trial ended, payment overdue, or demo).
- Creating or cancelling an owner block is limited to 20 per hour per owner.
- The sign-in link is removed from the address bar once it has been used.
- Status: all four are in the code and covered by tests (2026-10-13).

*Why:* the security review found that an owner's access must end when the owner changes, and that blocks must follow the same read-only rules as the rest of the workspace.

**D-47 · 2026-10-13 · Confirmation codes on owner statements are stored, not printed.** This updates D-45. The published statement keeps each stay's confirmation code in its stored copy, but screens and emails don't show it, because the stays table is already wide on phones. Owners match stays with channel payouts by dates, unit and guest first name. Host file downloads with emoji or non-Latin names now work (same fix as the owner receipt download).

**D-48 · 2026-10-13 · Cleaner role, denied by default (as built).** Workspace role `cleaner` added to users and invitations. One guard, `cleanerGuard` in `src/lib/cleaner.js`, sits in front of the API. A cleaner reaches only the routes on its allow-list: their own account, notifications, support and help; cleaning jobs, board and calendar; files on cleaning, damage and lost-and-found records; damage, lost-item, supplies and work-order actions on a job; the supply list; and their own pay. Any other route answers 403 `CLEANER_FORBIDDEN`, including routes added later, until someone adds them to the list. A cleaner must have at least one property. A cleaner sees only their own jobs and jobs nobody has been given, in their properties. A cleaner can't cancel a job.
*Why:* a cleaner must never see booking money, guest contact details or other cleaners' pay. A list that is closed by default stops a new route from leaking to cleaners.

**D-49 · 2026-10-13 · Unit cleaning status gains "inspected" (as built).** A unit is dirty, clean or inspected. Check-out makes it dirty. A finished job makes it clean. A passed inspection makes it inspected. A failed inspection makes it dirty and reopens the job with the failed items unticked. A pass changes the unit only while it is still clean, so a newer check-out stays dirty. Anything that treated "not dirty" as ready keeps working.

**D-50 · 2026-10-13 · Inspections and cleaner scores (as built).** Owners and managers inspect a finished job: pass or fail for each checklist item, with notes up to 1,000 characters. Score = passed items ÷ items × 100, rounded. Pass = no failed items. Results are stored in `cleaning_inspections`. A cleaner's quality score is the average of their inspected jobs in the month, shown on Housekeeping → Scores with fails and jobs done.

**D-51 · 2026-10-13 · Damage reports (as built).** Anyone who can see a job, a stay or a unit can report damage: description, optional estimate, photos. Owners and managers resolve each report once: **charge the guest** (adds a damage extra charge to the stay and updates its total), **deduct from deposit** (the deposit settle form is pre-filled with the total of open and deducted reports), or **waive** (with a note). A report on a unit with no stay can only be waived. Cleaners never see amounts and see only reports they filed.

**D-52 · 2026-10-13 · Cleaner pay (as built).** Each cleaner has a rate, per clean or per hour. The cleaner is a team member, or an outside cleaner typed by name. The payee is the assigned team member, else the outside cleaner's name, else whoever marked the job done. When a job is marked done, its pay is set from the rate. Per hour is the time from start to finish, rounded up to the next 15 minutes, capped at 12 hours. Owners and managers can change the amount until it is paid. Mark paid takes several finished cleans with a date (not in the future), a method (cash, GCash, Maya or bank transfer) and a reference. An optional tick records one `cleaning` expense per unit, naming the cleaners and the count. Owners can undo a payment. Cleaners see only their own pay (`GET /my-pay`).

**D-53 · 2026-10-13 · Supplies with par levels (as built).** Per property: name, unit label, par level and on-hand count. Counts, restocks and uses are logged and update on-hand. Low stock = on hand below par; Home and the supplies page show it. No costs, no purchasing.

**D-54 · 2026-10-13 · Lost and found, work orders and recurring maintenance (as built).** Lost items: description, where found, date, photos, status held → returned or disposed. Guest contact for returning an item stays on the reservation. Work orders: a cleaner raises a maintenance request from a job, which is a normal request with the job linked. Recurring: a schedule per property or unit (title, every N days or months, next due date, priority). An hourly job opens one request when due, does nothing if the last request from that schedule is still open, and then moves the due date past today.

**D-55 · 2026-10-13 · Deviations from the Phase 3 spec, agreed in the build.**
- A paid clean is locked. Its status can't change, its pay can't change, and a failed inspection can't reopen it (refused with a 409).
- An inspection of a job with an empty checklist is refused.
- Passing an inspection marks the unit inspected only if it is still clean.
- Who gets paid: the assigned team member, then the outside cleaner's name, then whoever marked the job done.
- Cleans paid together share one expense per unit, and must be undone together.
- A clean with zero pay creates no expense.
- Payment dates can't be in the future.
- A rate change applies to cleans finished after the change only.
- Supplies used beyond stock stop at zero, and the note keeps the amount asked for.
- A recurring schedule doesn't stack a second request while one is open, and doesn't backfill missed dates.
- Cleaners can't add photos to a work order. They add photos to the cleaning job instead. (Spec D-54 allowed photos on work orders.)
- The suggested deposit deduction is hidden from staff (owners and managers only).
- Cleaners don't see jobs assigned to an outside cleaner by name.
- Cleaning push notifications don't go to cleaners yet.
*Why:* each one closes a gap found while building: money changing after it was paid, empty inspections passing, and cleaners seeing money or other people's work.

**D-56 · 2026-10-13 · Phase 3 security review fixes.** Review verdict PASS. Fixed before release:
- Cleaners can only move a job forward (to do, in progress, done). They can't reopen a finished job, so one cleaner can't take another's pay. A job nobody was assigned to is assigned to whoever marks it done.
- Changing the pay or the cleaner on a paid job is refused, and the edit locks the job first so it can't race "Mark paid".
- Cleaners see the cost estimate and outcome only on damage reports they filed themselves.
- Cleaners now get the "cleaning assigned to you" notification. Recurring maintenance due dates must be between a year ago and five years ahead, and the next due date is worked out in one step.
- The browser check also hid the Reopen button from cleaners, stopped the app asking for the inbox count and the help assistant for cleaners, and redrew the cleaning calendar as one row per day.
