# BalayHub for short-term rentals (Airbnb and staycation hosts)

The short-term module was built for individual hosts with 1–10 units: condo staycations, Airbnb studios and vacation houses.

## What's included

| Screen | What you can do |
|---|---|
| **Home** | **Daily overview** for Today, Tomorrow or the next 7 days: check-ins, check-outs, turnovers, guests staying, and one-tap **Check in / Check out**. **Trends** for the next 7 or 30 days: check-ins, check-outs, turnovers and occupancy. **Revenue** by month: average daily rate and total revenue, compared with the previous month |
| **Calendar** | All listings × dates. Bookings appear as colored bars by channel. Open nights show the nightly price. Tap an open night to **book**, **block** or **change the price** |
| **Reservations** | Saved views: Upcoming, Currently hosting, Check-ins and check-outs today or tomorrow, “Unpaid, not yet checked out”, Past, Cancelled, Recently created, All. Search, channel filter, CSV export. Each reservation shows the stay, guest, payments and balance, with check-in and check-out, edit and cancel |
| **Inbox** | Email guests from one place, one thread per reservation. Templates, scheduled and automatic messages, internal notes and ✨ AI reply drafts. Setup: [INBOX-SETUP.md](INBOX-SETUP.md) |
| **Housekeeping** | A cleaning task for every check-out, with a checklist, photos and an assigned cleaner (see below) |
| **Listings** | Each unit's base nightly rate, cleaning fee, maximum guests, check-in/out times, and the **guest info** (Wi-Fi, check-in instructions, house rules) used in messages. **Cleaning status** (Clean / Dirty) and **channel connections** |
| **Guests** | Guest list with stay history |
| **Expenses / Maintenance / Settings** | Shared with the long-term module |

Built-in rules:
- **No double bookings.** The database refuses overlapping stays or blocks on the same listing. A same-day turnover (one guest out, the next in) is allowed.
- **Nightly price** comes from the listing's base rate unless you set a price for specific dates on the calendar.
- **Checking a guest out** marks the listing **Dirty** and creates a cleaning task. Finishing the task (or marking the listing **Clean**) marks it clean again.
- **Receipts:** every payment gets a receipt number (AR-000001, …). Tick **Email a receipt** when recording a payment, or open **Receipt** to print or save it as a PDF. These are acknowledgement receipts, not BIR official receipts.
- **Booking confirmations:** tick the box on a new reservation, or use **Email booking confirmation** on the reservation. The text comes from the "Booking confirmation" template, which you can edit.
- **Payments** can be partial and are never deleted, only voided with a reason. Double-tapping Save records a payment once.
- **Revenue** spreads each stay's accommodation amount evenly across its nights. Cleaning and other fees count in the month of check-in.

Each workspace chooses **Short-term**, **Long-term** or **Both** in **Settings**, and the menu changes to match.

## Housekeeping
- Cleaning tasks are created automatically for **today's and tomorrow's check-outs**, and when you check a guest out. **Add task** creates an extra one, such as a deep clean.
- Each task shows when the **next guest arrives**. Same-day turnovers are shown in red.
- **Assign** a task to a team member (invite your cleaner as **Staff**: they see only the properties you assign, without guest contact details or the Inbox) or just type the name of a cleaner who has no login. **Copy for cleaner** gives you the task and checklist as text to paste into Messenger or Viber.
- Cleaners tick checklist items on their phone, upload photos (finished unit or damage found), and tap **Mark done**.
- The owner can change the default checklist with **Edit checklist**.

