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

**D-57 · 2026-10-13 · Guidebook per listing (as built, Phase 4).**
- One guidebook per listing: arrival, parking, building and gate notes, local tips, emergency contacts. Each has an optional Taglish version. The listing's own check-in instructions and house rules have no Taglish version yet.
- The door code is stored encrypted. Owners and managers can read it; nobody else can.
- Each booking gets a private guest link (`#/guide/<token>`). The link is made the first time it's needed. It works from 14 days before check-in to 2 days after check-out, and only for confirmed stays. Cancelled stays get no link.
- The Wi-Fi password and door code show from the day before check-in through check-out day (Manila time). Before that, the page says the day they'll appear.
- Messages: `{{guidebook_link}}`, `{{door_code}}` and `{{wifi_password}}`. The two codes follow the same window; outside it they read "(shared the day before check-in)".
- The audit log records which fields changed, never their values.
*Why:* guests need the codes at the right time, and a door code shouldn't sit in plain sight for months.

**D-58 · 2026-10-13 · House rules acceptance (as built, Phase 4).**
- If a listing has house rules, the booking page and the quote page refuse payment until the guest ticks the box.
- The check-in form asks once, and only if no acceptance is on file yet. The time and the exact text go on the booking.
- The reservation shows "House rules accepted on …" with the text, for owners and managers.
*Why:* a dated record of what the guest agreed to is the host's protection if there's a dispute.

**D-59 · 2026-10-13 · Paid add-ons (as built, Phase 4).**
- Owners create, edit and archive add-ons. Managers can read them. Staff and cleaners can't see them.
- Pricing: per stay, per night, per guest, or per guest per night. Quantity 1 to 20. Each add-on can be limited to some listings (none picked means all).
- An add-on can be offered on the booking page, before arrival, or both. Before arrival means on the guest's pay page, until check-in day.
- Each add-on bought becomes an "addon" extra charge. The name and unit price are copied onto the charge, so editing the add-on later never changes past stays.
- Add-ons can't be bought on cancelled stays, demo workspaces, or read-only workspaces.
*Why:* add-ons earn money without new screens, and each one lands in the same bill, receipt and statement as other charges.

**D-60 · 2026-10-13 · Quotes (as built, Phase 4).**
- Owners and managers make a quote for one listing and one set of dates. Price fills in from the pricing engine and can be changed. Payment is full or deposit, as the listing allows.
- The dates are checked as free when the quote is made, but not held. The usual 30-minute hold starts only when the guest starts paying.
- The quote link is `#/quote/<token>`. The guest accepts the house rules, fills in any missing details, and pays through the host's PayMongo key, the same way as a direct booking.
- Confirmed quotes make a booking with channel direct and source quote.
- Quotes expire by themselves. Default 48 hours; the maximum is 14 days. Expiry is checked on every read and in the follow-up job.
- The host can cancel an open quote. That also ends any open payment page for it.
- "Send by email" works only if the quote has a guest email. Otherwise the host copies the link.
*Why:* a Facebook or Messenger inquiry needs a real price and a link the guest can pay from, without blocking the dates for people who never pay.

**D-61 · 2026-10-13 · Sources and share links (as built, Phase 4).**
- Share a listing's booking page with `?src=<source>`. The source is kept for the whole visit and saved on the booking.
- Allowed sources: facebook, instagram, messenger, viber, tiktok, google, whatsapp, email, referral, quote and other. Anything else is ignored.
- Stay reports have a "By source" table for direct bookings: stays, nights and revenue per source.
- No tracking cookies.
*Why:* the host learns which posts bring bookings, without tracking guests.

**D-62 · 2026-10-13 · Reviews, returning guests and follow-up (as built, Phase 4).**
- Public review links: up to 4 links, each with a label and an https address of 300 characters or fewer. Only guests who rate 4 or 5 stars see them, after the private rating. Ratings of 3 or fewer stay private, and the host is alerted as before.
- Returning-guest codes: the owner sets a percentage from 1 to 50, or turns it off. Each guest who has checked out gets one personal code, used once, valid 12 months. The code is made the first time a message uses `{{returning_guest_code}}`. Personal codes don't count toward the 50-code limit.
- Abandoned booking follow-up: off by default. When on, a guest whose online booking ended unpaid gets one plain email, about 2 hours after it ended, with a link back to the same dates.
- The follow-up is sent once. It is claimed before sending, so a failed send is never retried.
*Why:* happy guests are asked for a public review at the moment they're happiest, and a personal code brings them back without a public code leaking.

**D-63 · 2026-10-13 · Search-friendly listing pages (as built, Phase 4).**
- Each listing has a page address (`units.public_slug`), set from its name and editable. It is unique within the workspace.
- Pages: `/stay/<host>` for the host and `/stay/<host>/<listing>` for each listing. They show only when direct booking is on, and not for demo or read-only workspaces. Unknown pages get a plain 404.
- Each page has a title, description, canonical link, Open Graph tags, the listing's details and photos, house rules, the cancellation policy, and a "Check dates and book" button to the app.
- The page shows the city and province, never the street address. It shows no guest data, and only a "from" price.
- `/sitemap.xml` lists the pages. `/robots.txt` allows `/stay/` and blocks `/api/`.
- Every value on the page is HTML-escaped. Pages are cached for 5 minutes.
*Why:* a search engine can only show a listing that has its own address.

