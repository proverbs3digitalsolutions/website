# BalayHub — Product Requirements (PRD)

BalayHub is a web app that helps Filipino hosts run 1 to 10 rental units from one place. It covers condo staycations listed on Airbnb, Booking.com and Agoda, and long-term monthly rentals such as apartments, boarding houses, dorms and bedspaces. Hosts get one calendar for every channel, a direct booking page with GCash, Maya and card payments, a guest inbox, cleaning tasks, condo gate passes, deposits, reports and owner statements. Long-term landlords get properties, tenants, leases, rent, expenses and repairs. This document describes what is **actually built** today, feature by feature, and lists what is planned. It was written from the code (`src/routes`, `src/lib`, `public/js`, `db/migrations`) and the existing docs.

Last updated: 2026-10-14 (QA round 9; D-85)

*2026-10-14 (D-85): the alpha targets owners of 1 to 3 properties; the Guesty-inspired ideas are on hold as reference only. QA puts small-host friction first.*

---

## How to read this document

- Each feature has a **Status**: **MVP (built)** means it is in the code today. **Future** means it is planned or only an idea.
- Each feature lists: **For** (who uses it), **What it does**, **Done looks like** (acceptance), and **Out of scope**.
- "Owner", "manager" and "staff" are workspace roles. "Platform admin" is the BalayHub operator. "Guest" is a person staying, who only uses private link pages.
- Where something could not be confirmed from the code, it says **unverified**.
- Page-by-page clicks and states are in `APP-FLOW.MD`.

## Product at a glance

| Item | What is built |
|---|---|
| Market | Philippine hosts, 1 to 10 units (landing page copy). Long-term docs still say 5 to 100 units. |
| Workspace types | Short-term, Long-term, or Both. Chosen at setup, changeable by the owner in Settings. The menu changes to match. |
| Roles | Owner, Property manager, Staff. Plus platform admin and guests. |
| Plans | Free trial (14 days, up to 10 listings, AI on). Starter ₱499 (2 listings, no AI). Growth ₱999 (5 listings, AI). Pro ₱1,799 (10 listings, AI). Complimentary (1,000 listings, AI, not sold). Source: `src/lib/plans.js`. |
| Stack | Node 22 (Docker image), Express 4, PostgreSQL, vanilla-JS single-page app with a hash router. No build step. |
| Languages | English everywhere. English or Tagalog on the landing page. English or Taglish on guest pages and default guest messages. |
| Devices | Mobile-first web app. Installable as a phone app (PWA) with push notifications. |

## Roles summary

| Role | Who | Scope |
|---|---|---|
| Owner | The person who created the workspace | Everything in the workspace. Only role for team, billing, data export and deletion, unit owners and their statements and payouts, automations, Launchpad. |
| Unit owner | A person whose units the workspace manages | Their own units only, through the owner portal (emailed sign-in link). Not a team member: no workspace access. |
| Property manager | Co-host or manager | Only the properties assigned to them. Can run day-to-day work. Cannot create properties, manage the team or billing. |
| Staff | Front desk, accountant | Only assigned properties. No guest or tenant contact details, no Inbox, no stay reports, no pricing changes, no workspace settings. Can check guests in and out, record payments and deposits, and do cleaning tasks. |
| Cleaner | A team member with the cleaner role (cleaning jobs only) | Only assigned properties. Only their own jobs and unassigned jobs. Their own pay only. No booking money, no guest contact details, no reports or settings. See F33. |
| Platform admin | BalayHub operator (emails in `PLATFORM_ADMIN_EMAILS`, verified) | Admin page for all workspaces and the support queue. Hidden (404) from everyone else. |
| Guest | Person booking or staying | Public token pages only. No account. |

Server rules live in `src/lib/access.js` (property, tenant and guest scoping) and `requireRole(...)` on each route. Hiding buttons is never the only control.

---

## Features

### F1. Landing page with Get-started popup and EN/TL switch
**Status:** MVP (built)

**For:** Visitors who are not signed in.

**What it does:**
- Shows the product story: hero with a sample multi-calendar, "Syncs with" channel list, feature tabs, "Made for hosts in the Philippines", setup steps, "Who BalayHub is for", pricing, FAQ, footer.
- Pricing cards come from `GET /public/plans` (Starter, Growth, Pro). Growth is marked "Most popular".
- A language menu switches the page between English and Tagalog. The choice is saved in the browser.
- **Get started** opens a 3-step popup:
  1. How many units (1–3, 4–10, more than 10). "More than 10" shows a custom-plan note.
  2. First name, last name, business name, mobile (optional), and what you rent out (Short-term, Long-term, Both).
  3. Email, password (8+ characters), Terms and Privacy checkbox, then **Start my free trial**. A Google button shows if Google sign-in is set up.
- **Try the live demo** signs the visitor into the shared read-only demo workspace.
- A light/dark/match-device switch is in the footer.

**Done looks like:**
- Step answers are kept when moving back and forth.
- Missing required fields are highlighted. Server errors show in the popup.
- After sign-up, the workspace is created from the popup answers without asking again (stored in the browser until setup runs).
- If the plans call fails, the page still shows, without prices.

**Out of scope:** Translating the signed-in app into Tagalog. Online chat on the landing page. A separate marketing CMS.

### F2. Sign-up, email verification, password reset and Google sign-in
**Status:** MVP (built)

**For:** New hosts, invited team members, returning users.

**What it does:**
- Sign-up with full name, email, password, confirm password and Terms/Privacy acceptance. Consent is recorded with the policy versions.
- Email verification link (48 hours). A "Check your email" page lets the user resend, continue, or use a different account.
- Log in with email and password. Errors never reveal whether an account exists. Login is rate-limited.
- Forgot password sends a 1-hour reset link. Resetting signs out every session.
- **Continue with Google** (only when the server has Google keys). New Google users get an account with email already verified. Existing accounts with the same email are linked on first use.
- Invitation links (`#/signup?invite=…`) pre-fill the email and join the inviting workspace with the chosen role and properties. Invited users are verified by the link.
- Session expiry returns the user to the login page and back to the same page after login.

**Done looks like:**
- Wrong password shows one generic message.
- An invite used with a different email is refused with a clear field error.
- A Google account that does not match the invite email is refused.
- In development, verification and reset links are shown on screen when email is not configured.

**Out of scope:** Two-factor sign-in. Facebook or Apple sign-in. One user in several workspaces (one workspace per account; a second invite to an existing email is refused).

### F3. Workspace setup and Launchpad onboarding
**Status:** MVP (built)

**For:** New owners.

**What it does:**
- Setup creates the workspace (name, type) and starts a 14-day trial. The owner role is set.
- Short-term and Both workspaces go to the **Launchpad**. Long-term workspaces go to Properties with the Add property form open.
- Launchpad has 5 phases and 11 steps: add listing, guest info (Wi-Fi, check-in, rules), photos (optional), connect a channel calendar, first reservation, automatic messages, check-in form (optional), invite team (optional), cleaning checklist (optional), direct booking page (optional), choose a plan.
- Steps tick themselves off from real data. Optional steps can be skipped and shown again.
- A progress bar and a **Next** button point to the next step. "How do I…?" guides sit at the bottom.
- Home shows a Launchpad reminder card until setup is complete or the owner clicks **Hide**.
- After login, owners of unfinished short-term workspaces start on the Launchpad.

**Done looks like:**
- Required steps cannot be skipped.
- The Launchpad shows "You're all set" when every required step is done and every optional step is done or skipped.
- Managers and staff opening the Launchpad see a note that the owner sets it up.

**Out of scope:** A Launchpad for long-term workspaces. Video tutorials. (Note: `docs/SHORT-TERM-GUIDE.md` still describes an older 6-item "Get started checklist on Home".)

### F4. Multi-calendar and iCal channel sync
**Status:** MVP (built)

**For:** Owners and managers (edit). Staff (view only).

