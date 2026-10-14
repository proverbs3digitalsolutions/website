# BalayHub — App Flow

This document walks through BalayHub page by page and role by role. For each page it says what the main clicks do, which page comes next, and what the user sees when data is loading, empty, failing, read-only, in the demo, or over a plan limit. It covers visitors, guests on private link pages, the three workspace roles (owner, property manager, staff) and the platform admin. Every statement was checked against `public/js/app.js`, the views in `public/js/views/`, the server routes in `src/routes/`, `src/lib/access.js` and every `requireRole(...)` call. Features themselves are described in `PRD.MD`.

Last updated: 2026-10-13

---

## 1. How routing works

The app is a single page with hash routes (`#/…`). Each route has an access level (`public/js/app.js`).

| Access | Meaning | If the rule fails |
|---|---|---|
| Public | Only for signed-out visitors (landing, login, signup, forgot) | A fully set-up user is sent to their home page |
| Open | Anyone (privacy, terms, reset, verify, and all guest token pages) | — |
| Signed in | Signed in, setup may be unfinished (`#/verify-pending`, `#/setup`) | Not signed in → `#/login` |
| App | Signed in, email verified (if required) and in a workspace | Not signed in → `#/login` (the page is remembered); not verified → `#/verify-pending`; no workspace → `#/setup` |

- **Home page by type:** Long-term workspaces land on `#/dashboard`. Short-term and Both land on `#/home`.
- **Unknown route:** sends to the home page (signed in) or `#/` (signed out).
- **Route guard (2026-10-13, D-76):** a signed-in user who types a page their role or workspace type can't use (for example staff on `#/inbox`, a manager on `#/owners`, a long-term workspace on `#/calendar`, a short-term one on `#/dashboard`, `#/admin` for anyone but a platform admin) goes to their home page with the toast "That page isn't available for your role or workspace." The rules are in `public/js/routeaccess.js`, built from the same lists as the menu.
- **After login (`afterLogin`):** setup redirect first; else the remembered page; else, for an owner of a short-term or Both workspace (not the demo) whose Launchpad is unfinished and not hidden, `#/launchpad`; else the home page.

## 2. Global states (every app page)

| State | What the user sees | Next |
|---|---|---|
| Loading | Grey skeleton blocks in the content area | The page renders |
| Page failed to load | Card "Couldn't load this page" with the server message, and **Try again** (no retry button for 403 or 404) | Retry re-renders |
| Not found / out of scope | "Not found" card (server returns 404 for records in another workspace or unassigned property) | Use the menu |
| No permission | Error card with "You don't have permission to do that." (403) | Use the menu |
| Session expired (401) | Toast "Your session expired. Log in again — your unsaved input is kept." | `#/login?expired=1`, then back to the same page |
| Offline | Offline banner at the top; "Back online." toast when it returns. Forms say "Couldn't reach BalayHub. Nothing was saved yet — your input is kept." | Press Save again |
| Server can't be reached at start | "Can't reach BalayHub. Check your internet connection." with retry | Reloads |
| Validation error | Red message "Please check the highlighted fields." and per-field errors | Fix and save |
| Double click | Save button disabled while saving ("Saving…"); payments and expenses use an idempotency key | Recorded once |
| Empty list | An icon, a title and a hint, often with an action button (e.g. "Add listing") | See each page |
| Filters hide everything | "No results found — Try removing a filter" | Remove a chip or **Clear all** |
| Backwards date range in a filter bar | Inline red "The end date is before the start date." on the range; the range is not applied | Fix a date |
| Row you can click | Rows that open a page can also be opened with the keyboard (Tab to focus, Enter or Space) | — |

### Plan and workspace banners (top of every app page)

| Banner | When | Owner sees | Others see |
|---|---|---|---|
| Demo (blue) | Demo workspace | "You're exploring the demo. Changes are turned off." + **Start your free trial** (logs out → `#/signup`) | Same |
| Trial | On the free trial | "Free trial: N days left" + **See plans** (→ Settings) | Text only |
| Grace (amber) | Paid-until passed, within 7 days | "Your plan was paid until … Please renew soon." + **Renew** | Nothing |
| Read-only (red) | Trial ended, or 7+ days past paid-until | "Your free trial has ended…" or "Your plan payment is overdue…" + **Choose a plan** | "Ask the workspace owner to renew." |
| Deleting (red) | Owner asked to delete the workspace | "This workspace will be permanently deleted on … It is view-only until then." + **Cancel deletion** | Text only |

### Read-only, demo and plan-limit behaviour

- **Read-only (trial ended, payment due, deleting):** every page still opens and exports still work. Any save is refused with HTTP 402 and a message such as "Your free trial has ended. Your data is safe and you can still view and export it. Choose a plan in Settings to keep making changes." It shows as a form error or a red toast. These keep working: billing, support tickets (and screenshots), account, push settings, the assistant, and **Cancel deletion**. The direct booking page shows "Online booking is paused". Gate passes are not sent.
- **Demo:** same as read-only, with the message "This is the demo workspace, so changes are turned off. Start a free trial…". Settings hides Notifications, Plan & billing, Direct booking page and Your data. The Launchpad reminder is hidden. The assistant button is hidden. The demo booking page says "This is a demo, so booking is turned off."
- **Listing limit:** adding a listing, giving a long-term unit a nightly rate, or restoring a listing beyond the plan's limit fails with "Your Starter plan includes up to 2 listings. Upgrade your plan in Settings to add more." (402). Long-term units without a nightly rate do not count.
- **AI drafts limit:** on Starter, the **✨ Draft reply with AI** button is not shown. A direct API call returns "AI reply drafts are included in the Growth and Pro plans." (402).

## 3. App shell and navigation

- **Desktop:** left sidebar with the menu, then the user card (name, workspace, role → `#/account`), a compact theme switch and **Log out**.
- **Phone:** top bar (workspace name and avatar → `#/account`) and a bottom bar with the first four menu items (Launchpad excluded) plus **More**. More opens a sheet with My account, the rest of the menu, the theme switch and Log out.
- **Inbox badge:** unread count on the Inbox link (owners and managers).
- **Ask button:** floating assistant button on every app page when the assistant is on (see 9.4).
- **Log out:** turns off push on this device, clears the assistant chat, ends the session → `#/login`.

### Menu by workspace type

| Short-term | Long-term | Both |
|---|---|---|
| Launchpad, Home, Inbox, Calendar, Reservations, Housekeeping, Listings, Guests, Unit owners, Reports (stay), Expenses, Maintenance, Settings | Dashboard, Properties, Tenants, Rent & Expenses, Reports, Maintenance, Settings | Launchpad, Home, Inbox, Calendar, Reservations, Housekeeping, Listings, Long-term rentals, Tenants, Rent & Expenses, Rental reports, Stay reports, Guests, Unit owners, Maintenance, Settings |

Every member also gets **Help & support**. Platform admins also get **Admin**.

### Menu items removed by role

| Item | Owner | Manager | Staff |
|---|---|---|---|
| Launchpad | Yes | Hidden | Hidden |
| Unit owners | Yes | Hidden | Hidden |
| Inbox | Yes | Yes | Hidden |
| Stay reports | Yes | Yes | Hidden |
| Profit and loss | Yes | Yes | Hidden |
| Everything else | Yes | Yes | Yes (with limits below) |

Typing a hidden URL does not bypass this: the server returns 403 (Inbox, Unit owners, stay reports) and the page shows the error card. The Launchpad shows a note for non-owners.

## 4. Role differences (verified against the server)

Managers and staff only see records in properties assigned to them (`propertyScope`, `tenantScope`, `guestScope`). Guests and tenants with no stays or leases yet are visible to them too. Owners see the whole workspace.

