# BalayHub for short-term rentals (Airbnb and staycation hosts)

The short-term module was built for individual hosts with 1–10 units: condo staycations, Airbnb studios and vacation houses.

## What's included

| Screen | What you can do |
|---|---|
| **Home** | **Daily overview** for Today, Tomorrow or the next 7 days: check-ins, check-outs, turnovers, guests staying, and one-tap **Check in / Check out**. **Trends** for the next 7 or 30 days: check-ins, check-outs, turnovers and occupancy. **Revenue** by month: average daily rate and total revenue, compared with the previous month |
| **Calendar** | All listings × dates. Bookings appear as colored bars by channel. Open nights show the nightly price. Tap an open night to **book**, **block** or **change the price** |
| **Reservations** | Saved views: Upcoming, Currently hosting, Check-ins and check-outs today or tomorrow, Upcoming unpaid, Past, Cancelled, Recently created, All. Search, channel filter, CSV export. Each reservation shows the stay, guest, payments and balance, with check-in and check-out, edit and cancel |
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

## Getting started checklist
New workspace owners see a **Get started** checklist on Home: add a listing, add Wi-Fi and check-in instructions, connect a calendar, add a reservation, turn on automatic messages, and invite a co-host or cleaner. It ticks itself off as you go and can be hidden.

## Connecting Airbnb, Booking.com and Agoda (calendar sync)

BalayHub syncs with the channels through **calendar (iCal) links**. These are free and work for any host. Sync goes both ways.

**1. Stop double bookings on the channels.** In BalayHub, go to **Listings → Channels** on a listing and copy *"Your BalayHub calendar"* link. Paste it into each channel:
- **Airbnb:** Calendar → choose the listing → Availability → **Connect to another website** (also called "Import calendar")
- **Booking.com:** Rates & Availability → **Sync calendars** → Import calendar
- **Agoda (YCS):** Calendar → **iCal / Calendar sync** → Import

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
Owner statements for hosts who manage units for other owners, online payments (PayMongo/Xendit for GCash, Maya and cards), and a guest-facing booking page for direct bookings.
