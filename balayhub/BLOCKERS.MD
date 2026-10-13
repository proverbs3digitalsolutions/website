# BLOCKERS

Things only the founder can do or decide before related work can go ahead. Automated runs add items here. The founder clears them by doing the item and ticking it, or by writing the decision in DECISIONS.MD.

Last updated: 2026-10-13

## Security — do first

- [ ] **Rotate the Gmail app password.** The current one has appeared in screenshots more than once.
  1. Go to myaccount.google.com/apppasswords (admin@proverbs3digitalsolutions.com).
  2. Delete the old password and create a new one.
  3. Paste the new one into both `SMTP_URL` and `IMAP_URL` in `deploy/.env`.
  4. Run `./deploy/update.sh`.
- [ ] **Decide whether to change the database password.** It was also visible in a screenshot. The database isn't reachable from the internet, so the risk is lower. Changing it on a running database needs guided steps: don't just edit `DB_PASSWORD`.
- [ ] **Blur secrets and guest details in any screenshot** you share from now on.

## Launch setup (server)

- [ ] **Backups.** Confirm the daily backup runs (`deploy/backup.sh`) and turn on Hostinger VPS snapshots.
- [ ] **Uptime monitor.** Point UptimeRobot (free) at `https://balayhub.proverbs3digitalsolutions.com/api/health`.
- [ ] **PayMongo.**
  - Add BalayHub's own PayMongo keys (for plan payments) to `deploy/.env`.
  - Do one test booking with test keys, then switch to live keys.
- [ ] **Confirm plan prices** (₱499 / ₱999 / ₱1,799) and the 14-day trial before launch (D-03).
- [ ] **Run `./deploy/update.sh`** after each round of changes so the live site gets them.

## Optional features waiting on the founder

- [ ] **BalayHub assistant (chatbot).** Parked by the founder on 2026-10-13. To turn it on:
  1. Create a key at console.anthropic.com and set a spend limit.
  2. Add `ANTHROPIC_API_KEY=...` to `deploy/.env`.
  3. Run `docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --force-recreate app`.
  4. Check that `/api/assistant` shows `{"enabled":true}`.

  The same key also turns on AI reply drafts in the Inbox.
- [ ] **SMS reminders (next feature).** Before building, the founder picks:
  - the SMS provider (for example Semaphore, about ₱0.50 per text) and creates the account
  - which reminders to send by default
  - a monthly SMS limit per workspace, and whether SMS costs are included in plans or charged extra
- [ ] **Facebook Messenger inbox (last).** Needs a Meta developer app and Meta's app review, which can take weeks.

## Process decisions

- [ ] **Branches.** Keep deploying from `claude/trusting-hopper-lyg8vu`, or merge it into `main` and have the server pull `main`?
- [ ] **Test tenant for QA.** Create a dedicated test workspace and test login on the live site, so `/proverbs3-qa` and `/proverbs3-e2e` can run without touching real data.
- [ ] **Review the eight canon docs** (this file plus PRD, TRD, APP-FLOW, DESIGN-BRIEF, BACKEND-SCHEMA, IMPLEMENTATION-PLAN, DECISIONS). Correct anything that isn't what you want BalayHub to be.