## Guest check-in form
Many condo buildings require the names and IDs of everyone staying. Each reservation has a **private check-in link** (on the reservation page, under **Guest check-in form → Copy link**). It's also filled in automatically wherever a message template uses `{{checkin_link}}`. The default booking confirmation and check-in templates for new workspaces already include it; for older workspaces, add it to your templates.
- The guest opens the link on their phone. No account is needed. They enter everyone's names, their mobile number, arrival time and car plate number, and upload photos of valid IDs (photos are shrunk before upload, which saves mobile data).
- You get a note in the Inbox when it's submitted. The reservation page shows the details and ID photos, and **Copy for building admin** gives you a ready-to-paste summary.
- ID photos are visible to owners and managers only (never staff), and are **deleted automatically 30 days after check-out** (`GUEST_ID_RETENTION_DAYS`). Names stay on the record.
- **New link** replaces the link if it was sent to the wrong person.

## Direct booking page (no channel fees)
Each host can have a public booking page, such as `https://balayhub.proverbs3digitalsolutions.com/#/book/reyes-staycations`, to share on Facebook, Instagram, Messenger or a QR code at the unit.

**Host setup (Settings → Direct booking page):**
1. **Connect PayMongo.** Guests pay **you directly** through your own PayMongo account (GCash, Maya, cards, GrabPay). Create an account at dashboard.paymongo.com, then copy **Developers → API keys → Secret key**. Try it with the test key (`sk_test_…`) first, then switch to the live key. The key is stored encrypted and never shown again.
2. **Choose which listings appear:** Listings → Edit → *Show this listing on my booking page*. Add a description, and set:
   - **Online payment:** full payment only, a 50% deposit (the rest due before check-in), or let the guest choose.
   - **Minimum nights** and **balance due** (days before check-in).
3. **Add photos:** Listings → Photos (up to 12; the first one is the cover).
4. **Turn on** the page and **Copy link**.

**What the guest sees:** your listings with photos and prices, then an availability calendar with nightly prices. Taken nights from Airbnb, Booking.com and Agoda are blocked. They pick dates, see the total (and deposit), fill in their details and pay on PayMongo's secure page.

**What happens automatically after payment:**
- BalayHub confirms the payment with PayMongo using your key, then creates the reservation (channel *Direct*) and records the payment with a receipt number.
- The guest is emailed the booking confirmation (with the check-in form link) and a receipt.
- You get a note in the Inbox.
- Your calendar link updates Airbnb and Booking.com on their next sync, so the dates get blocked there too.
- While a guest is paying, their dates are held for 30 minutes so no one else can book them on your page. If they cancel, or the 30 minutes run out, the dates are released and that checkout is closed at PayMongo so it can't be paid later. Each visitor can have at most 2 unpaid checkouts open, and bookings open up to about 18 months ahead.
- A 50% deposit is only offered when the balance due date is still ahead; stays closer than that are paid in full.
- **Test mode:** with a `sk_test_` key, guests see a TEST MODE notice and bookings are labelled as test bookings. Switch to your live key before sharing the link.
- In the rare case a channel booking lands on the same dates before the payment finishes, no double booking is made. You get an email to refund the guest or offer other dates from your PayMongo dashboard.
- For 50% deposits, the reservation shows the remaining balance. Use the *Payment reminder* template, or an automatic message, to ask for it before check-in.

The booking page is paused automatically if your plan ends.

## Gate pass for your condo admin

Open **Listings → Gate pass**, choose a building and enter the admin's email (up to 3, e.g. admin
and security). Turn on automatic sending and choose how many days before check-in.

- BalayHub emails the admin the guests' names, dates and times, number of guests, plate number,
  your notes (e.g. parking slot) and "Authorized by" (the unit owner name the admin has on file).
- The email has a private link to a printable gate pass with the guests' ID photos, and a
  **Confirm received** button. You see "Received by admin" on the reservation and in the Inbox.
- Names and IDs come from the guest check-in form. BalayHub waits for it until the day before
  arrival, then sends what it has and tells you; send it again from the reservation once the guest
  fills it in.
- IDs are shown through the private link by default (it stops working the day after check-out).
  You can choose to attach them to the email instead.

## Security deposits

On a reservation, **Record deposit** when the guest pays the refundable deposit (the listing's
"Security deposit" amount is suggested). It is kept apart from booking income. After check-out it
appears on Home under **Deposits to return**. Press **Return deposit**: return it all, or deduct
for damage with a reason the guest sees, and add photos. The guest can get an acknowledgement and a
summary by email. Staff can record deposits; owners and managers return them.