**D-64 · 2026-10-13 · Deviations from the Phase 4 spec, agreed in the build.**
- Add-ons are paid in full, up front, together with the deposit. The deposit and the balance count the accommodation only, so add-ons are never part of a deposit percentage.
- Quote dates aren't held until the guest pays. A new payment attempt on a quote ends the older unpaid attempt.
- A cancelled quote shows as "cancelled", not as an error. An expired quote shows as "expired".
- Follow-up email: only for direct checkouts that ended 2 to 24 hours ago. Skipped if the same email booked overlapping nights, or has a newer pending checkout. Sent once, never retried. Quote payments never get it.
- Returning-guest codes don't count toward the 50-code limit. The code is only offered while the setting is on.
- Welcome codes sit in their own section on the discount codes page, apart from the owner's codes.
- Search pages: the "from" price is the lowest of the nightly, weekend and holiday rates. They follow the workspace language. `robots.txt` doesn't block the app, so its stylesheet still loads. The sitemap has no `lastmod` dates, because listings don't store an update time.
- Listings made by the demo or the seed have no public address until the host sets one.
- Door code and Wi-Fi password become plain text in the inbox history once a message containing them is sent. This is the same as any other message content.
- P&L and owner statements include add-ons, through extras.
*Why:* each one was a choice made during the build, to keep money simple to explain, keep dates from being blocked, and keep guest data out of search engines.

**D-65 · 2026-10-13 · Phase 4 security review fixes.** The first review blocked the release; the re-review passed. Fixed before release:
- **Quotes can't take money without a booking.** A quote's discount can't be more than the accommodation, a deposit quote must leave something after the discount, and the amount due now must be at least ₱100 (the same minimum as the booking page). The database also refuses a checkout with a negative accommodation amount.
- **Quote emails are limited:** 3 per quote and 30 per workspace per day. They aren't sent from the demo or by hosts who can't take online payments.
- **Unfinished-booking reminder:** sent only when the guest reached the payment page, at most once per email address per 30 days across BalayHub, and it greets the guest by first name only if it looks like a real name.
- **A quote cancelled by the host but paid anyway** still makes the booking (the money was taken), stays marked cancelled, and leaves a note on the reservation.
- **Personal welcome codes** work only with the email of the guest they were made for.
- **Search pages and the sitemap** are rate limited, and the sitemap is cached for 5 minutes.
- **Other fixes:** adding an extra on the pay page can't be charged twice by a double tap. Quote checkout asks for privacy consent. The consent box no longer repeats the house rules, which have their own box.
- **Accepted risk:** a host with a test payment key could make BalayHub send one reminder in 30 days to an address they type in.


**D-66 · 2026-10-13 · Pricing rules (as built, Phase 5).**
- Each night is priced in this order: a custom calendar price (kept as set), the holiday rate, a season (its fixed rate, or its percentage on the weekend or usual rate), the weekend rate, then the usual rate.
- Booking-window rules: last-minute (check-in 0 to 30 days ahead, Manila date), far-out (31 to 540 days ahead) and gap night (fills a free gap of 1 to 7 nights between confirmed bookings or blocks). At most one of last-minute and far-out applies. A gap applies on top.
- A listing rule replaces the workspace rule of the same kind. Percentages multiply each night that isn't custom, rounded to the centavo. The lowest price is applied after them.
- One stay discount applies: monthly (28+), fortnight (14+) or weekly (7+), the first that fits.
- Quotes, the direct booking page, the new-reservation price, the calendar and the preview all use this engine.
*Why:* a price typed onto the calendar is exact; every other price comes from a rule that can be shown night by night.

**D-67 · 2026-10-13 · Bulk changes (as built, Phase 5).**
- Owners and managers pick up to 50 listings (checkboxes or a tag) and up to 366 nights, starting today or later. Managers reach only their properties.
- Actions: set a price, change by a percentage, clear custom prices, block, unblock.
- Preview and apply run the same code. Apply locks the listings in a fixed order, writes in one transaction and writes one audit entry with counts. The preview shows up to 500 rows, with totals.
- A percentage change skips nights that have no price, and reports how many.

**D-68 · 2026-10-13 · Tags and room types (as built, Phase 5).**
- Tags are lowercase, 1 to 30 characters, up to 10 per listing. They filter the listing list, the calendar and bulk changes.
- Room type is free text up to 40 characters, per listing. Picking a room type takes the first free active listing of that type, by name.

**D-69 · 2026-10-13 · Team tools (as built, Phase 5).**
- Activity: owners and managers only. The newest 200 lines from audit rows about the reservation and its related records. Free text is cleaned of email addresses and phone numbers. An action with no sentence shows its name in words.
- Assignment: the new assignee is notified, unless it is you. Refused for someone who can't see the property.
- Mentions: stored as `@[Full Name](user id)`. Each person is notified once. Only owners and managers who can see the property can be mentioned. Anyone else gets a 400 on the note text.
- Notification settings: each person sees only the types their role can receive. Stored in `notify_prefs`.