| Area | Owner | Manager | Staff |
|---|---|---|---|
| Home overview, check in / check out | Yes | Yes | Yes (no "New reservation" button) |
| Calendar | Book, block, set price | Same | View only ("Only owners and managers can change the calendar.") |
| Pricing rules page | Add/remove any season, incl. "All listings" | Add/remove seasons for one listing only | No link; page is read-only if opened directly |
| Reservations | Create, edit, cancel, export | Same | View and export; no create/edit/cancel |
| Reservation payments | Record, void, email receipt, copy payment link | Same | Record only |
| Guest contact (phone, email, notes) | Yes | Yes | Never sent by the server; shows name only |
| Check-in form and guest IDs | Yes | Yes | Hidden; ID files refused |
| Gate pass | Settings and send | Same | Hidden |
| Security deposit | Record, return, undo a return | Record, return | Record only |
| Inbox, templates | Yes | Yes | No (403) |
| Automatic messages | Add, edit, turn on/off, delete | View only ("Only the workspace owner can change automatic messages.") | No |
| Housekeeping | All, plus Edit checklist | Add, assign, cancel, copy for cleaner | View, tick checklist, start, mark done, reopen, add photos |
| Listings | Add, edit, photos, channels, gate pass | Same, but can't create a new building | View, mark clean/dirty |
| Guests | Edit, VIP, Do not rebook; Reviews; Discount codes | Same | Names and stay counts only; no Reviews or Discount codes buttons |
| Unit owners, statements, payouts and repairs reserve | Yes | No (403) | No (403) |
| Profit and loss (`#/pnl`) | Yes, all units | Yes, assigned properties | No (403) |
| Owner portal (unit owners, separate sign-in) | Invites and turns off access | No access | No access |
| Stay reports and tax summary | Yes | Yes | No (403) |
| Long-term Dashboard and Reports | All properties | Assigned | Assigned (not hidden for staff) |
| Properties | Create, archive, restore | Edit, add/archive units | View |
| Tenants and leases | Full, export tenant data | Full except export | Names only; no lease documents; can record payments |
| Expenses | Record, correct, void | Same | Record only |
| Maintenance | Full | Full | Create, add costs; can't change status |
| Settings | Everything | Account, appearance, notifications, "Your recent actions", privacy | Account, appearance, notifications, privacy |
| Team, billing, booking page, data export/delete | Yes | No | No |
| Launchpad | Yes | Note only | Note only |
| Push topics | All | All | Cleaning only |
| Support tickets | All workspace tickets | Own tickets | Own tickets |

Note: staff can open Settings, but only see personal sections. Staff can see the long-term Dashboard and Reports for assigned properties. The short-term stay reports are the ones hidden from staff.

---

### 4.1 Cleaner role (Phase 3, D-48)

A cleaner is a team member with the cleaner role. They must have at least one property. Their home is Cleaning (`#/housekeeping`). Any other address sends them back there.

**Menu:** Cleaning · My pay · Help & support · Account. Nothing else is shown.

| Area | Cleaner |
|---|---|
| Cleaning jobs, board, calendar | Their own jobs and unassigned jobs in their properties. Guests by first name only. |
| Job detail | Tick checklist items, Start, Mark done, Reopen, add photos, Report damage, Found an item, Supplies used, Something broken? (work order). No cancel, no reassign, no edit, no inspect. |
| Pay | Their own pay only (`#/my-pay`). |
| Supplies | Names and counts only (no costs). Record used or restocked on a job. |
| Files | Photos on cleaning, damage and lost-and-found records they can see. |
| Account, help, support | Yes. |
| Everything else | Not shown. The server refuses with 403 CLEANER_FORBIDDEN. |

**Flow: a clean.** Open the job → tick items → Start → Mark done. The unit becomes Clean. Owners and managers get a notification. Pay for the job is worked out from the cleaner's rate.

**Flow: something found.** On the job, use Report damage, Found an item, Supplies used or Something broken?. Each one saves and shows on the job.

**Flow: my pay.** My pay lists this month's finished cleans, the amount for each, and whether it is paid.

Cleaning push notifications do not go to cleaners yet.

---

## 5. Visitor flows (signed out)

### 5.1 Landing `#/`
- Loads plans from the server. If that fails, the page still shows without prices.
- **Features / Why BalayHub / Pricing / FAQ** links scroll the page.
- **Language (EN ▾)** → English or Tagalog. The page re-renders. The choice is saved in the browser.
- **Log in** → `#/login`.
- **Get started**, **Start your 14-day free trial**, **Start free trial** (pricing) → Get-started popup at step 1.
- **Get started** on a "Who BalayHub is for" card → popup at step 2 with the unit band set.
- **Try the live demo** → button shows "Opening demo…" → signed into the demo → `#/home`. On error: red toast and the button resets.
- Footer: Terms, Privacy, contact email, theme switch.

### 5.2 Get-started popup (3 steps)
1. **How many units?** Tap 1–3, 4–10 or More than 10 → step 2.
2. **Tell us about your hosting business.** First name, last name, business name (required), mobile, what you rent out. "More than 10" shows a custom-plan note. **Back** → step 1. **Continue** → step 3, or highlights missing fields.
3. **Create your account.** Email, password, Terms/Privacy checkbox. **Start my free trial** → "Creating your account…".
   - Success → popup closes → `#/verify-pending` (email verification on) or straight to setup, which creates the workspace from the saved answers → `#/launchpad` (short-term/Both) or `#/properties?new=1` (long-term).
   - Error (e.g. email taken) → red message in the popup with field errors.
   - **Sign up with Google** (if set up) saves the answers and goes to Google.
   - **Already have an account? Log in** → `#/login`.

### 5.3 Log in `#/login`
- Banners: session expired, password updated, or a Google error.
- **Log in** → success → `afterLogin` (see 1). Wrong details → "Incorrect email or password. Try again or reset your password." Too many tries → "Too many attempts…".
- **Log in with Google** (if set up) → Google → back to the app.
- **Forgot password?** → `#/forgot`. **Create an account** → `#/signup`. **Try the live demo** → demo.

### 5.4 Sign up `#/signup` (and invitations)
- Fields: full name, email, password, confirm, Terms/Privacy.
- With `?invite=…`: title "Join <workspace>", email pre-filled. An invalid or expired invite shows "Invitation not valid" with a link to create your own account.
- **Create account** → `afterLogin` → `#/verify-pending` (new user) or the app (invited users are verified by the link, then go to their home page).
- **Sign up with Google** → Google (passes the invite).
- After a brand-new Google sign-up the server returns to `#/` (landing). Unverified: the visitor may need to click Log in to reach setup.

### 5.5 Check your email `#/verify-pending`
- Shows the address. In development, a "Verify my email" link. If sending failed: an error explaining the admin must fix email.
- **Resend verification email** → "A new verification email is on its way." or an error.
- **I've verified — continue** → re-checks → setup or app.
- **Use a different account** → logs out → `#/login`.

### 5.6 Verify `#/verify?token=…`
- "Verifying your email…" → success toast "Email verified." → `afterLogin` (or a Log in button if signed out).
- Bad or expired link → "Couldn't verify" + **Request a new link**.

### 5.7 Forgot and reset password
- `#/forgot` → **Send reset link** → "If an account exists for that email, we sent a reset link." (same text either way).
- `#/reset-password?token=…` → new password + confirm → **Save new password** → `#/login?reset=1`. Bad link → error. No token → `#/forgot`.

### 5.8 Workspace setup `#/setup`
- If answers from the Get-started popup are saved, the workspace is created right away → Launchpad or Properties.
- Otherwise: business name and type → **Create workspace** → `#/launchpad` (short-term/Both) or `#/properties?new=1` (long-term).
- Already in a workspace → `afterLogin`.

### 5.9 Privacy `#/privacy` and Terms `#/terms`
Open to everyone. Linked from sign-up, guest pages and footers.

---

## 6. Guest and outside-party pages (private links, no account)

All guest pages have an English / Tagalog toggle (Taglish text). The default is the host's guest language. Server error messages, receipts and the gate pass stay in English.

### 6.1 Booking page `#/book/<slug>`
- Shows host name, welcome text and listing cards (photo, guests, minimum nights, price per night).
- **Tap a listing** → `#/book/<slug>/<unitId>`.
- States: unknown slug → "Page not found". Booking off or plan read-only → "Online booking is paused right now. Please contact the host directly." Demo → "This is a demo booking page. Bookings and payments are turned off." Test key → "TEST MODE…". No listings → "No places are open for online booking yet."

### 6.2 Listing booking page `#/book/<slug>/<unitId>`
- Gallery, details, house rules, availability calendar (taken nights greyed, holiday prices marked).
- **Tap a check-in date, then a check-out date** → price summary (nights, discounts, cleaning fee, total, 50% deposit option).
- **Have a discount code?** → **Apply** → "Code … applied" or the reason it failed.
- Payment choice: Pay in full or 50% deposit (as the host allows). Too close to arrival → charged in full.
- Fill name, guests, email, mobile, optional message, consent → **Continue to payment** ("Opening secure payment…") → PayMongo.
- Errors: dates taken → "Sorry, these dates are no longer available." Too many open checkouts → "You already have a booking waiting for payment…". Field errors are shown inline.
- Back from PayMongo with cancel → toast "Payment cancelled. Nothing was charged and your dates were not booked."