## Reports and income summary

**Reports** (owners and managers) shows, for a month or a whole year: revenue, occupancy, average
nightly rate and RevPAR, revenue by channel, results by listing, expenses, and net after channel
fees and expenses. Revenue counts each night of a stay in the month it happens.

**Income summary (for taxes)** lists, per month and quarter, revenue earned, **payments actually
received** (cash basis, excluding security deposits), channel fees, expenses and net. Download it
as CSV for your bookkeeper. BalayHub doesn't issue BIR official receipts or give tax advice; your
accountant decides which figures and tax option apply.

## Taglish for guests

Settings → **Language for guests**: choose English or Taglish for your booking page, payment page,
guest check-in form and review page. Guests can switch with the English / Tagalog button at the top.
Tick "Also switch my … messages" to change the built-in confirmation, check-in, thank-you and
payment reminder messages too; if you had edited them, your wording is kept as a separate
"(my version)" template. Error messages from the server, receipts and the building admin's gate
pass stay in English.

## Price extras

Set them per listing (Listings → Edit → *Price extras*; the section is closed until you tap it) and in **Calendar → Pricing rules**:

- **Weekend rate** for Friday and Saturday nights.
- **Holiday rate**, applied automatically on the nights before and during Philippine holiday long
  weekends (Holy Week, Christmas to New Year, Independence Day, National Heroes Day, etc.).
  Chinese New Year and Eid dates are set by proclamation each year and may move; check the list
  on the Pricing rules page and set a calendar price for any night that needs it.
- **Seasons**: a date range with its own nightly rate and/or minimum stay (e.g. "Summer peak",
  "Christmas, 3-night minimum"), for one listing or all of them.
- **Weekly (7+ nights) and monthly (28+ nights) discounts.**

Order of priority for a night: a price set on the calendar → holiday rate → season → weekend
rate → base rate; then the long-stay discount. Rules apply to new quotes, new reservations and the
booking page. Existing reservations keep their price.

## Owner statements (if you manage units for other owners)

Open **Unit owners** (owners of the BalayHub workspace only), add each owner with their email,
management fee % and their units. *Statement for last month* shows, for stays that checked out in
that month: each stay's total, the channel fee, the cleaning fee (when you keep it for cleaning),
the net rental income, your management fee, the units' expenses and the **payout to the owner**.
Print it / save it as PDF, or email it to the owner.

For it to be complete:
- Enter the **channel fee / commission** on each reservation (Edit reservation). Stays synced from a
  channel calendar have no amounts — enter what the guest paid; the statement warns you about these.
- Record unit expenses (repairs, supplies, dues) against the unit in Expenses.

## Guest reviews, repeat guests and discount codes

- **Private reviews:** the "thank-you the day after check-out" message includes a private link
  (`{{review_link}}`) where the guest rates the stay (overall + cleanliness) and leaves a comment.
  Only your team sees it: on the reservation, the guest's profile, Guests → Reviews, and as a note in
  the Inbox. Ratings of 3 or less also send a phone notification. Turn the automation on in Inbox
  settings.
- **Repeat guests:** a reservation with the same email as a past guest joins that guest's profile,
  so reservations show "Returning · 3rd stay". Mark guests as **VIP** or **Do not rebook** (Guests →
  Edit); you're warned in the Inbox if a "Do not rebook" guest books online.
- **Discount codes** (Guests → Discount codes): percent or peso off the accommodation on your
  booking page, with optional dates, minimum nights, a usage limit, or *returning guests only*
  (the guest must use the email from a past stay). Codes stack after weekly/monthly discounts.

## Guests paying the balance online

