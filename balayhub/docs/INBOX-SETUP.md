# Inbox setup: guest messages, replies and AI drafts

The **Inbox** lets you email guests from BalayHub and keeps each reservation's messages in one thread. There are three parts:

| Part | What it needs | Required? |
|---|---|---|
| **Sending** messages, receipts and confirmations | Email sending (`SMTP_URL`), see [EMAIL-SETUP.md](EMAIL-SETUP.md) | Yes |
| **Guest replies showing up in BalayHub** | `IMAP_URL` (below) | Optional. Without it, replies arrive in your Gmail inbox only. |
| **✨ AI reply drafts** | `ANTHROPIC_API_KEY` (below) | Optional |

## How replies find their way back
Every email BalayHub sends to a guest has a reply-to address like `admin+bh-k3x9q2…@proverbs3digitalsolutions.com`. Gmail delivers anything with a `+` tag to your normal inbox (`admin@…`), and BalayHub uses the tag to match the reply to the correct reservation.

BalayHub checks your inbox every 2 minutes and **only reads emails with a `+bh-` tag**. It doesn't mark anything as read, move or delete anything, and it ignores all your other mail.

> Keep guest replies in your Gmail **Inbox**. If a filter archives or deletes them first, BalayHub can't see them.

## Step 1: Turn on guest replies (IMAP)
Use the **same Google account and App Password** you used for `SMTP_URL`.

1. Check that IMAP is on: in Gmail, go to **⚙ Settings → See all settings → Forwarding and POP/IMAP**. Google now keeps IMAP always on, so there's usually no "Enable IMAP" switch. If that page shows IMAP options ("When I mark a message in IMAP as deleted…"), IMAP is on and you can leave every option as it is.
2. In the Hostinger **Web console**:
   ```bash
   cd /opt/balayhub-src/balayhub
   nano deploy/.env
   ```
3. Add this line. It's the same as your `SMTP_URL`, with **three** changes: `smtps://` → `imaps://`, `smtp.gmail.com` → `imap.gmail.com`, and `465` → `993`. (The host is the easy one to miss.)
   ```
   IMAP_URL=imaps://admin%40proverbs3digitalsolutions.com:YOURAPPPASSWORD@imap.gmail.com:993
   ```
   `%40` stands for `@`. Write the 16-letter app password **without spaces**.
4. Save with **Ctrl+O**, **Enter**, **Ctrl+X**, then restart:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d
   ```
5. To test, open a reservation for **your own** email address, click **Message guest**, send something, then reply to it from your phone. The reply appears in BalayHub within about 2 minutes.

If it doesn't appear, the Inbox page shows the error, or run:
```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env logs app --tail 30 | grep inbox
```
| Message | Fix |
|---|---|
| `IMAP_URL looks wrong` | Check the format above: `%40` for `@`, no spaces |
| `Invalid credentials` / `AUTHENTICATIONFAILED` | Wrong app password, or IMAP is turned off in Gmail (step 1) |

## Step 2 (optional): Turn on ✨ AI reply drafts
AI drafts use Claude, by Anthropic. You pay Anthropic directly for what you use. With the default model, a draft usually costs well under ₱1.

1. Go to **https://console.anthropic.com/**, create an account (use your company email), add a payment method under **Billing**, and set a **monthly spend limit** you're comfortable with.
2. Go to **API Keys → Create Key**, name it `BalayHub`, and copy the key (it starts with `sk-ant-`).
3. Add it to `deploy/.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
   ```
4. Restart with the same `docker compose … up -d` command.

> 🔒 The API key is a password. Don't paste it in chats or screenshots; it goes only in `deploy/.env`.

The **✨ Draft reply with AI** button appears in the message box of every conversation on the Trial, Growth and Pro plans. It uses the reservation, the listing's Wi-Fi, check-in instructions and house rules, and the conversation so far. Drafts are **never sent automatically**: the host reads and edits each one first. Each workspace is limited to 60 drafts per hour.

**Privacy:** when a host clicks the button, that conversation and reservation details are sent to Anthropic to write the draft. Mention Anthropic as a service provider in your privacy notice (see [PRIVACY-CHECKLIST.md](PRIVACY-CHECKLIST.md)).

## Using the Inbox
- **Start a conversation:** open a reservation and click **Message guest**.
- **Templates:** pick one from **Insert template…**. Guest name, dates, Wi-Fi, check-in instructions and other details are filled in automatically. Fill in each listing's guest info under **Listings → Edit → Guest info**.
- **Send later:** choose a date and time before sending. A scheduled message can be cancelled until it goes out.
- **Internal notes** are seen only by your team, never by the guest.
- **Automatic messages** (Inbox → Templates & automatic messages) send a template at a set time, such as check-in instructions one day before arrival. They are **off by default**. Turning one on never sends to stays whose time has already passed. Only the workspace owner can change them.
- **Assign, snooze, archive** a conversation from its header. Guest replies automatically re-open archived or snoozed conversations.
