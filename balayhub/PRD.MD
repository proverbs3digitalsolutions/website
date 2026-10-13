# BalayHub — Product Requirements (PRD)

BalayHub is a web app that helps Filipino hosts run 1 to 10 rental units from one place. It covers condo staycations listed on Airbnb, Booking.com and Agoda, and long-term monthly rentals such as apartments, boarding houses, dorms and bedspaces. Hosts get one calendar for every channel, a direct booking page with GCash, Maya and card payments, a guest inbox, cleaning tasks, condo gate passes, deposits, reports and owner statements. Long-term landlords get properties, tenants, leases, rent, expenses and repairs. This document describes what is **actually built** today, feature by feature, and lists what is planned. It was written from the code (`src/routes`, `src/lib`, `public/js`, `db/migrations`) and the existing docs.

Last updated: 2026-10-13

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
| Owner | The person who created the workspace | Everything in the workspace. Only role for team, billing, data export and deletion, unit owners, automations, Launchpad. |
| Property manager | Co-host or manager | Only the properties assigned to them. Can run day-to-day work. Cannot create properties, manage the team or billing. |
| Staff | Cleaner, front desk, accountant | Only assigned properties. No guest or tenant contact details, no Inbox, no stay reports, no pricing changes, no workspace settings. Can check guests in and out, record payments and deposits, and do cleaning tasks. |
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
- Pricing helpers per listing: **weekend rate** (Fri and Sat nights), **holiday rate** (nights before and during Philippine holiday long weekends), **weekly discount** (7+ nights) and **monthly discount** (28+ nights).
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
- Automatic messages: triggers on booking created, days before check-in, on check-in day, days before check-out, days after check-out, at a set Philippine time. Defaults are created **off**. Only the owner can add, edit, turn on or delete automations.
- **✨ Draft reply with AI** writes a draft in the guest's language (English, Tagalog or Taglish) for review. Shown only when `ANTHROPIC_API_KEY` is set and the plan includes AI (trial, Growth, Pro, Complimentary).
- System notes appear for check-in forms, online payments, reviews and gate pass receipts.

**Done looks like:**
- A failed send is kept with "Not sent" and can be retried. Scheduled messages can be cancelled.
- A guest with no email gets a warning and can only receive notes.
- The payment reminder automation skips guests with no balance.

**Out of scope:** Airbnb, Booking.com or Agoda message sync. SMS. Facebook Messenger (see Future).

### F11. Housekeeping, cleaning tasks and checklist
**Status:** MVP (built)

**For:** Owners, managers and staff (cleaners).

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

**Out of scope:** Cleaner payroll. Inventory or supplies tracking.

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

**Done looks like:**
- A warning shows when stays have no amounts (imported channel stays).

**Out of scope:** An owner login or portal (see Future). Paying owners through BalayHub.

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
- **Rent:** monthly charges generated from each lease. Statuses paid, partial, unpaid, overdue. Payments go to the oldest charge first.
- **Payments:** full or partial, cash, bank, GCash, Maya, check, reference, receipt file. Never edited or deleted, only voided with a reason.
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
- **Team & permissions** in Settings: invite by email as Property manager or Staff, choose properties. The link is emailed (if email works) and shown to copy. Links expire in 7 days and work once.
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
| **Phase 1: Money done right** (itemised stay bill with extras, payment proof uploads and bank transfer, cancellation policies and refund log, payment schedules, host net per booking, BIR-ready invoices and monthly tax summary after a tax check) | **Next (from research)** | See docs/research/00-SUMMARY.md §4. |
| **Phase 2: Owners and co-hosts** (owner portal login, owner date blocks, fee models, statement approval, payout record, reserve, per-unit P&L, monthly emailed report) | Next | Replaces the "Owner portal" idea below. |
| **Phase 3: Operations** (cleaner-only access, cleaner calendar, status board with inspected, inspections and scores, damage reports linked to deposits, cleaner pay, supplies par levels, lost and found, maintenance for stays) | Next | |
| **Phase 4: Guest experience and direct booking** (guidebook in English and Taglish, house rules acceptance, paid add-ons, quote-and-pay links for Facebook inquiries, private feedback, returning-guest codes, unpaid-booking follow-up, search-friendly listing pages) | Planned | Covers the "Booking page upgrades" idea below. |
| **Phase 5: Pricing rules and team** (gap nights, last-minute and far-out rules, events, bulk changes, booking activity log, conversation assignment, notification rules, unit tags, group bookings, room types, sync-health alerts) | Planned | Covers the "Smarter reports" idea below. |
| Booking page upgrades | Idea | Not specified in the repo docs yet. Scope to be defined. |
| Smarter reports | Idea | Not specified in the repo docs yet. Scope to be defined. |
| Recurring expenses | Idea | Not built. Expenses are entered one at a time today. |
| Owner portal | Idea | Not built. Owners get emailed or printed statements only (F16). |
| Official two-way channel APIs | Excluded for now (founder, 2026-10-13: no integrations) | Guest names, prices and messages from Airbnb, Booking.com, Agoda. Mentioned in SHORT-TERM-GUIDE. |
| Long-term: tenant portal, online rent payments, utility billing, e-signatures | Planned | Listed in README "Not built yet". |
| Prorated first-month rent | Known limitation | ARCHITECTURE "next steps". |
| Several workspaces per account | Known limitation | ARCHITECTURE "next steps". |

---

## Known gaps and open questions

- After a **new** Google sign-up the server redirects to `#/`, the landing page. The app does not send the user on to workspace setup from there. Unverified in a browser; worth checking.
- The Inbox API returns `ai_needs_upgrade` for Starter plans, but the app does not use it. Starter users see no AI button and no upgrade hint.
- `welcomeView` in `public/js/views/auth.js` is no longer routed (the landing page replaced it).
