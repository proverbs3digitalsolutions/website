# BalayHub — App Flow

This document walks through BalayHub page by page and role by role. For each page it says what the main clicks do, which page comes next, and what the user sees when data is loading, empty, failing, read-only, in the demo, or over a plan limit. It covers visitors, guests on private link pages, the three workspace roles (owner, property manager, staff) and the platform admin. Every statement was checked against `public/js/app.js`, the views in `public/js/views/`, the server routes in `src/routes/`, `src/lib/access.js` and every `requireRole(...)` call. Features themselves are described in `PRD.MD`.

Last updated: 2026-10-21 (QA round 26: section 39 and 33.1; D-108). Before that: 2026-10-21 (QA round 25: section 38, 5.10 and 30 corrected; D-107). Before that: 2026-10-21 (QA round 24: section 37; D-106). Before that: 2026-10-21 (QA round 23: section 36; D-105). Before that: 2026-10-21 (QA round 22: section 35; D-104). Before that: 2026-10-21 (QA round 21: section 34; D-103). Before that: 2026-10-20 (QA round 20: section 33; D-102). Before that: 2026-10-20 (QA round 19: section 32, 5.10 second tab, 28.3 photo rule; D-101). Before that: 2026-10-19 (QA round 18: section 31, admin Delete workspace in section 10, 5.10 card page; D-100). Before that: 2026-10-15 (QA round 17: section 30 and the card step 5.10, D-98 and D-99; 29.11 corrected)

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
- **Route guard (2026-10-13, D-76):** a signed-in user who types a page their role or workspace type can't use (for example staff on `#/inbox`, a manager on `#/owners`, a long-term workspace on `#/calendar`, a short-term one on `#/dashboard`, `#/admin` for anyone but a platform admin) goes to their home page with the toast "That page isn't available for your role or workspace." The rules are in `public/js/routeaccess.js`, built from the same lists as the menu. *Exception (2026-10-14, round 7): a cleaner is sent to Housekeeping without the toast (`public/js/app.js`), on purpose.*
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
| Card needed | A new workspace whose owner has not confirmed a card (D-98) | No banner: the **Confirm your payment card** page says it all (5.10) | Same |
| Deleting (red) | Owner asked to delete the workspace | "This workspace will be permanently deleted on … It is view-only until then." *(D-98: when it is purged, BalayHub also cancels any PayMongo subscription, detaches the saved card and deletes the PayMongo customer record; if the subscription cancel fails the purge waits and retries.)* + **Cancel deletion** | Text only |

### Read-only, demo and plan-limit behaviour