**What it does:**
- Calendar grid: listings down the side, 14 or 30 days across. Reservations show as colored bars by channel. Blocks show with a lock.
- Open nights show the nightly price. Holiday and season prices are highlighted.
- Tap an open night: **New reservation**, **Block dates**, or **Set nightly price**. Tap a bar to open the reservation, or a block to remove it.
- Filter bar: search listings, property, availability, listing type, cleaning status.
- Each listing has a private export calendar link to paste into Airbnb, Booking.com, Agoda and others. The link can be replaced.
- Owners and managers connect each channel's export link (Airbnb, Booking.com, Agoda, Vrbo, Expedia, Trip.com, Other). BalayHub checks every 30 minutes and on **Sync now**.
- Airbnb "Not available" events become blocks. Other channel events become reservations named like "Airbnb guest" with ₱0.
- An imported stay that overlaps an existing booking is skipped and reported, never overwritten.
- The database refuses overlapping stays or blocks on one listing. Same-day turnover is allowed.

**Done looks like:**
- A booking made in BalayHub appears on the export feed for the channels' next poll.
- Disconnecting a channel removes future imported stays and blocks, but keeps past stays and stays with payments.
- Channel blocks cannot be removed in BalayHub ("change it on the channel").

**Out of scope:** Official two-way channel APIs (guest names, prices, messages from Airbnb). Pushing prices to channels.

### F5. Reservations and saved views
**Status:** MVP (built)

**For:** Owners and managers (full). Staff (view, check in/out, record payments and deposits).

**What it does:**
- Saved views: Upcoming, Currently hosting, Check-ins today/tomorrow, Check-outs today/tomorrow, Upcoming unpaid, Past, Cancelled, Recently created, All.
- List with check-in, check-out, guest, listing, channel, code, total and balance. CSV export of the current view and filters.
- **New reservation** form with a live price quote from the pricing rules, cleaning fee, other fees, channel fee, notes, and "Email a booking confirmation".
- Reservation detail: stay, guest, payments, check-in form, gate pass, deposit, guest review.
- Actions: Check in, Check out (marks the listing dirty and creates a cleaning task), undo either, Edit, Cancel (with reason), Message guest, Email booking confirmation.
- Payments: record full or partial (cash, bank transfer, GCash, Maya, card, channel payout, other), optional emailed receipt, void with reason. Receipt numbers like AR-000001. Printable acknowledgement receipt (not a BIR official receipt).
- "Returning · 3rd stay", "VIP" and "Do not rebook" badges.

**Done looks like:**
- Overlapping dates are refused with a message naming the clash.
- Double-tapping Save records a payment once (idempotency key).
- Imported channel stays cannot change dates in BalayHub, only amounts.
- Saving a reservation for a "Do not rebook" guest shows a warning.

**Out of scope:** Splitting a stay across listings. Refunds through BalayHub (refund outside, then void). BIR official receipts.

### F6. Listings and pricing
**Status:** MVP (built)

**For:** Owners and managers. Staff can view listings and mark them clean or dirty.

**What it does:**
- A listing is a unit with a nightly rate. Fields: name, type, base rate, cleaning fee, max guests, security deposit, check-in/out times, Wi-Fi, check-in instructions, house rules, booking-page settings.
- Price extras per listing (a collapsed section of the listing form; was called "Pricing helpers"): **weekend rate** (Fri and Sat nights), **holiday rate** (nights before and during Philippine holiday long weekends), **weekly discount** (7+ nights) and **monthly discount** (28+ nights).
- **Pricing rules** page: how a night is priced, a rates table, seasons, and the PH holiday list for the next 12 months.
- **Seasons**: a date range with its own rate and/or minimum nights, for one listing or (owner only) all listings.
- Priority: calendar price → holiday → season (listing beats all-listings) → weekend → base. Then the long-stay discount.
- Listing cards: cleaning status tabs (All, Needs cleaning, Clean), Channels, Photos, Edit, Bookings link.
- Plan listing limit: adding, restoring or converting a unit to a listing beyond the plan limit is refused with "Upgrade your plan in Settings".

**Done looks like:**
- New quotes, new reservations and the booking page use the rules. Existing reservations keep their price.
- Managers must pick a listing for a season. Only owners can add or remove an all-listings season.
- Long-term units (no nightly rate) do not count toward the listing limit.

**Out of scope:** Dynamic or market-based pricing. Auto-updated holiday dates for movable holidays (Chinese New Year, Eid); hosts set those nights by hand.

### F7. Direct booking page and PayMongo
**Status:** MVP (built)

**For:** Owners (setup). Guests (booking).

**What it does:**
- Owner connects their own PayMongo secret key in Settings → Direct booking page. It is stored encrypted and never shown again. A test key puts the page in TEST MODE.
- Owner sets the page address (slug), welcome text, and turns the page on or off. Listings opt in with "Show this listing on my booking page".
- Per listing: online payment option (full, 50% deposit, or guest's choice), minimum nights, balance due days, up to 12 photos (first is the cover).
- Guest page `#/book/<slug>`: listings with photos and prices. Listing page: gallery, details, house rules, availability calendar with nightly prices, discount code, guest details, consent, **Continue to payment**.
- Guest pays on PayMongo (GCash, Maya, card, GrabPay). Dates are held for 30 minutes. Max 2 unpaid checkouts per visitor or email. Bookings open about 18 months ahead.
- After payment: reservation (channel Direct), payment and receipt are created, guest gets confirmation and receipt emails, host gets an Inbox note and push.
- A background check catches paid checkouts whose guest did not return to the page.

**Done looks like:**
- Taken nights from channels are blocked on the page.
- A 50% deposit is offered only when the balance due date is still ahead.
- If a channel booking takes the dates mid-payment, no double booking is made and the host is told to refund or offer other dates.
- The page shows "Online booking is paused" when turned off or when the plan is read-only. The demo page has booking turned off.

**Out of scope:** Payments to BalayHub's account (money goes to the host's PayMongo). Refunds from inside BalayHub. Multiple currencies.

### F8. Paying the balance online
**Status:** MVP (built)

**For:** Owners and managers (send link). Guests (pay).

**What it does:**
- **Copy payment link** on a reservation with a balance, when PayMongo is connected.
- Guest page `#/pay/<token>` shows the stay and balance with **Pay ₱… now**.
- The "Payment reminder" automation can email the link before check-in to guests who still owe.
- Recording a payment by hand, editing or cancelling the reservation closes any open payment page.

**Done looks like:**
- Payment is confirmed with PayMongo before it is recorded. A receipt is emailed and the host is told in the Inbox.
- Cancelled or fully paid bookings show a clear message instead of a pay button.
- Without PayMongo, the button explains how to connect it.

**Out of scope:** Partial amounts chosen by the guest. Payment plans.

### F9. Guests, VIP, Do-not-rebook and reviews
**Status:** MVP (built)

**For:** Owners and managers (full). Staff (names and stay counts only).

**What it does:**
- Guest list with search, filters (type, stay, channel, property, latest stay, stays, review rating) and sorts.
- Guest profile: contact, notes, stays, private reviews. **Edit** sets VIP and Do not rebook.
- A reservation with a past guest's email joins that guest's profile.
- Private reviews: the default thank-you message includes `{{review_link}}`. The guest rates overall and cleanliness and can comment. Open from check-in day up to 60 days after check-out, once per stay.
- Reviews page with filters. A review adds an Inbox note. Ratings of 3 or less send a push notification.
- Online bookings by a "Do not rebook" guest add a warning to the Inbox note.

**Done looks like:**
- Staff never receive guest email, phone, notes or total spent from the server.
- Reviews are never public.

**Out of scope:** Publishing reviews on the booking page. Syncing channel reviews.

### F10. Inbox: email, templates, automatic messages, AI reply drafts
**Status:** MVP (built)

**For:** Owners and managers. Not staff.

