# Email setup: verification, password reset and invitations

BalayHub sends email (account verification, password reset, team invitations, and later guest messages) through an SMTP account. Use the email provider your domain **already uses**.

> ⚠️ **Don't switch providers just for BalayHub.** If your domain's email is on Google Workspace, creating a Hostinger mailbox would require pointing your domain's mail (MX records) to Hostinger, and your Gmail inbox would stop receiving mail.

## Step 0: Check which provider your domain uses
In the Hostinger **Web console**:
```bash
dig +short MX proverbs3digitalsolutions.com
```
| It shows | Your email runs on | Follow |
|---|---|---|
| `aspmx.l.google.com` and similar | **Google Workspace** | Option A |
| `mx1.hostinger.com` and similar | **Hostinger Email** | Option B |
| something else | another provider | Use that provider's SMTP settings, in the same format as below |

---

## Option A: Google Workspace (Gmail)

### A1. Choose the sending address
The simplest choice is your existing account, for example `admin@proverbs3digitalsolutions.com`.

Optional but nicer: add a free **alias** such as `no-reply@` or `balayhub@`:
1. In **admin.google.com**, go to **Directory → Users →** your user **→ User information → Alternate email addresses**, add the alias and save.
2. In **Gmail → Settings → Accounts → Send mail as**, add the alias.

### A2. Turn on 2-Step Verification
1. Signed in as that Google account, go to **https://myaccount.google.com/security**.
2. Under **How you sign in to Google**, turn on **2-Step Verification** if it's off.

### A3. Create an App Password for BalayHub
1. Go to **https://myaccount.google.com/apppasswords**. Sign in again if asked.
2. App name: `BalayHub`, then click **Create**.
3. Google shows a **16-letter password** such as `abcd efgh ijkl mnop`. **Copy it now**; Google shows it only once.

**Write it without spaces:** `abcdefghijklmnop`.

> If the App passwords page says *"The setting you are looking for is not available"*:
> - 2-Step Verification is still off (go back to A2), or
> - your Workspace admin has blocked app passwords. Fix that in **admin.google.com → Security → Authentication → 2-step verification** (allow users to turn it on), and under **Less secure apps / App passwords**, allow them.

### A4. Build your SMTP line
The format is:
```
SMTP_URL=smtps://YOUR_EMAIL:APP_PASSWORD@smtp.gmail.com:465
```
In the email address, replace `@` with `%40`. Example:
```
SMTP_URL=smtps://admin%40proverbs3digitalsolutions.com:abcdefghijklmnop@smtp.gmail.com:465
MAIL_FROM=BalayHub <admin@proverbs3digitalsolutions.com>
```
`MAIL_FROM` must be your Google address or an alias you added in A1.

Now continue at **"Put it on the server"** below.

---

## Option B: Hostinger Email (only if your MX records point to Hostinger)
1. In **hPanel → Emails**, create a mailbox such as `no-reply@yourdomain.com` with a strong password.
2. Build the line, replacing `@` in the email with `%40` and encoding special characters in the password:

   | Character | `@` | `:` | `/` | `#` | `?` | `%` | `&` | `+` | space |
   |---|---|---|---|---|---|---|---|---|---|
   | Write as | `%40` | `%3A` | `%2F` | `%23` | `%3F` | `%25` | `%26` | `%2B` | `%20` |
   ```
   SMTP_URL=smtps://no-reply%40yourdomain.com:YOUR_PASSWORD@smtp.hostinger.com:465
   MAIL_FROM=BalayHub <no-reply@yourdomain.com>
   ```

---

## Put it on the server
In the Hostinger **Web console**:
```bash
cd /opt/balayhub-src/balayhub
nano deploy/.env
```
1. Use the arrow keys to move to the `SMTP_URL=` line and replace the whole line with yours.
2. Set `MAIL_FROM=` the same way.
3. Make sure it says `REQUIRE_EMAIL_VERIFICATION=true`.
4. Save: **Ctrl + O**, then **Enter**, then **Ctrl + X**.

Apply the change:
```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d
```

## Test it
1. Open BalayHub in a private/incognito window. Don't log in.
2. Click **Log in → Forgot password?** and enter your own email.
3. Within a minute you should receive **"Reset your BalayHub password"**. Check **Spam** too. You don't have to reset; the email arriving proves it works.

If no email arrives, check the logs:
```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env logs app --tail 30
```
| Log shows | Fix |
|---|---|
| `Invalid login` / `535` / `Username and Password not accepted` | Wrong App Password, the `@` wasn't changed to `%40`, or there are spaces in the password. Create a new App Password and update the line |
| `Mail from must equal authorized user` / `553` | `MAIL_FROM` isn't your Google address or a "Send mail as" alias |
| `ETIMEDOUT` / `ECONNREFUSED` | The server can't reach the mail server. Make sure the line ends with `:465` and starts with `smtps://` |
| `SMTP_URL is not set` warning | The `.env` line is empty or misspelled, or you forgot the `up -d` command |

## Keep emails out of Spam (one-time DNS check)
Your domain already has a DMARC record (`v=DMARC1; p=quarantine`). Emails that fail checks can therefore go to Spam, so make sure Google can sign them:
1. In **admin.google.com → Apps → Google Workspace → Gmail → Authenticate email (DKIM)**, click **Generate new record**, then **Start authentication**.
2. Add the TXT record it shows (name `google._domainkey`) in your DNS. Yours is at **GoDaddy**, where the nameservers point.
3. Make sure your SPF TXT record includes Google: `v=spf1 include:_spf.google.com ~all`.

**Sending limits:** Google Workspace allows about 2,000 emails per day per account, which is plenty for a small host.