- **Read-only (trial ended, payment due, deleting):** every page still opens and exports still work. Any save is refused with HTTP 402 and a message such as "Your free trial has ended. Your data is safe and you can still view and export it. Choose a plan in Settings to keep making changes." It shows as a form error or a red toast. These keep working: billing, support tickets (and screenshots), account, push settings, the assistant, and **Cancel deletion**. The direct booking page shows "Online booking is paused". Gate passes are not sent.
- **Card check pending (D-98):** a new workspace is gated until the owner confirms a card. The menu shows only **Confirm your card** and **Help & support**; Account and Log out stay reachable; any other page sends the person back to `#/confirm-card`, and any save the server refuses with 402 "Confirm your payment card to start your free trial." Support tickets (with a screenshot) still work. See 5.10.
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
| Inbox | Yes | Yes | No (403) |
| Message templates | Create, edit, archive | View only (D-28; the server refuses a manager's change) | No (403) |
| Automatic messages | Add, edit, turn on/off, delete | View only ("Only the workspace owner can change automatic messages.") | No |
| Housekeeping | All, plus Edit checklist | Add, assign, cancel, copy for cleaner | View, tick checklist, start, mark done, add photos (no reopen; D-56) |
| Listings | Add, edit, photos, channels, gate pass | Same, but can't create a new building | View, mark clean/dirty |
| Guests | Edit, VIP, Do not rebook; Reviews; Discount codes (create and change: owner only, D-28) | Same, but managers only view and use discount codes | Names and stay counts only; no Reviews or Discount codes buttons *Changed 2026-10-14 (D-82): names only; no stay counts.* |
| Unit owners, statements, payouts and repairs reserve | Yes | No (403) | No (403) |
| Profit and loss (`#/pnl`) | Yes, all units | Yes, assigned properties | No (403) |
| Owner portal (unit owners, separate sign-in) | Invites and turns off access | No access | No access |
| Stay reports and tax summary | Yes | Yes | No (403) |
| Long-term Dashboard and Reports | All properties | Assigned | Assigned (not hidden for staff) |
| Properties | Create, archive, restore | Edit, add/archive units *(D-83: managers archive and restore units and listings in assigned properties from the property page.)* | View |
| Tenants and leases | Full, export tenant data | Full except export | Names only; no lease documents; can record payments |
| Expenses | Record, correct, void | Same | Record only |
| Maintenance | Full | Full | Create, add costs; can't change status |
| Settings | Everything | Account, appearance, notifications, "Your recent actions", privacy | Account, appearance, notifications, privacy |
| Team, billing, booking page, data export/delete | Yes | No | No |
| Launchpad | Yes | Note only | Note only |
| Push topics | All | All | Cleaning only |
| Support tickets | All workspace tickets | Own tickets | Own tickets |

*Corrected 2026-10-14 (QA round 6): cleaners can't reopen a finished job, as D-56 says and the code does; owners, managers and staff can.*

Note: staff can open Settings, but only see personal sections. Staff can see the long-term Dashboard and Reports for assigned properties. The short-term stay reports are the ones hidden from staff.

---

### 4.1 Cleaner role (Phase 3, D-48)

A cleaner is a team member with the cleaner role. They must have at least one property. Their home is Cleaning (`#/housekeeping`). Any other address sends them back there.

**Menu:** Cleaning · My pay · Help & support · Account. Nothing else is shown.

| Area | Cleaner |
|---|---|
| Cleaning jobs, board, calendar | Their own jobs and unassigned jobs in their properties. Guests by first name only. |
| Job detail | Tick checklist items, Start, Mark done, add photos (no reopen; D-56), Report damage, Found an item, Supplies used, Something broken? (work order). No cancel, no reassign, no edit, no inspect. |
| Pay | Their own pay only (`#/my-pay`). |
| Supplies | Names and counts only (no costs). Record used or restocked on a job. |
| Files | Photos on cleaning, damage and lost-and-found records they can see. |
| Account, help, support | Yes. |
| Everything else | Not shown. The server refuses with 403 CLEANER_FORBIDDEN. |

*Corrected 2026-10-14 (QA round 6): cleaners can't reopen a finished job, as D-56 says and the code does; owners, managers and staff can.*

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
   - Success → popup closes → `#/verify-pending` (email verification on) or straight to setup, where the saved answers fill the form and **Create workspace** creates the workspace (nothing is created until that click, D-84) → `#/launchpad` (short-term/Both) or `#/properties?new=1` (long-term).
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
- **Under the button (D-98, only while the card check is on):** a muted line, "After you sign up, you'll confirm a card with a ₱20 payment to start your 14-day free trial."
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
- If answers from the Get-started popup are saved, they fill the setup form; the workspace is created only when the person clicks **Create workspace** (D-84) → Launchpad or Properties.
- Otherwise: business name and type → **Create workspace** → `#/launchpad` (short-term/Both) or `#/properties?new=1` (long-term).
- Already in a workspace → `afterLogin`.
- **D-98:** when the card check is on and the person is not a platform admin, the new workspace has no trial yet, so `afterLogin` sends the owner to **Confirm your payment card** (5.10) instead of the Launchpad or Properties. When the check is off, nothing changes (the trial starts at creation).

### 5.9 Privacy `#/privacy` and Terms `#/terms`
Open to everyone. Linked from sign-up, guest pages and footers.

### 5.10 Confirm your payment card `#/confirm-card` (owners; D-98)

*2026-10-20 (D-101): a second tab opened after the card already passed goes home with no message. See 32.2.*

*2026-10-21 (D-107): while the card check is due, My account says "Waiting for your card check" with one Confirm your card button, and the Ask assistant button is hidden. See 38.3.*

*Numbered 5.10 because 5.9 was already Privacy and Terms.* The page appears right after workspace setup (and whenever a gated owner signs in or opens any other page). It is the only app page a gated owner can use besides Help (`#/help`) and Account (`#/account`).

**What the owner sees**
- h1 **Confirm your payment card**; lead **One last step before your 14-day free trial starts.**
- **Plan after your trial** (Starter, Growth, Pro cards; default Growth) with the hint **You can change this anytime before your trial ends.**
- A list of what happens: (1) **We charge ₱20 to your card once, to confirm it's yours. The ₱20 is not refunded and is not part of a plan payment.** (2) **PayMongo keeps your card details. BalayHub never sees or stores your card number.** (3) Stage 1: **Your trial ends on {date}. Then pay for {plan} ({price} a month) with this card in one tap. We'll email you 3 days and 1 day before. Nothing is charged automatically. If you don't pay, your workspace becomes view-only, and nothing is deleted.** Stage 2 (when automatic payment is on): **Your trial ends on {date}. Then we charge {plan} ({price} a month) to this card every month until you cancel. You can cancel anytime in Settings, Plan & billing, and you won't be charged again after you cancel.**
- Stage 2 only: a required tick box **I agree that BalayHub may charge my card for the plan above every month after my trial, until I cancel.**
- Fields: **Name on card**, **Card number**, **Expiry (MM/YY)**, **CVC** (they carry no `name` and the card never goes to BalayHub). Button **Pay ₱20 and start my trial** (busy: **Checking your card…**). Small print: **Card payments are handled by PayMongo. Your bank may ask you to confirm with a code.**
- Footer links: **Help**, **Account**, **Log out**.

**Next**
- **Success** (card accepted, 3-D Secure done or not asked): h2 **Your card is confirmed**, **Your free trial has started. It ends on {date}.** and **Set up my workspace** (to the Launchpad, or `#/properties?new=1` for long-term-only). The h2 takes focus.
- **The bank's page:** the browser goes to the bank for a code and comes back to `#/confirm-card?check=<id>`. Waiting: h2 **Checking with your bank…** and **This usually takes a few seconds.** (checks every 3 seconds for up to 60). Then **Still waiting for your bank. You can leave this page. Your trial starts as soon as the payment comes through.** with **Check again**.
- **Already confirmed** (page opened later): goes home with no message.

**States and messages**
- Field errors (shown under the box, the first one takes focus): **Enter the name on the card.** / **Enter the card number.** / **This card number isn't valid. Check it and try again.** / **Enter the expiry as MM/YY.** / **This card has expired.** / **Enter the 3 or 4 digit code on the back of the card.** / **Tick the box to agree to automatic payment.**
- Error summary at the top (`role="alert"`, takes focus): declined **Your card was declined. Try another card, or ask your bank.**; bank check not finished **Your bank's check wasn't finished, so nothing was charged. Try again.**; network **We couldn't reach the payment service. Nothing was charged. Please try again in a moment.**; too many tries **Too many tries. Please wait a few minutes and try again.**; PayMongo's own field message is shown prefixed **PayMongo says:**. A declined card keeps the same payment until the owner tries again; a retry after a decline expires the old ₱20 intent and creates one new intent (never two charges). *Changed 2026-10-19, D-100: the earlier text said the same intent was reused; the code makes a new one.* On the bank's page, choosing **Fail** returns to the card page with the declined message above (**Your card was declined. Try another card, or ask your bank.**), not the "bank check wasn't finished" message. After a bank return that passes, the **Your card is confirmed** panel takes focus on its heading.
- Loading: skeleton while the page reads `GET /billing/card-check`. If the check is off or already done: goes home.
- **Team members** (manager, staff, cleaner) of a gated workspace see **Waiting for your workspace owner**: **{Owner name} needs to confirm a payment card before your team can use BalayHub. Ask them to log in and finish setup.** with Help, Account and Log out.
- **Phones:** card fields stack one per row (expiry and CVC share a row from 360px); every button and link is at least 44px tall.
- **Re-verify fixes (2026-10-19):** returning from the bank page the page waits for the payment, then shows success or the bank-failure message. A declined card shows the server's message, or "Your card was declined. Try another card, or ask your bank." If an earlier ₱20 payment already went through, the page goes straight to success and charges nothing. If PayMongo cannot be reached, the page says so in plain words and nothing is charged. While the card is due, the menu is flat and shows only **Confirm your card** and **Help**. Known gap: reloading the page in the middle of the bank check shows the form again (carried).
- Team members of a gated workspace should rarely see the waiting page: invitations are blocked until the card is confirmed (D-98), so that page is a safety net.

---

## 6. Guest and outside-party pages (private links, no account)

All guest pages have an English / Tagalog toggle (Taglish text). The default is the host's guest language. The gate pass has no language toggle and stays in English (QA round 14). Server error messages and receipts stay in English too.

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
- *2026-10-15 (D-87): the form starts with no extra guest row; **+ Add guest** adds one. An empty added row is still refused.*
- **Submit registration** → uploads IDs one by one ("Uploading ID photo 1 of 2…") → "Thank you! You're registered." → **Review or change my answers**.
- Already submitted → green "Received …" note and **Save changes**.
- *2026-10-15 (D-95): answers saved without a stored ID photo are a draft; see section 28.3.*
- Stay ended or cancelled → "This stay has ended or was cancelled, so the form is closed." Bad link → "Link not found". Offline → answers kept.

### 6.6 Review `#/review/<token>`
- "How was your stay?" stars (overall, cleanliness) and a comment → **Send feedback** → "Salamat po!".
- No stars → "Please choose a star rating first." Before check-in → "Feedback opens soon". More than 60 days after check-out, cancelled, or already sent → "Feedback is closed" or the thank-you.

### 6.7 Gate pass (building admin) `#/gatepass/<token>`
- Printable "Guest gate pass" with guests, dates, plate, notes, authorized by, and ID photos (if linked). One guest is shown as a name; two or more are a numbered list. Contact: the owner's account email (founder question, round 13).
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
- Optional steps: **Skip for now** / **Show again**. *Round 15 (D-95): choosing either keeps the step open and the page where it was; the button keeps focus.*
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
- Toolbar: ‹ ›, **Today**, date picker, 14/30 days. Filter bar: search, property, availability, type, cleaning. Legend by channel. *Round 15 (D-95): a host with 3 or fewer listings sees search and a **Filters** button (the quick filters sit inside it) instead of a bare "Filter" fold; see section 28.4.*
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
- **Click a row** to open `#/reservations/<id>`. From the keyboard, Tab to the check-in date (it is a link) and press Enter; rows are not Tab stops (round 5, section 18).
- On a cancelled booking that still holds money, the page shows "Cancelled: ₱… still to refund" with a link to the Refunds card (the "Overpaid" and "You keep" lines are for live bookings only). The Unpaid and Partial payment filters list confirmed bookings only.
- Empty: "Nothing here yet" + **New reservation**. Filtered: "No results found".
- *2026-10-15 (D-88): saving from the list opens the new reservation, as written here; the calendar stays on the calendar.*

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
5. **Plan & billing** (not demo) — status alert, plan, listings used, paid until. Online: pick plan, months, total, **Pay now** ("Opening secure checkout…") → PayMongo → back to `#/settings?billing=…` → "Payment received. Thank you! Your plan is active." or "still waiting…". Cancelled → "Payment cancelled. Nothing was charged." Manual: email instructions. Payment history. *Round 15 (D-94): owners also get a **Have a coupon code?** box above the Pay button, a free activation and a card-only ₱20 payment; see section 28.1.* *Round 17 (D-98): the card on file, one-tap pay and automatic payment rows are described in section 30.11; dates here read like "Nov 14, 2026" (D-99).*
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
- Month picker and property filter (shared filter bar). A table per unit with a totals row; a negative net is shown in the danger colour. "Whole-property expenses" (renamed from "Not linked to a unit" in round 13, D-89) appears as its own row when there are expenses with no unit. Clearing the month box fills it with this month and says "Showing this month.".
- **Download CSV**. Empty state when there are no units in scope. On a phone the table becomes stacked cards.
- Staff don't see the menu item and get the server's 403 if they open the page directly.

### 7.24 Phase 3 pages (owners and managers)
- **Cleaner pay `#/cleaner-pay`:** pick a month and filters, tick finished cleans, **Mark paid** (a per-hour clean with no start time shows "Pay not set — add the hours, or set the amount." and can't be marked paid until its pay is set) (date, method, reference, optional expense). **How you paid** starts on **Choose…** (no default) and asks **Choose how you paid the cleaner.** until one is picked (D-100). **Rates** editor is owners only. **Undo paid** is owners only.
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
- **Card on file (D-98):** the workspace table has a **Card** column (a dash when not needed, **Waiting**, **Visa 4242**, **Skipped**) and the Status filter has **Waiting for card**. A waiting workspace shows an amber **Waiting for card** badge, and after the owner removes the card the Card column reads **Removed**. A waiting workspace's panel says "Waiting for the owner to save a card. The trial has not started." with **Skip card check**: the dialog reads **Skip the card check for {workspace}? Their 14-day trial starts now.** (**Cancel** / **Skip card check**), the toast **Card check skipped. The trial has started.** On a workspace that is not waiting the server answers 409.
- **Delete workspace (D-100; platform admin only, section 31.1).** The workspace panel ends with a **Delete workspace** section: type the workspace name, then **Delete in 14 days** or **Delete now**. Not offered for the demo or the admin's own workspace; the server also refuses a workspace that has a platform admin as a member. A workspace waiting for deletion shows a red **Deleting** badge and a **Cancel deletion** button.
- **Plan coupons `#/admin/coupons`** (a button next to Support queue on the admin page; platform admins only; anyone else sees "Not found"). Make and manage coupons for BalayHub's plans; see section 28.2.
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
| 10 min | Plan payment check | Plan activates even if the webhook was missed; a card check left unfinished for 24 hours is marked expired (D-98) |
| 1 h | Trial reminders; automatic payment start (off) | Trial-end emails 3 days and 1 day before (D-98); Stage 2 only: monthly subscriptions start |
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
- A details form asks only for the fields the quote does not already have (name, email, mobile). Then "I agree to the house rules" (if there are rules), then the privacy consent box (required, the same notice as the booking page), then the pay button. The page says "Your dates are held only when you pay." *Corrected 2026-10-14 (D-84): details the quote already has are shown filled in and can be edited; they are not hidden.*
- States: **expired** ("This offer has expired"), **paid** ("This quote is already paid", with the booking code), **cancelled** ("This quote was cancelled"). A cancelled quote is not an error page. An expired one is the only state that uses the 410 error.
- If a payment for the quote is still in progress, the page checks it first. A guest who has just paid comes back to a confirmed booking.

### 13.3 Guidebook `#/guide/<token>`

- Phone-first sections with icons: arrival, parking, building and gate notes, local tips, emergency contacts, plus the listing's check-in instructions and house rules (English only).
- A switch between English and Taglish. Sections without a Taglish version show English.
- Wi-Fi and door code appear as cards with a Copy button, only inside the window. Outside it, a note says "For your safety, the Wi-Fi password and door code appear the day before check-in."
- After check-out day, the page says the stay has ended and hides both codes. *Corrected 2026-10-14: an ended or cancelled stay's link says "Guidebook not available", as D-78 decided.*
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
- **Listings:** owners (short-term workspaces) get Archive and Restore on the Listings page. Managers and staff don't. *Clarified 2026-10-14 (D-83): this is the Listings page's own button. Managers archive and restore listings from the property page.*
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
- **Groups, add rooms:** a room count that is not a whole number from 1 to 20 shows "Count must be a whole number from 1 to 20." and nothing is sent. *Corrected 2026-10-14 (round 8): matches line 769 and the code (D-78).* A blank date says "Enter the check-in and check-out dates." A backwards pair says "Check-out must be after check-in." A price of 0 is refused. A clash reads "Only N <type> rooms are free on these dates (you asked for M). Nothing was saved."
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
- **Inbox, Insert template:** the template goes below what you typed, after a blank line, and the toast says "Template added below your message." A typed subject stays; an empty subject takes the template's subject. If the result would pass 10,000 characters, nothing is inserted: "Adding this template would go over the 10,000-character limit." *2026-10-15: a subject filled by a template counts as empty for the next template, so a second template replaces it.*
- **Inbox, switching conversations:** the subject you typed is kept with that conversation's message draft.
- **Inbox, opening an unread conversation:** the row loses its unread look, and the header count and the menu badge update at once.
- **Inbox, template names:** saving a template with the same name as another active template (case and end spaces ignored) is refused: "You already have a template called ..." on the name box. Archived templates don't count.
- **Inbox, automatic messages:** for "Before check-in", "Before check-out" and "After check-out", "Number of days" is required ("Enter the number of days."). A blank "Send at" time means 10:00, and the form says "Leave blank for 10:00." With 0 days the list reads "On check-in day at 10:00" or "On check-out day at 10:00". Check-in day and booking-created messages store 0 days, so a blank days box is fine for them.
- **Housekeeping, Reopen a finished clean:** when the clean has pay set, Reopen asks "Reopen this clean?" and says the pay is cleared and worked out again from the rate when the clean is finished. Confirm with Reopen, or Cancel to keep the clean as it is. With no pay set, it reopens straight away. From round 5 a paid clean has no Reopen button (section 18).
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
- **Phones:** a wide table or the calendar fades the edge where more columns are hidden, and the fade goes once you reach the end. The calendar fades on the right only. The fade is subtle; stacked cards were chosen in round 5 and are built (section 18). Below 560px every dialog is a full-width sheet, including wide ones. Long words wrap in cleaning-task history and work-order lists, so the page does not scroll sideways at 390px.
- **Accessibility:** the selected theme icon in the sidebar is white on green, so it can be read in both themes. The guest star rating uses a darker amber in light mode. "Share link for" opens its box when clicked. "Default language" is linked to its box. The last column of the owner statements table has a hidden name, "Actions", for screen readers. The cleaner's copy box has a name.

## 18. QA round 5 flow changes (2026-10-14)

- **Get started, step 2:** the mobile number is checked before step 3. A number that isn't a phone number stops here with "Enter a valid phone number." (Taglish: "Maglagay ng tamang numero ng telepono."). A blank number is allowed. In Taglish the business name label is "Pangalan ng negosyo".
- **Workspace setup `#/setup`:** when the server refuses the answers saved from Get started, the page opens a form with a "Mobile number" box, filled from the saved number, and the server's message shows at that box. A correct number creates the workspace and clears the saved answers.
- **New reservation and group rooms, prices:** the price from your rates fills a box only while you haven't typed in it. If you have typed a different amount, a "Use ₱X from your rates" button appears next to the quote. If the rates can't be worked out for the new dates, a box that still holds an old suggestion is emptied.
- **Room type ("Any free room of a type"):** the price boxes stay empty. The note gives the first listing's price as a guide and says each room is priced from the listing BalayHub picks. Leave the boxes empty to use each listing's own price, or type one price for every room.
- **Group rooms, count:** a count that is not a whole number from 1 to 20 gets "Count must be a whole number from 1 to 20."
- **Reservation, Record payment:** "Guest overpaid by ₱X." shows when the guest has paid more than the balance. Once a refund has cleared the overpayment, the dialog says "Nothing more is owed on this booking." instead of "overpaid by ₱0.00".
- **Reservation detail, "You keep":** the saving line is worked out on the same amount as "You keep", so the two lines agree.
- **Reservations list:** each booking's check-in date is a link. Rows are not Tab stops; from the keyboard, Tab to the check-in date and press Enter. On a phone each booking is a card showing Check-in, Check-out, Total, Balance, Guest and Listing. Channel and Code stay hidden on phones.
- **Calendar, cleared prices:** "Set prices cleared for 3 nights. These nights use your usual rates again." For one night: "Set prices cleared for 1 night. This night uses your usual rates again."
- **Calendar, prices in cells:** prices of ₱100,000 and up show in short form, for example ₱1M. The full amount is in the cell's label and tooltip.
- **Bulk price change:** the preview lists only nights whose price would change. When none would change it says "None of these nights would change." and Apply saves nothing.
- **Daily close:** the count of payments recorded uses a neutral badge. Sections that are open work keep the amber badge.
- **Home:** October revenue includes extra charges in fees, so it matches Stay reports and Profit and loss.
- **Guest pay page `#/pay/<token>`, when manual payments are on:** a "Proofs waiting for the host" list shows each proof's amount, method and the day it was sent. A proof with no screenshot offers "Add the screenshot" (adds it) and "Take it back" (withdraws it). The form refuses an amount above the balance less the proofs waiting: "You already sent proofs for ₱X that the host hasn't checked yet, so you can send up to ₱Y more." When nothing is left, the form is replaced by "Your proofs already cover what you owe. The host will check them soon." At most five proofs can wait at once. Reference numbers are not shown on this list.
- **Booking page, add-ons:** a quantity above the maximum is written back into the box, so the box shows the number that is charged (3 becomes 2 when the maximum is 2). Each add-on name is listed once, the oldest active copy. The owner's Add-ons page still lists every copy so duplicates can be archived.
- **Quote page `#/quote/<token>`:** the PayMongo line in the footer shows only on an open quote. Cancelled and expired quotes keep the privacy link.
- **Housekeeping, job detail:** a paid clean has no Reopen button. The owner sees "Paid. To reopen it, undo the payment on Cleaner pay first.", with a link to Cleaner pay. A manager sees "Paid. To reopen it, an owner needs to undo the payment on Cleaner pay first." Staff and cleaners see "Paid." An unpaid finished clean can still be reopened, and reopening it marks the unit dirty.
- **Housekeeping, pay on jobs:** owners and managers see the pay on every job. Staff and cleaners see the pay only on a job assigned to them, or on an unassigned job they finished.
- **Housekeeping, found items:** status shows Held, Returned or Disposed (Taglish: Hawak pa, Naibalik, Itinapon).
- **Housekeeping, checklist:** a repeated item is refused in the dialog and on save: "This checklist has “Change towels” twice."
- **Housekeeping, supplies used (cleaner):** a negative quantity is refused on its own row with "Quantity can't be negative." (Taglish: Hindi puwedeng negatibo ang dami.) Nothing is sent.
- **Supplies (owner):** the whole-number check comes before the "Not enough on hand" question. A quantity such as 2.5 gets "Quantity must be a whole number." and no question.
- **Maintenance:** a resolved request offers Reopen and Cancel request. A cancelled request offers Reopen only. A recurring job with a next due date in the past asks "Next due date is in the past." with "A request opens at the next hourly check. Save anyway?" Cancel saves nothing.
- **Cleaner pay, rates:** an amount that isn't a valid positive amount goes straight to the field's message, with no question. A valid rate asks first, and Cancel keeps the form open.
- **Inbox, Last message:** one "Last message between" date range. A range that ends before it starts shows a message instead of being dropped without a word. Date boxes on filter bars are named "<label>, from" and "<label>, to". Template and automatic message buttons name their row, for example "Edit template: Booking confirmation".
- **Owners, payouts:** a payout for a month in which the owner owes the workspace is refused: "Nothing is due to <owner> for <month>: they owe you ₱X. A payout can't be recorded for this month." A month with nothing due still asks first. The over-due question names the month, for example "September 2026".
- **Owners, management fee:** a number from 0 to 100, labelled "Management fee (%)", not a money box.
- **Owner portal sign-in:** an invalid or used link shows the message in section 12, with a "Request a new link" button that goes to the owner sign-in page.
- **Notifications (My account and Settings), monthly rentals:** the owner sees only "Alerts for monthly rentals aren't available yet.", with no Turn on or Send a test button. When a device already has notifications on, "Turn off on this device" stays. A switch whose save fails goes back to its old setting and shows the error.
- **Long-term, rent payments:** the confirmation reads the amount you typed, so "1,000.50" confirms as ₱1,000.50. A status filter with no matches shows "No results found" with Clear filters.
- **Help:** the search and assistant examples follow the workspace type (long-term workspaces get rent reminders, receipts and maintenance). Each rating star is announced as not chosen until one is picked. A blank question shows "Type a question first."
- **My pay `#/my-pay`:** cleaners only. Anyone else is sent home.
- **Settings, Modules for this workspace:** the choices are "Short-term stays", "Long-term rentals" and "Both", with the explanation in the hint.
- **My account, devices:** each device's Sign out button is named for that device and its sign-in time.
- **Phones, More:** the More menu is a dialog that fits the screen and scrolls, so every item can be reached at 390px. Escape or a tap outside closes it, and focus goes back to More. The theme buttons in the sheet stay on one line with three equal icons.
- **Phones, wide tables:** a table with four or more columns shows one card per row below 560px (see DESIGN-BRIEF section 14). Tables with three or fewer columns stay tables. The calendar keeps its grid and its edge fade.
- **Phones, long names:** long words wrap in headings, listing names, the launchpad and reservation names, so no page scrolls sideways at 390px.
- **Accessibility:** the account link at the top of the app is named "<workspace name>, my account".

## 19. QA round 6 flow changes (2026-10-14)

- **Staff and guests (D-82):** staff see a guest's name only. The Guests page has only the search box (no VIP or Do not rebook filters, no stay counts). A guest's page says the details are limited. A reservation shows no VIP star, no Returning badge and no review card. A group's lead guest carries no flags. Owners and managers see everything as before.
- **Cleaning board and job page, per role:** owners and managers see inspection results in full. Staff see no inspection line. A cleaner sees "Passed" or "Failed" with the date on a unit where she has the job (no score, notes or inspector), and sees the guest only on units where she has a job.
- **Housekeeping buttons:** Copy for cleaner is hidden on a cancelled job. Inspect is hidden on a paid clean (as Reopen is).
- **Cleaner photo card:** the file box is named "Choose a photo". The empty card and the message for a file that isn't JPG, PNG or WEBP are in Taglish for cleaners using Taglish.
- **New reservation:** "Use ₱X from your rates" fills the total and then disappears. If the stay's rates are missing it offers the cleaning fee only. ~~A rate typed as "1,5" is read as 1.5.~~ *Corrected 2026-10-14 (D-83): "1,5" is refused, as D-79 says.* A check-out before check-in shows one message.
- **Group lead guest:** the search says "Showing 8 of N" when there are more matches.
- **Daily close:** balances show dates written out ("Check-in Oct 15, 2026"). A sync problem opens the listing. Update close says "Close updated." On phones each "All clear" badge stays on its heading line.
- **Listing form, discounts:** a weekly discount above the 14+ night discount, or a 14+ night discount above the monthly one, is refused at the longer stay's field with the reason.
- **Quotes:** an open or cancelled quote says "Valid until <date>" (and "Expired" once past). The quote page loading line and the host fallback are in Taglish.
- **Stay reports, Home, profit and loss:** "Channel fees" is the channel commission only. Cleaning and extras is its own column on Stay reports and its own part of the Revenue tile. A negative charge price shows no total in the preview.
- **Amount filters:** an unusable amount (negative, or 11 or more digits) or a backwards range shows a message at the field and the filter is off, with no chip. Payments and Expenses show one "Amount (₱)" chip.
- **Status chips with no matches** (maintenance, tenants, properties): "No results found" with Clear filters, which returns to the default status.
- **Owners:** if the portal invite email fails, a toast says so and the owner card offers "Send the invite again" while access is on. Owners with no units are left out of a month's statements and the ready count, unless a statement was already saved. A month outside 2000 to 2100 shows a message at the month field. Archiving an owner turns portal access off.
- **Cleaner pay:** "Select all unpaid" sits in the visible bar above the table (nothing focusable is hidden in the table header on phones).
- **My pay:** for cleaners only, on the page and behind it. Other roles get "My pay is for cleaners."
- **Launchpad:** "N of 11 steps done · K skipped". The bar counts done steps only.
- **Settings, activity:** a listing or guide edit shows "Changed: <field names>" with no values.
- **Public booking page:** one guest-limit message when the guests don't fit. A done link that doesn't exist shows a new not-found sentence and "See all places".
- **Get started:** going back and forward keeps the step 3 answers (email, password, Terms tick); the password is held in memory only. A taken email shows one message at the email field: "This email is already registered. Log in or reset your password instead."
- **Page addresses:** a blank id (`#/payments/%20`, `#/tenants/%20`, `#/maintenance/%20`) or a badly written one shows "Not found", never a raw error.
- **Reviews and support:** a review filter that isn't a real id is ignored. A support rating can be given once; a second try is refused.
- **Notifications:** a notification setting can't be saved with an empty property list.
- **Long-term assistant:** the footer wording matches a monthly-rental workspace.

## 20. QA round 7 flow changes (2026-10-14)

- **Record payment above the balance:** asks "This is ₱X more than the balance of ₱Y. Record it?" Cancel keeps the form, says "Payment not saved." and records and sends nothing. The receipt email goes only after "Record it". A payment at the exact balance asks nothing. The question is on the screen only; the server still accepts an overpayment (D-32). *(Superseded in part 2026-10-14, round 8 / D-84: Cancel is now quiet, with no message; see section 21.)*
- **Groups list and group page:** a cancelled group shows "Cancelled" and "₱X held" when its rooms had payments; the group page adds "Held from cancelled rooms". Owners and managers only; staff never see the held figure.
- **New reservation:** "Use ₱X" appears after a typed amount too, and again when the money changes. Backwards dates (check-out before check-in) leave the price line empty and Save shows the one check-out message.
- **Reservations filters:** Nights (at least) and Guests (at least) refuse anything that is not a whole number, with a message at the field and no filter chip.
- **Deposit return:** a deduction above the deposit shows the server's sentence about the limit and no "Return to guest" button; no ₱0.00.
- **Quote with a listing that has no nightly rate for some nights:** "This listing has no nightly rate for some nights. Enter the total yourself.", an empty total box and no "Use ₱0" button.
- **Add unit (short-term and Both workspaces):** asks for a base nightly rate. A listing saved without one shows the note "No nightly rate yet." (staff see it too).
- **Photos dialog:** every image has alt text with its number; buttons are named "Make cover, photo N" and "Delete, photo N"; per-card buttons are named with the listing ("Archive, <listing>").
- **Pricing forms:** a base rate below zero, a rule's days out of range (gap nights 1 to 7, last-minute 0 to 30, far-out 31 to 540) and a percentage out of range are refused at the field before "Change the existing rule?" or the lowest-price question.
- **Bulk "Set a price":** warns when it would put nights below the lowest price, as the percentage change does. The price preview labels a changed night "Adjusted" (a booked night still reads "Booked").
- **Outside cleaner names:** typing a team member's name for a rate or a job is refused with "Pick <name> from the team list instead." The remove-rate dialog names the amount and the person.
- **My pay (cleaners):** cleans paid to someone else show as "Paid to another cleaner" with no amount (Taglish too). "N cleans" stays on one line on phones.
- **Recurring maintenance job:** the unit list follows the chosen property; a next-due date more than a year back is refused at the field with no question; a recent past date asks first. Resuming a paused job writes "Resumed a maintenance schedule".
- **Calendar:** staff see their own subtitle; link filters that aren't real options (tag, availability, cleaning, maintenance priority) are dropped; a range that crosses a month reads "October – November 2026" with "Nov 1" on the first of the month.
- **Inbox:** From and To show the full year; the Listing dropdown names the unit (the property only when two units share a name); an unknown listing or property id in the link is ignored and shows the full list.
- **Stay reports:** the average stay line says how many whole stays it counts; a link with the end before the start shows both dates and the end-before-start line; the By listing header reads "Of which cleaning & extras".
- **Reviews (empty):** owners get a hint to Inbox settings; managers and staff read "Reviews from your guests show here."
- **Booking page:** "At least 1 guest." stays at the field *(wording changed 2026-10-14, D-85: "Enter a whole number of guests, 1 or more." on the reservation form)* and no quote is asked for fewer than 1; switching language works on an invalid-link card without a reload.
- **Guest pages in Taglish:** the "link not valid" and "not available" sentences (check-in, review, guidebook, quote, booking page).
- **Get started:** an error moves focus to the first field with a message.
- **More menu (phones):** a visible Close button, first in the list so it takes focus; Shift+Tab wraps inside the menu.
- **Team invite with an existing email:** one message at the field, "This email already has a BalayHub account. Use a different email for each workspace.", plus a generic banner.

## 21. QA round 8 flow changes (2026-10-14)

*Decision D-84. Each line was checked against the code after the fixes landed.*

- **Get started answers:** the business name, type, number of units and mobile typed on sign-up are kept in the browser tied to that email (after a Google sign-up, for 30 minutes). The setup page fills its form with them only for that email and waits for the person to press Create; nothing is posted on its own. Logging out, "Use a different account", or already having a workspace deletes them. Errors on the setup sheet set `aria-invalid` and tie the message to its field. "Long-term rentals" reads "Pangmatagalang upa (buwanan)" in Taglish.
- **Guest links with the code missing** (`#/pay/`, `#/checkin/`, `#/review/`, `#/guide/`, `#/quote/`, `#/book/<slug>/done/`): each page shows its own "not valid" card in the guest's language, not the marketing home. A signed-in page with a missing id (for example `#/help/tickets/`) says "This link is incomplete".
- **Booking and quote pages:** switching language keeps everything the guest typed or picked (dates, guests, name, email, phone, message, code, add-ons) and recalculates the total. Guests below 1 shows "Enter the number of guests to see the total." and no old total. The tab title follows the language and keeps the host's name ("Rio 2210 — Reyes Staycations"). A listing that can't take bookings shows the reason.
- **Sign-in and reset:** a wrong password keeps focus in the form (also on forgot-password and setup server errors). The green "password reset" banner goes away on the next submit. Sign-up shows every problem at once (no tick, short password, mismatch).
- **Cancel discards a draft:** pressing Cancel on a form (for example Add unit) throws away what was typed; closing with Escape or by clicking away keeps it for next time. After a form error the focus stays in the form.
- **Rent:** a month's row Record button starts at that month's remaining amount; the dialog's balance line still shows the whole balance; the tenant's own Record starts at the whole balance. A rent row's Record button is named with the tenant, unit and month. *Clarified 2026-10-14 (D-85): the row's Record fills the box with that month's amount; the money itself goes to the oldest unpaid month first, and the form says which month.*
- **Over-amount questions:** Cancel on "Record more than the balance?" (reservations), "Record more than is owed?" (rent) and the owner payout question returns to the form with no message and posts nothing. An amount above ₱99,999,999.99 is refused at its field ("... is too large.") before any question. Guests below 1 on a reservation show "At least 1 guest." at the field.
- **Dates:** every typed date must be between 2000 and 2100 and says so at the field; report and list filters still accept 1900 to 2200 for now.
- **New reservation, any free room of a type:** the guide quotes the listing BalayHub would pick now (free and not on a lease) and names it; the saved booking matches. The same holds for a group's type rooms. With none free the answer is "No free <type> at this property on these dates."
- **Job page, Supplies used (owners and managers):** nothing on hand is refused on that row ("Nothing on hand. Restock it first."); more than on hand asks, and "Record what is on hand" records the stock as it stands. Cleaners and staff still skip an out-of-stock item and are told which; only cleaners also read "Tell your manager."
- **Cleaner pay:** changing a filter drops ticks on rows that are no longer shown, and the button counts only what is visible. An outside cleaner's rate shows the name as text on Edit (remove the rate and add it again to change the name).
- **Job notes:** owners and managers can edit a cleaning task's notes on the job page.
- **Team-name refusal** when adding a cleaning task for a team member's name: the new wording no longer echoes the person's name and says how to add them to the property.
- **Damage on a unit:** only owners and managers can report damage from a unit page; staff report from a job or a stay.
- **Unit owners:** a blank management fee is refused on a percentage model (add and edit). The unit filter and sort from a link that isn't real are dropped; the quick filter reads "Any number of units".
- **Filter links:** a value in a link or saved filter that isn't a real option is dropped by the shared filter bar on every list page, with no chip and no "Showing" line; a search of spaces is no search. Owners, Reviews (rating, sort, unit, property) and Inbox ("assigned") ignore ids that aren't in the workspace and show the full list. Maintenance "Assigned to" and cleaner pay "Cleaner" keep a valid value that arrives after the bar is drawn.
- **Repeated controls named:** buttons and links that repeat on every row or card (Void refund, Record, Channels, Bookings, Open channels, pricing, rent charges, supplies, cleaner rates, Launchpad, maintenance "From cleaning task", Settings Saves) carry the row's name.
- **Photos dialog:** Make cover and Delete keep focus inside the dialog after the photo list redraws.
- **Listings:** a Bedspace or Commercial space listing keeps its type when other fields are edited, and both types are offered on the form and the Type filter. A base rate of text ("abc") says "valid amount". The share link source starts on "Other".
- **Quotes:** a quote can't have more guests than the listing allows ("This listing allows up to N guests."). If the price preview fails (offline) the rate-card button is hidden. Typing a phone like "abc" shows one message at the field.
- **Listing page address:** must start and end with a letter or number; `---` and `-abc` are refused (the field message still reads "Use 3 to 60 lowercase letters, numbers or hyphens.").
- **Plan limit:** a manager who reaches the listing limit reads "Your plan's listing limit is reached. Ask the workspace owner to upgrade." with no number.
- **Settings:** the four Save buttons are named by their card ("Save booking page", and so on). Notification settings in Settings and on the Account page log what changed.
- **Inbox composer:** Reply, Internal note and similar mode switches are toggle buttons with `aria-pressed` and one Tab stop each, not tabs.
- **Help:** Send rating with no star, an empty reply ("Write a reply first.") and an empty assistant question each say so at the field and send nothing.
- **Tabs everywhere:** every tab list answers to arrow keys, Home and End.
- **Check-in form:** mobile "abc" and email "a@" each show one message at their field; the remove-guest button reads "Alisin ang guest {n}" in Taglish.
- **Cleaner calendar (Taglish):** "Ngayon" and Taglish weekday names.
- **Activity log:** every edit names only the fields that changed ("Changed: <label>"), and a save that changes nothing adds no row (see BACKEND-SCHEMA section 14).

## 22. QA round 9 flow changes (2026-10-14)

Decision D-85. The alpha is for owners of 1 to 3 properties, so these changes make the first screens shorter and the money rules stricter.

- **Menu (sidebar and phone More sheet):** four groups: **Every day** (Launchpad, Home, Inbox, Calendar, Reservations, Housekeeping, Guests), **Money** (Stay reports, Reports, Profit and loss, Rent, Cleaner pay, Unit owners), **More tools** (folded; opens itself on one of its pages, and remembers being opened), **Setup** (Listings, Settings, Help). Nothing was removed. A page no group lists lands in More tools. Long-term and cleaner menus stay flat. A blank middle part in a link goes to the home page.
- **Trial banner:** shows only in the last 3 days of the trial.
- **Balance after refunds:** the guest balance is total, less the channel fee (channel bookings), less payments, plus refunds. Recording a refund bigger than the overpayment on a live stay first asks "Refund more than the overpayment?" ("After this refund the guest will owe ₱X again. Record it?", button Record refund); Cancel keeps the form. Every balance (reservation, list, CSV, pay link, receipts, daily close, owner portal, messages) follows the same rule.
- **New reservation:** a **Where did they book?** list for direct bookings (Not set, Facebook, Messenger, Instagram, Viber, WhatsApp, TikTok, Google, Email, Referral, Other). There is no Walk-in choice: use Other. A channel booking has no source. Editing the dates offers the new price from your rates ("Use the new price?"). *2026-10-15 (D-86): Save asks "Use the new price?" when the amount still matches the old dates.* The reservation's rate offer keeps its space, so the Save button doesn't move under the pointer. Guest count: "Enter a whole number of guests, 1 or more." The Reservation channel and property filters are under **More filters**.
- **Unit owners:** ticking a unit that already has another owner asks "Move this unit?" naming both owners; Yes moves it (statements and payouts follow), Cancel leaves it. The management fee box starts empty; label "How the management fee is worked out". An owner-operator sees a line saying they don't need a fee. The Publish button shows the reason when it can't be used.
- **Rent:** Record says "This payment goes to September 2026 first (the oldest unpaid month)." when that isn't the row's month. "Partly paid" counts every month with some money on it, overdue or not. **Add tenant** goes on to **Assign unit** (to be confirmed in a browser check).
- **Check-in form (guest):** an empty guest row is refused at its field: "Enter the name of each guest, or remove the empty row." (Taglish too). The host's note says "(2 guests, booked for 3)" when fewer names than booked guests were given.
- **Pay page (guest):** add-on boxes say **Select**; the button is **Add selected to my bill**. An online payment failure reads "Online payment isn't available right now. Please try again in a few minutes, or contact the host." with no blame on the host.
- **Booking page (guest):** after both dates are picked, the price line shows this stay's average nightly price before any discount; before that it shows "from" the lowest open night. Every peso amount shows two decimals, on the public `/stay` pages too.
- **Automatic messages (inbox settings):** a new automatic message starts **off**; the "Turned on" box starts empty with a hint. Two automatic messages can't share a name (the field says so). Row buttons name the message and its trigger. **Insert template** is hidden in note mode. The assistant message clears when you close it.
- **Discount codes:** a code typed with spaces is refused at the field: "Codes can't contain spaces. Try QA-R9-BAD." Guests who type a code with a space are still forgiven.
- **Launchpad:** the calendar step ticks only after a sync worked (otherwise an amber warning); the guest-info step counts house rules; the unit-count card reads "1–3 units"; **Show the reminder on Home** brings back a dismissed reminder; the footer points to Help & support.
- **Add and Edit listing:** the form opens with **Basics**; four collapsed sections follow: **Price extras**, **Guest info**, **Booking page and payments**, **Booking rules**. A section with an error opens itself. The pricing explainer is folded under "How pricing works". "Create a new link" names the link it makes.
- **Cleaner pay:** a clean the owner did, with no rate for the owner, reads **Done by you, no pay** and isn't counted as missing pay. A priced clean stays unpaid with its amount. A name with no rate says why ("No rate for this name. Add a rate or pick the team member."). Saving the same rate again shows a toast, not a question. The address changes only after a successful load.
- **Lost and found, checklists, photos:** row buttons in Lost and found name the item; a checklist edit reads "Changed: Checklist items" in the activity log; photos on a cleaning job show a thumbnail.
- **Groups:** renaming a booking group writes one activity row, shown on each room's timeline.
- **Reports and profit and loss:** category labels match the rest of the app; profit and loss reads "October 2026" and says it counts finished stays by check-out date; Reports counts by check-in and shows a "Direct bookings by source" card. The Period box keeps focus after a change; the tab row has the label "Report type".
- **Calendar:** go-to-date waits 400 ms after typing, so a half-typed date loads once.
- **Focus and forms everywhere:** after a save or redraw, focus returns to the control the person used (or its replacement); a tab row drawn again keeps focus on the same tab *(rule replaced in round 13: see section 26)*. A date outside 2000 to 2100 is refused at the field before any question. While a question is open the form's button shows its own label, not "Saving…". Errors inside a closed section open it. One toast per save.
- **Filter links:** a bad value in a link is also removed from the address; a half-typed year is ignored; date filters use 2000 to 2100.

## 23. QA round 10 flow changes (2026-10-15)

Decision D-86. The alpha is still for owners of 1 to 3 properties, so these changes remove friction and close the last money and privacy gaps.

- **Inbox drafts:** the composer saves whether a draft is an Internal note or a message to the guest. After a reload it opens in the same mode; an older draft with no saved mode opens as an Internal note. The banner reads "Guest replies go to your email inbox for now. Reply from there, or send a new message here."
- **Refunds:** the question "Refund more than the overpayment?" appears only when the booking is overpaid and the refund would leave money owed ("The guest overpaid by ₱300.00. After this ₱1,000.00 refund they will owe ₱700.00. Record it?"). A refund above what is left shows the server's sentence at Amount ("Only ₱199.00 is left to refund (...)") with no question and nothing posted.
- **Edit a reservation's dates:** Save asks "Use the new price?" (Use ₱X / Keep ₱Y) when the dates changed, the accommodation box still holds the stored amount, and the rates give a different price. A host who typed a new amount is not asked. The search box on Reservations reads "Guest, code or listing".
- **Leases:** assigning a unit, or moving a lease's end later or clearing it, is refused while short stays are booked inside it. The message names the stays (up to 5) and the first day the lease could start. Nothing is saved.
- **Receipts:** "Remaining balance" is the balance at that payment; later refunds are left out.
- **Guest pay page:** one "Refunded to you +₱1,000.00" line per refund between the payments and the balance, so Total less payments plus refunds equals Balance due. Every amount owed, charged, paid, refunded or totalled shows two decimals. If online payment can't start: "Online payment isn't available right now. Please try again in a few minutes, or contact the host." If the host turned it off: "Online payment is not available for this booking. Please contact your host."
- **Language switch (English / Tagalog):** check-in, review and pay keep everything the guest typed (check-in keeps added guest rows; review keeps the stars and comment; pay keeps ticked add-ons). Photos chosen but not yet uploaded must be chosen again. In Taglish, Dates is "Petsa" on the quote and booking pages and "Guests" stays "Guests".
- **Booking page (Settings):** Turn on is disabled until at least one listing is ticked, with the line "Tick at least one listing for your page first (Listings → Edit → Booking page and payments)." Turn off is never gated.
- **Add listing:** the first screen shows building, listing name, type, nightly rate, cleaning fee and maximum guests. "More details" (closed, opens itself on an error) holds property type, street address, city, province, room type and tags. The deposit is under "Booking page and payments", not required; blank saves 50%.
- **Menu:** Cleaner pay and Unit owners are under More tools (sidebar and phone More sheet) for every role that sees them. More tools still opens itself on one of its pages.
- **Plan card (Settings):** "Short-term listings 0 of 10", with "Monthly units are not counted." under it for a workspace that also has monthly units.
- **Lost and found:** "+ Add item" (owners and managers) opens Add lost item: Listing (preselected when only one), What is it, Where found, Date found (today).
- **Housekeeping, Supplies used:** with no supplies set up the dialog says "No supplies are set up for this property yet." with no Save. Owners and managers get a "Set up supplies" link to Supplies; cleaners are told to tell their manager.
- **Daily close for a past day:** the damage section is titled "Damage reports still open" and lists reports reported on or before that day that are still open. Today is unchanged.
- **Recurring maintenance job:** a due date outside the allowed window reads "Pick a date between Oct 15, 2025 and Oct 15, 2031." (dates as the app shows them).
- **Cleaner pay:** Add rate with nothing chosen says "Choose a team member or type a name for an outside cleaner."; with both: "Pick a team member or type a name, not both." The Name box is required while "Someone outside the team" is chosen. `status=unpaid` no longer lists "Done by you" rows; a card group of only your own cleans reads "Done by you, no pay".
- **Booking groups:** a cancelled group's header reads "<n> rooms, cancelled". New quote and New group show every field problem at once (the date message is no longer hidden by "Accommodation is required").
- **Support tickets:** the progress tracker ticks "Waiting for you" only if the ticket really waited on the customer; otherwise it shows "(not needed)" and Resolved is ticked.
- **Help center:** long-term owners see a monthly-rent reports guide (Reports, By property, Outstanding balances, Export); the short-term reports guide is hidden for them. The category is "Cleaning, upkeep & deposits". Rent roll caption: "Monthly rent from occupied units".
- **Rent payment page, Print receipt:** prints only an acknowledgement block (workspace name, "Acknowledgement receipt (not a BIR official receipt)", tenant, property, unit, amount, date received, method, reference, recorded by). No receipt number yet (BLOCKERS).
- **Reports:** headline money tiles say how they count (Performance Revenue: "Rooms counted by night; cleaning and extras by check-in."; Income summary Revenue earned: "Nights counted in their month; cleaning and extras at check-in."). Profit and loss with a bad month in the link (`2026-13`, `1999-12`) shows "That month isn't valid, so this is <this month>." and the address is rewritten. Custom dates in Stay reports, and any list date filter, accept years 2000 to 2100: a bad box shows "Enter a year from 2000 to 2100.", a valid side is still applied, and a backwards range never puts back an out-of-window date.
- **Focus kept after slow redraws:** after any save, toggle (Mark clean / Mark dirty, Undo paid / Mark paid, Start / Mark done, Disposed / Back to held), void, archive or dialog action, focus stays on the same control, its renamed replacement in the same place, or the page heading, for up to 2 seconds. Tab rows (Stay reports, status tabs) wait for the new row. Focus is never moved away from something the person already chose.
- **Calendar link (channels dialog):** a bad link shows its message as an alert, the link field is marked invalid and has focus.

## 24. QA round 11 flow changes (2026-10-15)

Decision D-87. Still for owners of 1 to 3 properties: less friction, true money on every document, nothing removed.

- **Receipt (page and email):** an overpaid booking shows "Overpaid by ₱800.00" where "Remaining balance" would be; otherwise "Remaining balance" as before.
- **Refunds:** any refund on a live stay that leaves the guest owing asks "Refund leaves money owed?" ("After this ₱100.00 refund the guest will owe ₱100.00. Record it?"). When the guest was overpaid before, the round 10 question "Refund more than the overpayment?" is unchanged. A refund on a cancelled booking never asks. A refund above what is left is refused once, at the Amount field (the top of the form says "Please check the highlighted fields.").
- **New or edited reservation:** "Where did they book?" shows only while Booked through is Direct. Every wrong field (dates in the wrong order, a negative total) shows on the first Save.
- **Deposit:** Return deposit on a stay that has not checked out and is not cancelled asks "Return the deposit before check-out?" ("The stay ends <date>. Damage is usually checked after check-out."). Cancel posts nothing.
- **Property page (long-term):** an occupied unit reads "Apartment · ₱9,500.00/month (lease)", with " · listed ₱12,000.00" when the list rent differs. The Rent roll adds up lease rents ("Monthly rent from current leases").
- **Rent payment page:** a voided payment has no Print receipt button, and its printed block starts "VOID: this payment was voided on <date>. It is not a receipt."
- **Daily close:** the Close dialog adds "Closing saves this checklist as the record for <date>. You can reopen it later." A closed day has a secondary **Reopen day** beside Update close; it asks "Reopen <date>?" ("The saved close (by <name>, <time>) is removed. You can close the day again."), then the toast "Day reopened." Managers can reopen only a close covering just their properties; otherwise the existing "already closed for more properties" sentence shows. For a day before today, arrivals, departures and cleanings are listed as they stood at the end of that day.
- **Maintenance:** the default tab "Open & in progress" lists only those two statuses. A resolved request offers only Reopen; an in-progress one offers "Back to open".
- **Housekeeping:** an owner's own finished clean with no amount reads "Done by you, no pay" on the task (Set pay stays). The owner's and manager's "Something broken?" submits as **Log repair** (toast says it is on the Maintenance list); cleaners and staff still see "Send to host". A cleaner who records more of a supply than is on hand sees "Only {recorded} of {name} was on hand, so {recorded} was recorded." then "Tell your manager." Supplies: a use or restock below 1 reads "Enter a quantity of at least 1."
- **Cleaner pay:** a rate above ₱10,000.00 per clean or ₱1,000.00 per hour is refused at Amount with "That's more than ₱10,000.00 per clean. Check for an extra zero." (or per hour). Set pay on one clean refuses more than ₱10,000.00 the same way.
- **Lost and found:** the first box is "Item" (placeholder "e.g. Blue umbrella"); empty reads "Item is required."
- **Inbox:** a second template replaces the subject the first one filled (a typed subject stays); no "Draft reply with AI" in Internal note mode; Snooze 1 week wakes at 9:00 AM Manila; template fields show "Up to 80 characters.", "Up to 200 characters." and "Up to 5,000 characters."
- **Guest pages:** Taglish room charge is "Tuluyan"; the deposit line is "{pct}% na deposit"; the payment-unavailable sentences are in Taglish; the pay page's refund line reads "Refunded to you, added back to the balance". The booking page's guest count says "Enter a whole number of guests, 1 or more." (a count above the listing's limit says "This place allows up to N guests."). A bad listing link says "This listing is not available…" with See all places. The review page's star message shows under the stars and is gone once the review is sent. The check-in form starts with no extra guest row.
- **Booking page (Settings):** the server refuses Turn on with no bookable listing (a ticked listing with a nightly rate): "Tick at least one listing for your booking page first." Turning off is never refused.
- **Check your email page:** follows the chosen language; "I've verified, continue" before verifying shows "Not verified yet. Open the link we sent to <email>, then press this again."
- **Add listing:** choosing New building (always when the workspace has none) shows "Building / property name", Street address, City and Province in the first section, marked required; they stay under More details only for an existing building.
- **Settings:** "Monthly units are not counted." shows only when there is a monthly-only unit. Delete workspace and Download data name tenants, leases and rent payments for a long-term owner, and both sets for a mixed workspace.
- **Focus:** a dialog opened by a link (`?new=1`, `?assign=1`) hands focus to the page heading when it closes; after a redraw BalayHub watches for up to 10 seconds (slow networks) and never moves focus off something the person chose.
- **Calendar:** a start date outside 2000 to 2100 is dropped (the calendar opens on this week). A click on the price cell under a booking or block opens that booking or block, not New reservation. The stay quote also refuses dates outside 2000 to 2100.
- **Groups:** an empty room row reads "Choose a listing for room 3." and that Listing box is marked.
- **Reports:** a link with years outside 2000 to 2100 says "The dates in this link must be between 2000 and 2100. Pick both dates to see this range." A single date filter shows "Enter a year from 2000 to 2100." at the box. The performance occupancy total counts only listings that have capacity.
- **Charts and shell:** an empty account's chart axes show one 0 label; no two neighbouring axis labels repeat. "Show as table" sits at the left of the chart card, clear of the Ask button. The sidebar fades at its bottom edge while more is below, with a thin scrollbar.
- **Owner statements:** the Publish dialog says to send the statement by email when the owner's portal is off; unpublishing a statement that was sent adds "It was emailed on <date>. The owner keeps that copy."

## 25. QA round 12 flow changes (2026-10-15)

Decision D-88. Still for owners of 1 to 3 properties: less friction, true money on every screen, nothing removed. Round 12 was not clean: the focus rule below is only partly done (see "Focus").

- **List pages send their default:** every list (Rent, Reservations, Housekeeping, Inbox, Guests and the rest) asks the server for the tab or filter it shows, so "All unpaid" on Rent lists unpaid charges only.
- **Record payment (reservation):** on a direct booking the payment method starts blank and is required ("Choose how the guest paid."). A channel booking still starts on "Channel payout".
- **Payment card:** an overpayment reads "Overpaid ₱800.00" (the alert and the receipt use the same word). "You keep" shows only once the channel fee is known; until then the card asks for the fee and shows the total.
- **Edit reservation:** a date clash is shown at Check-out before any price question. "Where did they book?" can be changed and is marked "(optional)". Saving a new reservation from the list opens it (7.5).
- **Group bookings:** a cancelled room shows "—" for its room total; a room type's name reads "room N".
- **Rent page:** when the list is narrowed, the cards say they still count all unpaid rent. With 3 or fewer units, Month and Property sit under **More filters**. Ending a lease, or changing its end date, moves an unpaid move-in charge's due date to the end date.
- **Reports and Stay reports:** switching the period clears the old one from the link ("Whole year" to "Month" drops `year=`). A link with `from` and `to` and no period opens as Custom dates. A bad date in a link ("2026-02-30") shows "The dates in this link aren't valid. Showing this month for now." and a reversed range keeps its dates and says why. P&L and Performance each say what they count. By month shows every column on one width; By property shows the occupied total.
- **Reports Export:** until both dates are set, Export (Excel / CSV) is dimmed and has no link, and "Pick both dates to export." sits beside it. It is reachable by keyboard (`aria-disabled`, not `disabled`).
- **Add-ons:** the All tab lists active add-ons only and ends with "N archived add-ons not shown. See Archived." (a link to the Archived tab).
- **Add listing:** the Basics section asks, in order, for name, type, nightly rate, cleaning fee, building, then max guests. The Launchpad step text uses the same words. A nightly rate above ₱50,000.00 asks "Check the nightly rate: This is ₱… a night. Save anyway?" with **Save anyway** and **Change it** (Change it puts focus back in the rate box). The same question applies to the Calendar's price change and to bulk **Set a price**. Bulk **Change prices by %** does not ask yet (BLOCKERS).
- **Calendar:** the page heading is "Calendar"; the iCal link has a clearer label; the bulk block preview ends with "Last night".
- **Housekeeping:** the task page of an owner's own finished clean reads "Done by you, no pay"; a quantity reads "1 pc". **Copy for cleaner** shows only on open cleans (not done, not cancelled) and copies the due date.
- **Supplies:** each row shows **Add stock** and **Record use**, and a **More** button ("More for <name>") that opens Count, History, Edit and Archive.
- **Daily close:** a date outside 2000 to 2100 shows "That date isn't valid." with today's checklist. A close a manager may not change shows a line saying who can (a whole-workspace close, or one that covers properties that are not theirs), and no Reopen or Update. The owner always sees both. The line is English (the host app is English).
- **Automatic messages (Inbox):** the page says when the four starter messages are ready but off, with a link to the guest language setting. A template used by an automatic message can't be deleted ("Choose another template for it, or remove it, first."); an automatic message with a deleted template can't be turned on. They list in a fixed order. Snoozed conversations disappear from every working list (All open, Unread, Mine, Upcoming and Hosting) until they wake. *(Corrected in round 16, #12: the line used to name three lists.)*
- **Guest pages:** the booking summary names the price rule ("Includes: Booked-early price."); the door code card reads "Door code" (Taglish "Code ng pinto"); the check-in thank-you screen says "Thank you! You're registered." under its own heading; the review page's star message goes away when a star is picked; the guest-limit message has a Taglish line.
- **Language:** the **verify screens** (Check your email, "I've verified, continue", Resend) follow the chosen language, including Taglish; after sign-in the app resets to the host language. **Setup and the owner portal are English throughout** for now (founder question in BLOCKERS).
- **Focus:** after any route change focus goes to the new page's h1. A page that reloads in place stays on screen (marked `aria-busy`) until the new one is ready, then swaps; a button that was disabled during its own request gets focus back; a refused form focuses the field that needs fixing (the stars, a blank guest row, the reason box). A page-level error has a heading. *Closed in round 13 by the D-89 focus guard (see section 26).*

---

## 26. QA round 13 flow changes (2026-10-15)

Decision D-89 (and D-90 for the planned top bar). Where this section and an older line disagree, this section wins.

### Navigation, focus and the skip link (every app page)
- **The menu stays when you change page.** The sidebar, top bar and bottom bar are built once and kept. Clicking a link moves only the highlighted ("current page") mark. The sidebar keeps its scroll position and the **More tools** fold keeps its state; the fold opens itself when the current page is inside it and is never closed by moving around. The Inbox unread badge updates in place.
- **A new page starts at the top, once.** The window scrolls to the top when the click happens, before the page is drawn, and not again afterwards. A page that reloads in place (a filter or a save) stays where it is.
- **The page heading takes focus without scrolling.** After a page change focus goes to the new page's h1 (`tabindex="-1"`) and the page does not move. If you had just clicked a sidebar, top bar or bottom bar link, that counts as free and the heading takes focus.
- **Skip to main content.** The first Tab stop on every app page is a "Skip to main content" link (visible only when focused). Enter moves focus to the page heading; the next Tab goes into the page, not the sidebar.
- **Phone More sheet.** More tools is a fold inside the sheet: closed on pages outside it, open when the current page is one of its pages, and it remembers the choice like the sidebar does. The Tab key stays inside the sheet, including the fold's button. Escape closes the sheet and returns focus to More. The More button always marks the page you are on now, not the one the sheet was built on.
- **Assistant panel.** Closing it puts focus back on the Ask button.
- **Confirm dialogs start on Cancel,** unless they have a reason box (then the box).

### The focus rule (replaces the "Still open" notes in sections 23 to 25)
- After any save, confirm, void, undo or redraw, focus goes to: the control you used; else the control that took its place (same `data-focus-key`, else same role and name, else the same place in the same labelled group); else, from 0.8 seconds, the page heading (a dialog: its heading) without scrolling. It keeps looking for up to 10 seconds in case a slow page draws late, and may move from the heading to the real control then.
- A control inside a closed fold hands focus to the fold's button. While a dialog is open the guard waits and acts when it closes.
- It never moves focus after you chose something else, and never after a page change.
- A control outside the main area (the guest pages' English/Tagalog toggle in the header) is found too.
- A form error shows its sentence once, at the field; the box at the top says "Please check the highlighted fields.".

### Changed flows, by screen
- **Home (owner).** With no reservations yet: a first-run card leads ("Connect your calendar", linking to the calendar step) and the charts sit in a closed **Trends and revenue** fold (they draw on first open). With reservations: unchanged. Managers and staff don't get the card yet.
- **Add and Edit listing.**
  - Cleaning fee: placeholder "e.g. 500" with a hint; a listing with none shows "No cleaning fee" on its card.
  - After a partial save (listing made, building failed), the retry shows "Building: <name> (saved)".
  - Pay-now line: one sentence says what the guest pays now and later. Pay in full: the full-amount sentence. Guest chooses: "A guest pays 50% or the full amount when booking, and any balance 3 days before check-in." A set percentage: "A guest pays 50% when booking and the rest 3 days before check-in."
  - The calendar link label ends "(ends in .ics)" with a hint; the short description example is shorter.
- **Calendar.** With 3 or fewer listings the Filter box and the colour legend sit in closed folds. Night cells and booking tiles keep focus after Block, Set price and Remove block.
- **New and Edit reservation.** A booking total above ₱50,000 a night asks "This is ₱60,000.00 a night (₱60,000.00 for 1 night). Save anyway?" (**Save anyway** / **Change it**; Change it puts focus in the amount box). ₱60,000 for 2 nights does not ask. Edit asks only when the total or the dates changed, after the date clash and "Use the new price?" steps. Nothing is refused.
- **Security deposit, Return dialog.** The deduction is checked first: more than the deposit shows the server's sentence at the field ("The deduction can't be more than the deposit (₱1,000.00).") and no "return early" question is asked. (Known: the sentence also shows in the "Return to guest" line, carried.) Check in/out and deposit buttons keep focus.
- **Pricing, seasons.** A season with a fixed price above ₱50,000 a night asks the "Save anyway?" question. A Fixed price with no rate says "Enter a nightly rate for a fixed price." (a percentage change likewise). The overlap line names the winner last: "Christmas rush also covers this night, but QA overlap takes it." An identical season is refused at the Name field: "You already saved this season." (a different price or dates saves; the same name on another listing saves).
- **Unit owners.** Saving an owner whose email another active owner uses asks "This email already belongs to <name>. Save anyway?" (**Save anyway** resends with the flag; **Change it** focuses the email box). The first portal invite and "Send the invite again" keep focus on the row. Statement Publish/Unpublish to correct and Send to owner/Send again keep focus.
- **Add-ons.** A price above ₱50,000 asks "This add-on costs ₱99,999,999.00. Save anyway?".
- **Inbox.**
  - **Assigned to** shows in a conversation only when there is more than one person to choose from, or it is already assigned.
  - Switching guest language keeps a template name you gave it (and still rewrites an untouched built-in).
  - **Turn on** on an automatic message whose template was deleted is dimmed (`aria-disabled`) with "Choose a template first." (not reachable today, see D-89).
  - The email-alert line when mail is off reads in plain words and no longer names server files.
  - Snooze and Archive keep focus.
- **Cleaner pay and housekeeping.** A cleaner rate above the ceiling (₱10,000.00 per clean, ₱1,000.00 per hour) is refused at the field before "Change this rate?". A rate added again under different capitals keeps the saved spelling. The supplies shortage text reads "so 1 pc was recorded". Row checkboxes are 24px on phones. Mark done, Set pay, Edit pay and Undo paid keep focus.
- **Daily close.** **Close the day** / **Update close** keep focus on the same button after saving; **Reopen day** is its own control.
- **Rent and Reports.** A voided-only month reads "Voided only: 3 entries, not counted in totals." (1 entry: "Voided only: 1 entry, not counted in totals."). Export with an inverted date range reads "Fix the dates to export." (a missing date still reads "Pick both dates to export."). The Reports screen row for expenses with no unit reads "Whole-property expenses (dues etc.)"; the profit and loss screen and both CSVs read "Whole-property expenses" (the suffix goes in round 14).
- **Stay reports.** The tab row keeps focus on the same tab, even on a slow network.
- **Gate pass (building admin).** One guest is a name, not "1."; the Set up buttons are named "Set up, <listing>"; Confirm received hands focus to the heading.
- **Guest pages.** The review form is its own card with spacing under the heading. The English/Tagalog toggle keeps focus on itself. Setup's "Both" says what it adds. After email verification, the toast is English when the guest goes on to the host app (signed in); otherwise it follows the chosen language.
- **Settings, Connect payments.** The PayMongo dialog says how to get a PayMongo account, with a link (opens in a new tab, `rel="noopener"`).
- **Lists after a save.** Known: on a long list (Supplies), saving in a dialog moves the page by about 62px because the list is replaced (carried to round 14).

### Top bar (D-90, founder request)
Built in QA round 14. The full flow is in section 27.

---

## 27. QA round 14: the top bar and other changes (F53, D-91, D-92; 2026-10-15)

### 27.1 The top bar (every signed-in page of the host app)

The bar is drawn once and stays when you change page, so it never flickers or loses what you typed. On a desktop (960px wide or more) it sits at the top of the page next to the sidebar: search in the middle, then Bookmarks, **+** Add new, the Notifications bell, Help and your initials on the right. The sidebar keeps the brand and its account box.

**Who sees what**

| Control | Owner | Manager | Staff | Cleaner | Long-term workspace | Read-only or demo workspace |
|---|---|---|---|---|---|---|
| Search | Yes | Yes | Yes | Pages and help only | Yes | Yes |
| Bookmarks | Yes | Yes | Yes | Yes | Yes | Yes (the demo refuses saving, with its usual message) |
| + Add new | Yes | Yes | Expense, Rent payment only | Hidden | Yes | Hidden |
| Bell | Yes | Yes | Yes | Yes (cleaning alerts) | Hidden (no rent alerts exist yet) | Yes |
| Help | Yes | Yes | Yes | Yes | Yes | Yes |
| Profile menu | Yes | Yes | Yes | Yes | Yes | Yes |

**Search**
- Press **/** anywhere on the page (not while typing in a field, and not with a dialog open) or click the box. The key cap "/" shows at the right end while the box is empty.
- Empty box with focus: your last 5 searches (on this device only), with **Clear**. One letter: pages only, with "Type 2 or more letters to search records." Two or more letters: pages and settings first (found in the browser), then the record groups when the server answers: Reservations, Guests, Listings, Properties, Tenants, Unit owners, Quotes, Repair requests, Cleaning tasks, Supplies, Expenses, Discount codes, Add-ons, Help articles *(the order and the five new groups are section 30.1, D-99)*. Staff get no Discount codes or Add-ons groups. Empty groups are not shown.
- What you can find depends on your role: an owner searches everything; a manager or staff member only records of the properties they are assigned to; staff get no Unit owners or Quotes groups; a cleaner gets pages and help articles only (the app never asks the server). Search matches names, listing names and confirmation codes, never phone numbers, emails, notes or money. Archived listings, properties, tenants and unit owners are left out; cancelled reservations are shown marked "Cancelled".
- **Arrow Down / Up** move through results (focus stays in the box), **Enter** opens the chosen one (or the first), **Escape** closes the list, a second **Escape** returns you to where you were. Choosing a result clears the box and opens that page; the page heading then gets focus.
- States: "Searching…" while the server answers; "No results for “zzz”." with a hint for your role ("Try a guest name, a confirmation code or a listing name."; long-term: "Try a tenant, a property or a repair."; cleaners: "Try a page name or a help topic."); "Search isn't working right now. Try again." (pages still work); "Too many searches in a minute. Wait a moment and try again."; offline: "You're offline. Only pages can be searched."

**+ Add new** (hidden for cleaners and read-only or demo workspaces). Each item opens the page's own "new" dialog, then the page heading gets focus when you close it.

| Item | Opens | For |
|---|---|---|
| Reservation | `#/reservations?new=1` | Owner, manager (short-term and Both) |
| Listing | `#/listings?new=1` | Owner, manager (short-term and Both) |
| Property | `#/properties?new=1` | Owner (long-term and Both) |
| Unit owner | `#/owners?new=1` | Owner (short-term and Both) |
| Cleaning task | `#/housekeeping?new=1` | Owner, manager (short-term and Both) |
| Expense | `#/rent?tab=expenses&new=expense` | Owner, manager, staff |
| Tenant | `#/tenants?new=1` | Owner, manager (long-term and Both) |
| Rent payment | `#/rent?new=payment` | Owner, manager, staff (long-term and Both) |
| Invite a teammate | `#/settings?invite=1` | Owner |

Arrow keys, Home and End move between items; Escape closes and returns focus to the **+** button.

**The `?new=` and `?invite=` openers.** A page that sees `?new=1` (or `?new=expense`, `?new=payment`, `?invite=1`) opens its dialog once, after the page has drawn. The same links work when typed. Bookmarks never keep these openers (the bookmark drops `new`, `invite` and a few other one-time keys).

**Bell.** The badge shows the unread count (99+ above 99) and is refreshed on page change (at most every 15 seconds) and when the window regains focus. The panel has **Mark all as read**, a filter row (All, then only the filters you can have: Reservations, Payments, Cleaning, Messages, Owners) and a list. A row shows a dot while unread, the title, a short line and the time ("Just now", "5 min ago", "Yesterday", "12 Oct"). Clicking a row marks it read and opens the page. **Show older** loads more. The footer link "Choose which alerts you get" goes to My account. Alerts you turned off, and alerts for properties you are no longer assigned to, do not show. States: "You're all caught up." with a line on what shows up here (cleaners: "New cleaning jobs show up here."); "Nothing in Payments yet."; "Couldn't load notifications." with **Try again**. A unit owner blocking or unblocking dates in the owner portal is a new alert, "Unit owner activity", for owners.

**Help.** Opens a panel with a help search, "Suggested for this page" (changes with the page; on pages without a match, the Getting started articles), **Browse all help**, and **Contact us**, which opens a new support ticket that remembers the page you were on. Empty search: "No articles found. Try other words, or contact us."

**Bookmarks.** The panel's first button is **Bookmark this page** (it becomes **Remove this page from bookmarks**, in place, so focus stays on it). The list shows each saved page with its section and a remove button; removing moves focus to the next row, then the previous row, then the button. Up to 20: at the limit the toast says "You can keep up to 20 bookmarks. Remove one to add another." A bookmark to a page your role can no longer open is hidden. Empty: "No bookmarks yet." States: skeleton rows while loading; "Couldn't load your bookmarks." with **Try again**.

**Profile menu.** Your name, workspace and role, then My account, Settings (not for cleaners), the light/dark switch, and Log out.

**On a phone (under 960px).** The bar shows the logo (the word BalayHub too from 560px up), Ask, **Search** (an icon that opens a full-screen search; Escape or the back arrow returns to the icon), **+**, the bell and your initials. **Bookmarks and Help & support move into the profile menu** and open the same panels. Every control and row is at least 44px, panels open full width under the bar and never sit under the bottom bar, and the workspace name moves into the profile menu. The **/** shortcut opens the full-screen search.

### 27.2 Other flow changes from the round 14 sweep

**Smooth screens.** After a save, search, filter or tab change the page stays where you were; only a change of page scrolls to the top (once). One shared piece of code holds the page height during a redraw and undoes any scroll it caused. Home draws all its cards at once instead of one by one. When the control you used disappears, focus goes to the page heading at once and moves to the control if it comes back within 10 seconds. (Completes section 26's focus rule; D-92.)

**Guest booking page, summary.** "Pay in full now" shows one **Pay now** line with the total. "Pay a deposit" shows the deposit line (for example "50% deposit: ₱3,100.00 now"). Changing the choice changes the summary straight away. The amount shown is the amount PayMongo charges. (Taglish: "Bayad ngayon".)

**Reservation, Record refund.** The method starts on "Choose…" and the dialog asks "Choose how the money was refunded." A zero or negative amount is refused at the amount field before any question (such as "Refund more than the overpayment?").

**Guest check-in page.** A guest must add at least one photo of a valid ID. Sending the form without one shows "Add a photo of a valid ID for at least one guest." at the photo box (with the other problems at the same time). A guest who already sent a photo and comes back to edit does not need to send another.

**Settings, Direct booking page, PayMongo.** Saving a key makes BalayHub ask PayMongo whether it works. The status then reads **Connected (…last digits)**, or **Saved, not checked yet (…)** when PayMongo could not be reached. PayMongo refusing the key shows "PayMongo didn't accept this key. Copy the Secret key again from your PayMongo dashboard (Developers, API keys)." under the key box and saves nothing. **Turn on** with a key that is not checked tries the check again: if PayMongo still cannot be reached a dialog "Key not checked yet" asks **Turn on anyway** or **Cancel**; if PayMongo refuses the saved key the page cannot be turned on until the key is changed. A guest checkout that PayMongo refuses as unauthorised puts the status back to "Saved, not checked yet".

**Home and Launchpad.** "Connect your calendar" on Home, and the calendar step on the Launchpad, open the first active listing's Channels dialog (`#/listings?channels=<listing>`); with no listing they go to the Listings page.

**Check-in page.** After a guest has registered, the page heading reads "Your check-in details" (before that it is the form heading).

**Listings.** The filter bar depends on the number of listings: none until there is a listing; 1 to 3 listings show only search, with the rest under **More filters**; 4 or more show the full bar. With 0 active listings the Archived listings view can be reached only by a link (see BLOCKERS).

**Inbox.** The "email needs setup" note is one muted line. The Property and Listing filters show only when there is more than one of each. An error clears when you switch tabs.

**Unit owners.** Saving an owner whose email is a teammate's login asks "This email is a login for <name>. Save anyway?" (**Save anyway** or **Change it**).

**Rent, Record payment.** Recording from a later month's row (while an older month is unpaid) keeps that row's amount and says: "This payment goes to September 2026 first (the oldest unpaid month), then to October 2026."

**Reports.** `#/reports` (long-term Reports) sends a short-term-only workspace to `#/stay-reports`. The Reports screen row reads "Whole-property expenses".

---

## 28. QA round 15: plan coupons, check-in drafts and other changes (D-94, D-95; 2026-10-15)

### 28.1 Plan & billing: "Have a coupon code?" (owners; Settings → Plan & billing, `#/settings`)

The box sits with the online payment choices, so it shows only when online payment is on (the demo has no Plan & billing). It is a fold above the Pay button, titled **Have a coupon code?**.

1. Type the code (any case; spaces and dashes are tidied) and press **Apply** or Enter. BalayHub asks the server for a read-only preview for the plan and months picked. Changing the plan or months asks again.
2. **A good code:** the total shows the list price struck through, the new total, and a line such as "50% off your first 3 months. This payment covers 1 of them." The button now reads **Pay ₱499.50** (or **Pay now**). **Remove** clears the code.
3. **A free code (no card needed):** the button reads **Activate free plan**. Pressing it shows "Activating…", makes no PayMongo call, then a toast "Your Growth plan is active until Nov 28, 2026." and the page redraws. During a trial the paid period starts when the trial ends.
4. **A free code that requires a card:** the button reads **Pay ₱20 by card**. It opens PayMongo with card only; paying ₱20 once gives the free months, and nothing is charged automatically afterwards. The same ₱20 applies when a discount would leave less than ₱20.
5. **A workspace already using a coupon** sees a live line ("ALPHA50: 50% off your first 3 months, 2 months left") and the discount is applied to each checkout without typing the code again. When the months are used the box says "Your coupon's 3 months are used. This payment is the full price."
6. **Errors** show under the code box (the box opens if it was folded) and keep focus there; a complimentary workspace hears the coupon reason, not a payment error: "Enter your coupon code."; "Enter the code using letters, numbers and dashes."; "This code isn't valid right now. Check it and try again." (one answer for unknown, off, not started, ended and full); "This code is for Growth and Pro."; "Your workspace has already used this code."; "Your workspace is already using the coupon ALPHA50. It applies until its months are used."; "Your workspace is on a complimentary plan, so coupons don't apply."; "This code needs a card payment, and card payments are off right now."; **"Your plan is already paid ahead. Your coupon applies at your next renewal."** (a discounted payment while paid more than 45 days ahead); and after 10 wrong tries in 15 minutes, the "too many tries" message (valid codes wait too).
7. Payment history rows show "Free with coupon ALPHA50 · covers …" with a **Free** badge, or the discount on a paid row. The coupon line under the plan names the coupon and the months left.
8. A manager, staff member or cleaner never sees the box (403 if called). The demo cannot use coupons (its pages are read-only: 403 `DEMO_READ_ONLY`). Billing paths stay usable in a read-only workspace, so an owner whose plan ended can still apply a coupon.

### 28.2 Platform admin: Plan coupons (`#/admin/coupons`)

- **List:** four tiles (Active, Scheduled, Ended or off, Total discount given), then the standard filter bar: search (code or name), Status, Type (Percentage, Fixed amount, Free access), Plan, Sort (Newest first, Oldest first, Code A to Z, Ending soonest, Most used). Each row shows the code, name, what it gives and the plans, start to end, used of limit, a status badge (Active, Scheduled, Ended, Switched off, Limit reached), whether a card is required, and a **Redemptions** button. Empty: "No coupons yet. Make a coupon to give your customers a discount on a BalayHub plan." or "No coupon matches these filters. Try removing a filter."
- **New coupon** (dialog): Coupon name; Coupon code (not case-sensitive, 3 to 32 letters, numbers and dashes) with **Generate** (8 characters, no 0, O, 1 or I); Coupon type (Percentage, Fixed amount, Free access); Percent off or Amount off each month (₱); How long it applies after it is used (First month only, First N months, Every month) with Months (2 to 36); Plans (none ticked = every paid plan); Limit total uses with Total uses; Once per workspace (on by default); Require a card payment (a hint says it means one ₱20 card payment); Starts and End date with times in Manila time; Note. **Create coupon** (**Save** when editing) closes the dialog and the list shows the coupon. A code in use: "Another coupon already uses this code."
- **Edit** (click the code in a row): after any redemption, Coupon code, type, amounts, length, plans and start are locked (shown disabled with a note: "This coupon has been used, so its discount can't change. Make a new coupon instead."). Name, note, end date, limit (not below the times used: "The limit can't be below the 4 times it has been used."), once per workspace, require card and **Switched on** can change.
- **Redemptions** (button on the row): a list of workspaces that used it, with owner email, status (Pending, Active, Used up), months used of total, dates and the discount given. 
- Switching a coupon off or letting it end stops **new** workspaces only; workspaces already using it keep their months. There is no Delete.
- A free coupon with no limit and Once per workspace off gives unlimited free months; the form does not warn yet (carried).

### 28.3 Guest check-in: a draft until an ID photo is stored (D-95; changes 6.5)

*2026-10-20 (D-101): the form needs a photo picked before it sends; a draft is kept only after a failed upload. See 32.7.*

- The guest sends the form with answers and photos. The server saves the answers at once; the registration is **finished only when an ID photo is stored**. Until then:
  - **Guest page:** "Your answers are saved. Add a photo of your ID to finish registering." (English and Taglish) with the photo box; adding the photo finishes it and shows "Thank you! You're registered."
  - **Host, reservation page, check-in card:** Status **Waiting for the guest's ID photo** instead of "Received". No "check-in form received" alert or inbox note is sent yet.
  - **Gate pass, the Reservations "check-in form" filter and the Launchpad step** count only finished registrations.
- The first stored photo finishes the registration and sends the host the usual alert and inbox note, once. Registrations made before this change stay finished.

### 28.4 Filters (every list page)

- The secondary button that used to read **More filters** now reads **Filters**, with a funnel icon and a number: the count of every active filter except the search box. Its spoken name is "Filters, 2 active" (or "Filters"). With a filter set the button turns green.
- A quick filter that is set (for example **On trial**) turns green and bold; the chips under the bar have a tick and a round ×, press down when clicked, and **Clear all** now shows even with a single chip. Every select box has a chevron. "Unread only" in the Inbox is a pill that turns green when on.
- A host with few listings (Listings 1 to 3, Rent 3 or fewer units, Calendar 3 or fewer listings) sees only search and **Filters**; the quick filters are inside the panel. The Reservations table's Channel column folds under the listing name on screens 960 to 1439px wide.

### 28.5 Launchpad, Home and the calls to action

- **Home first-run card** ("Connect your calendar") is a card with an icon, the sentence, then the button, with a gap between the text and the button; on a phone it stacks. Other cards with a sentence followed by a button (Security deposit "None", the cleaner pay load error, the booking not completed page) have the same 12px gap.
- **Launchpad:** an optional step's **Skip for now** and **Show again** keep the step open and the page still, and focus stays on the button.
- **Home calendar sync rows** that point at the same listing are grouped (for example "Sunset Loft (2 links)"); Listings shows duplicate link rows as "(link 1)" and "(link 2)".

### 28.6 Listings → Channels: a link that does not look like a calendar

Adding a link that is not obviously a calendar shows "This doesn't look like a calendar link (they usually end in .ics). Save it anyway?" with **Save anyway** and **Change it**. A link with `.ics` or `ical` in it (Booking.com's `ical.html`, for example) saves without a question.

### 28.7 Other changes from the round 15 sweep

- **My account:** the page title (h1) is "My account"; the person's name is a smaller heading in the card. The Tagalog verify toast follows the chosen language.
- **Phone bottom bar:** staff and cleaners see **Groups** and **Help** (the sidebar keeps "Group bookings" and "Help & support").
- **Theme switch** (Settings, sidebar, More sheet): one Tab stop; the arrow keys, Home and End move and pick; the buttons are 44px tall on phones.
- **Search:** a capped group says "5 of 8 shown"; a guest result names the latest stay ("Last stay: Oct 16, 2026 – Oct 17, 2026"); "In Settings" for settings; "No results" is one disabled line; one Close button in the phone sheet.
- **Reservation, add-ons:** a quantity over the limit keeps the typed number, says "Up to 3 Extra mattress per stay." and blocks Save. **Cleaner pay → Payout:** Method starts on "Choose…". A refused custom From date stays when To changes.
- **Cleaners:** the job sheet's "Supplies used" list shows the job property's supplies (loaded for that job). The Supplies page itself is not available to cleaners (they are sent to Housekeeping).
- **Alerts with no property** (bell and phone) go to owners only. The housekeeping alert says "Due Oct 16, 2026".
- **Review page** (4 and 5 star guests): the share links come back when the guest returns. **Quote page:** a phone number in the wrong format is refused. "See all places" and the Privacy link on the account page are easy-to-hit links; links inside a sentence (the consent "privacy notice") keep their text size.
- **Maintenance:** each row's badge is not a second Tab stop; empty Resolved and Cancelled tabs say so. Statements → **Receipt** and the dashboard repairs count are easy-to-hit links.
- **"+ Add new" → Property** is shown for long-term and Both workspaces only (short-term hosts add buildings through Add listing); this is the same as 27.1.

## 29. QA round 16 changes (D-97; 2026-10-15)

### 29.1 Navigation
- **Back keeps your place.** Browser Back, or a page's `‹ Back` link that points at the page you came from, returns to the same scroll place. The page waits up to 1.5 seconds for the list to load, then restores the place; any scroll, tap or key press cancels it. A new page starts at the top.
- **The other module's home goes home quietly.** Opening `#/dashboard` on a stays workspace, or `#/home` on a rentals workspace, goes to the workspace's own home with no message. Any other refused page still says "That page isn't available for your role or workspace." The Privacy page logo goes to the workspace's own home.

### 29.2 Reservations
- The Nights and Guests filters say "Enter a number from 1 to 99."
- **Do not rebook** warns for any booking whose email belongs to a flagged guest (the owner's save toast; the Inbox note and push for an online booking). The flag stays on the original guest record. Group bookings do not warn yet (carried). *(They warn since round 17, D-99 O8; section 30.2.)*

### 29.3 Calendar
- On phones, Property, Tag and Availability sit under Filters and the colour key is folded. A night's menu starts on New reservation. The month bar (previous, month, next, Today) stays on one row.

### 29.4 Guest booking page
- A payment error shows just above "Continue to payment". Once both dates are picked, the calendar heading says "Dates chosen. Tap a date to change them." (before that: "Choose your check-in date", then "Now choose your check-out date").

### 29.5 Check-in and gate pass
- When a guest registers more people than booked, they see "This booking is for N guests…". The host's check-in card reads "6 registered · booked for 4"; the gate pass and its email read "6 (booked for 4)". Nothing is blocked. *(When only the main guest registered, the pass reads "1 (booked for 2)", section 30.4.)* An upload that fails while online says "That didn't go through. Your answers are still here; please try again."

### 29.6 Inbox
- Assigned to, Snooze/Unsnooze and Archive/Unarchive keep keyboard focus. Switching between Guest message and Internal note keeps each one's own text (in memory only).

### 29.7 Top bar search
- The panel says "Search covers guests, reservations, listings and pages." *(Widened in round 17: the scope line and the group list follow section 30.1, D-99.)*

### 29.8 Plan & billing
- A comped workspace sees "Your workspace is on a complimentary plan, so there is nothing to pay." and no Pay now or coupon box. A free-with-card coupon says "You pay ₱20.00 once by card." in the preview message, the hint and the banner. A forever coupon reads "Coupon CODE: ₱100 off every month." with no months-left count. Apply sits beside the code box; a code error is tied to the box.

### 29.9 Platform admin coupons (`#/admin/coupons`)
- The required mark follows the kind (percent or amount). A free coupon with no total limit and once per workspace off asks "Unlimited free months?" before saving. Codes of 3 to 7 characters get a short hint under the box.

### 29.10 Unit owners
- A percentage fee over 50% asks "Check the management fee" (Save anyway / Change it); 0% saves without a question. An exact duplicate name asks "Name already used" (Save anyway / Change it). On Edit, the fee question is asked only when the fee model or the value changed.

### 29.11 Reports
- Stay reports: a custom range longer than two years keeps the last report and marks the To box "Choose up to two years." Long-term Reports has no range limit (D-99).

### 29.12 Rent & Expenses
- The Vendor list hides vendors seen only on voided expenses unless voided expenses are shown.

### 29.13 Launchpad
- The current group is open; later groups fold under "Later (N more steps)". The count at the top is still the full count. This applies to every owner (S2).

### 29.14 Cleaning task and repair request
- Picking a photo uploads it at once. There is no Upload photo button. (The deposits page still uses pick, then button.) *(The deposits page now uploads on pick too, D-99.)*

### 29.15 Forms in dialogs
- While saving, the Save button shows "Saving…", is marked busy and keeps focus. A dialog with no fields starts on its first action button.

## 30. QA round 17 changes (D-98, D-99; 2026-10-15)

### 30.1 Top bar search (O1; widens 27.1 and 29.7)
- Five new groups, each scoped as its own page is: **Cleaning tasks** (by unit or property name; the same scope as the Housekeeping list; opens the task), **Supplies** (by name; opens Supplies filtered to it), **Expenses** (by vendor or description; opens the expense), **Discount codes** and **Add-ons** (owners and managers only; staff get neither group). The old **Maintenance** group is now called **Repair requests**.
- Results never show money, guest contact details or notes. **Archived add-ons are not found.** A discount code result shows only its status word (Active, Off, Expired, Used up or Starts later), never its note. An expense result is titled with its vendor, then its category, never the free-text description. Voided expenses and archived supplies are not found. Long-term owners get no Supplies group.
- Order of groups: Pages, Reservations, Guests, Listings, Properties, Tenants, Unit owners, Quotes, Repair requests, Cleaning tasks, Supplies, Expenses, Discount codes, Add-ons, Help articles. Still 5 per group.
- The line under the box names what the person can search:
  - Owner, short-term: "Search covers reservations, guests, listings, properties, unit owners, quotes, repair requests, cleaning tasks, supplies, expenses, discount codes, add-ons, pages and help."
  - Staff, short-term: "Search covers reservations, guests, listings, properties, repair requests, cleaning tasks, supplies, expenses, pages and help."
  - Owner, long-term: "Search covers properties, tenants, repair requests, expenses, pages and help."
  - Cleaner: "Search covers pages and help."

### 30.2 Reservations and groups
- A room's error shows on that room's own box in the group form ("This listing allows up to 4 guests." under Guests in this room, marked invalid). A one-room group reads "The 1 room will be cancelled…".
- Group bookings warn like single reservations when the lead guest's email belongs to a guest marked Do not rebook (owner or manager toast: Heads up: {name} is marked "Do not rebook" in Guests.).
- A booking whose email and first name match a saved guest joins that guest and says so: "Saved under the existing guest {name} (same email and first name)." The typed name is not stored.
- **Record payment** on an Airbnb booking starts on **Cash** (Channel payout stays a choice). Direct bookings still start with no method chosen; other channels start on Channel payout.
- Reason boxes (void a payment, refund, cancel, remove a room, reject a proof, void a charge, payout or withdrawal) take up to 500 characters and show "Reason must be at most 500 characters." instead of cutting the text. Deposit deduction reasons keep 1,000; block reasons keep 200.
- **Record refund** checks Amount, Method and Reason together and shows all that are missing at once.
- A negative deposit deduction is flagged at the field with no question. Deposit damage photos upload when picked (the **Add photo** button is gone; "Damage photos: add them on the deposit card (before or after saving).").
- A bad number in an address filter (for example `min_guests=abc`) is dropped from the address.
- On phones the room links on a group booking's page are 44px tall, and the landing footer's theme buttons are 44px wide.

### 30.3 Filters (every list page)
- **Done** closes the Filters panel and puts keyboard focus on the **Filters** button.

### 30.4 Guest pages
- The gate pass (page and email) shows the registered count whenever a registration exists, with the booked count when they differ: "1 (booked for 2)".
- A draft check-in registration's button reads **Submit registration** (English and Taglish).
- A balance payment that fails shows its message above the Pay button.

### 30.5 Inbox
- The teammate list for an `@` mention opens in the flow under the note box and never covers the **Internal note** and **Message guest** tabs; clicking a tab switches mode and never inserts a mention.
- **Skip to conversation** (a keyboard skip link) jumps to the open thread's heading.
- Non-owners read "These automatic messages are off until the workspace owner turns them on." on the automations card.

### 30.6 Rent & Expenses
- Rent due **Sort** default reads **Overdue first**. A voided payment prints one VOID line. An expense above ₱50,000 asks **Check the amount** ("This expense is ₱… . Save anyway?"; Save anyway / Change it), on add and on a correction whose amount changed.

### 30.7 Platform admin coupons (`#/admin/coupons`)
- A fixed amount above the highest plan price (today ₱1,799.00) asks **Check the amount off** (Save anyway / Change it; Change it focuses the amount). **Total discount given** counts every coupon, not only the page shown, with two decimals. Offers show thousands separators.
- Coupon codes are up to 32 characters ("Codes are up to 32 characters."). On Plan & billing a forever coupon shows its offer once.

### 30.8 Home and Listings (small hosts)
- The Home first-run card says "Your calendar is connected. Bookings from it show here after the next sync." once a calendar is connected, and is hidden while a sync problem shows.
- Listing photos upload when picked. With 3 or fewer listings the Listings bar shows Occupancy and Sort, and folds the rest under Filters.
- A failed first sync shows in the Channels dialog, on the listing card, in the bell and in the Home banner, with no toast on top.

### 30.9 Repairs
- After a status change (Start work, Mark resolved, Reopen) focus goes to the page heading, never to the button that would undo the change.

### 30.10 Cleaner pay (phones)
- Each row's tick box label, and the **Select all unpaid** label, is a 44px tap target. The box itself may stay 24px.

### 30.11 Plan & billing: card on file (owners; D-98; adds to 28.1)
- **Card on file: Visa ending 4242** with **Remove card**. The dialog is **Remove your card?** — Stage 1: "BalayHub forgets this card. You can still pay another way."; Stage 2: "BalayHub forgets this card and turns off automatic payment. Your plan stays active until {date}." Buttons **Keep card** / **Remove card**; toast **Card removed.**
- **Plan after your trial: Growth** (after the trial: **Next plan: Growth**) with **Change**, which shows a plan drop-down and **Save** (toast **Saved.**).
- **Stage 1 pay:** the primary button **Pay ₱999.00 with Visa ending 4242** *(corrected in round 25: amounts show two decimals, D-107; the card ending is the saved card's own)* (the amount follows plan, months and coupon preview; a free coupon keeps **Activate free plan**) and a secondary **Pay another way** (the hosted PayMongo checkout). If the saved card is declined: "Your saved card couldn't be charged. Pay another way, or use a different card." If the bank asks for a code, the browser goes to the bank and comes back to Plan & billing with the usual "Payment received" message.
- The note "BalayHub never charges your card on its own; you renew here." stays in Stage 1.
- **Stage 2 (when switched on):** "Automatic payment is on. Next charge: ₱999 to Visa ending 4242 on {date}." with **Cancel automatic payment** (dialog **Cancel automatic payment?**, buttons **Keep it on** / **Cancel automatic payment**, toast **Automatic payment is off.**). Off with a saved card: "Automatic payment is off." and **Turn on automatic payment** (shows the consent tick box). Past due: "Your card payment on {date} didn't go through. Pay now to keep making changes."
- **History:** a card check row reads **Card check**, "Paid {date} · Visa ending 4242", ₱20.00, badge **Paid**. Dates on this page read "Nov 14, 2026" (D-99).
- **Reminder email** (3 days and 1 day before the trial ends): subject "Your BalayHub trial ends on {date}" with a link to Settings. Stage 2 with automatic payment on gets "Your BalayHub plan starts on {date}" 3 days before.
- After saving the plan after the trial (Change, then Save), focus stays on **Change**.
- Owners only; managers, staff and cleaners never see or call any of this.
- *2026-10-20 (D-101): the bank-return notices, the in-progress wait message, the coupon release after a failed payment and the pay picker's plan are in 32.1.*

---

## 31. QA round 18 changes (D-100; 2026-10-19)

### 31.1 Platform admin: Delete workspace (`#/admin`)
- Open a workspace (not the demo, not your own). At the bottom of the panel, h3 **Delete workspace** with a box **Type {workspace name} to confirm**. The name is trimmed on both sides and must otherwise match exactly (capitals count). Both buttons stay off until it matches. The server checks again.
- **Delete in 14 days:** "The owner and team are locked out now. You can cancel this for 14 days, then everything is deleted." Toast **Deletion scheduled for {date}.** The owner gets an email ("Your BalayHub workspace "{name}" will be deleted on {date}") with a link to Settings. The workspace is view-only and shows the **Deleting** badge in the table. The panel then shows **Cancel deletion** and only **Delete now**.
- **Delete now:** "Everything is deleted right away: bookings, guests, files, and their PayMongo card and plan. This cannot be undone." Toast **{name} was deleted.**, the panel closes, the table redraws and focus goes to the page heading.
- **Cancel deletion** (admin): toast **Deletion cancelled.**; the workspace is editable again. The owner can do the same from Settings (**Cancel deletion**), also for a deletion an admin scheduled.
- **Messages (shown in the panel, focus moves to the message):** the demo "The demo workspace cannot be deleted."; own workspace "You cannot delete the workspace you belong to."; a workspace with a platform admin member "This workspace belongs to a BalayHub admin and can't be deleted here."; already scheduled "This workspace is already scheduled for deletion."; a wrong name "Type the workspace name exactly to confirm." (under the box, marked invalid); a failed purge "The workspace could not be deleted. Nothing was deleted. Please try again in a minute." (the box and buttons stay, so it can be retried); Cancel on a workspace that is not scheduled "This workspace is not scheduled for deletion."
- The deletion is written to a record that survives the purge (platform audit, no workspace). The workspace's own Settings audit list shows "Workspace deletion scheduled by BalayHub" and "Workspace deletion cancelled by BalayHub".

### 31.2 Confirm your payment card (5.10)
- A bank **Fail** shows the declined message. A decline then a retry makes one new ₱20 payment (the old one expires); two charges never happen. The success panel takes focus on its heading after a bank return. See 5.10.
- Plan & billing Stage 1: the note under the pay buttons is only "BalayHub never charges your card on its own; you renew here." The sentence about automatic payment shows only when automatic payment is on.
- **Remove card** turns automatic payment off first, then forgets the card; removing again with no card writes no second log entry.

### 31.3 Filters on phones (every list page with a filter bar)
- Below 560px the search box and the **Filters** button share one row. Quick toggles and quick selects (for example Housekeeping **Only my tasks** and the property select) move into the Filters panel. Desktop is unchanged. First list row sits near the top (Housekeeping 605px to 443px, Maintenance 553 to 387, Expenses 466 to 300, Guests 443 to 277, measured at 390 wide).
- **Clear all** and **Reset filters** clear only filter values; they keep the saved view the person chose.
- The Appearance switch labels on Settings and My account stay on one line ("Match device" does not wrap).

### 31.4 Reservations
- The saved view **Upcoming unpaid** is now **Unpaid, not yet checked out** (it includes in-house unpaid stays).
- **Record payment** reports the amount and the method together: both messages appear at once, as in Record refund.
- Channels dialog (Listings): **Connecting…** and the busy button appear only after "Save it anyway?" is answered **Save anyway**, or when no question was needed.

### 31.5 Cleaner pay
- Mark paid: **How you paid** starts on **Choose…**; saving without a choice says **Choose how you paid the cleaner.**

### 31.6 Inbox
- The box under the thread is named **Internal note** in note mode and **Message to {guest name}** in message mode (it was always "Message").

### 31.7 Reports and Profit and loss
- Channel stays with no channel fee entered: one line per channel next to Channel fees, **N Airbnb stays have no channel fee entered.** (one stay reads "1 Airbnb stay has…") with a link **See the bookings** to Reservations filtered to that channel and period. Reports counts by check-in date, Profit and loss by check-out date (stays already ended). Counts only, never money. Owners and managers.
- Reports custom dates: every date error marks the **From** and **To** boxes invalid and ties the message to them for screen readers.

### 31.8 Plan coupons (Plan & billing)
- A code is looked up first. An unknown or unusable code says "This code isn't valid right now. Check it and try again." even on a comped workspace. A comped workspace with a usable code or no code hears "Your workspace is on a complimentary plan, so coupons don't apply."
- A coupon with limited months reads **This payment covers 1 of your 3 coupon months.** under the total. The offer itself stays in the coupon box. The number is the coupon's total months, not the months left.

### 31.9 Other
- Tenants **Owes at least (₱)** uses Rent's rule: **Enter an amount of 0 or more (up to 10 digits).**, no chip while invalid. Search placeholders fit at 1280px: Payments **Tenant, unit, reference, notes**; Tenants **Name, phone, unit, property**.
- Top bar search: a page keyword matches whole words or word starts only ("Ana" no longer finds "manager"). An expense result's second line drops the category when the title already is the category.
- The host check-in card reads **5 (booked for 3)** when more are registered than booked; when fewer, only the registered count.
- Maintenance status buttons and Daily close **Reopen day** stay enabled while saving (the page marks them busy and ignores a second click), so focus never drops to the page body before it moves to the heading.

---

## 32. QA round 19 changes (D-101; 2026-10-20)

### 32.1 Plan & billing: paying, coming back from the bank, coupons (owners; adds to 28.1 and 30.11)
- **Coming back from the bank** (`#/settings?billing=<id>`): **paid** shows "Payment received. Thank you! Your plan is active."; **failed** shows the alert "Your saved card couldn't be charged. Pay another way, or use a different card." Whichever appears takes keyboard focus.
- **A payment still at the bank:** pressing pay again says "A payment is already in progress. Try again in N minutes." (N is the time left of the 15 minutes, rounded up; "1 minute"). If the earlier payment has in fact failed (PayMongo says so), it is let go and the new payment goes ahead. **After 15 minutes with the payment still alive at PayMongo** the message is "We're still waiting for your bank to finish an earlier payment. Pay another way, or try again later." and paying stays blocked.
- **While a payment is waiting for the bank,** Plan & billing shows "A payment of ₱<amount> is waiting for your bank…" and hides the **Pay** button and the coupon box (it no longer shows the full price).
- **A coupon after a failed or abandoned payment:** the coupon is released (usable again, months used unchanged). **Type the code again**; the amount on the button is the amount charged. A payment left pending is let go (and its coupon released) only when PayMongo shows it dead, when the next payment is started or by the 2-day cleanup. If it later lands, it takes the coupon back (the coupon's use limit can then be passed, because the money was already taken).
- **The pay picker** starts on the plan chosen under **Plan after your trial**, else the current paid plan, else Growth. A free coupon activates the picker's plan.
- The saved-card pay button appears only when a card is on file.
- A workspace with no saved trial end date counts 14 days from the day it was created; a free coupon's covered months start after that.

### 32.2 Confirm your payment card, second tab (changes 5.10)
- If another tab already passed the card check, this tab goes straight to the owner's home page with no message (it no longer shows a red "already confirmed").

### 32.3 Platform admin: Delete workspace (changes 31.1)
- **Delete in 14 days** and **Cancel deletion** keep the workspace panel open and redraw it in place: after scheduling, **Cancel deletion** and **Delete now**; after cancelling, the Delete workspace form again. Focus goes to the **Delete workspace** heading. **Delete now** still closes the panel (31.1). On phones the section has a gap and a divider above it.
- Plan coupons: the **Ended or off** card counts ended and off coupons only. A missing start date says **Choose the day the coupon starts.**

### 32.4 Rent: Record payment and the voided printout (changes 7.18 and the rent rows)
- **Method** starts on **Choose…** and is required: **Choose how the money was received.** (no pre-chosen Cash).
- A voided payment's printout is titled **Voided payment record**.
- Phone search hints: Rent due **Tenant, unit or property**; Payments **Tenant, unit, ref, notes**; Expenses **Description or vendor**.

### 32.5 Inbox: Send later (changes 7.8)
- The label reads **Send later (Philippine time, optional)**. The chosen time is Philippine time wherever the device is; the scheduled time shown is Philippine time. Search hint **Guest or code** (screen-reader name "Search guest, listing or booking code"; round 22).

### 32.6 Notification settings (changes 14.7)
- Settings and My account list **every type the person can receive**, each with on or off, saved per person: mentions, assigned conversations, calendar sync problems and unit-owner activity are included. Owners see 9 types, managers 8 (the seven stay alerts plus Cleaning tasks), staff the cleaning alerts only (cleaners the same).

### 32.7 Guest check-in (changes 28.3)
- The form needs **a photo picked** before it sends (a check-in with no photo is refused; no draft is made). A draft is kept **only after a failed upload**: the answers are saved and the guest sees "Your answers are saved. Add a photo of your ID to finish registering." After a successful registration the browser tab title follows the new heading ("Thank you! You're registered. — BalayHub").

### 32.8 Calendar: block dates and phone names
- **Block dates** that clash show the same sentence as a reservation: "These dates overlap a block on {dates} on this listing." or the other guest's stay with its code and dates. The message shows in the dialog banner.
- On phones, long listing names are cut in the middle ("QA r19…Unit 1") so two units never look the same.

### 32.9 Reservations and groups: do not rebook
- The warning reads: **Heads up: {flagged guest} is marked "Do not rebook" in Guests.** It names the guest who is flagged, which can be a different guest with the same email. A **manager** sees that name only if the flagged guest is in the manager's property scope; otherwise the warning names the booking's own guest. Owners always see the flagged guest. The group room table reads "1 night".

### 32.10 Phone filters and layout
- **Filters panel:** pages whose bar has only quick filters (Cleaner pay, Plan coupons) get the same **Filters** button and panel below 560px (count, Clear all). Every quick select inside the panel has a visible label.
- Compact tab bars on phones: a group of 3 tabs shows three equal columns, a group of 4 shows two by two, each tab at least 44px (the group fills the width below 560px); the More sheet's header with **Close** stays pinned while the sheet scrolls (**Log out** still needs a scroll).
- Landing **Log in** and the language switch are at least 44px tall, and the landing section links are hidden below 768px so Log in stays on screen. Listing cards use one boxed button style for Edit, Archive and Bookings. Lost and found: the guest name is a tap-size link. The pay page has a gap above **Add selected to my bill**. Properties, Help and Listings search hints are shortened (Properties **Name, address or city**, Help **Search help**, Listings **Listing, building or city**).

### 32.11 Other
- Add-on price question: **Change it** puts focus back on the Price box.
- Profit and loss: the "no channel fee entered" link opens the stays that checked out before today, so the list count equals the note.
- Rental Reports: an empty custom date box is marked invalid with **Pick both dates to export.**
- A PayMongo Secret key with the right start but too short says **This key is too short. Paste the full Secret key from PayMongo.**

## 33. QA round 20 changes (D-102; 2026-10-20)

### 33.1 Plan & billing: one open payment at a time (changes 5.10, 31 and 32)
- While a plan payment is open, a second one does not start. Under **Pay another way**, while a one-tap payment waits at the bank, the page says "This cancels the payment waiting at your bank."
- **Pay another way** while a one-tap payment waits: BalayHub ends the older payment at PayMongo first. If the bank payment is dead, the hosted checkout opens. If it is still alive: "A payment is still waiting for your bank. Finish it there, or try again later." If it turns out to have been paid (including during the check): the owner is told the payment was received (no second charge).
- **Stale page:** if another tab or window already completed a payment, pressing Pay (or Pay with the saved card) on the old page answers "payment received", refreshes the plan summary and history, and moves focus to the notice. No new charge starts. Paying ahead from a freshly loaded page is still allowed.
- A free coupon activation in progress also counts as an open payment (D-108): a second payment is refused with "A payment is already in progress. Try again in a moment."
- **Pay with the saved card** while a hosted checkout is open: "A payment is already open in another window. Finish it there, or try again later."
- An applied coupon states its discount once (the green box with the code and **Remove**).
- **Payment history** rows show the card brand and last four digits of the card used, even after **Remove card**.

### 33.2 Platform admin: plan coupons
- **Limit total uses** ticked with an empty box: "Enter how many times the coupon can be used." The box is marked.
- A code that is already taken marks the code box. A code longer than 32 characters says "Codes can be up to 32 characters."
- The workspace search hint reads **Workspace or owner**.

### 33.3 Listings
- With **1 to 3 listings** the page is compact: status tabs with a zero count are hidden (All stays), and Occupancy and Sort by sit in the **Filters** panel.
- An iCal sync problem shows the plain sentence, with the raw error inside a closed **Technical details** box.
- On phones the card buttons (Edit, Archive, Bookings) sit in two columns; an odd last button spans both.

### 33.4 Keyboard focus and filters
- After a redirect (for example Reports to Stay reports) focus lands on the **page heading** and stays there; clicking a tab keeps focus on the tab.
- Removing a filter chip or pressing **Clear all** with the keyboard puts focus on the **Filters** button (else the search box, else the heading). On phones the chips row sits between the bar and the open panel.

### 33.5 Smaller changes
- **Block dates** that clash: the banner names the clash once; both date boxes are marked, with no text repeated under them.
- **New reservation** shows all field problems together (guest count, dates, email). **Add listing** does the same (building and nightly rate in one pass).
- **Inbox** composer Subject reads "Subject (optional)". **Help** new ticket Subject example "e.g. Airbnb not syncing". Tenants search hint "Name, phone or unit".
- **Gate pass** has a labelled **Notes** row and a Unit row laid out like the others.
- **Support:** a cleaner opens Help and sees their own tickets only.
- Phones: the Housekeeping main tabs are two by two under 380px; the theme switch labels fit at 320px (they wrap if needed).

## 34. QA round 21 changes (D-103; 2026-10-21)

### 34.1 Keyboard focus
- **Any form with several wrong fields** puts focus on the first wrong field in the order the form shows it (for example Add tenant with a bad phone and a bad email focuses Phone).
- **Phones, More sheet:** choosing a page from the sheet puts focus on that page's heading, also when the new page has the same heading text as the old one. Closing the sheet without going anywhere returns focus to the More button.
- **Calendar:** after Block dates, Set price, New reservation from a cell, Remove block or a drag-move, focus returns to the redrawn cell that opened the menu (else the page heading).
- **Quotes:** after **Cancel quote** focus lands on the page heading. An unknown quote link shows a **Not found** heading with focus on it.
- **Filters:** **Clear all** and the chip remove buttons work on the first click even when a number box (for example Nights at least) was typed and not yet applied.

### 34.2 Assistant and notifications
- The open **assistant panel closes when the page changes**; the floating button stays. It no longer covers the Send to support button on a new ticket.
- **Account, Notifications on this device** reads **On** only when this browser has a push subscription and permission is granted; otherwise it reads **Turn on**.

### 34.3 Forms
- **Public booking form:** a field's error disappears as soon as the guest fixes that field; a ticked checkbox clears its error; the red banner goes when no field is marked.
- **New reservation:** a date clash is stated once in the banner; both date boxes are marked and focus goes to Check-in. **Email a booking confirmation** is unticked and disabled until a guest email is typed, then it ticks (unless the host unticked it).
- **New quote:** all problems (dates, guest limit, email, negative amounts) show in one pass.

### 34.4 Plan & billing
- A free, card-only coupon states "once by card" once.
- Pressing **Apply** with an empty coupon box puts focus in the box.
- Plan cards sit **one per row on phones (under 560px)**; the **Pay** button label wraps inside the button, so there is no sideways scroll at 320px.

### 34.5 Cleaner pay
- The bulk bar counts **unpaid cleans only**: "N unpaid", or "Nothing unpaid" when none are left.

## 35. QA round 22 changes (D-104; 2026-10-21)

### 35.1 Keyboard focus
- **First page after loading, and pages reached by a redirect:** the page heading takes keyboard focus (no scroll), the same as any page change. This covers a fresh Home, Home after the confirm-card redirect, guest pages opened directly (including "Quote not found" and "Booking not found"), and a redirect onto the page already open (for example demo@ typing a calendar link while on Dashboard).
- **Opening Unit owners, Tenants or Properties with `?new=1`:** the Add dialog opens after the page has drawn. Escape closes it and focus returns to the page heading. The **+ Add** button route still returns focus to the button.
- **Filters:** **Escape** closes the open Filters panel and puts focus on the **Filters** button. Escape inside an open select list closes only the list.
- **Cleaner pay:** **Clear all** or removing a filter chip keeps the scroll position; focus stays on a control in the bar.
- **Booking, Charges:** voiding one of two charges with the same description keeps focus on the page heading and the page does not move. The two Void buttons read "(1 of 2)" and "(2 of 2)".
- **Rent:** changing the Property filter while a typed Amount is waiting no longer shows a page error; the amount is applied once.

### 35.2 Forms
- **Add owner:** a bad email and a missing fee show together on the first Save; focus goes to the first wrong field in page order.
- **Add season:** a missing price and a last night before the first night show together.
- **Quote and Check-in (guest pages):** a field's message disappears as soon as that field is fixed; the banner goes when the last one clears.
- **Edit reservation, date clash:** both date boxes are marked, the banner says it once, and focus goes to Check-in (as New reservation).
- **Help, new ticket:** the file in "Screenshot or file" is checked before sending. A file that is not a PDF, JPG, PNG or WEBP, or is over 10 MB, shows "Upload a PDF, JPG, PNG or WEBP file up to 10 MB." on the field; no ticket is created and the text stays.

### 35.3 Listings and Settings
- **Listings, Channels, Connect calendar:** the Channel box starts on **Choose the channel**. A link from a known site (Airbnb, Booking.com, Agoda, Vrbo, Expedia, Trip.com) picks that site; any other link needs the host to choose, otherwise "Choose which site this calendar link is from." shows on Channel. A channel the host picked by hand is not changed by the link. After **Save anyway** on an odd link, focus lands on the new row's **Sync now**.
- **Edit listing:** the "Booking page and payments" section is open by itself while no listing in the workspace is on the booking page.
- **Settings, Direct booking:** with no listing on the page it reads "None yet: on Listings, press Edit and tick "Show this listing on my booking page"." with a **Go to Listings** link.

### 35.4 Plan & billing
- **Two tabs, Pay in both at once:** one charge. The refused tab redraws to the waiting view ("A payment of ... is waiting for your bank..."); it keeps no Pay button and no "Try again in 15 minutes" alert. When no payment is waiting (the hosted "already open in another window" case), the message shows as before.
- **Changing plan after a free coupon or trial days:** paid days convert at the price ratio as before; free days move day for day to a cheaper plan and never grow.

### 35.5 Phones and Inbox
- **Assistant panel (under 560px):** the open panel ends just above the bottom bar, so the bar's tabs can be tapped. Tapping a tab changes the page and closes the panel.
- **Inbox search box:** the hint reads "Guest or code" and is not cut at 390px with a filter count showing.

## 36. QA round 23 changes (D-105; 2026-10-21)

### 36.1 Keyboard focus and navigation
- **Same-page address changes:** editing the address, Back or Forward, or a plain `#` link to the same page with a different filter, view or month (for example Reservations `?view=all` to `?view=upcoming`, Profit and loss `?month=`, Expenses `&category=`, Inbox `?view=open`) puts keyboard focus on the page heading, as a page change does, when focus was not on anything inside the page. A control the person was using keeps focus: the Daily close date picker, a Reservations tab link, a filter chip and Profit and loss's Month box stay where they are.
- **Housekeeping, a task, Add photo:** after the photo uploads, focus stays on the Add photo control and the "Photo uploaded." message shows. A second pick while the first is uploading is ignored.
- **Phone More sheet (under 560px):** every link can be tapped at every scroll position. **Log out** sits after a visible gap (a divider) under the last link and never overlaps Supplies or any other row. A link to the page already open closes the sheet and focuses its heading; Close and Escape return to More.

### 36.2 Forms: every problem on the first Save
- **Money, number and phone boxes are checked on the first Save** together with the required fields: Add expense (date outside 2000 to 2100 and an amount like `100.555`, or an amount of 0), Record payout (date and amount), Record payment (an amount of 0 and no method), Add unit (no unit type and a rent of 0), Add tenant (no name and a phone like `abc`), Add listing (nightly rate, cleaning fee below zero, maximum guests 0), and any other form with these boxes. Focus goes to the first wrong box in page order and nothing is sent. A blank optional monthly rent is still stored as 0.00.
- **Settings, Invite:** a bad email and a Property manager or Cleaner with no property show together.
- **Settings, Discount codes, New discount code:** a code with a space, a percent of 0, a percent and an amount together, or an end date before the start date show together (the server also answers with all of them at once).
- **Pricing, Bulk changes:** problems mark their boxes (listing or tag, first and last night, new price, percentage, block reason), focus goes to the first, and a box's message clears when it is edited. Preview is not sent until all are fixed.
- **Get started (step 3) and Confirm your card:** a field's message, its red mark and the banner clear as soon as that field is corrected (Get started in English and in Tagalog).
- **Confirm your card, Get started step 3 after a Tagalog choice:** Setup and Confirm your card stay in English (host screens, D-09); the language choice covers the public pages, Get started, Check your email and the verify step.
- **Inbox, internal note:** picking a teammate shows `@Bea Reyes` in the box; the saved note shows the highlight and notifies as before. A draft keeps the mention across a reload. Messages to a guest are never coded.
- **Groups, New group booking:** changing a room row's listing or dates clears the "These rooms are taken" list and its banner; the next Save lists only rooms that still clash.
- **Booking, Charges, Void:** the dialog reads "Void this charge? <description> (<category>): ₱<amount>. ..." (the category alone when the description is the category's name or is empty).

### 36.3 Plan & billing and My account
- **Plan & billing, tab regains focus:** the page re-reads billing and redraws if a payment, the plan or the paid-until date changed, at most once every 5 seconds. A return inside that window is checked when the window ends. Leaving Settings stops the checks.
- **Changing plan:** days convert by what was actually paid for them (a half-price payment converts at half weight); free days move day for day to a cheaper plan and never grow.
- **My account:** the Team line ("Team: N members") shows for owners only. Managers, staff and cleaners see no Team line.

### 36.4 Reports
- **Performance (under 560px):** the four headline cards stack one per row. Dashboard stat cards stay two per row. At 1280 they are four across.

## 37. QA round 24 changes (D-106; 2026-10-21)

### 37.1 Reservations, payments and receipts
- **New reservation, a saved draft:** closing the form and reopening it brings back only what the person typed. The price the quote suggested (Accommodation, Cleaning) is not restored as typed, so on another listing the quote fills the boxes again. A price the person typed is restored and the "Use the rate" offer shows as before. The same holds for every form that keeps a draft (Record payment, Add expense, Add listing, Add tenant, Add property, Add unit, Help ticket).
- **Receipt (print, email, receipt page):** every money line is as of that payment: the charge lines, the extras total, the booking total and the remaining balance. A charge added or a refund recorded after the payment does not change a re-printed receipt. A later change to the stay's own price still shows at today's price.
- **Payments, refunds, owner payouts and withdrawals:** the Void, Receipt and Email buttons name their own row: the receipt number when the row has one, else the amount and date with `(n of m)` when two rows match. A row with no twin keeps its old name.
- **Calendar, Remove block:** after the grid reloads, focus returns to the day cell that opened the menu (restates the rule in section 34; not a change).

### 37.2 Forms
- **Dates are checked on the first Save:** a date box's own earliest and latest day (Record payment, Add expense, Add repair cost, Assign lease, Record payout, Quote and refund dates and others) shows "cannot be in the future", "must be on or after ...", or "Pick a date between ... and ..." together with the other problems.
- **Assign lease and Change terms:** a lease end before the start says "Lease end must be on or after the start date." on the first Save.
- **Maintenance, recurring job:** the next-due window message shows on the first Save.
- **Cleaner pay, Add rate:** an amount of 0 and an amount above the ceiling (₱10,000 per clean, ₱1,000 per hour) show on the first Save.
- **Listings, Channels:** an empty calendar link, or one that is not a link, is said on the device and is not sent to the server.
- **Listings, Edit listing:** Maximum guests is blank when none is stored. Blank means no limit. Saving without a change stores no number. New listings still start at 2.
- **Properties, Add unit on a workspace that takes stays:** asks the cleaning fee and maximum guests, like Add listing.
- **Booking page, Guests box:** a valid count clears its message, red mark and greyed Continue as it is typed, and the price quote follows 500 ms after typing stops. An invalid count is said when the person leaves the box. A listing with no maximum allows up to 50.
- **Pricing, Edit pricing rule:** opens with focus on Days (Rule and Applies to are fixed). **Bulk changes:** a negative price says "cannot be negative".
- **Confirm dialogs with a reason box (Void payout and others):** an empty reason marks the box invalid and describes it.

### 37.3 Card on file, shell and My account
- **5.10, Confirm your card (gated):** the top bar shows only Help and the account menu. There is no Search, Bookmarks, Notifications or "/" key. When the card passes, the success panel shows the full top bar and the full sidebar at once, without going to another page. Focus that was inside the page stays on the same control.
- **Confirm your card, a PayMongo outage:** one-tap pay and Pay another way both say "We couldn't reach the payment service. Nothing was charged. Please try again in a moment."
- **My account, Preferences, monthly-rental owner:** a note that alerts aren't available yet, with no Turn on or Send a test button. "Turn off on this device" stays when a device is already on. Owners who take stays see the buttons as before.

### 37.4 Phones
- **Under 560 px, compact tabs** (for example Housekeeping's "Today & overdue (6)") wrap their label inside the cell and never clip it, down to 320 px.
- **Reports, Performance (390 px):** the Revenue card detail is three lines or fewer; the note sits in a footnote.
- **Tables:** a cell holding only an action button (Discount codes, Turn off / Turn on) centres the button on the row's first line.

## 38. QA round 25 changes (D-107; 2026-10-21)

### 38.1 Leases, focus and filters
- **Tenants, End lease:** the dialog keeps its date, reason and note. When it passes, a question follows: "End {tenant}'s lease?" with "{Property}, {Unit} becomes vacant from {move-out date}. Rent after that date is removed. This can't be undone in the app." The buttons are **End lease** and **Keep lease**; focus starts on Keep lease, so Enter never ends a lease. Keep lease returns to the End lease dialog with its values. There is no reopen yet (BLOCKERS round 25 a).
- **Filter bars (Inbox Show, Reservations Saved view, Profit and loss Month, Cleaner pay Month, Help and Housekeeping tabs):** after Back, Forward or an address change rebuilds the bar, focus returns to the same control. It goes to Filters only when that control no longer exists (a removed chip).

### 38.2 Forms
- **All problems in one save:** New group booking (lead guest name and every room row together), Add charge (a price of 0 together with the quantity), Record payout (an amount of 0 together with the method), guest Check-in (email and mobile shape together with the other fields), Get started step 2 (the same summary line as step 3).
- **Receipt file (Record payment, Add expense):** the file's type and size are checked with the other problems, before anything is saved.
- **Supplies:** a low-stock level or quantity out of range names a short noun ("Low-stock level cannot be negative.", "Quantity must be at least 1."), not the whole question label. A number box that cannot go below zero says "cannot be negative".
- **Help, follow-up link:** a subject or topic filled from the link wins over an older unsent draft.
- **Record payment and Record payout, Method:** shows the required mark and still uses the form's own sentence ("Choose how the money was received.", "Choose how you paid the owner.").
- **Discount codes, New discount code:** a Valid until date in the past asks "This code has already ended. Valid until {date} is in the past, so guests can't use it. Save it anyway?" with **Save anyway** and **Change it** (Change it returns to the Valid until box). The toast says "Code created. It has already ended, so guests can't use it.", "Code created. It starts {date}." for a code not yet started, and "Code created. Share it with your guests." otherwise.
- **Inbox, template insert:** a template inserted into a guest message is kept in that conversation's draft, like typing.

### 38.3 My account, shell and pages
- **My account while the card check is due:** "Waiting for your card check" and one **Confirm your card** button; no "Free trial" line and no Choose a plan.
- **Ask assistant button:** hidden while the card check is due, on desktop and phone; it returns when the card passes.
- **A heading the app focuses on arrival** (every page title, guest pages included) shows no focus ring. Controls keep theirs.
- **Reports tabs:** one Tab stop (the selected tab); arrow keys move between tabs.
- **Bulk changes, listing box:** shows about six listings; when more are hidden a soft shadow marks the edge that has more.
- **Guest pages:** one wording per rule: "This place allows up to N guests." and "Enter a valid email address."
- **Cleaner pay, Add rate:** the rate select is labelled "Rate type".
- **Record payment, restored draft:** a restored tenant draws its Current balance line; a restored Add expense keeps its property and unit.
- **Receipts on a monthly-rental workspace:** `#/receipts/<id>` goes home with the module toast (stays-only page; not changed).

## 39. QA round 26 changes (D-108; 2026-10-21)

### 39.1 Plan & billing
- **Free coupon activation counts as an open payment.** While it is being applied, a second plan payment (hosted, one-tap or another free one) is refused: "A payment is already in progress. Try again in a moment." A pending free activation blocks for at most 2 minutes.
- **Coupon kept across card-row changes:** saving "Plan after your trial", turning automatic payment on or off, or Remove card redraws the page, and a coupon the owner had applied is still in the box and is checked again for the current plan (the green line, or the server's refusal). A redraw after a payment, or after another tab paid, starts without it.
- **The tab that lost a two-tab race** says what is true now. If the other payment finished and the plan is paid further: "That payment was just received. Check your plan before paying again." If the other payment failed: no message, and the Pay buttons work. If it is still waiting: the waiting view.

### 39.2 Forms, drafts and receipts
- **Dialogs that back out of a question** ("Check the amount", Record more than the balance, a high nightly rate, Change this rate, an ended discount code, End lease's question): answering "Change it" or pressing Escape keeps the typed draft, so reopening shows it. Cancel still discards it.
- **Receipt file:** an empty file is refused before saving: "This file is empty. Choose the receipt file again." (the type and size messages are unchanged).
- **Receipt upload fails after the save** (Add expense, Record payment): one error message names both: "Expense saved, but the receipt didn't upload: {reason}" or "Payment saved, but the receipt didn't upload: {reason}". "Expense saved." / "Payment saved." is not shown.
- **Edit reservation:** check-out on or before check-in shows "Check-out must be after check-in." together with the guest-count message in one save.
- **Add a season:** a fixed price of zero or less shows "Nightly rate must be greater than zero." together with a bad minimum stay in one save.
- **Required marks:** Method on a direct booking's Record payment and on Record refund shows the red asterisk.

### 39.3 Address, focus and tabs
- **A `?new=1` dialog and an address change:** when the page is redrawn for a new address (for example `?view=arrivals_today`), the dialog closes and focus goes to the page heading.
- **Back or Forward from a `?new=1` dialog** closes the dialog even when the address text looks the same (the page had replaced `new=1` in the address). Same on every page with a `?new=1` dialog.
- **Tab lists** (Rent, Housekeeping, Listings, Maintenance, Help, Home, Reports and the rest): one Tab stop, the selected tab. Arrow keys, Home and End move between tabs and open them.
- **Filters, active-filter chips:** the chips and Clear all sit directly under the bar, above the open Filters panel, on phones and on desktop.

### 39.4 Wording
- **Manager on Cleaner pay:** with no amounts, the empty text and the row text tell the manager to ask the owner about rates. Owners see the old texts about adding a rate.
- **Guest pages:** full name blank: "Please enter your full name." (booking, quote); mobile blank: "Please enter your mobile number." (booking changes); house rules: "Please read and agree to the house rules." (check-in changes); consent: "Please agree to continue." (quote changes). Check-in keeps "Please enter your full name, as on your ID." and "Please agree so your host can register you with the building." Tagalog follows each.
- **Add listing, Type:** starts on Studio (no "Choose..."); changeable in Edit listing (works as decided, D-108).
