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

## Access decisions (found while writing BACKEND-SCHEMA)

- [x] **Managers and workspace-wide settings.** Decided 2026-10-13: owner-only (D-28). Managers limited to some properties can still create discount codes, edit message templates and switch the template language for the whole workspace. Is that OK, or should these be owner-only?
- [x] **Cleaning task assignment.** Decided 2026-10-13: block (D-29). A cleaning task can be assigned to a team member who isn't assigned to that property, so they can't open it. Should BalayHub block this or warn?
- [ ] **Encryption keys.** Make sure `DATA_ENCRYPTION_KEY` and the VAPID keys are set in `deploy/.env`. Otherwise BalayHub generates them inside the uploads folder, and that folder is backed up together with the data they protect.

- [ ] **Gate pass: include guest IDs by default?** The "Include guest ID photos" setting is off by default. Since 2026-10-13 it also hides IDs on the gate pass link, so a building admin sees no IDs unless the host turns it on for that building. If most of your condos require IDs, we could make it on by default.

## Decisions from the competitor research (2026-10-13)

- [ ] **What to build next.** Phase 1 (money done right: itemised bills, payment proofs, cancellation policies, host net) or SMS reminders first? SMS needs an outside SMS provider. Recommendation: Phase 1 first.
- [ ] **Tax practitioner check before BIR features.** Confirm for Filipino STR hosts:
  - the percentage tax rate vs VAT and the 8% option
  - the invoice wording and numbering under the EOPT Act
  - the monthly and quarterly filing rules

  Until confirmed, BalayHub won't generate "BIR-compliant" invoices.
- [ ] **Owner fees.** Which fee rule do most of your owners use: % of gross, % of net after channel fees, or a flat monthly fee? Do owners need a login, or is an emailed PDF enough?
- [ ] **Free plan.** Offer a permanent free plan for 1 unit, as Hospitable and Zeevou do, to win the largest group of hosts? Today there's a 14-day trial.
- [ ] **Smarter pricing scope.** Simple rules (gap nights, last-minute, events) are planned. Should BalayHub also adjust prices automatically from your own occupancy? This is not AI, but it is more complex.

## Process decisions

- [ ] **Branches.** Keep deploying from `claude/trusting-hopper-lyg8vu`, or merge it into `main` and have the server pull `main`?
- [ ] **Test tenant for QA.** Create a dedicated test workspace and test login on the live site, so `/proverbs3-qa` and `/proverbs3-e2e` can run without touching real data.
- [ ] **Review the eight canon docs** (this file plus PRD, TRD, APP-FLOW, DESIGN-BRIEF, BACKEND-SCHEMA, IMPLEMENTATION-PLAN, DECISIONS). Correct anything that isn't what you want BalayHub to be.