**D-70 · 2026-10-13 · Group bookings (as built, Phase 5).**
- One lead guest and 2 to 20 rooms. Each room is a normal reservation linked by `group_id`. All rooms are saved in one transaction, or none are. Taken rooms are named (409 `ROOMS_TAKEN`).
- A room type takes the first free listing. It never takes a listing another row in the same group names for the same nights. None free gives 409 `NO_FREE_ROOM`.
- A group is visible only when every room is in the viewer's properties. Staff see groups without money.
- Removing a room needs a reason and uses the normal cancel path. Cancelling the group cancels each confirmed room.

**D-71 · 2026-10-13 · Moving a booking (as built, Phase 5).**
- Drag on the calendar, or "Move to another listing", uses the normal reservation update. Dates and price stay the same. The cleaning task follows the existing rule.
- Refused for channel-managed stays and for a taken listing (409, shown to the user). Owners and managers only.

**D-72 · 2026-10-13 · Daily close (as built, Phase 5).**
- The checklist is computed on each request for the chosen Manila date, within the caller's properties. Only the close itself is stored: counts, payment totals by method, an optional note, and who closed it.
- One close per workspace per date. Closing again updates it. Every save is audited.
- A manager's close records their properties; an owner's records none (whole workspace). A manager can't overwrite a close that covers properties they don't manage (409).
- Balances due: check-ins within 2 days, plus guests staying now. Home reminds owners and managers after 9 PM Manila time.

**D-73 · 2026-10-13 · Sync health (as built, Phase 5).**
- Stale: no sync for 3 hours. A feed that has never synced counts from when it was added. Failing: the last sync errored, not counting "Synced:" messages that only skipped overlaps.
- Overlaps are stored in `ical_conflicts` and shown until the channel stops reporting them. Each new overlap sends one alert during the 30-minute import.
- The `sync-health` job (every 15 minutes) alerts once per new stale or failing problem. `ical_feeds.alerted_at` and `problem_since` track this. A problem that clears resets, so a return is alerted again.
- Archived listings and properties raise no warnings and send no alerts.

**D-74 · 2026-10-13 · Agreed build choices and open differences (Phase 5).**
- A custom calendar price is used exactly as set, even below the lowest-price floor.
- An inactive listing rule switches that kind off for that listing.
- The calendar and price preview show each night as a one-night stay. So a last-minute price can differ from the price of a longer stay.
- A bulk block skips the whole listing if any night in the range overlaps a booking or block.
- A bulk unblock removes only manual blocks fully inside the range. Channel blocks, owner stays and reservations are never removed.
- Previews never write.
- A bulk percentage change uses today's computed price for each night.
- Group rooms are all or nothing. A group is visible only when every room is in the viewer's properties. Group bookings send no automatic confirmation email. Payments stay per room.
- Removing a room needs a reason. A manager can't overwrite a close that covers more than their properties.
- Balances due include guests staying now.
- Email is used when a push reaches no device.
- Mentions reach only people who can see the reservation. Assignment is refused for a manager outside the property.
- A sync overlap that clears and then returns sends alerts again. A never-synced feed counts as stale after 3 hours. Archived listings don't raise sync warnings.
- Fixes made during the build: sync problem alerts use their own notification type (`sync_problem`); archived listings are left out of sync warnings; a conversation can't be assigned to a manager who can't see the property.
- Not yet in the activity history: check-in form submissions and the reason given for a refund.
- Open differences from the spec, not yet decided (see PRD.MD known gaps): sync warnings are not on Listings; the profit and loss page has no tag filter; any member can choose among their visible properties for alerts; the Home reminder reads "Today isn't closed yet. Close the day." rather than "Day not closed yet"; a manager with no properties can save a close that counts as whole-workspace (BACKEND-SCHEMA.MD section 7, finding 15).
*Why:* each of these was a choice made during the build, to keep money exact, keep rules explainable, and keep alerts to people who can see the data.

**D-75 · 2026-10-13 · Phase 5 security review fixes and corrections.** The review passed. Fixed before release:
- **Daily close:**
  - A manager with no assigned properties can't open or save the daily close.
  - Managers see a stored close only if it covers the whole workspace or shares one of their properties.
- **Group bookings:** adding a room locks the group, so it can't race a group cancel. Removing a room re-checks it under the same lock. Removing the last room cancels the group.
- **Mentions:**
  - A mention is saved with the person's real name, so it can't show one name and notify another.
  - Only real mentions in internal notes are highlighted.
  - Notes with mentions and assignment changes are each limited to 60 an hour per person.
- **Prices:** stacked percentage changes (season, last-minute or far-out, gap night) can't take a night below 10% of its usual price. Custom calendar prices, including those written by bulk changes, are still used exactly as set.
- **Sync warnings:** they reach owners and managers through the new "Calendar sync problems" notification type. Archived listings don't raise them. Conversations can't be assigned to a manager who can't see that property.
- **Correction to D-74:** sync warnings are also shown on each listing card in Listings.