When PayMongo is connected (Settings → Direct booking page), every reservation has a private
payment link. Open the reservation and click **Copy payment link**, or turn on the
"balance reminder" automation: it emails the link 3 days before check-in to guests who still owe.
The guest pays with GCash, Maya or card; BalayHub confirms it with PayMongo, records the payment,
emails a receipt and tells you in the Inbox. Recording a payment by hand, editing or cancelling
the reservation closes any payment page the guest still has open, so they can't pay twice.

## BalayHub on your phone (app + notifications)

- **Android (Chrome):** open BalayHub, then Settings → App & notifications → *Install BalayHub*
  (or menu ⋮ → Install app). Tap *Turn on notifications*.
- **iPhone/iPad (iOS 16.4+):** in Safari tap Share → *Add to Home Screen*, open BalayHub from the
  new icon, then Settings → App & notifications → *Turn on notifications*.
- Choose what to be notified about: new bookings, guest messages, check-in forms, online payments
  and cleaning. Staff only get cleaning notifications. Logging out turns them off on that device.

## Getting started checklist
New workspace owners see a **Get started** checklist on Home: add a listing, add Wi-Fi and check-in instructions, connect a calendar, add a reservation, turn on automatic messages, and invite a co-host or cleaner. It ticks itself off as you go and can be hidden.

## Connecting Airbnb, Booking.com and Agoda (calendar sync)

BalayHub syncs with the channels through **calendar (iCal) links**. These are free and work for any host. Sync goes both ways.

**1. Stop double bookings on the channels.** In BalayHub, go to **Listings → Channels** on a listing and copy *"Your BalayHub calendar"* link. Paste it into each channel:
- **Airbnb:** Calendar → choose the listing → Availability → **Connect to another website** (also called "Import calendar")
- **Booking.com:** Rates & Availability → **Sync calendars** → Import calendar
- **Agoda (YCS):** Calendar → **iCal / Calendar sync** → Import

- **Vrbo, Expedia, Trip.com:** look for "Calendar sync", "iCal" or "Import/Export calendar" in the property's calendar settings. Not every account type has it (for example many Expedia and Trip.com hotel accounts don't); if yours doesn't, you can still add those bookings by hand and choose the channel so your reports show where bookings come from.
- **Any other site** that gives you a calendar link (for example Holidu, Plum Guide or Glamping Hub): choose **Other**.

  _Channels rename these menus from time to time. If a step looks different, search their help center for "import calendar" or "iCal"._

**2. Bring channel bookings into BalayHub.** On each channel, copy its **Export calendar** link. Then in BalayHub open **Listings → Channels → "Bring in bookings from your channels"**, choose the channel, paste the link and click **Connect calendar**.

BalayHub then checks each connected calendar **every 30 minutes**, and also when you click **Sync now**.

**What calendar links can and can't do**
- ✅ They sync dates: new bookings, changed dates, cancellations and blocked nights.
- ❌ They don't include guest names, phone numbers, prices or messages. Imported stays show as *"Airbnb guest"* with ₱0. Open the reservation and click **Edit** to add the amount, so it counts in your revenue.
- Channels refresh imported calendars on their own schedule, roughly every 15 minutes to 3 hours. A booking made in the gap could still double-book, so for last-minute dates, block the night on the other channels too.
- On **Airbnb**, "Reserved" events become reservations and "Not available" events become blocks. **Booking.com** and **Agoda** don't mark the difference, so all their events are imported as reservations.
- If an imported stay overlaps a booking already in BalayHub, it's **skipped and reported** under Channels (shown in red). Nothing is overwritten.

Full two-way connections (guest names, prices, messages) require official partner API access from each channel. That's planned for a later phase.

## Updating your live server (Hostinger VPS)

In the Hostinger **Web console**:
```bash
cd /opt/balayhub-src/balayhub
./deploy/update.sh
```
This backs up your data, downloads the new version and restarts BalayHub. The database is upgraded automatically. Your existing workspace keeps its current type; to switch to short-term, go to **Settings → Modules for this workspace → Short-term stays → Save**.

## Coming next
Tell us what would help your hosting next.
