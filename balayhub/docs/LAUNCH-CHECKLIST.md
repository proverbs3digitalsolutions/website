# Before you sell: launch checklist

## 1. Daily backups (10 minutes, once)
BalayHub's backup script saves the database and uploaded files and keeps the last 14 days. Schedule it to run every night.

In the Hostinger **Web console**:
```bash
cd /opt/balayhub-src/balayhub
./deploy/backup.sh
```
It should end with **Backup saved to /root/balayhub-backups (…)**. Then schedule it:
```bash
crontab -e
```
If asked, choose **nano** (usually `1`). Go to the bottom and add this line (it runs at 2:00 AM Philippine time every day):
```
0 18 * * * cd /opt/balayhub-src/balayhub && ./deploy/backup.sh >> /var/log/balayhub-backup.log 2>&1
```
Save with **Ctrl+O**, **Enter**, **Ctrl+X**. Check it's there with `crontab -l`. The next morning, check `ls -lh /root/balayhub-backups`.

**Also turn on Hostinger snapshots:** hPanel → **VPS** → your server → **Snapshots & backups** → enable **weekly backups** (or create a manual snapshot before big changes). This saves the whole server in Hostinger's own storage.

**Keep a copy off the server** once a month: download the newest `db-…sql.gz` and `uploads-…tar.gz` from `/root/balayhub-backups` (for example with an SFTP app such as FileZilla, using your VPS login), and keep them on Google Drive. A backup that lives only on the same server doesn't help if the server is lost.

## 2. Know when the site is down (5 minutes, free)
BalayHub can't email you if it's completely down, so use a free outside monitor:
1. Create a free account at **https://uptimerobot.com/**.
2. **Add New Monitor** → type **HTTP(s)**:
   - URL: `https://balayhub.proverbs3digitalsolutions.com/api/health`
   - Interval: 5 minutes
   - Alert contact: your email (and the mobile app if you want push notifications)
3. Save. You'll get an email within minutes if the site or its database goes down, and another when it's back.

## 3. Error alerts (automatic)
With `PLATFORM_ADMIN_EMAILS` set in `deploy/.env`, BalayHub emails you when:
- the server hits an unexpected error, or
- a background job (calendar sync, guest messages, payments check, …) fails 3 times in a row.

You get at most one email per kind every 30 minutes. If you get one, send me the subject and the log lines it mentions, with any passwords and keys covered.

## 4. Legal pages
- **Terms of Service** (`/#/terms`) and **Privacy Notice** (`/#/privacy`) are drafts. Fill in your contact email and have a Philippine lawyer or data privacy professional review them before you take payments.
- New sign-ups agree to both, and BalayHub records the version they agreed to.

## 5. Customer data rights (built in)
Owners can, in **Settings → Your data**:
- **Download all data** as a file.
- **Delete workspace**. It becomes view-only for 14 days (it can be cancelled), then everything is permanently deleted, including team accounts and files. This covers Data Privacy Act requests for access and erasure.

Everyone can **change their password** in **Settings**. Other devices are signed out, and an email confirms the change.