**What it does:**
- One conversation per reservation. Views: All open, Unread, Assigned to me, Upcoming stays, Currently hosting, Snoozed, Archived. Filter bar with unread, stay, channel, property, listing, assignee, needs attention, dates, sort.
- Compose a message (emailed to the guest), schedule it for later, or save an internal note. Insert a template with placeholders filled in. Snooze, mark unread, archive.
- Unread badge on the Inbox menu item.
- Guest replies come in only when the server has `IMAP_URL` set. Otherwise the page explains replies go to the email inbox.
- Templates: Booking confirmation, Check-in instructions, Thank you after check-out, Payment reminder, plus custom templates. Taglish versions exist.
- Automatic messages: triggers on booking created, days before check-in, on check-in day, days before check-out, days after check-out, at a set Philippine time. Defaults are created **off**, and so is every automatic message the owner adds: the "Turned on" box starts empty (D-85). Only the owner can add, edit, turn on or delete automations.
- **✨ Draft reply with AI** writes a draft in the guest's language (English, Tagalog or Taglish) for review. Shown only when `ANTHROPIC_API_KEY` is set and the plan includes AI (trial, Growth, Pro, Complimentary).
- System notes appear for check-in forms, online payments, reviews and gate pass receipts.

**Done looks like:**
- A failed send is kept with "Not sent" and can be retried. Scheduled messages can be cancelled.
- A guest with no email gets a warning and can only receive notes.
- The payment reminder automation skips guests with no balance.

**Out of scope:** Airbnb, Booking.com or Agoda message sync. SMS. Facebook Messenger (see Future).

### F11. Housekeeping, cleaning tasks and checklist
**Status:** MVP (built)

**For:** Owners, managers, staff and cleaners.

**What it does:**
- Tasks are created automatically for today's and tomorrow's check-outs, and when a guest is checked out. Managers can add extra tasks.
- Tabs: Today & overdue, Upcoming, Done, All. Filters include only my tasks, property, listing, status, assignee, due dates, next guest, overdue.
- Each task shows the next guest's arrival. Same-day turnovers are highlighted.
- Assign to a team member or type the name of a cleaner without a login. **Copy for cleaner** gives text for Messenger or Viber.
- Cleaners tick checklist items, upload photos and press **Mark done**. Done marks the listing clean and notifies owners and managers.
- Owner edits the default checklist.

**Done looks like:**
- Marking done with unticked items asks for confirmation.
- Staff cannot cancel tasks, assign, add tasks or edit the checklist.
- Ticking an item moves a task to In progress.

**Out of scope:** Payroll and tax for cleaners. Inventory purchasing. Cleaner pay, supplies and lost and found were added in Phase 3 (F33 to F39).

### F12. Guest check-in form with guest IDs
**Status:** MVP (built)

**For:** Guests (fill in). Owners and managers (view).