### 6.3 Booking result `#/book/<slug>/done/<token>`
- "Confirming your payment…" while it polls.
- Paid → "You're booked, <name>!" with code, place, dates, guests, paid, balance and due date, and **Register your guests now** → check-in form.
- Conflict → "Dates no longer available" (host will refund or offer dates). Expired, failed or pending → explanation + **Back to all places**.

### 6.4 Pay balance `#/pay/<token>`
- Shows the stay and balance. **Pay ₱… now** → PayMongo → back here → "Confirming your payment…" → "Payment received. Thank you!" when the balance is zero.
- Fully paid → "Your booking is fully paid". Cancelled → "This booking was cancelled". No PayMongo → "Online payment is not available for this booking. Please contact your host." Bad link → "Link not found".

**Since Phase 1 (2026-10-13):**
- The pay page shows an itemised bill: nights, cleaning, other fees, each extra charge, payments and the balance.
- If the host turned on manual payments, a second card shows the host's GCash, Maya and bank details, plus a form: amount (prefilled with the balance), method, reference, payer name and a screenshot.
- Sending it shows "Thank you, your proof was sent". The host confirms it before it counts as paid.
- Proofs are refused for cancelled, fully paid or ended stays, and when 5 are already waiting.

### 6.5 Guest check-in form `#/checkin/<token>`
- Shows stay, times and booking code.
- Main guest (name, mobile, email), **+ Add guest** (up to the listing's max; more shows an error toast), arrival time, plate, notes, ID photos, consent.
- **Submit registration** → uploads IDs one by one ("Uploading ID photo 1 of 2…") → "Thank you! You're registered." → **Review or change my answers**.
- Already submitted → green "Received …" note and **Save changes**.
- Stay ended or cancelled → "This stay has ended or was cancelled, so the form is closed." Bad link → "Link not found". Offline → answers kept.

### 6.6 Review `#/review/<token>`
- "How was your stay?" stars (overall, cleanliness) and a comment → **Send feedback** → "Salamat po!".
- No stars → "Please choose a star rating first." Before check-in → "Feedback opens soon". More than 60 days after check-out, cancelled, or already sent → "Feedback is closed" or the thank-you.

### 6.7 Gate pass (building admin) `#/gatepass/<token>`
- Printable "Guest gate pass" with guests, dates, plate, notes, authorized by, and ID photos (if linked).
- **Confirm received** → toast "Thank you! The host has been told you received it." **Print**.
- Expired (day after check-out) or bad link → "Gate pass not available".

### 6.8 Calendar feed `/ical/<token>.ics`
Not a page. Airbnb, Booking.com, Agoda and others poll it to block dates.

---

## 7. Owner flows (short-term and Both)

Managers follow the same flows unless section 8 says otherwise.

### 7.1 Launchpad `#/launchpad`
- Hero: progress bar, "N of 11 steps done", **Next: <step>** → that step's page.
- Five phase cards. Each step opens to show why and how, with an action button (e.g. **Add listing** → `#/listings?new=1`, **Open Channels** → `#/listings`, **New reservation** → `#/reservations?new=1`, **Set up messages** → `#/inbox-settings`, **Invite** / **Set up booking page** / **See plans** → `#/settings`, **Open Housekeeping** → `#/housekeeping`).
- Optional steps: **Skip for now** / **Show again**.
- Complete → "You're all set, <name>! 🎉". "How do I…?" guides stay available.

### 7.2 Home `#/home`
- Launchpad reminder card (owner, unfinished, not hidden): **Open Launchpad** or **Hide**.
- **New reservation** → `#/reservations?new=1`. **Calendar** → `#/calendar`.
- **Daily overview** tabs Today / Tomorrow / 7 days. Tiles link to Reservations views. Rows open the reservation. Today's rows have **Check in** / **Check out** → toast → card reloads. "N listings need cleaning" → `#/listings?cleaning=dirty`.
- **Deposits to return** card → reservation.
- **Trends** (7/30 days) and **Revenue** (‹ month ›).
- Empty (no listings): "Add your first listing" + **Add listing** (owner). Managers/staff: "No listings assigned to you yet". A card that fails shows a red message inside the card only.

### 7.3 Calendar `#/calendar`
- A start date in the address that isn't a real date (such as 2026-02-30) shows today with the toast "That date wasn't valid, so we're showing today." A refused drag-move shows the reason (for example the guest limit) in its toast.
- Toolbar: ‹ ›, **Today**, date picker, 14/30 days. Filter bar: search, property, availability, type, cleaning. Legend by channel.
- **Tap an open night** → menu: **New reservation** (form pre-filled), **🔒 Block dates** (first/last night, reason), **₱ Set nightly price** (date range; empty price removes the override).
- **Tap a reservation bar** → `#/reservations/<id>`. **Tap a block** → "Remove this block?" (channel blocks: "Change it on the channel.").
- **₱ Pricing rules** → `#/pricing`. **New reservation** → form.
- Empty: "No listings yet" + **Add listing**. Filtered out: "No results found".
- Overlap → form error "These dates overlap … on this listing."

### 7.4 Pricing rules `#/pricing`
- **+ Add season** → name, listing (owner can pick "All listings"), first/last night, rate and/or minimum nights → **Save season**.
- **Remove** → confirm → season gone.
- Listing rates table (edit in Listings). PH holidays list. Empty: "No listings yet".
- **‹ Calendar** back link.

### 7.5 Reservations `#/reservations`
- Saved views (side list on desktop, a dropdown on phone). Filter bar: search, channel, property, More filters (listing, check-in/out dates, payment, guest type, check-in form, nights, guests, sort).
- **New reservation** → form with live quote ("2 nights · ₱… · includes 1 weekend night"). **Save reservation** → toast with the code → reservation page. If the email failed: "Reservation saved, but the confirmation was not emailed: …". "Do not rebook" → warning toast.
- **Export CSV** downloads the current view.
- **Click a row** (or Enter or Space on it) → `#/reservations/<id>`.
- On a cancelled booking that still holds money, the page shows "Cancelled: ₱… still to refund" with a link to the Refunds card (the "Overpaid" and "You keep" lines are for live bookings only). The Unpaid and Partial payment filters list confirmed bookings only.
- Empty: "Nothing here yet" + **New reservation**. Filtered: "No results found".

### 7.6 Reservation detail `#/reservations/<id>`
- Header buttons: **Check in** (from check-in day), **Check out** → listing marked dirty, cleaning task created. **Undo check-in / Undo check-out**. **Message guest** → `#/inbox/<conversation>`. **Edit** (dates locked for channel imports). **Cancel** → reason → "Reservation cancelled." (not for channel imports or checked-out stays).
- **Payment card:** **Record payment** (amount, date, method, reference, email receipt) → toast. **Copy payment link** (balance > 0) → copied, or a reason ("Connect PayMongo in Settings…"). Per payment: **Receipt** → `#/receipts/<id>`, **Email**, **Void** (reason).
- **Guest card:** badges, contact, **Guest profile**, **Email booking confirmation**.
- **Guest check-in form card:** **Copy link**, **Copy for building admin**, **New link** (confirm).
- **Gate pass card:** status, **Send now / Send again**, **Preview**, or "Set up the admin email" → `#/gatepass-settings`.
- **Deposit card:** **Record deposit**, then **Return deposit** (deduction, reason, photos, email), owner-only **undo** back to held.
- Cancelled → red banner with the reason; most actions hidden.

**Phase 1 cards on the reservation detail page (right column, under Payment):**
- **Extra charges:** add a charge (category, description, quantity, price), with an optional "Send pay link" after adding. Void with a reason.
- **Payment proofs** (owners and managers): each proof with its screenshot. *Confirm* records the payment, with an optional receipt. *Reject* needs a reason, which is emailed to the guest.
- **Refunds:** the listing's policy, a suggested refund, paid, refunded and left to refund, and a refund log. *Record refund* and *Void*.
- **Payment card additions:**
  - a "You keep" line (total minus channel fee), with a hint when an OTA booking has no channel fee entered
  - "No channel fee — about ₱X saved" on direct bookings
  - an "Guest overpaid by ₱X — record a refund" alert when the balance is below zero
- **Home:** owners and managers see "Payments to check (n)" when proofs are pending.
- **Settings → Manual payments** (owner): an on/off switch plus your GCash, Maya and bank details.
- **Listings → Edit:** deposit %, cancellation policy and custom policy text.
- **Booking page:** shows the listing's cancellation policy before payment, in English or Taglish.

### 7.7 Receipt `#/receipts/<id>`
Printable acknowledgement receipt. **Print / save as PDF**. Voided receipts show "VOIDED". **‹ Reservation** back.

### 7.8 Inbox `#/inbox`, `#/inbox/<id>`
- Setup alerts: email sending not set up; guest replies arrive in email only; reply check failed.
- Left list with view dropdown (with counts) and filter bar. **Click a conversation** → thread on the right.
- Thread header: **Snooze** (pick a time) / **Unsnooze**, **Mark unread**, **Archive** / **Unarchive**.
- Composer: **Message guest** or **Internal note** tabs, **Insert template…**, **✨ Draft reply with AI** ("Drafting…" → "Draft ready. Read it and edit before sending."), subject, **Send later** time, **Send**.
- The chosen tab (**Message guest** or **Internal note**) stays after a note is saved, so the next note doesn't go to the guest. A hint line says "Internal note: only your team sees this" or "This will be emailed to <guest>". Sending a message that still has `@[Name](id)` mention text or an unfilled `{{variable}}` asks "Send this to the guest?" first. Mentioning staff or a cleaner shows "Only owners and managers can be mentioned." A counter appears in the last 1,000 characters (limit 10,000). Very long messages show a **Show more** button.
- Results: "Sent.", "Scheduled for …", "Note saved.", or "Saved, but the email was not sent: …". Scheduled messages can be cancelled; failed ones retried. Drafts are kept per conversation in this browser.
- No guest email → warning with a link to the reservation.
- Right panel: reservation summary + **Open**.
- Empty: "No conversations yet — Open a reservation and choose 'Message guest'". No selection: "Select a conversation".
- **Templates & automatic messages** → `#/inbox-settings`.

### 7.9 Templates & automatic messages `#/inbox-settings`
- **Automatic messages:** **Add**, **Turn on/off**, **Edit** (name, template, when, days, time), **Delete** (owner only). "N sent so far".
- **Message templates:** **New template**, **Edit**, **Delete** (built-in templates can't be deleted).
- Warning if email sending is not set up.

### 7.10 Housekeeping `#/housekeeping`
- **Add task** with a due date in the past asks "Date is in the past" (it will show as overdue) → **Add task** to confirm. A failed inspection says "Sent back for re-cleaning. The pay you set was cleared; it is set again when the clean is finished."
- Tabs with counts. Filter bar. **Add task** (listing, date, assignee or outside cleaner, notes). **Edit checklist** (owner).
- **Click a task** → `#/housekeeping/<id>`: tick checklist items, **Start**, **Mark done** (asks if items are unticked) → listing clean, **Reopen**, **Copy for cleaner**, **Cancel task**, assign, upload photos.
- **Board** tab: each unit as Dirty, Clean or Inspected, with the current stay, next arrival, open job and last inspection score.
- **Calendar** tab: week by day. Owners and managers reassign a job with the select on it.
- **Scores** tab (owners and managers): per cleaner, jobs done, jobs inspected, average score, fails.
- **Inspect** (owners and managers, finished jobs): pass or fail per checklist item and notes. Pass → unit Inspected. Fail → job reopens with failed items unticked, unit Dirty.
- Job detail also has **Report damage**, **Found an item**, **Supplies used** and **Something broken?** (work order), and pay for the job (owners and managers can edit it until paid).
- Empty: "Nothing to clean ✨ — Cleaning tasks appear automatically for today's and tomorrow's check-outs."

### 7.11 Listings `#/listings`
- Tabs All / Needs cleaning / Clean. Filter bar (property, occupancy, type, channels, booking page, guests, sort).
- **Add listing** → building (pick or create new — owner only) + listing fields → "Listing added. Next: connect your Airbnb or Booking.com calendar." Over the plan limit → plan-limit error. If the new building saved but the listing didn't, the form keeps the saved building (no second building is created on retry) and says "The building was saved; fix the listing details and save again."
- Per listing: **Mark clean / Needs cleaning**, **Channels** (copy export link, **Create a new link**, connect a channel link → "Connected. …" or "Connected, but the first sync failed: …", **Sync now**, **Disconnect**), **Photos** (upload up to 12, **Make cover**, delete), **Edit**, **Bookings** → filtered reservations.
- **Gate pass** → `#/gatepass-settings`.
- Empty: "No listings yet" + **Add listing**. Nothing dirty: "All clean ✨".

### 7.12 Gate pass settings `#/gatepass-settings`
Per building: **Set up** → admin emails, auto-send, days before, attach IDs, authorized by, notes → "Gate pass settings saved."

### 7.13 Guests `#/guests`, `#/guests/<id>`
- Filter bar (type, stay, channel, property, latest stay, stays, rating, sort). **★ Reviews** → `#/reviews`. **% Discount codes** → `#/discount-codes`.
- **Click a guest** → profile: contact, stays, private reviews, **Edit** (name, mobile, email, notes, VIP, Do not rebook).
- Empty: "No guests yet — Guests are added when you create a reservation."

### 7.14 Reviews `#/reviews`
Average and count, filter bar, list linking to reservations. Empty: "No reviews yet" (explains the thank-you automation).

### 7.15 Discount codes `#/discount-codes`
**+ New code** (code, note, percent or amount, dates, minimum nights, max uses, returning only) → "Code created." **Turn off / Turn on**. Over 50 active → error. Empty: "No codes yet".

### 7.16 Unit owners `#/owners` (owner only)
- **+ Add owner** (name, email, phone, fee type, fee % or flat monthly fee, cleaning to manager, repairs reserve target and monthly top-up, notes, units). **Edit**, **Remove** (confirm).
- Each row shows the portal status: **Off**, **Invited**, or **Active** (with last seen). Actions: **Invite to owner portal** (needs an email) and **Turn off portal access** (confirm; signs the owner out everywhere).
- **Statements** (`#/owners/statements?month=…`): a month picker and one row per owner with status (Draft, Published, Sent), payout and sent date. Each row opens the statement.
- Statement page (`#/owners/<id>/statement?month=…`): status bar (Draft / Published on … / Sent to … on …). Buttons: **Publish** (refused for a month that has not ended), **Unpublish to correct** (confirm), **Send to owner** (only when published; confirm), **Print**. Shows the fee line (for example "Management fee (20% of net)" or "(flat)"), the repairs reserve top-up line, and expense rows with a **Receipt** link when one is attached. A warning appears when stays lack amounts.
- Flat fee with no stays: the statement shows "Owner owes you" and nothing to pay out.
- **Payouts** card: list (voided ones are marked), **Record payout** (amount prefilled with what is still unpaid), void with a reason. The card shows "Paid ₱X of ₱Y" or "Owner owes you". A payout that would take a month's payouts above the amount due asks "Pay more than the statement?" (with the amounts) → **Record anyway**; the statement then shows "Overpaid by ₱…". A month in the address that isn't a real month shows "… is not a valid month. Choose a month above."
- **Repairs reserve** card: balance, target, entries, **Record withdrawal** (amount, date, required note).
- Empty: "No unit owners yet" + **Add owner**.

### 7.17 Stay reports `#/stay-reports`
- Tabs: **Performance**, **Income summary (for taxes)**, **Deposits**.
- Period: month, year or range ("Choose both dates. Showing this month for now."). Filters: property, listing, channel. **Download CSV**.
- Empty: "No stays in this period". Failure: "Couldn't load this report" + toast.
- "Record an expense" → `#/rent?tab=expenses`.

### 7.18 Expenses `#/rent?tab=expenses` (short-term menu) and Maintenance `#/maintenance`
Shared with long-term; see 7.21.

### 7.19 Settings `#/settings`
Cards top to bottom (owner):
1. **Your account** — **My account**, **Change password**, **Modules for this workspace** (Short-term / Long-term / Both → **Save** → menu changes).
2. **Language for guests** (not long-term) — English or Taglish, "Also switch my … messages" → **Save** → "Guest language saved." (notes any "(my version)" copies).
3. **Appearance** — Light / Dark / Match device.
4. **App & notifications** (not demo) — **Install BalayHub**, **Turn on notifications**, topics, **Send a test**, **Turn off on this device**. iPhone without Home Screen install → instructions first.
5. **Plan & billing** (not demo) — status alert, plan, listings used, paid until. Online: pick plan, months, total, **Pay now** ("Opening secure checkout…") → PayMongo → back to `#/settings?billing=…` → "Payment received. Thank you! Your plan is active." or "still waiting…". Cancelled → "Payment cancelled. Nothing was charged." Manual: email instructions. Payment history.
6. **Direct booking page** (not long-term, not demo) — **Connect PayMongo** (secret key) → **Turn on / Turn off**, **Copy link**, **Page settings** (address, welcome text), **Change key**. TEST MODE warning. Tip to add photos.
7. **Your data** (not demo) — **Download all data**, **Delete workspace** (type the name) → "Deletion scheduled. You can cancel it within 14 days." → deleting banner.
8. **Team & permissions** — **Invite** (email, role, properties) → "Invitation created" with the link and **Copy**. **Edit access**, **Remove** (confirm). Pending: **New link**, **Revoke**.
9. **Audit history** — table, or "No activity yet".
10. **Privacy** — summary and link to the Privacy Notice.

### 7.20 My account `#/account`
**Edit profile**, **Log out**, workspace & role (owner: **Choose a plan / Plan & billing**, **Manage team**), properties, **Change password**, devices (**Sign out** one, **Sign out all other devices**), preferences (theme, notifications link), support summary (**Help & support**, **Contact support**), recent activity.

### 7.21 Long-term pages (Long-term and Both)
- **Dashboard `#/dashboard`:** stats, quick actions (**Add property** for owners or a Properties link, **Add tenant** for owners and managers or a Tenants link, **Record payment**, **Maintenance**), rent status, recent payments, Needs attention. Empty: "Add your first property" (owner) or "No properties assigned yet".
- **Properties `#/properties`:** Active/Archived tabs, filter bar, **Add property** (owner). Detail `#/properties/<id>`: **Add unit**, **Edit**, **Archive / Restore** (owner), unit archive/restore, assign tenant from a vacant unit. Archiving a unit with an active lease → error.
- **Tenants `#/tenants`:** Active/Archived, filter bar, **Add tenant** (duplicate warning lets you review or save anyway). Detail: **Assign Unit** (no vacant units → explanation), **Edit**, **Archive / Restore**, **Export data** (owner). Lease card: **Record payment**, **Documents**, **Change terms**, **End lease** (no future dates), **Cancel (entered by mistake)** (only with no payments).
- **Rent & Expenses `#/rent`:** tabs Rent due / Payments / Expenses, each with its own remembered filters. **Record payment** (no active leases → explanation) → "Payment saved. New balance: …" or "This payment was already saved." **Add expense** (no properties → explanation). Detail pages `#/payments/<id>` (**Print receipt**, **Void**) and `#/expenses/<id>` (**Correct**, **Void**).
- **Reports `#/reports`:** date range and property filters, **Export (Excel / CSV)**, **Print / PDF**. Empty: "No transactions in this period".
- **Maintenance `#/maintenance`:** status tabs, filter bar, **New request** (no properties → explanation). Detail: **Start work / Mark resolved / Reopen / Cancel request**, **Edit**, **Add cost** (saved as a Repairs expense), photos.

### 7.22 Help & support `#/help`
- Search guides (results or "No articles found" + **Contact support**). Category lists.
- **Ask the BalayHub assistant** box (only when the assistant is on).
- Tickets card: Open / Resolved / All, search, rows → ticket.
- **Contact support** → `#/help/new`: subject, topic, urgency, description, screenshot → "Ticket T-… sent. We'll email you when we reply." (screenshot failure is a separate error toast) → ticket page.
- Ticket `#/help/tickets/<id>`: progress, conversation, **Send reply** / **Reply and reopen** (within 14 days), **Mark as solved** (confirm), rating after resolution, or **Open a follow-up ticket** when closed.

---

### 7.23 Profit and loss `#/pnl` (owner and manager)
- Month picker and property filter (shared filter bar). A table per unit with a totals row; a negative net is shown in the danger colour. "Not linked to a unit" appears as its own row when there are unlinked expenses.
- **Download CSV**. Empty state when there are no units in scope. On a phone the table becomes stacked cards.
- Staff don't see the menu item and get the server's 403 if they open the page directly.

### 7.24 Phase 3 pages (owners and managers)
- **Cleaner pay `#/cleaner-pay`:** pick a month and filters, tick finished cleans, **Mark paid** (a per-hour clean with no start time shows "Pay not set — add the hours, or set the amount." and can't be marked paid until its pay is set) (date, method, reference, optional expense). **Rates** editor is owners only. **Undo paid** is owners only.
- **Supplies `#/supplies`:** per property, low stock highlighted. Add, archive, record count, restock, or **Record use** (toast "Use recorded."). **History** on each item opens a dialog with its last 20 movements (what, how many, who, date, note). Owners and managers only; an archived item has no History button.
- **Lost and found `#/lost-found`:** filter by status; mark Held, Returned or Disposed with a note.
- **Maintenance → Schedules:** add, pause. Requests from a cleaning job show a "From cleaning task" badge.
- **Damage reports** (on a stay): Charge the guest, Deduct from deposit, or Waive.
- **Home:** "Supplies running low (n)" for owners and managers.

---

## 8. Property manager differences

- Sees only assigned properties everywhere. No assigned properties → empty states such as "No listings assigned to you yet" and "Ask the workspace owner to assign you".
- No Launchpad, no Unit owners. Launchpad URL → note "The workspace owner sets up BalayHub here."
- Can't create a new building or property (Add listing with no properties → "Ask the workspace owner to add a property first.").
- Pricing: seasons must target one listing.
- Inbox: full, but automatic messages are view-only.
- Housekeeping: can add, assign and cancel tasks; can't edit the default checklist.
- Deposits: can return; can't undo a return.
- Settings: Your account (no modules selector), Appearance, Notifications, **Your recent actions**, Privacy. No language card, plan, booking page, data or team.
- Tenants: no **Export data**.
- Help: sees only their own tickets.

## 9. Staff differences

### 9.1 What staff use
- **Home:** overview with **Check in / Check out**, trends, revenue, deposits to return. No **New reservation**.
- **Calendar:** view; tapping a night shows "Only owners and managers can change the calendar."
- **Reservations:** list and export; detail shows stay, guest name only, payments with **Record payment** and **Receipt**, and the deposit card with **Record deposit**. No Message guest, Edit, Cancel, Copy payment link, Void, check-in form or gate pass cards.
- **Housekeeping:** today's tasks, **Only my tasks**, tick items, **Start**, **Mark done**, **Reopen**, photos. Cancelling returns "Only owners and managers can cancel cleaning tasks."
- **Listings:** view and **Mark clean / Needs cleaning**. No add, edit, channels, photos or gate pass.
- **Guests:** names and stay counts; search by name only.
- **Expenses and Maintenance:** record expenses and requests, add repair costs; can't void, correct or change status ("Only owners and property managers can change the status.").
- **Long-term:** Dashboard and Reports for assigned properties; tenant names only; record payments; no lease documents.
- **Settings:** account, appearance, notifications, privacy.
- **Push:** cleaning notifications only.

### 9.2 What staff never get
Inbox, guest phone/email/notes, guest IDs, stay reports, tax summary, pricing changes, unit owners, team, billing, booking page, data export, Launchpad. The server enforces each of these.

### 9.3 Staff empty state
No assigned properties → lists are empty with "assigned to you" wording.

### 9.4 BalayHub assistant (all roles)
- The **Ask** button shows only when the server has `ANTHROPIC_API_KEY` and the workspace is not the demo.
- Click → chat panel. Type → answer with related guide links. **Contact support with this chat** → `#/help/new` with the chat attached. **New chat**, **×** close.
- Errors: rate limit ("You've asked a lot of questions…"), busy, or "Couldn't reach the assistant…".

---

## 10. Platform admin

- **Admin** appears in the menu only for verified emails in `PLATFORM_ADMIN_EMAILS`. Anyone else opening `#/admin` sees "Not found" (API returns 404).
- **Platform admin `#/admin`:** stats (on trial, paying, monthly revenue, ended/overdue), filter bar (status, type, plan, signup dates, sort), workspace table. **Click a workspace** (not the demo) → plan, paid until, trial ends, note → **Save** (audit-logged). **Support queue** → `#/admin/support`.
- **Support queue `#/admin/support`:** tickets from every workspace, urgent and new first. Status tabs plus the standard filter bar (search, topic, priority, assigned to me); the filters are kept in the address and remembered. Rows open with Enter or Space. Help tickets on `#/help` use the same filter bar (search plus the Open or Closed tabs). Empty: "No tickets here".
- **Ticket `#/admin/support/<id>`:** **Assign to me**, **Mark resolved**, reply or internal note, customer card, attachments, **Change status** buttons. Customers see replies from "BalayHub Support".
- A platform admin is also a normal member of their own workspace.

---

## 11. Background flows users notice

- **Recurring maintenance:** once an hour a due schedule opens one maintenance request and moves its next due date on (section 7.24).

| Every | Job | What the user sees |
|---|---|---|
| 30 min | Channel calendar sync | New, changed or cancelled channel stays on the calendar |
| 1 min | Scheduled and automatic messages | Messages appear as sent in the Inbox |
| 2 min | Guest replies (only with `IMAP_URL`) | Replies in the Inbox |
| 15 min | Cleaning tasks for today's and tomorrow's check-outs | New tasks in Housekeeping |
| 15 min | Gate passes due | "Sent" status on reservations |
| 6 h | Guest ID cleanup | IDs disappear after the retention period |
| 2–3 min | Direct booking and balance payment checks | Bookings and payments appear even if the guest closed the page |
| 10 min | Plan payment check | Plan activates even if the webhook was missed |
| 1 h | Support auto-close; workspace purge; demo date refresh | Tickets close; deleted workspaces purged after 14 days |

## 12. Unit owner portal (separate sign-in)

Unit owners never see the workspace app. They use the owner portal at `#/owner`, with its own simple top bar (workspace name, owner name, Sign out) and tabs Home, Statements, Bookings, Money and Profit and loss. It is phone first and has no app menu.

| Step | Page | What happens |
|---|---|---|
| 1 | `#/owner` | Enter the email address. The page always says "Check your email", whether or not an account exists. |
| 2 | Email | One link per workspace, each valid for 30 minutes and used once. |
| 3 | `#/owner/signin?token=…` | Exchanges the link for a session, then goes to Home. An expired or used link shows "This sign-in link is invalid or has expired. Ask for a new link." with the option to request another. |
| 4 | `#/owner/home` | This month at a glance (upcoming stays, nights booked in the next 30 days), the latest published statement and its payout, and the activity list. |
| 5 | `#/owner/statements` and `#/owner/statements/<month>` | Published statements only, newest first. A statement is a read-only copy with receipt links and the month's payouts. **Print or save as PDF** opens the browser print window. |
| 6 | `#/owner/bookings` | Stays and blocks on the owner's units, with a simple month strip per unit. **Block dates** (unit, from, to, reason) and cancel own future blocks. |
| 7 | `#/owner/money` | Payouts and the repairs reserve balance. |
| 8 | `#/owner/pnl` | Profit and loss for the owner's units, by month. |

- Any portal call that returns "signed out" sends the owner back to `#/owner`.
- A block that overlaps another stay shows "These dates overlap a stay or block on this unit." It doesn't name the guest.
- The login page has a small "Are you a unit owner? Sign in here" link to `#/owner`.
- `#/owner/pnl`: for a month with a published statement the page shows that statement's frozen numbers with "From your published statement, <date>. Later changes don't show here."; other months say "Live numbers. They can still change until the statement is published."
- Host side: the invite and turn-off buttons are on the owner row in `#/owners` (section 7.16).

## 13. Phase 4 flows: guest experience and direct booking (built 2026-10-13)

Spec: `docs/specs/PHASE-4-GUESTS.md`. Decisions D-57 to D-64. Both the English and Taglish text go through `public/js/i18n.js`.

### 13.1 Booking page add-ons, house rules and sources (changes to 6.2)

- The booking page shows an "Add-ons" picker for the listing's add-ons that are offered on the booking page. Each row has a quantity, and the total updates live.
- The total is the stay, plus add-ons. "Pay in full now" pays the total. With a deposit, the guest pays the deposit on the stay plus the add-ons, in full.
- If the listing has house rules, "I agree to the house rules" must be ticked before "Continue to payment". Without it, the page says "Please read and agree to the house rules."
- A `?src=<source>` in the link is kept for the whole visit and sent with the payment. Unknown sources are ignored.

### 13.2 Quote page `#/quote/<token>`

- Shows the quote: dates, guests, price lines (accommodation, cleaning, add-ons, discount), the total, the amount due now, the expiry time, the host's note, and the house rules.
- A details form asks only for the fields the quote does not already have (name, email, mobile). Then "I agree to the house rules" (if there are rules), then the privacy consent box (required, the same notice as the booking page), then the pay button. The page says "Your dates are held only when you pay."
- States: **expired** ("This offer has expired"), **paid** ("This quote is already paid", with the booking code), **cancelled** ("This quote was cancelled"). A cancelled quote is not an error page. An expired one is the only state that uses the 410 error.
- If a payment for the quote is still in progress, the page checks it first. A guest who has just paid comes back to a confirmed booking.

### 13.3 Guidebook `#/guide/<token>`

- Phone-first sections with icons: arrival, parking, building and gate notes, local tips, emergency contacts, plus the listing's check-in instructions and house rules (English only).
- A switch between English and Taglish. Sections without a Taglish version show English.
- Wi-Fi and door code appear as cards with a Copy button, only inside the window. Outside it, a note says "For your safety, the Wi-Fi password and door code appear the day before check-in."
- After check-out day, the page says the stay has ended and hides both codes.
- A link that doesn't work (wrong or cancelled) shows "Guidebook not available" with a note to ask the host for a new link. Before the window opens, the page says "Your guidebook opens on <date>. Come back then; this same link will work." (D-78). After the window it says the stay has ended.

### 13.4 Pay page: add-ons before arrival (changes to 6.4)

- An "Add-ons" section lists the add-ons offered before arrival. It appears only while the stay is confirmed, not a demo, and check-in day has not passed.
- Choosing add-ons adds them to the bill right away. The guest then pays the balance as before. Adding the same choices twice (for example after a retry) records them once.
- After check-in day the section is gone, and a message says add-ons can only be booked up to check-in day.

### 13.5 Check-in form (changes to 6.5)

- If the listing has house rules and none were accepted yet, the form shows the rules and a required checkbox "I have read and agree to the house rules." The form won't submit without it.
- If the rules were already accepted (from the booking page), the checkbox doesn't appear.

### 13.6 Review step (changes to 6.6)

- After a private rating of 4 or 5 stars, the thank-you step asks "Would you share your experience?" and lists the owner's public review links.
- A rating of 3 or fewer shows the usual thank-you only, with no links.

### 13.7 Host: listings (changes to 7.11)

- A listing has a **Guidebook** tab with English and Taglish text for each section. The door code field is masked, with a Show button.
- A **Page address** field sets the listing's public address. A "View page" link opens the public page, once direct booking is on.
- A **Guest pages** tab has a share-link builder: pick a source, then copy the link.

### 13.8 Host: reservations (changes to 7.6)

- The reservation shows the source (for example "from Facebook" or "quote").
- "Copy guidebook link" creates the guest's private link, if needed, and copies it. The button is hidden for cancelled stays.
- "House rules accepted on …" shows the time, with the accepted text in a toggle. Owners and managers only.
- Add-ons appear as extra charges, the same as other charges.

### 13.9 Host: add-ons `#/addons`

- A filter bar (search, status Active or Archived) sits above the list. A name already used by an active add-on is refused with a message under the name field.
- Owners see the catalogue and can add, edit and archive. Managers can view it, but the add-on forms are hidden.
- Each add-on shows its price, pricing rule, maximum quantity, listings, and whether it is offered on the booking page, before arrival, or both.
- Archive shows "Add-on archived." Archived add-ons stay on past stays.

### 13.10 Host: quotes `#/quotes`, `#/quotes/<id>`

- The list has a status filter (open, paid, expired, cancelled) and a **New quote** button.
- **New quote** opens a form: listing, dates, guests, guest name, email or mobile, and the price. The price comes from the pricing engine and can be edited (accommodation, cleaning, add-ons, discount). It shows whether the dates are free. Pay type and expiry are set here, and a note can be added.
- The quote detail page has: **Copy**, **Send by email** (only when the guest has an email), and **Cancel quote** (only while open). A paid quote links to its booking.

### 13.11 Host: stay reports (changes to 7.17)

- A "By source" table lists direct bookings by source: stays, nights and revenue. Quotes show as "quote".

### 13.12 Host: settings, Guest experience card (changes to 7.19, owners only)

- **Public review links:** up to 4 labelled https links.
- **Returning-guest discount:** a percentage from 1 to 50. Blank means off.
- **Abandoned-booking follow-up:** a switch, off by default.
- Saved with "Guest experience saved."

### 13.13 Host: discount codes (changes to 7.15)

- The welcome codes made for returning guests sit in their own section, apart from the owner's codes, with the note "They do not count toward your limit."

### 13.14 Menu (changes to 3)

- Owners and managers in short-term workspaces see **Quotes** and **Add-ons** in the menu.

---

## 14. Phase 5 flows: pricing, team and operations (built 2026-10-13)

Spec: `docs/specs/PHASE-5-PRICING-TEAM.md`. Decisions D-66 to D-74. Staff and cleaners see none of the pricing or daily close screens. Owners and managers see them for their own properties.

### 14.1 Host: pricing rules `#/pricing` (changes to 7.4)

- **Booking-window rules:** last-minute (0 to 30 days before check-in), far-out (31 to 540 days) and gap nights (1 to 7 nights). Each is a percentage. Owners set workspace rules. Owners and managers set listing rules.
- **Seasons:** a season can be a fixed nightly price, or a percentage change on the usual price. Overlapping seasons are allowed: saving one that overlaps another shows "Season saved. It overlaps … on shared nights." with which one wins (the later start wins), and the season list shows an "Overlaps …" line. Zero prices are refused.
- **Staff** can open the page and the price preview for their properties; the add and remove controls are hidden.
- **Price preview:** pick a listing and a start date. Each night shows its price, a colour for its kind, and a legend. Select a night to see how its price was worked out ("Rules applied").
- **Bulk changes:** pick listings or a tag, the first and last night, and an action: set a price, change prices by %, clear custom prices, block dates or unblock dates. **Preview** shows each change and any skipped listings. **Apply** makes exactly those changes.

### 14.2 Host: listings (changes to 7.11)

- Edit form: tags (up to 10 chips), room type, lowest nightly price, and the fourteen-night discount.
- The listing list has a tag filter in the filter bar.
- Listings shows no sync warning in this build (see PRD.MD known gaps).

### 14.3 Host: calendar (changes to 7.3)

- Tag filter (owners and managers).
- A "Sync problem" mark on a listing's row when its channel calendar is stale, failing or overlapping.
- **Drag to move:** drag a reservation bar onto another listing's row. A confirm box says "Move this reservation? … The price stays the same." Refused moves show the reason (for example, the listing is taken).

### 14.4 Host: reservation detail (changes to 7.6)

- **Activity card** (owners and managers): newest first, with who and when.
- **Group badge:** "Group: <name>", linking to the group page.
- **Move to another listing:** a picker of other active listings; the dates and price stay. Not shown for channel stays, or while the stay is checked out.
- New reservation: choose "Any free room of a type", then the room type and property. BalayHub takes the first free listing for those dates, or says "No free <type>" if there is none.

### 14.5 Host: group bookings `#/groups`, `#/groups/<id>` (owners and managers, menu)

- **List:** group name, rooms, dates, total, and status (Active or Cancelled).
- **New group booking:** name, lead guest (an existing guest, or a new one), then 2 to 20 room rows. Each row is a listing or a room type, with dates, guests, accommodation total and cleaning fee.
- **Group page:** rooms with amounts, paid and balance per room and in total. Actions: add a room, remove a room (a reason is required), cancel group, edit name and notes.
- Staff can open groups and rooms, without money.

### 14.6 Host: inbox (changes to 7.8)

- **Assigned to** select on a conversation. "Assigned to me" filter. Assignment notifies the new assignee.
- **Internal note:** typing `@` opens a list of owners and managers. Picking one inserts their name. A mention shows as "@Name". A mention of someone who can't see the property is refused with "<name> can't see this reservation".

### 14.7 My account: Notifications (changes to 7.20)

- One switch per notification type the person can receive. Owners can choose all properties or chosen ones.
- Saved with "Notification settings saved." A person must pick at least one property, or choose all properties.

### 14.8 Home (changes to 7.2)

- **Assigned to you (n):** a link to the Inbox filter "Assigned to me".
- **Sync problems:** a banner when any calendar is stale, failing or overlapping. Owners and managers only.
- **Day not closed:** after 9 PM Manila time, a link "Today isn't closed yet. Close the day." until the day is closed.

### 14.9 Host: daily close `#/daily-close` (owners and managers)

- Pick a day (today by default, up to tomorrow). A date after tomorrow is changed to tomorrow with "You can close a day up to tomorrow, so this shows tomorrow."; a date that isn't real (such as 2026-02-30) shows today with "That date isn't valid." The page never ends on an error for a typed date. The checklist shows each section with its count and links to fix each line.
- **Payments recorded:** totals by method for the day.
- **Close the day:** optional note, then "Update the daily close" if the day is already closed. Past closes are listed below with the date, who closed it and the note.
- A manager sees the summary only for a close that covers exactly their properties, or for an owner's close.

### 14.10 Sync warnings (who sees them)

- Warnings use plain words (for example, the address could not be reached) instead of the raw error. On a listing's Channels list the raw text stays under "Technical details".
- Owners and managers only, on Home and the Calendar. Stale means no sync for 3 hours; failing means the last sync errored; overlap means a channel booking was skipped because the dates are taken.
- Each new problem sends one alert by push, or by email if there is no device. Alerts are checked every 15 minutes.

### 14.11 Menu (changes to 3)

- Owners and managers in short-term workspaces see **Group bookings** and **Daily close**. Staff see **Group bookings** (without money) and the read-only **Supplies** page in their menu since QA round 2; they still don't see Daily close.

## 15. QA round 2 flow changes (2026-10-14)

- **Inbox, mark unread:** after "Mark unread" the screen goes back to the conversation list.
- **Inbox, send later:** if the chosen time has already passed, a dialog asks "That time has passed. Send it now?" with Send now or Cancel.
- **Listings:** owners (short-term workspaces) get Archive and Restore on the Listings page. Managers and staff don't.
- **Staff menu:** Group bookings and Supplies appear. Supplies has no add, edit, count or restock buttons for staff.
- **Supplies, record use above what is on hand:** for an owner or manager, a dialog titled "Not enough on hand" asks first, with the button "Record what is on hand". If confirmed, the log shows the on-hand amount and "Asked for N" in its note. With none on hand, the save is refused with a message. For a cleaner saving from a job, the short item is skipped, the rest are saved, and a note names the skipped item. The note disappears after 4 seconds.
- **Rent payments:** a payment above the tenant's balance asks first and shows how much becomes advance credit.
- **Tenants:** archiving a tenant who owes money warns about the amount.
- **Profit and loss:** an invalid month in the link shows a warning and opens the current month. The empty state shows only when there is no income, no expense and zero refunds.
- **Help when logged out:** help links go to sign-up with the line "Create your account and ask us in Help & support".
- **Help search:** whole words only, every meaningful word must match, titles first, filtered to the guides for the workspace's business type.
- **Links with bad filter values:** the bad value is ignored. A backwards date range shows a message and applies nothing.
- **Pricing:** a duplicate rule asks before replacing. Seasons that overlap show a warning that the newer one wins (and that listing seasons beat all-listings seasons). A bulk cut below the lowest price shows a warning in the preview.
- **Listing edit:** a blank required field shows a message on that field; the postal code must be 4 digits.
- **Group bookings:** adding rooms is all or nothing (1 to 20).
- **Team:** inviting or editing a manager needs at least one property ("Pick at least one property for a manager.").
- **Voiding a payment** that refunds depend on is refused: "Void the refund first, then this payment."
- **Cancelled stays:** the guest pay page, booking detail and CSV show nothing owed; held money points to the Refunds card.
- **Quotes:** the accommodation price is kept after a date change; a non-number or zero price is refused.
- **Maintenance:** cancelling a request asks first.
- **Guest check-in:** the heading changes after check-in; the form stays editable until check-out. Guest error pages have a heading by cause.
- **Gate pass:** the header drops a repeat of the property name or city.
- **Sign-up band:** the smallest plan reads "1–2 units".

## 16. QA round 3 flow changes (2026-10-14)

- **New and edit reservation:** the channel fee box shows only when Booked through is not Direct. Switching to Direct clears it. A direct booking that already carries a fee shows a warning on its page ("Direct bookings don't have one, so the guest is asked for the full amount"); the Edit dialog says that saving removes the stored fee. On a channel booking, blanking the fee does nothing; type 0. *(Superseded in round 4: a blank fee now means 0 on every booking, see section 17.)*
- **Cancelled booking alert:** with no cancellation policy it reads "No cancellation policy is set, so no refund is suggested. See the Refunds card." A Custom policy says it has no automatic suggestion.
- **Groups, add rooms:** a room count outside 1 to 20 shows "Count must be between 1 and 20." and nothing is sent. A blank date says "Enter the check-in and check-out dates." A backwards pair says "Check-out must be after check-in." A price of 0 is refused. A clash reads "Only N <type> rooms are free on these dates (you asked for M). Nothing was saved."
- **Guest pay page:** if the screenshot is refused, the guest can choose a different file and send again (the saved details are withdrawn first). The host is told only after the screenshot is saved.
- **Owner statements:** the banner counts only drafts for months that have ended. "Send to owner" is disabled with "Add an email for this owner first." when there is no email.
- **Stay reports:** an invalid month shows "That month isn't valid. Showing <Month YYYY>." and the month box shows the month used. An empty source reads "Not tagged".
- **Filters:** a backwards date range turns that date filter off entirely and shows "The end date is before the start date. This date filter is off until you fix it." Reports with a custom range and no dates asks for both dates.
- **Add and Edit listing:** a lowest price above the usual nightly price asks "Save anyway?" first. Cancel keeps the form open.
- **Property detail:** a short-term workspace sees no Assign Tenant, monthly rent, Rent roll, Occupied/Vacant, lease-ending filter or monthly rent field in the unit editor.
- **Profit and loss:** a note says cancelled stays are left out.
- **Phones:** the Ask button is in the top bar (below 960px) instead of floating over the page. The reservations list shows Total and Balance next to the dates and hides Channel and Code.

## 17. QA round 4 flow changes (2026-10-14)

- **Calendar, Set nightly price:** the price box starts empty. The hint says what the night costs now: "Now ₱2,125 from your usual rates. Type a price to set it for these nights; leave empty to use your usual rates." If the night already has a set price, it says "Now ₱2,500, set on the calendar. Leave empty to go back to your usual rates." A blank save clears any set prices for those nights and says "Set prices cleared. These nights use your usual rates again." If there was none to clear, it says "No set prices to clear. These nights already use your usual rates." and writes nothing. A typed price says "Price saved." A price above ₱1,000,000 is refused: "A nightly price can't be more than ₱1,000,000."
- **Reservation, Edit:** a blank cleaning fee, other fees or channel fee saves as 0 (the hints say "Leave blank for 0."). A blank accommodation total is refused: "Accommodation total is required. Type 0 for a free stay." A save that changes nothing says "No changes to save." instead of "Reservation updated." This replaces the round 3 rule that a blank channel fee does nothing.
- **Reservation, Record payment:** a direct booking's method list has no Channel payout. When the guest has paid more than the balance, the dialog says "Guest overpaid by ₱X." instead of showing a negative balance.
- **Refunds card and cancelled alert, after a partial refund:** the suggestion counts refunds already recorded. The alert reads "Cancelled: policy suggests refunding ₱5,000.00 of ₱5,000.00 paid. ₱2,000.00 is already refunded, so ₱3,000.00 more." When nothing more is suggested it ends "so nothing more is suggested." Record refund starts at the amount still left to suggest, and is blank when none is left.
- **Inbox, Insert template:** the template goes below what you typed, after a blank line, and the toast says "Template added below your message." A typed subject stays; an empty subject takes the template's subject. If the result would pass 10,000 characters, nothing is inserted: "Adding this template would go over the 10,000-character limit."
- **Inbox, switching conversations:** the subject you typed is kept with that conversation's message draft.
- **Inbox, opening an unread conversation:** the row loses its unread look, and the header count and the menu badge update at once.
- **Inbox, template names:** saving a template with the same name as another active template (case and end spaces ignored) is refused: "You already have a template called ..." on the name box. Archived templates don't count.
- **Inbox, automatic messages:** for "Before check-in", "Before check-out" and "After check-out", "Number of days" is required ("Enter the number of days."). A blank "Send at" time means 10:00, and the form says "Leave blank for 10:00." With 0 days the list reads "On check-in day at 10:00" or "On check-out day at 10:00". Check-in day and booking-created messages store 0 days, so a blank days box is fine for them.
- **Housekeeping, Reopen a finished clean:** when the clean has pay set, Reopen asks "Reopen this clean?" and says the pay is cleared and worked out again from the rate when the clean is finished. Confirm with Reopen, or Cancel to keep the clean as it is. With no pay set, it reopens straight away.
- **Housekeeping, supplies used:** a decimal quantity (for example 2.5) is refused on its own row with "Quantity must be a whole number." Nothing is sent, and nothing is rounded.
- **Cleaner pay, Add rate:** if the cleaner (or outside name) already has a rate, Save asks first: "Nena already has ₱75.00 per hour. Change it to ₱95.00 per hour?" with the button "Change rate". Cancel keeps the form open and saves nothing. While the question waits, the Save button keeps the words "Save rate".
- **Properties list, short-term workspace:** the cards show the unit count only, with no occupied or vacant badge. The filter bar has no Occupancy filter, and the sort has no "Most vacant units" choice. A link with an occupancy or vacant value ignores it. Long-term and both-type workspaces are unchanged.
- **My account, Notifications, and Settings, App & notifications, in a monthly-rental workspace:** there are no alert types to choose. The card says "Alerts for monthly rentals aren't available yet." in place of the list. Short-term and both-type workspaces keep every alert type. Known gap, carried to round 5: a monthly-rental owner can still see a "Turn on notifications" button, which has no alert types to turn on.
- **Reports, dates in the link:** a from or to date that isn't a real date is dropped, so text such as "abc" or "2026-02-30" never shows "Invalid Date". A custom range with only one date shows "Pick both dates to see this range." and loads nothing. It no longer fills the missing side with this month.
- **Settings, invite a team member:** a bad email and a missing property show together on the form, email first.
- **Get started (home page), step 3:** the "I agree" box is checked in the browser before anything is sent. If it is not ticked, no request goes out, and the banner says "Please check the highlighted fields." with the Terms message next to the box, shown once.
- **Sign-up page `#/signup`:** the same Terms check happens in the browser before sending. The page is English only, as it has no Taglish text.
- **Booking page, guest count:** when the number of guests changes after dates are picked, the price is worked out again straight away, so "This place allows up to N guests." shows at once (in Taglish, "Hanggang N guests lang ang puwede sa lugar na ito."). The public quote refuses more guests than the listing allows, the same as checkout.
- **Settings, Audit details:** labels read in words, for example "Pricing: Per night" and "Price change: -10%". No raw codes such as underscores show.
- **Phones:** a wide table or the calendar fades the edge where more columns are hidden, and the fade goes once you reach the end. The calendar fades on the right only. The fade is subtle; a question on a swipe hint or stacked cards is open in BLOCKERS. Below 560px every dialog is a full-width sheet, including wide ones. Long words wrap in cleaning-task history and work-order lists, so the page does not scroll sideways at 390px.
- **Accessibility:** the selected theme icon in the sidebar is white on green, so it can be read in both themes. The guest star rating uses a darker amber in light mode. "Share link for" opens its box when clicked. "Default language" is linked to its box. The last column of the owner statements table has a hidden name, "Actions", for screen readers. The cleaner's copy box has a name.
