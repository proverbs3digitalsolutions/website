# Turn on "Continue with Google"

The Google button appears on the login and sign-up pages only after you create a free **Google sign-in key** (an OAuth client) and add it to your server. This takes about 15 minutes, once.

What users get:
- **New users:** one click to create an account. Their email is already verified by Google, so there's no verification email.
- **Existing users:** if their BalayHub email matches their Google email, Google sign-in is linked to the same account.
- **Invited team members** can accept the invite with Google, as long as it's the same email the invite was sent to.

## Step 1: Create a Google Cloud project
1. Go to **https://console.cloud.google.com/** and sign in. Use **admin@proverbs3digitalsolutions.com** so the company owns it.
2. At the top, click the **project picker → New project**.
3. Name it **BalayHub** and click **Create**. Make sure **BalayHub** is selected at the top afterwards.

## Step 2: Set up the consent screen (what users see when they click the button)
1. In the menu, go to **APIs & Services → OAuth consent screen**. Newer accounts call it **Google Auth Platform → Branding**.
2. Click **Get started** (or **Configure**) and fill in:
   - **App name:** `BalayHub`
   - **User support email:** your email
   - **Audience / User type:** **External**
   - **Contact email:** your email
3. Under **Branding** (optional but recommended):
   - **App logo:** upload your logo
   - **App domain / homepage:** `https://balayhub.proverbs3digitalsolutions.com`
   - **Privacy policy link:** `https://balayhub.proverbs3digitalsolutions.com/#/privacy`
   - **Authorized domains:** add `proverbs3digitalsolutions.com`
4. Under **Data access / Scopes**, the defaults (`email`, `profile`, `openid`) are all BalayHub needs. Don't add others.
5. Under **Audience**, click **Publish app** so anyone with a Google account can sign in. With these basic scopes, Google doesn't require a review.

## Step 3: Create the sign-in key
1. Go to **APIs & Services → Credentials** (or **Google Auth Platform → Clients**) → **Create credentials → OAuth client ID**.
2. **Application type:** **Web application**. **Name:** `BalayHub web`.
3. **Authorized JavaScript origins:** add `https://balayhub.proverbs3digitalsolutions.com`
4. **Authorized redirect URIs:** add exactly this, character for character:
   ```
   https://balayhub.proverbs3digitalsolutions.com/api/auth/google/callback
   ```
5. Click **Create**. Google shows a **Client ID** (ends in `.apps.googleusercontent.com`) and a **Client secret**. Copy both.

> 🔒 The **client secret** is a password. Don't paste it in chats or screenshots; it goes only into the server file below.

## Step 4: Add the key to your server
In the Hostinger **Web console**:
```bash
cd /opt/balayhub-src/balayhub
./deploy/update.sh
nano deploy/.env
```
Add these two lines anywhere, or fill them in if they're already there:
```
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```
Save with **Ctrl+O**, **Enter**, **Ctrl+X**, then restart:
```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d
```

## Step 5: Test
Open **https://balayhub.proverbs3digitalsolutions.com/#/login** in a private window. You should see **Log in with Google** under the form. Click it, choose your Google account, and you'll land in BalayHub.

| Problem | Fix |
|---|---|
| No Google button | The two `.env` lines are empty or misspelled, or you skipped the restart command |
| Google says **"redirect_uri_mismatch"** | The redirect URI in Step 3.4 doesn't match exactly. Check `https`, no trailing slash, and `/api/auth/google/callback` |
| Google says **"Access blocked: app not published"** or only test users can sign in | Click **Publish app** (Step 2.5) |
| BalayHub says *"We couldn't reach Google"* | Check the client secret, then run `docker compose -f docker-compose.prod.yml --env-file deploy/.env logs app --tail 20 \| grep google` |
