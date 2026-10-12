# Selling BalayHub: plans, free trial, demo and admin

## What customers see
- **Landing page:** `https://balayhub.proverbs3digitalsolutions.com/` shows features, pricing, FAQ, **Start free trial** and **Try the live demo**. Your marketing site links to it from the menu and footer.
- **Free trial:** every new workspace gets **14 days with all features** (up to 10 listings). A banner shows the days left.
- **After the trial**, or 7 days after a paid period ends, the workspace becomes **view-only**. Nothing is deleted, and customers can still view and export everything. A red banner tells them to choose a plan.
- **Live demo:** one click opens a sample host ("Reyes Staycations", 5 condo listings) with bookings, guest conversations, cleaning tasks and reports. It is **read-only** and never sends email. Its dates move forward every day so it always looks current.

## Plans (suggested prices: confirm or change them)
| Plan | Price / month | Listings | AI reply drafts |
|---|---|---|---|
| Starter | ₱499 | 2 | – |
| Growth | ₱999 | 5 | ✓ |
| Pro | ₱1,799 | 10 | ✓ |
| Complimentary | free | unlimited | ✓ (for friends, testers, and workspaces created before plans existed) |

Every plan includes the calendar and channel sync, inbox, housekeeping, payments, receipts, reports and unlimited team members. Long-term units (no nightly rate) don't count toward the listing limit.

To change prices or limits, edit `src/lib/plans.js` and deploy. Existing customers keep their plan; only the price shown changes.

## Getting paid (manual, for now)
There is no card payment yet. Customers pay by **GCash, Maya or bank transfer** and email you; **Settings → Plan & billing** tells them how. Then:

1. Make sure your email is in `PLATFORM_ADMIN_EMAILS` in `deploy/.env` (see below).
2. Log in to BalayHub. The sidebar shows **Admin**.
3. Find the workspace (search by name or owner email) and click it.
4. Set **Plan**, set **Paid until** to the last day the payment covers (for example, one month from today), and add a **Note** such as `GCash ref 1234567, Oct 15–Nov 14`. Click **Save**.

The Admin page also shows how many workspaces are on trial, paying, or overdue, your monthly revenue, and when each workspace was last active. That makes it a ready follow-up list. You can also **extend a trial** by setting a new "Trial ends" date.

> Later, online payments (PayMongo or Xendit: GCash, Maya and cards) can turn this into automatic checkout. Ask when you're ready.

## Server settings (`deploy/.env`)
```
# You (and any co-founder) — can open the Admin page. Comma-separated.
PLATFORM_ADMIN_EMAILS=admin@proverbs3digitalsolutions.com

# Shown on the landing page and Settings as "contact us". Defaults to the MAIL_FROM address.
SALES_CONTACT_EMAIL=admin@proverbs3digitalsolutions.com

# Free trial length in days (default 14)
TRIAL_DAYS=14
```
Restart after editing: `docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d`

## Notes
- Your own workspace and any workspace created before this update are set to **Complimentary**, so nothing changes for them.
- The demo is created automatically the first time someone clicks **Try the live demo**. Nobody can sign in to it with a password, and it can't send email, upload files, or invite anyone.
