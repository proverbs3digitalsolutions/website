# proverbs3-qa config — BalayHub

## Stage A target — this machine (localhost)
- main_branch: claude/trusting-hopper-lyg8vu   # project rule: the server deploys from this branch; there is no merge to main
- fetch_pull_cmd: git fetch origin claude/trusting-hopper-lyg8vu && git pull origin claude/trusting-hopper-lyg8vu
- local_build_cmd: none (no build step; plain JS)
- local_run_cmd: (setsid nohup <scratchpad>/dev.sh > <scratchpad>/server.log 2>&1 &)
- local_base_url: http://localhost:3000
- local_db_env: DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub (dev database; snapshot taken before the run)
- workdir: /home/user/website/balayhub

## Stage B target — the real live site
- app: BalayHub · live_base_url: https://balayhub.proverbs3digitalsolutions.com · deploy_project: Hostinger VPS

## Between-stage handoff
- stop_local_cmd: pkill -f "node [s]rc/index.js"   # then confirm port 3000 is free
- merge_cmd: none — project rule (BalayHub CLAUDE.md): push to claude/trusting-hopper-lyg8vu; no merge to main
- deploy:
  - platform: vps
  - cmd: the founder runs `cd /opt/balayhub-src/balayhub && ./deploy/update.sh` in the Hostinger terminal (it backs up, pulls, rebuilds and migrates)
  - freshness_check: live site serves the new commit's files (compare a changed public JS file)
  - rollback: docs/DEPLOY-HOSTINGER.md rollback steps (update.sh takes a backup first)
  - rollback_verified: false   # confirm with the founder before the Stage B deploy

## Surfaces → lanes (risk-based: money, access and guest-facing first)
- public · landing, signup, login, forgot/reset, terms, privacy, SEO listing pages, public booking page
- guest · guest stay page, pay page, check-in form, guidebook, quote page, review page
- money · reservations list and detail, payments, charges, refunds, deposits, payment proofs, discount codes
- calendar · calendar, blocks, move, group bookings, daily close
- listings · listings, properties, pricing rules, bulk changes, tags, room types
- inbox · inbox, templates, automations, assign, mentions, inbox settings
- owners · owners, statements, profit and loss, payouts, owner portal
- ops · housekeeping, maintenance, supplies, lost and found, cleaner pay
- rbac · cleaner, staff and manager logins against every route and API
- settings · settings, account, launchpad, gate pass, add-ons, quotes, reviews, guests, reports, help, admin
- longterm · long-term workspace (demo@): dashboard, properties, tenants, rent, expenses, reports
- phone · 390px dark mode across every main page (layout, overflow, tap targets)

## Auth
- Stage A (local): owner stays@balayhub.test, manager mara@, staff sam@, cleaner nena@ (all balayhub.test, password demo-password-1); long-term owner demo@balayhub.test
- Stage B (live): robagascon+test@gmail.com on its own test workspace. Password is NOT in this repo; it must reach the session as an environment secret QA_TEST_PASSWORD. The live site is currently blocked by this environment's network policy.

## Live-site do-not-touch list (Stage B)
- No email, SMS or Messenger to real people (no guest/owner invites to real addresses)
- No payments, refunds, PayMongo checkouts or plan upgrades
- No deleting records, no workspace deletion or data purge
- No changing the test account's password or email

## Data / repro
- test_db_env: TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_<lane letter> (never the dev DB)
- seed_notes: Reyes Staycations (short-term, 3 properties), Santos Family Rentals (long-term)

## Decision record
- path(s): DECISIONS.MD, PRD.MD, APP-FLOW.MD, BACKEND-SCHEMA.MD

## State + logs
- state_file: .claude/proverbs3-qa-state.md
- round_log_dir: docs/qa-rounds/
- round_log_convention: "QA round N — <stage>"

## Loop
- clean_rounds_required: 3
- stop_severity_floor: SEV3
- public_facing: true
- watchdog_cron_min: 15
- compact_between_rounds: true
- closure_docs: true