**What it does:**
- Each reservation has a private link `#/checkin/<token>`, also used by `{{checkin_link}}` in templates.
- Guest enters main guest name, mobile, email, other guests (up to the listing's max), arrival time, car plate, notes, ID photos (shrunk before upload), and consent.
- Host sees details and ID photos on the reservation, with **Copy link**, **Copy for building admin** and **New link**.
- The host gets an Inbox note and a push notification.
- ID photos are deleted automatically after check-out (default 30 days, `GUEST_ID_RETENTION_DAYS`). Names stay.

**Done looks like:**
- Consent is required to submit.
- The form closes after the stay ends or is cancelled.
- Staff can never open guest ID files.

**Out of scope:** ID verification or face matching. Storing IDs beyond the retention period.

### F13. Condo gate pass
**Status:** MVP (built)

**For:** Owners and managers (setup and send). Building admins (receive).

**What it does:**
- Per building (Listings → Gate pass): up to 3 admin emails, auto-send on/off, days before check-in (0, 1, 2, 3, 5 or 7), attach IDs or link them, "Authorized by", notes.
- The email carries guest names, dates, times, guest count, plate number and notes, plus a private printable gate pass link with **Confirm received**.
- The reservation shows status and **Send now / Send again** and **Preview**.
- BalayHub waits for the check-in form until the day before arrival, then sends what it has.

**Done looks like:**
- "Received by admin" shows on the reservation and in the Inbox after the admin confirms.
- The link stops working the day after check-out.
- Gate passes are not sent while the workspace is read-only.

**Out of scope:** Building admin accounts. Integrations with building security systems.

### F14. Security deposits
**Status:** MVP (built)

**For:** Staff (record). Owners and managers (return). Owner (undo a return).

**What it does:**
- **Record deposit** on a reservation (amount suggested from the listing). Kept apart from booking income.
- After check-out it appears on Home under **Deposits to return**.
- **Return deposit**: all, or with a deduction and a reason the guest sees, plus photos. Optional acknowledgement and summary emails.
- Reports → Deposits tab lists every deposit with filters.

**Done looks like:**
- A deduction cannot exceed the deposit and needs a reason.
- One deposit per stay. A settled deposit cannot be settled twice.

**Out of scope:** Holding deposits through PayMongo. Long-term lease deposit refunds (lease deposit is stored as an amount only).

### F15. Stay reports and tax summary
**Status:** MVP (built)

**For:** Owners and managers. Not staff.

**What it does:**
- **Performance** tab: for a month, year or date range — revenue, occupancy, average nightly rate, RevPAR, revenue by channel, results by listing, expenses, and net after channel fees and expenses. Filters by property, listing, channel. CSV download.
- **Income summary (for taxes)** tab: per month and quarter — revenue earned, payments actually received (cash basis, without deposits), channel fees, expenses and net. CSV for the bookkeeper.
- **Deposits** tab (see F14).
- Home also shows daily overview, 7/30-day trends and monthly revenue vs. last month.

**Done looks like:**
- Revenue counts each night in the month it happens. Cleaning and other fees count in the check-in month.
- Imported channel stays count as ₱0 until amounts are entered.

**Out of scope:** BIR filing, tax advice, official receipts.

### F16. Owner statements
**Status:** MVP (built)

**For:** Workspace owners who manage units for other unit owners. Owner role only.

**What it does:**
- **Unit owners** page: add owners with email, phone, management fee %, whether cleaning fees go to the manager, notes, and their units (up to 100 owners).
- Statement for a month: each stay that checked out, its total, channel fee, cleaning fee, net rental income, management fee, unit expenses and **payout to the owner**.
- Print / save as PDF, or **Email to owner**.
- Phase 2 (built 2026-10-13, see F30–F32): fee types, review then publish, unpublish to correct, payout records, repairs reserve, and a monthly reminder to review. Expense receipts are on the statement.

**Done looks like:**
- A warning shows when stays have no amounts (imported channel stays).

**Out of scope:** Server-made PDF files (the printable page covers it). Paying owners through BalayHub. Automatic sending without review. BIR documents.

### F17. Discount codes
**Status:** MVP (built)

**For:** Owners and managers (create). Guests (use on the booking page).

**What it does:**
- Percent off or peso off the accommodation. Optional valid dates, minimum nights, max uses, returning guests only.
- Turn codes on and off. Filter by status, type, returning-only.
- Codes apply after weekly or monthly discounts.

**Done looks like:**
- Up to 50 active codes per workspace.
- "Returning guests only" requires the email from a past stay.

**Out of scope:** Codes on channel bookings. Automatic promotions.

### F18. Long-term rentals
**Status:** MVP (built)

**For:** Landlords with monthly tenants. All roles, with limits.

**What it does:**
- **Dashboard:** properties, occupied and vacant units, rent collected this month, outstanding and overdue rent, this month's rent status, recent payments, and "Needs attention" (overdue, leases ending, open repairs).
- **Properties and units:** add (owner), edit, archive and restore. Occupancy comes from leases.
- **Tenants and leases:** profiles with duplicate warning, assign a unit (creates a lease), change terms, end or cancel a lease, lease documents, payment history, owner-only data export.
- **Rent:** monthly charges generated from each lease. Statuses paid, partial, unpaid, overdue. Payments go to the oldest charge first (the Record form names that month; the row's Record box is filled with that month's own amount).
- **Payments:** full or partial, cash, bank, GCash, Maya, check, reference, receipt file. Never edited or deleted, only voided with a reason. Print gives an acknowledgement receipt (not a BIR official receipt); no receipt number yet (BLOCKERS).
- **Expenses:** categories (repairs, utilities, taxes, insurance, association dues, supplies, salaries, cleaning, other), unit, vendor, receipt. Corrections are logged; voids keep history. Short-term workspaces see this page as "Expenses".
- **Maintenance:** requests by property and unit, priority, status workflow (open, in progress, resolved, cancelled), repair costs saved as Repairs expenses, photos.
- **Reports:** any date range, by property, month and expense category, outstanding balances, CSV export, print to PDF.

**Done looks like:**
- One active lease per unit, enforced in the database.
- Negative, zero, malformed and future-dated payments are rejected.
- Double-click Save records once.

**Out of scope:** Tenant portal, online rent payments, utility billing, e-signatures, prorated first months (see Future).

### F19. Team and roles
**Status:** MVP (built)

**For:** Owners.

**What it does:**
- **Team & permissions** in Settings: invite by email as Property manager, Staff or Cleaner, choose properties. The link is emailed (if email works) and shown to copy. Links expire in 7 days and work once.
- Edit a member's role and properties. Remove a member (signed out at once, records kept). Revoke or reissue pending invitations.
- Audit history: owners see everyone's actions; managers see their own.

**Done looks like:**
- The owner's own access cannot be changed.
- An email that already has a BalayHub account cannot be invited.

**Out of scope:** Custom roles. Several owners per workspace.

### F20. Plans, billing and trial
**Status:** MVP (built)

**For:** Owners. Platform admin (manual changes).

**What it does:**
- New workspaces get a 14-day trial with all features and up to 10 listings.
- **Plan & billing** in Settings: current plan, listings used, paid-until date, payment history.
- With platform PayMongo keys: pick Starter, Growth or Pro and 1, 3 or 12 months (12 months = 2 months free), then pay by GCash, Maya, card or GrabPay. Renewing early adds time. Switching converts unused days. Paying during the trial keeps the remaining trial days.
- Without keys: pay manually and email; the platform admin sets the plan.
- After the trial, or 7 days after paid-until, the workspace becomes **read-only**. Nothing is deleted. View and export still work.
- Listing limits per plan. AI drafts only on plans with AI.

**Done looks like:**
- Payments are confirmed with PayMongo directly. A background check every 10 minutes catches missed webhooks.
- Complimentary workspaces cannot pay.
- Read-only blocks changes with a clear message (HTTP 402) but still allows billing, support, account, push and cancelling deletion.

**Out of scope:** Automatic recurring card billing. Invoices with VAT.

### F21. Privacy, data export and deletion
**Status:** MVP (built)

**For:** Owners (workspace). Everyone (Privacy Notice and Terms pages).

**What it does:**
- Privacy Notice and Terms pages, open to all.
- Consent recorded at sign-up, on the check-in form and on the booking page.
- **Download all data**: one JSON export of the workspace. Secrets and tokens are removed. Uploaded files are listed, not included.
- **Delete workspace**: type the name to confirm. The workspace becomes view-only and is permanently deleted after 14 days. The owner can **Cancel deletion** from the banner or Settings. A confirmation email is sent.
- Owners can export one tenant's data. Guest ID photos are auto-deleted after the stay.

**Done looks like:**
- The demo cannot be deleted.
- After 14 days, data, files and team accounts are purged by a background job.

**Out of scope:** Self-service deletion of a single guest record. Data residency choices.

### F22. Push notifications and phone app (PWA)
**Status:** MVP (built)

**For:** All roles.

**What it does:**
- Installable app (manifest and service worker). Settings → App & notifications offers **Install BalayHub** where the browser allows it, or iPhone "Add to Home Screen" steps.
- **Turn on notifications** per device. Topics: new bookings, guest messages, check-in forms, online payments (owner and manager), cleaning tasks (all roles). **Send a test**. **Turn off on this device**.
- Logging out turns notifications off on that device.
- The service worker never caches the app, only an offline page.

**Done looks like:**
- Staff only get cleaning notifications.
- The demo workspace does not show notification settings.

**Out of scope:** Native App Store or Play Store apps. Offline editing.

### F23. Light and dark mode
**Status:** MVP (built)

**For:** Everyone.

**What it does:** Light, Dark or Match device. Found in the sidebar footer, the phone More menu, Settings → Appearance, My account → Preferences and the landing footer. Saved on the device.

**Done looks like:** The choice persists across visits on that device.

**Out of scope:** Per-account theme sync across devices.

### F24. Help center and support tickets
**Status:** MVP (built)

**For:** All workspace members. Platform admins answer.

**What it does:**
- **Help & support** page: searchable guides filtered by role, and a tickets list (owners see all workspace tickets; others see their own).
- **Contact support**: subject, topic, urgency, description, optional screenshot. The current page and browser are attached.
- Ticket page: progress (Received → In progress → Waiting for you → Resolved), conversation, attachments, **Mark as solved**, reply to reopen within 14 days, 1–5 rating after resolution.
- Resolved tickets close automatically 7 days after they are resolved (hourly background job).
- New tickets email the platform admins (`PLATFORM_ADMIN_EMAILS`).

**Done looks like:**
- A lapsed (read-only) workspace can still open tickets and upload screenshots.
- A closed ticket asks the user to open a new one.

**Out of scope:** Live chat with a human. Phone support.

### F25. BalayHub assistant chatbot
**Status:** MVP (built, but off until `ANTHROPIC_API_KEY` is set)

**For:** All workspace members except the demo.

**What it does:**
- A floating **Ask** button on every app page, plus an "Ask the BalayHub assistant" box on the Help page.
- Answers how-to questions in English, Tagalog or Taglish from the help-center guides. It knows the user's role, workspace type, plan and current page, not their guest or booking data.
- Shows related help articles. Offers **Contact support with this chat** when it cannot solve something.
- Limits: 40 questions per person per hour, 300 per workspace per day.

**Done looks like:**
- With no key, the button and the Help box are hidden. A direct call returns "not set up on this server yet".
- Busy or failed AI calls show a friendly retry message.

**Out of scope:** Taking actions in the app for the user. Reading booking data.

### F26. Per-page filter bars with remembered filters
**Status:** MVP (built)

**For:** Everyone, on list pages.

**What it does:**
- One filter bar on Reservations, Calendar, Inbox, Housekeeping, Listings, Guests, Reviews, Discount codes, Unit owners, Stay reports, Deposits, Properties, Tenants, Rent, Reports, Maintenance and Admin.
- Search box, quick filters, a **More filters** panel with a count, chips for active filters, **Clear all** and **Reset filters**.
- Filters are remembered per person and per page in this browser. Filters in the URL win, so links can be shared.

**Done looks like:**
- "No results found — Try removing a filter" when filters hide everything, different from the true empty state.
- Opening a conversation from "Message guest" ignores saved Inbox filters so it is not hidden.

**Out of scope:** Named custom saved views shared across the team. Server-side storage of filters.

### F27. My account page
**Status:** MVP (built)

**For:** Every signed-in member.

**What it does:**
- Profile (name, mobile) with **Edit profile**.
- Workspace and role, plan status, and (owners) links to Plan & billing and Manage team.
- Properties the person works on.
- Sign-in and security: change password (signs out other devices), list of signed-in devices, sign out one device or all others, log out.
- Preferences: appearance and a link to notifications.
- Support ticket summary and recent activity.

**Done looks like:** Signing out another device ends that session at once.

**Out of scope:** Changing the login email. Deleting only one's own user account (unverified; not found in the code).

### F28. Platform admin and support queue
**Status:** MVP (built)

**For:** Platform admins only.

**What it does:**
- **Platform admin** page: counts for on trial, paying, monthly revenue, ended or overdue. Workspace table with filters (status, business type, plan, signup dates, sort).
- Click a workspace to set plan, paid until, trial end date and a note. Changes are audit-logged. The demo cannot be changed.
- **Support queue**: tickets from every workspace, urgent and new first. Ticket page: reply or internal note, assign to me, change status, mark resolved, customer details, attachments.

**Done looks like:**
- Non-admins get "Not found" for the page and 404 from the API.
- Replies show to customers as "BalayHub Support".

**Out of scope:** Impersonating a customer. Refunds from the admin page.

### F29. Live demo workspace
**Status:** MVP (built)

**For:** Prospects.

**What it does:** One click opens "Reyes Staycations" with sample bookings, conversations, cleaning tasks and reports. Read-only. Dates move forward daily. No email, uploads or invites. A banner offers **Start your free trial**.

**Done looks like:** Every change is refused with "This is the demo workspace, so changes are turned off."

**Out of scope:** Per-visitor private demos.

---

### F30. Owner portal (unit owners)
**Status:** Built 2026-10-13 (Phase 2)

**For:** Unit owners whose units the workspace manages. Not team members.

**What it does:**
- The host turns it on for an owner with **Invite to owner portal** (the owner needs an email). The owner gets a sign-in link by email. The link works once and expires after 30 minutes. They can ask for a new one by entering their email on the sign-in page. Replies never say whether an email has an account.
- The host can **turn off** portal access. That signs the owner out everywhere.
- Owners see, for their own active units: their published statements (never drafts), payouts, repairs reserve, bookings and blocks (guests by first name only), an activity list (check-ins, check-outs, completed cleanings, maintenance, expenses, statements, payouts), profit and loss, and receipts for expenses on a published statement.
- Owners can **block dates** on their units (up to 60 nights, not in the past) and cancel their own blocks before they start. The host is emailed about each block.

**Done looks like:**
- An owner never sees another owner, guest phone or email, payment proofs, or other workspace data.
- A team member's sign-in never opens portal data, and an owner's portal sign-in never opens workspace pages.
- Disabling the owner ends their sessions at once.

**Out of scope:** Paying owners through BalayHub. Owners changing their own settings or fee.

### F31. Owner fee types, statements and payouts
**Status:** Built 2026-10-13 (Phase 2)

**For:** Workspace owners who manage units for others.

**What it does:**
- Fee types per owner: % of net (the default), % of gross after refunds, or a flat monthly fee (charged in any month with an active unit, even with no stays).
- Statements: a draft is worked out live; **Publish** freezes it. **Unpublish to correct** goes back to draft (refused if the repairs reserve has paid out money from that statement). **Send to owner** emails the published copy with a portal link when access is on. **Print** opens the browser print window.
- Statements show receipts for expenses. The review list shows each owner's status, payout, paid amount and sent date.
- Payouts: record and void (with a reason). Methods: GCash, Maya, bank transfer, cash, other.
- Repairs reserve: target and monthly top-up per owner. Top-ups come out of the payout on publish. Withdrawals are recorded by hand with a note.
- A payout that would take a month's payouts above the statement's payout asks the host to confirm first (never blocked, except that a payout is refused when the owner owes the workspace for that month; round 5, D-81); the statement then shows "Overpaid by". The owner portal's profit and loss for a published month shows the frozen statement numbers, labelled (D-76).
- Reminder: on the 3rd of each month (Manila time), each workspace owner is emailed "n statements ready to review". Once per workspace per month. Nothing is published or sent by the reminder.

**Done looks like:**
- Publishing doesn't change when an expense is added later (the published copy stays the same).
- Money is exact to the centavo. A payout can't be deleted. A withdrawal can't take the reserve below zero.

### F32. Profit and loss per unit
**Status:** Built 2026-10-13 (Phase 2)

**For:** Owners and managers (managers see assigned properties). Owners see their own units in the portal too. Not staff.

**What it does:**
- A month, and optionally one property. Each unit: stays, nights, gross, channel fees, refunds, expenses, net. Expenses with no unit are in one row.
- Download CSV for the same table.

**Done looks like:**
- Guest cleaning fees count as unit income here. The owner statement is different (see D-45).

### F33. Cleaner role: cleaning jobs, checklists and their own pay
**Status:** Phase 3 (built 2026-10-13, D-48)

**For:** Cleaners (a team member with the cleaner role, given at least one property).

**What it does:**
- A cleaner signs in to Cleaning, My pay, Help and Account. Nothing else.
- They see only their own cleaning jobs and jobs nobody has been given yet, in their properties.
- They tick the checklist, start, mark done, add photos, and reopen. They can report damage, log lost items, record supplies used and raise a work order from a job.
- They see their own pay and nothing else about money.
- Screens are phone-first and follow the workspace language (English or Taglish).

**Done looks like:**
- Every route not on the cleaner allow-list returns 403 (CLEANER_FORBIDDEN), including routes added later.
- A cleaner never sees booking money, payments, guest phone numbers or emails, reports, settings, the inbox, or other cleaners' pay. Guests show by first name only.
- A cleaner can't cancel a job.

**Out of scope:** Cleaners logging in to see the rest of the workspace. Push notifications for cleaners (not yet).

### F34. Status board, calendar and inspections
**Status:** Phase 3 (built 2026-10-13, D-49, D-50)

**For:** Owners and managers (inspections, scores); cleaners see their own jobs.

**What it does:**
- Board: each unit as Dirty, Clean or Inspected, with the current stay, the next arrival, the open job and the last inspection score.
- Calendar: a week by day. Owners and managers reassign jobs from it.
- Inspect a finished job: pass or fail per checklist item, notes, and a score (passed items ÷ items × 100, rounded).
- Pass: the unit becomes Inspected. Fail: the job reopens with failed items unticked, and the unit is Dirty.
- Scores: per cleaner, for a month: jobs done, jobs inspected, average score, fails.

**Done looks like:**
- An empty checklist can't be inspected.
- A failed inspection can't reopen a paid clean (409).
- A pass marks the unit Inspected only if it is still Clean (a newer check-out stays Dirty).

**Out of scope:** Scoring by photo or by guest review.

### F35. Damage reports: charge, deduct or waive
**Status:** Phase 3 (built 2026-10-13, D-51)

**For:** Anyone who works a job or a stay (report). Owners and managers (resolve).

**What it does:**
- Report damage with a description, an optional cost estimate and photos, from a job, a stay or a unit.
- Owners and managers resolve each report once:
  - **Charge the guest:** adds a damage extra charge to the stay and updates the total.
  - **Deduct from deposit:** the deposit settle form is pre-filled with the open and deducted total.
  - **Waive:** no money, with a note.

**Done looks like:**
- A report on a unit with no stay can only be waived.
- Cleaners never see amounts and see only the reports they filed.
- Staff don't see the suggested deposit deduction.

**Out of scope:** Insurance claims and photo-based cost estimates.

### F36. Cleaner pay: rates, marking paid and expenses
**Status:** Phase 3 (built 2026-10-13, D-52, D-55)

**For:** Owners (rates, undo) and owners and managers (mark paid). Cleaners see their own pay.

**What it does:**
- A rate per cleaner (a team member, or an outside cleaner typed by name): per clean, or per hour.
- When a job is marked done, its pay is set from the rate. Per hour: time from start to finish, rounded up to 15 minutes, capped at 12 hours.
- Mark paid: several finished cleans at once, with a date, a method (cash, GCash, Maya, bank transfer) and a reference.
- Optional: record one cleaning expense per unit, so it shows on profit and loss and owner statements.
- My pay: the cleaner's own finished cleans, amounts, and paid status for the month. The page is for cleaners only (round 5).

**Done looks like:**
- Money is exact to the centavo. Zero pay creates no expense. Payment dates can't be in the future.
- A paid clean is locked: no status change, no pay change, no failed inspection.
- Rate changes apply to cleans finished after the change.
- Undo is owners only; it removes an expense only when every clean on it is undone together.

**Out of scope:** Payroll, tax or withholding for cleaners.

### F37. Supplies, par levels and low stock
**Status:** Phase 3 (built 2026-10-13, D-53)

**For:** Owners and managers (set up, count, restock). Cleaners and staff record use on a job.

**What it does:**
- Per property: item name, unit label, par level and on-hand count.
- Movements (count, restock, used) update on hand and are kept in a history.
- Owners and managers can open a per-item History of the last 20 movements (what, how many, who, when, note). Staff and cleaners can't. "Take stock out" is now called "Record use".
- Low stock (on hand below par) shows on Home and on the supplies page.
- On a job, record what was used or restocked.

**Done looks like:**
- On hand never goes below zero. If more is used than is on hand, on hand stops at zero and the note keeps the amount asked for.
- Supplies must belong to the job's property.

**Out of scope:** Costs, purchasing and inventory valuation.

### F38. Lost and found
**Status:** Phase 3 (built 2026-10-13, D-54)

**For:** Anyone who works a job (log). Owners and managers (manage).

**What it does:**
- Log an item: description, where found, date, photo. From a job, or on a stay. Owners and managers can also add an item from the Lost and found page (pick the listing).
- Status: Held, Returned or Disposed, with a note on change.

**Done looks like:**
- Owners and managers see the full list. Cleaners see only items they logged.
- Guest contact for returning an item stays on the reservation, for owners and managers.

**Out of scope:** Automatic guest notification about found items.

### F39. Work orders and recurring maintenance
**Status:** Phase 3 (built 2026-10-13, D-54)

**For:** Anyone who works a job (work order). Owners and managers (recurring schedules).

**What it does:**
- Work order: from a job, a cleaner raises a maintenance request (title, details, priority) linked to the job. Owners and managers get a notification.
- Recurring schedule: per property or unit, every N days or months, with a next due date and priority.
- Once an hour, a due schedule opens one request and moves its next due date past today.

**Done looks like:**
- A schedule doesn't open a second request while the last one is still open, and doesn't backfill missed dates.
- Cleaners can't add photos to a work order (they add photos to the cleaning job) and can't open the Maintenance page or see repair costs.
- Pause stops a schedule. There is no resume button yet.

**Out of scope:** Recurring expenses and vendor scheduling.

### F40. Guidebook per listing, with private guest link
**Status:** Phase 4 (built 2026-10-13, D-57)

**For:** Owners and managers write it. Guests read it.

**What it does:**
- Each listing has one guidebook: arrival and directions, parking, building and gate notes, local tips, and emergency contacts. Each section can have a Taglish version.
- Owners and managers store the door code once, encrypted. They can show it with a button.
- Each booking gets a private link. It works from 14 days before check-in until 2 days after check-out, and only for confirmed stays.
- The Wi-Fi password and door code show from the day before check-in through check-out day (Manila time). Before that, the page says when they'll appear.
- Messages can include the guide link, the door code and the Wi-Fi password, with the same time window.

**Done looks like:**
- Staff and cleaners never see the door code, and the guidebook screens are not open to them.
- A cancelled stay gets no link, and its link returns "not available".
- A guest never sees the codes outside the window.

**Out of scope:** Guest accounts or logins. Photos in the guidebook. Taglish for the listing's own check-in instructions and house rules (not yet).

### F41. House rules accepted by the guest
**Status:** Phase 4 (built 2026-10-13, D-58)

**What it does:**
- If a listing has house rules, the guest ticks "I agree to the house rules" before paying (booking page and quote page) and on the check-in form.
- The time and the exact text are saved on the booking. Owners and managers see "House rules accepted on …" on the reservation.

**Done looks like:** A guest can't pay, or submit check-in, without ticking the box when the listing has rules. A listing without rules shows no box.

### F42. Paid add-ons
**Status:** Phase 4 (built 2026-10-13, D-59)

**For:** Owners create and change add-ons. Managers can see them. Guests buy them.

**What it does:**
- An add-on has a name (English and optional Taglish), a description, a price, a pricing rule (per stay, per night, per guest, or per guest per night), a maximum quantity, and the listings it applies to.
- It can be offered on the booking page, before arrival (on the guest's pay page), or both.
- Guests pay for add-ons in full, up front, with their deposit. The deposit percentage counts the stay only.
- Each add-on bought shows as an extra charge on the reservation, in the bill, receipt, balance, P&L and owner statement.
- Archiving hides an add-on. Past stays keep it.
- Two active add-ons can't share a name (case ignored). The add-ons page has a search and status filter bar.

**Done looks like:** The booking total equals accommodation plus cleaning plus add-ons, to the centavo. An add-on bought twice by a retried request is recorded once.

### F43. Quotes for Facebook and Messenger inquiries
**Status:** Phase 4 (built 2026-10-13, D-60)

**For:** Owners and managers, and the guest who receives the link.

**What it does:**
- The host makes a quote for one listing and dates: price (prefilled, editable), add-ons, discount, full or deposit payment, a note, and how long it lasts (default 48 hours, maximum 14 days).
- The host copies the link, or emails it if the guest has an email address.
- The guest opens the link, sees the offer, accepts the house rules, fills in any missing details, and pays through PayMongo.
- A paid quote becomes a booking with the source "quote".
- A quote can be cancelled. Expired quotes show as expired. Cancelled quotes show as cancelled.

**Done looks like:** A quote can't be paid after it expires, and can't be paid twice. Its dates aren't held until the guest starts paying.

**Out of scope:** Posting to Facebook or Messenger. Any outside integration.

### F44. Share links and booking sources
**Status:** Phase 4 (built 2026-10-13, D-61)

**What it does:**
- A listing's booking page link with `?src=facebook` (or another allowed source) is kept through the visit and saved on the booking.
- Stay reports get a "By source" table for direct bookings: stays, nights and revenue per source.

**Done looks like:** No tracking cookies. A source outside the allowed list is ignored.

### F45. Public review links, returning-guest codes and abandoned-booking follow-up
**Status:** Phase 4 (built 2026-10-13, D-62)

**What it does:**
- Owners add up to 4 public review links (their own Google, Facebook or other pages). Guests who rate 4 or 5 stars see them after the private rating. Ratings of 3 or fewer never see them.
- Owners can turn on a returning-guest discount (1 to 50 percent). Each guest who has checked out gets one personal, single-use code, made the first time a message uses `{{returning_guest_code}}`.
- Owners can turn on a follow-up email for unfinished online bookings. It goes once, about 2 hours after the attempt ended, and only if the guest hasn't booked those nights.

**Done looks like:** A personal code doesn't count toward the 50-code limit. Quote payments never get the follow-up.

### F46. Search-friendly listing pages
**Status:** Phase 4 (built 2026-10-13, D-63)

**What it does:**
- Each listing has its own public page address, for example `/stay/<host>/<listing>`. Owners and managers set it under Listings.
- The page shows the name, a "from" price (lowest of the nightly, weekend and holiday rates), max guests, city and province, photos, house rules, the cancellation policy, and a "Check dates and book" button.
- The page follows the workspace language. `/sitemap.xml` lists the pages. `/robots.txt` allows them.

**Done looks like:** The street address and guest data never appear on these pages. Host text is escaped, so a name containing a script tag shows as text.

**Out of scope:** Google indexing control, and search rankings. BalayHub can't force Google to show a page.

---

### F47. Pricing rules: booking-window prices and price preview
**Status:** Phase 5 (built 2026-10-13, D-66)

**What it does:**
- Three rule kinds, each a percentage (-90 to +300):
  - **Last-minute:** check-in within 0 to 30 days of today (Manila time).
  - **Far-out:** check-in more than 31 to 540 days away.
  - **Gap night:** the stay exactly fills a free gap of 1 to 7 nights between two confirmed bookings or blocks. The minimum stay is waived for that gap.
- Owners set a rule for every listing. Owners and managers set one for a single listing. A listing rule replaces the workspace rule of the same kind. An inactive rule switches that kind off for the listing.
- Seasons can change the price by a percentage instead of setting a fixed rate.
- A fortnight discount (14+ nights, 0 to 90%) per listing. The discount ladder is monthly (28+) over fortnight over weekly (7+).
- A lowest nightly price per listing. No night is priced below it. A custom calendar price is used exactly as set, even below the floor.
- Price preview: the next 1 to 120 days for one listing (default 60), each night with its price, the rule that changed it, and whether it is booked.

**Done looks like:** Bookings already made keep their prices. The direct booking page, quotes, the new-reservation suggestion, the calendar and the preview all use one engine, so they agree. Each night says why its price is what it is.

**Out of scope:** occupancy-based automatic pricing (founder decision pending in BLOCKERS.MD).

### F48. Bulk price and block changes, tags and room types
**Status:** Phase 5 (built 2026-10-13, D-67, D-68)

**What it does:**
- Pick listings by checkbox or tag (up to 50) and a date range (up to 366 days, from today on).
- **Price:** set one nightly price, change today's computed prices by a percentage, or clear custom prices.
- **Block:** creates blocks. A listing is skipped whole, and named, if any night in the range has a booking or block.
- **Unblock:** cancels only manual blocks that lie fully inside the range. Channel blocks, owner stays and reservations are never touched.
- Every action has a **Preview** that writes nothing, then **Apply**. Both run the same code. Each apply is audited as one entry with counts.
- **Tags:** up to 10 per listing, lowercase, up to 30 characters each. Tags filter the listing list, the calendar and bulk changes.
- **Room types:** a name per listing (up to 40 characters, for example Studio or 1-bedroom), listed per property with a count.

**Done looks like:** The preview lists exactly what Apply writes. Nothing changes until Apply.

**Out of scope:** room types on the public booking page.

### F49. Team tools: activity log, assignment, mentions and notification settings
**Status:** Phase 5 (built 2026-10-13, D-69)

**What it does:**
- **Activity log** on each reservation: the newest 200 lines, in plain English, of what happened to the stay and its payments, charges, refunds, payment proofs, deposits, damage reports, cleaning task, quotes and guest messages, with who and when. Owners and managers only.
- **Assignment:** assigning a conversation tells the new assignee (push, or email if they have no device). Home shows "Assigned to you (n)".
- **Mentions:** in an internal note, `@` and a team member's name notifies that person with the note and a link. Only owners and managers who can see the reservation's property can be mentioned. Staff and cleaners can't.
- **Notification settings** in My account: each person switches each type on or off. Owners can limit alerts to chosen properties. Default: everything on, all properties. Three types were added: mentions, assignments and calendar sync problems.

**Done looks like:** Nobody is alerted about a reservation they can't open.

**Out of scope:** shift scheduling, and team chat outside notes.

### F50. Group bookings, room-type booking and moving a booking
**Status:** Phase 5 (built 2026-10-13, D-70, D-71)

**What it does:**
- **Group booking:** one lead guest, a name, and 2 to 20 rooms. Each room is a normal reservation in its own listing, chosen by listing, or by room type (the first free listing of that type is taken). Each room has its own dates, guests, accommodation total and cleaning fee. For a room type, the price boxes stay empty unless the host types a price, and each room takes its own listing's rates (round 5, D-81).
- **All or nothing:** if any room is taken, nothing is saved and the taken rooms are named.
- **Group page:** rooms, amounts, paid and balance per room and in total. Actions: add a room, remove a room (a reason is required and that reservation is cancelled), cancel the whole group, change the name and notes.
- Payments stay per room. Group bookings send no automatic confirmation email. Channel-imported bookings can't join a group.
- **Room type on a new reservation:** "Any free room of a type" at a property.
- **Move a booking:** owners and managers drag a reservation to another listing's row on the calendar, or use "Move to another listing" on the reservation. Dates and price stay the same. Channel stays and taken listings are refused. The cleaning task moves with the stay.

**Done looks like:** No double booking is possible, and a group never ends up half saved.

**Out of scope:** one checkout for a whole group. Room types on the public booking page.

### F51. Daily close
**Status:** Phase 5 (built 2026-10-13, D-72)

**What it does:**
- Owners and managers open the checklist for a day (today by default, Manila time; up to tomorrow). Managers see their own properties.
- The checklist: arrivals not checked in, departures not checked out, cleanings not done, payments recorded that day by method with totals, balances due within 2 days (including guests staying now), payment proofs waiting, open damage reports, and calendar sync problems. Each line links to where it can be fixed.
- **Close the day** saves a snapshot of the counts and totals, with an optional note. One close per workspace per date; closing again updates it, and every save is audited. History lists past closes.
- Home shows "Today isn't closed yet. Close the day." after 9 PM (Manila time) until the day is closed.

**Done looks like:** A close is a record of what was open at the time, not a live view.

**Out of scope:** end-of-shift handover between team members.

### F52. Calendar sync health
**Status:** Phase 5 (built 2026-10-13, D-73)

**What it does:**
- A channel calendar is **stale** when it hasn't synced for 3 hours. A calendar that has never synced counts from when it was added. It is **failing** when its last sync errored.
- A channel event whose dates are already taken in BalayHub is skipped and kept as an overlap, with its dates, until the channel stops reporting it or the dates clear.
- Warnings show on **Home** (a banner) and on the **Calendar** (a "Sync problem" mark on the listing's row).
- Owners and managers of the property get **one alert per new problem** (push, or email if no device), checked every 15 minutes. A problem that clears and comes back is alerted again.
- Archived listings and properties raise no warnings. Staff and cleaners don't see them.

**Done looks like:** One alert per problem, not one every 30 minutes.

**Out of scope:** two-way channel APIs (no integrations, founder decision 2026-10-13).

---

## Cross-cutting requirements (built)

- **Security:** workspace scoping on every query, 404 for out-of-scope records, CSRF header on writes, strict Content-Security-Policy, text-only rendering, rate limits, scrypt passwords, HttpOnly cookies (7-day absolute, 12-hour idle).
- **Money:** stored as numeric pesos. Payments are voided, never deleted. Idempotency keys stop double saves.
- **Uploads:** PDF, JPG, PNG, WEBP up to 10 MB, checked by file signature, served only after a permission check.
- **Offline:** offline banner, form drafts kept in the browser, saves only reported after the server confirms.
- **Audit:** important actions are logged.

---

## Future

| Item | Priority | Notes |
|---|---|---|
| **SMS reminders to guests** | **Next (planned)** | Listed in README "Not built yet". Today all guest messages are email. |
| **Facebook Messenger inbox** | **Later** | Listed in README "Not built yet". Today the Inbox is email only. |
| **Phase 1: Money done right** (itemised stay bill with extras, payment proof uploads and bank transfer, cancellation policies and refund log, deposit % per listing, host net per booking) | **Built 2026-10-13** | Spec: docs/specs/PHASE-1-MONEY.md. Decisions D-31 to D-36. |
| BIR-ready invoices and monthly tax summary | **Waiting on a tax practitioner** | See BLOCKERS.MD. |
| **Phase 2: Owners and co-hosts** (owner portal login, owner date blocks, fee models, statement approval, payout record, reserve, per-unit P&L, monthly emailed report) | **Built 2026-10-13** | Spec: docs/specs/PHASE-2-OWNERS.md. Decisions D-39 to D-45. Features F16 and F30–F32. |
| **Phase 3: Operations** (cleaner-only access, cleaner calendar, status board with inspected, inspections and scores, damage reports linked to deposits, cleaner pay, supplies par levels, lost and found, maintenance for stays) | **Built 2026-10-13** | Spec: docs/specs/PHASE-3-OPERATIONS.md. Decisions D-48 to D-56. Features F33 to F39. |
| **Phase 4: Guest experience and direct booking** (guidebook in English and Taglish, house rules acceptance, paid add-ons, quote-and-pay links for Facebook inquiries, private feedback, returning-guest codes, unpaid-booking follow-up, search-friendly listing pages) | **Built 2026-10-13** | Covers the "Booking page upgrades" idea below. |
| **Phase 5: Pricing rules and team** (gap nights, last-minute and far-out rules, events, bulk changes, booking activity log, conversation assignment, notification rules, unit tags, group bookings, room types, sync-health alerts) | **Built 2026-10-13** | Spec: docs/specs/PHASE-5-PRICING-TEAM.md. Decisions D-66 to D-74. Features F47 to F52. The roadmap phases 1 to 5 are now all built. |
| Booking page upgrades | Idea | Not specified in the repo docs yet. Scope to be defined. |
| Smarter reports | Idea | Not specified in the repo docs yet. Scope to be defined. |
| Recurring expenses | Idea | Not built. Expenses are entered one at a time today. |
| Owner portal | **Built 2026-10-13** | See F30. Owners can't yet pay themselves through BalayHub. |
| Official two-way channel APIs | Excluded for now (founder, 2026-10-13: no integrations) | Guest names, prices and messages from Airbnb, Booking.com, Agoda. Mentioned in SHORT-TERM-GUIDE. |
| Long-term: tenant portal, online rent payments, utility billing, e-signatures | Planned | Listed in README "Not built yet". |
| Prorated first-month rent | Known limitation | ARCHITECTURE "next steps". |
| Several workspaces per account | Known limitation | ARCHITECTURE "next steps". |

---

## Known gaps and open questions

- After a **new** Google sign-up the server redirects to `#/`, the landing page. The app does not send the user on to workspace setup from there. Unverified in a browser; worth checking.
- The Inbox API returns `ai_needs_upgrade` for Starter plans, but the app does not use it. Starter users see no AI button and no upgrade hint.
- `welcomeView` in `public/js/views/auth.js` is no longer routed (the landing page replaced it).
- Monthly schedules step from the last due date, so a schedule on the 31st can drift to the 28th after February.
- Monthly maintenance schedules count from the last due date, so a due date on the 31st can slide to the 28th.
- Cleaners get no push notifications for cleaning jobs yet (the cleaning topic goes to owners, managers and staff only).
- Phase 4: fixed — the `/stay` pages and sitemap are rate limited and the sitemap is cached (D-65).
- Phase 4: the listing's own check-in instructions and house rules have no Taglish text yet, so the guide shows English for them.
- Phase 4: door code and Wi-Fi password become plain text in the inbox history once a message with them is sent (D-64).
- Phase 4: Google decides when to show the listing pages. BalayHub can't force it.
- Phase 5: the reservation activity log doesn't show check-in form submissions, or the reason given for a refund (D-74).
- Phase 5: sync warnings show on Home and the Calendar, not on the Listings page the spec asked for (D-74).
- Phase 5: the profit and loss page doesn't filter by tag yet, although the spec asked for it.
- Phase 5: fixed — a manager with no assigned properties can't open or save the daily close (D-75).
- Phase 5: a mention in a note on a conversation with no reservation can only reach owners, because the property check has nothing to test.
- Phase 5: notification settings let any team member choose among the properties they can see. The spec limited this to owners.
- QA round 3: a channel fee exists only on channel bookings (D-78). Older direct bookings may still hold a stored fee; it is ignored for what the guest owes and still counted as a cost in reports until the founder decides.
- QA round 3: the guidebook link shows "Your guidebook opens on <date>" before its 14-day window (D-57, D-78).
- QA round 4: there are no notification types for monthly rentals yet. The Notifications card says so, and the founder question is in BLOCKERS.
- QA round 4: a monthly-rental owner can still see a "Turn on notifications" button with no alert types to turn on. Carried to round 5. Fixed in round 5.
- QA round 4: staff browsers still receive rent, deposit, admin email and gate-pass notes with a property, although the staff screen hides them (founder question in BLOCKERS).
- QA round 4: add-on descriptions are single-language. Guests reading in Taglish see the description as typed (founder question in BLOCKERS).
- QA round 4: on phones, wide tables and the calendar show a subtle edge fade rather than a clear cue. The founder is asked whether to add a swipe hint or show stacked cards instead (BLOCKERS). Built in round 5: tables with four or more columns stack into cards on phones (D-80, D-81). The calendar keeps its fade.
- QA round 4: the Taglish template-language switch can create a second template with the same name as a custom one. This is rare and accepted for now (D-79).
- QA round 4: a proof screenshot can be left on disk after a rare database failure. Nothing can reach the file without its record, so the fix is left for a tidy-up sprint (D-79).
- QA round 4: some choices are allowed with no warning until the founder answers in BLOCKERS: prices and groups on past dates, two cleaning tasks on one day, and staff invited with no property.
- QA round 5: `GET /api/my-pay` answers any signed-in person, with only that person's own cleans. The page is for cleaners only. BLOCKERS question 13 asks whether the API should match the page.
- QA round 5: reopening an older clean while a newer clean of the same unit is done still marks the unit dirty. Carried to round 6.
- QA round 5: the daily close lists payments only (D-72). Founder question 5 in BLOCKERS.
- QA round 5: duplicate add-ons made before the name rule are archived in the local copy only. Guest lists show each name once. The live database check is BLOCKERS question 10.
- QA round 5: the balance after refunding an overpayment stays as D-34 and D-77 define it. Founder question 1 in BLOCKERS.
- QA round 5: add-on descriptions are still English only (round 4 question, still open).

- QA round 6: staff see a guest's name only (no VIP or Do not rebook flag, stay counts, ratings or review card on guest pages and reservations). Staff can still read full reviews on the Reviews page. Founder questions 1 and 2 in BLOCKERS (D-82).
- QA round 6: `GET /api/my-pay` is now cleaners only, which closes the round 5 question (D-82).
- QA round 6: add-on descriptions are still English only (unchanged, round 4 question).
- QA round 7: past nights' prices and blocks can still be edited on the calendar (founder question 1 in BLOCKERS, default allowed).
- QA round 7: add-on descriptions are still English only (unchanged).
- QA round 7: the booking source is hidden from staff, following the access table (founder question 7 in BLOCKERS, default hidden).
- QA round 7: in a Both workspace every new unit needs a nightly rate even if it is rented monthly only (founder question 5, default required).
- QA round 8: the Wi-Fi password on the owner's listing form is a plain box with no Show/Hide, unlike the door code (founder question 7 in BLOCKERS, default keep).
- QA round 8: a payout to an owner with no units has no statement, so it is not checked against what the owner is owed (founder question 8 in BLOCKERS, default keep).
- QA round 8: the report and list date filters still accept years 1900 to 2200, while every date typed into a form is limited to 2000 to 2100 (D-84). To be tightened later.
- QA round 8 scope notes (D-84): a quote can't have more guests than the listing allows (same as reservations and the booking page); owners and managers can edit a cleaning task's notes on the job page; Get started answers are kept only for the email they were typed for, shown for checking and never posted on their own; unit-level damage reports are for owners and managers only; a percentage-model unit owner must have a management fee.
- QA round 9: the guest balance counts refunds (D-85). A refund on a live stay that leaves money owed asks first; the cap stays at what was paid (founder question 1 in BLOCKERS, default allowed).
- QA round 9: there is no Walk-in booking source; walk-ins are saved as Other (founder question in BLOCKERS, default Other).
- QA round 9: the Starter plan allows 2 listings while the alpha targets 1 to 3 units (BLOCKERS, default no pricing change).
- QA round 9: the automatic-message preview with sample guest details is not built yet (round 10).
- QA round 10: rent payments have no receipt numbers (founder question in BLOCKERS, default none). Automatic message names have no database index, only an app check (accepted gap, same reason as add-on names). The booking page can be turned on with no listing on screen-gated only; the server doesn't refuse yet (round 11).
