# Deploy BalayHub on a Hostinger VPS: step-by-step guide

At the end you'll have BalayHub running at your own address, such as **https://app.proverbs3digitalsolutions.com**, with HTTPS, automatic restarts and daily backups.

**Time needed:** about 45–60 minutes the first time.
**You will type commands** into a terminal. Copy and paste them exactly. A line starting with `#` is an explanation, not a command.

**How it runs on the server**
```
Internet ──HTTPS──▶ Caddy (free SSL certificate) ──▶ BalayHub app ──▶ PostgreSQL database
                    └──────────── all inside Docker on your Hostinger VPS ────────────┘
```

---

## Before you start: checklist
- [ ] A Hostinger **VPS** plan. **KVM 1** (4 GB RAM) is enough for a pilot; **KVM 2** gives more room. (Web or shared hosting won't work: BalayHub needs a VPS.)
- [ ] A domain you control. You'll use a subdomain like `app.proverbs3digitalsolutions.com`.
- [ ] An email mailbox for sending emails, such as `no-reply@proverbs3digitalsolutions.com`. You can create one in Hostinger (Step 7).
- [ ] Access to the GitHub repository `proverbs3digitalsolutions/website`.

---

## Step 1: Set up the VPS in Hostinger
1. Log in to **hPanel** → **VPS** → choose your VPS → **Setup** (or **OS & Panel → Operating System** if it's already set up).
2. Choose the operating system **Ubuntu 24.04** (the plain one, without a control panel).
3. Set a strong **root password** and save it in your password manager.
4. Finish the setup and wait a few minutes.
5. On the VPS **Overview** page, copy the **IP address** (for example `203.0.113.25`). You'll need it in the next steps.

> If you're asked about a "malware scanner" or "firewall," you can enable them. Step 3 opens the ports BalayHub needs.

## Step 2: Point your subdomain to the VPS
If your domain is managed in Hostinger:
1. hPanel → **Domains** → choose `proverbs3digitalsolutions.com` → **DNS / Nameservers** → **DNS records**.
2. Add a record:
   - **Type:** `A`
   - **Name:** `app`
   - **Points to:** your VPS IP address from Step 1
   - **TTL:** `300` (or the lowest offered)
3. Save.

If the domain is managed elsewhere (Cloudflare, GoDaddy and so on), add the same **A record** there. On **Cloudflare**, set the cloud icon to **"DNS only" (grey)** until the site works.

> DNS can take from 5 minutes to a few hours. To check it, open https://dnschecker.org, enter `app.proverbs3digitalsolutions.com`, and confirm it shows your VPS IP.

## Step 3: Connect to the VPS
Pick one:
- **Easiest:** hPanel → VPS → **Browser terminal** (opens a terminal in your browser).
- **From your computer:**
  - **Windows:** open **PowerShell**.
  - **Mac:** open **Terminal**.
  - Then type the following, replacing the IP with yours:
    ```bash
    ssh root@203.0.113.25
    ```
    Type `yes` if asked, then enter the root password. Nothing appears while you type the password; that's normal.

Now update the server and turn on the firewall:
```bash
apt update && apt upgrade -y
apt install -y git ufw
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```
> If hPanel also has a **Firewall** for your VPS, add rules allowing **TCP 22, 80 and 443**.

## Step 4: Install Docker
```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```
Both commands should print a version number.

## Step 5: Download BalayHub from GitHub
The repository is private, so the server needs read-only permission. A **deploy key** gives exactly that.

**5a. Create a key on the server:**
```bash
ssh-keygen -t ed25519 -C "balayhub-vps" -f ~/.ssh/github_balayhub -N ""
cat ~/.ssh/github_balayhub.pub
```
Copy the whole line it prints (it starts with `ssh-ed25519`).

**5b. Add it to GitHub:**
1. Open https://github.com/proverbs3digitalsolutions/website → **Settings** → **Deploy keys** → **Add deploy key**.
2. **Title:** `Hostinger VPS`. **Key:** paste the line. Leave **"Allow write access" unchecked**.
3. Click **Add key**.

**5c. Tell the server to use the key, then download the code:**
```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_balayhub
  IdentitiesOnly yes
EOF

cd /opt
git clone git@github.com:proverbs3digitalsolutions/website.git balayhub-src
cd /opt/balayhub-src
git checkout claude/trusting-hopper-lyg8vu     # skip this line once the branch is merged into main
cd balayhub
```
> Type `yes` if asked "Are you sure you want to continue connecting".

## Step 6: Create your settings file
```bash
cp deploy/.env.production.example deploy/.env
openssl rand -hex 24          # prints a random password: copy it for the next step
nano deploy/.env
```
In the editor, change these lines:

| Setting | What to enter |
|---|---|
| `DOMAIN` | `app.proverbs3digitalsolutions.com` (no `https://`) |
| `DB_PASSWORD` | the random password you just generated |
| `SMTP_URL` | see Step 7 (you can leave it blank for now) |
| `MAIL_FROM` | `BalayHub <no-reply@proverbs3digitalsolutions.com>` |
| `REQUIRE_EMAIL_VERIFICATION` | `true` once email works. Set it to `false` **only** if you're starting before email is set up (Step 7) |

Save and exit: press **Ctrl + O**, then **Enter**, then **Ctrl + X**.

> **Keep `deploy/.env` private.** It contains passwords and is never uploaded to GitHub.

## Step 7: Set up email (verification and password reset)
BalayHub emails people to verify accounts, reset passwords and accept team invitations.

1. hPanel → **Emails** → choose your domain → **Create email account**, for example `no-reply@proverbs3digitalsolutions.com`, with a strong password.
2. Build your `SMTP_URL`:
   ```
   smtps://EMAIL:PASSWORD@smtp.hostinger.com:465
   ```
   - In the email address, replace `@` with `%40`, so `no-reply@proverbs3digitalsolutions.com` becomes `no-reply%40proverbs3digitalsolutions.com`.
   - If the password contains special characters, encode them too:

     | Character | `@` | `:` | `/` | `#` | `?` | `%` | `&` | `+` | space |
     |---|---|---|---|---|---|---|---|---|---|
     | Write as | `%40` | `%3A` | `%2F` | `%23` | `%3F` | `%25` | `%26` | `%2B` | `%20` |

   - Example:
     ```
     SMTP_URL=smtps://no-reply%40proverbs3digitalsolutions.com:MyPass%23123@smtp.hostinger.com:465
     ```
3. Put that line in `deploy/.env` (`nano deploy/.env`), and set `REQUIRE_EMAIL_VERIFICATION=true`.

> Hostinger's SMTP server is `smtp.hostinger.com`, port `465` (SSL). If your email is hosted somewhere else, such as Google Workspace, use that provider's SMTP details instead.

## Step 8: Start BalayHub
Make sure Step 2's DNS check shows your VPS IP first. Caddy needs it to get the HTTPS certificate.
```bash
cd /opt/balayhub-src/balayhub
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
```
The first start takes 2–5 minutes. Then check:
```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env ps
docker compose -f docker-compose.prod.yml --env-file deploy/.env logs app --tail 20
```
All three services (`db`, `app`, `caddy`) should say **Up**. The app log should end with `BalayHub running at https://app.proverbs3digitalsolutions.com`.

🎉 Open **https://app.proverbs3digitalsolutions.com**. You should see the BalayHub welcome screen with a padlock in the address bar.

## Step 9: Create your account
1. Click **Get Started** and sign up with your email.
2. Open the verification email, click the link, then create your workspace.
3. Add your first property and units. You're live.

> Didn't get the email? Check spam, then see **Troubleshooting** below.

## Step 10: Turn on daily backups
BalayHub's backup script saves the database and uploaded files to `/root/balayhub-backups` and keeps 14 days.
```bash
cd /opt/balayhub-src/balayhub
./deploy/backup.sh                     # run once to test; it should say "Backup saved"
crontab -e                             # choose "nano" if asked
```
Add this line at the bottom (it runs every day at 2:00 AM Manila time), then save and exit:
```
0 18 * * * cd /opt/balayhub-src/balayhub && ./deploy/backup.sh >> /var/log/balayhub-backup.log 2>&1
```
> The server clock is in UTC, so 18:00 UTC = 2:00 AM in the Philippines.

**Extra safety (recommended):**
- In hPanel → VPS → **Backups & Monitoring**, enable or schedule **snapshots**.
- Copy the files in `/root/balayhub-backups` to another place now and then, such as your computer or Google Drive. A backup that only lives on the same server won't help if that server is lost.

---

## Everyday tasks

**Update BalayHub to the latest version:**
```bash
cd /opt/balayhub-src/balayhub
./deploy/update.sh
```
This makes a backup first, downloads the new code, and restarts the app. Database changes are applied automatically.

**See if it's running / view errors:**
```bash
cd /opt/balayhub-src/balayhub
docker compose -f docker-compose.prod.yml --env-file deploy/.env ps
docker compose -f docker-compose.prod.yml --env-file deploy/.env logs app --tail 50
```

**Restart:**
```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env restart app
```

**Restore a backup** (replace the file names with the backup you want):
```bash
cd /opt/balayhub-src/balayhub
C="docker compose -f docker-compose.prod.yml --env-file deploy/.env"
gunzip -c /root/balayhub-backups/db-2026-10-10-0200.sql.gz | $C exec -T db psql -q -U balayhub balayhub
$C exec -T app sh -c 'rm -rf /data/storage/* && tar -xzf - -C /data' < /root/balayhub-backups/uploads-2026-10-10-0200.tar.gz
$C restart app
```

---

## Troubleshooting

| Problem | What to check |
|---|---|
| Browser says "site can't be reached" | DNS not ready yet (check dnschecker.org). Firewall must allow 80 and 443 (Step 3, and hPanel firewall). Run `... ps` and confirm `caddy` is Up |
| Certificate or padlock error | DNS must point to this VPS **before** starting. On Cloudflare use "DNS only". Then run `docker compose -f docker-compose.prod.yml --env-file deploy/.env restart caddy` and check `... logs caddy` |
| No verification email arrives | Check spam. Check `SMTP_URL` encoding (Step 7). Run `... logs app` and look for mail errors. Temporarily set `REQUIRE_EMAIL_VERIFICATION=false`, then run `up -d` again so you can log in while fixing email |
| `Set DB_PASSWORD` / `Set DOMAIN` error | `deploy/.env` is missing or those lines are empty (Step 6) |
| `Permission denied (publickey)` when cloning | The deploy key wasn't added on GitHub, or the `~/.ssh/config` lines are missing (Step 5) |
| Changed `deploy/.env` but nothing happened | Apply it with `docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d` |
| Server feels slow | Run `docker stats`. Upgrade to KVM 2 in hPanel if memory stays above 90% |

**Important: never change `DB_PASSWORD` after the first start.** The database keeps the original password. Changing it requires extra steps, so ask for help first.

## Security notes
- Use a long root password. Better still, set up SSH keys and turn off password login once you're comfortable.
- Keep the server updated monthly: `apt update && apt upgrade -y`, then `reboot` if asked.
- Only the ports for SSH (22) and the website (80/443) are open. The database isn't reachable from the internet.
- Before inviting real tenants' data, finish the items in `docs/PRIVACY-CHECKLIST.md`.
