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

## Getting paid

### Online, automatic (PayMongo): recommended
Customers open **Settings → Plan & billing**, pick a plan and 1, 3 or 12 months (12 months = 2 months free), and pay on PayMongo's secure page with **GCash, Maya, card or GrabPay**. The plan switches on and **Paid until** moves forward automatically:
- **Renewing the same plan early** adds the time on top of the current period.
- **Switching plans** starts the new plan today, and unused days of the old plan are converted at the two plans' prices (for example, 30 unused Pro days become about 108 Starter days).
- **Paying during the free trial** keeps the remaining trial days; the paid period starts when the trial ends.
- Complimentary workspaces don't pay. Payments are listed in the customer's Settings, and your Admin page shows the new plan and Paid-until date.

One-time setup:
1. Sign up at **https://dashboard.paymongo.com/** with your business details and complete verification (you need a DTI or SEC registration, a valid ID and a bank account for payouts). You can test right away in **test mode**.
2. Under **Developers → API keys**, copy the **Secret key** (`sk_test_…` for testing, `sk_live_…` when you go live).
3. Under **Developers → Webhooks**, add an endpoint:
   - URL: `https://balayhub.proverbs3digitalsolutions.com/api/public/paymongo/webhook`
   - Event: `checkout_session.payment.paid`

   Copy its **signing secret** (`whsk_…`).
4. Add both to `deploy/.env` and restart:
   ```
   PAYMONGO_SECRET_KEY=sk_test_xxxxxxxx
   PAYMONGO_WEBHOOK_SECRET=whsk_xxxxxxxx
   ```
5. Test with your own workspace in test mode (PayMongo's test pages let you approve a fake GCash payment). When it works, switch both values to the **live** keys.

> 🔒 Both keys are passwords. Never paste them in chats or screenshots; they go only in `deploy/.env`.

How it stays safe: BalayHub never trusts a payment just because a browser or webhook says so. It always asks PayMongo directly (with your secret key) whether the checkout was paid, and checks the amount. A background check every 10 minutes also catches any payment whose webhook was missed. Webhooks are only acted on when `PAYMONGO_WEBHOOK_SECRET` is set and the signature matches; without it, payments still go through on the customer's return to BalayHub or within 10 minutes.

PayMongo deducts a fee from each payment; check their current rates on their pricing page.

### Manual (no PayMongo)
Without the PayMongo keys, Settings tells customers to pay by GCash, Maya or bank transfer and email you. Then:

1. Make sure your email is in `PLATFORM_ADMIN_EMAILS` in `deploy/.env` (see below).
2. Log in to BalayHub. The sidebar shows **Admin**.
3. Find the workspace (search by name or owner email) and click it.
4. Set **Plan**, set **Paid until** to the last day the payment covers (for example, one month from today), and add a **Note** such as `GCash ref 1234567, Oct 15–Nov 14`. Click **Save**.

The Admin page also shows how many workspaces are on trial, paying, or overdue, your monthly revenue, and when each workspace was last active. That makes it a ready follow-up list. You can also **extend a trial** by setting a new "Trial ends" date.

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
