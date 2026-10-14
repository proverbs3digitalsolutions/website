# BLOCKERS

Things only the founder can do or decide before related work can go ahead. Automated runs add items here. The founder clears them by doing the item and ticking it, or by writing the decision in DECISIONS.MD.

Last updated: 2026-10-14 (QA round 2 questions added)

## Security — do first

- [x] **Rotate the Gmail app password.** Done by the founder 2026-10-13. The current one has appeared in screenshots more than once.
  1. Go to myaccount.google.com/apppasswords (admin@proverbs3digitalsolutions.com).
  2. Delete the old password and create a new one.
  3. Paste the new one into both `SMTP_URL` and `IMAP_URL` in `deploy/.env`.
  4. Run `./deploy/update.sh`.
- [ ] **Decide whether to change the database password.** It was also visible in a screenshot. The database isn't reachable from the internet, so the risk is lower. Changing it on a running database needs guided steps: don't just edit `DB_PASSWORD`.
- [ ] **Blur secrets and guest details in any screenshot** you share from now on.

## Launch setup (server)

- [ ] **Backups.** Confirm the daily backup runs (`deploy/backup.sh`) and turn on Hostinger VPS snapshots.
- [ ] **Uptime monitor.** Point UptimeRobot (free) at `https://balayhub.proverbs3digitalsolutions.com/api/health`.
- [x] **PayMongo.** BalayHub's own keys (plan payments) added by the founder 2026-10-13. Still to do: a host-side test booking (Settings → Direct booking page), then live keys.
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

- [x] **What to build next.** Decided 2026-10-13: Phase 1 first, then Phase 2. Phase 1 (money done right: itemised bills, payment proofs, cancellation policies, host net) or SMS reminders first? SMS needs an outside SMS provider. Recommendation: Phase 1 first.
- [ ] **Tax practitioner check before BIR features.** Confirm for Filipino STR hosts:
  - the percentage tax rate vs VAT and the 8% option
  - the invoice wording and numbering under the EOPT Act
  - the monthly and quarterly filing rules

  Until confirmed, BalayHub won't generate "BIR-compliant" invoices.
- [x] **Owner fees.** Decided 2026-10-13: keep D-37 as is. Phase 2 offers all three fee types and both an owner login and an emailed statement, so each owner can be set up their own way. Original question: confirm D-37: should extras go to the owner's gross, should refunds reduce the owner's statement, and should the management fee be charged after refunds? Which fee rule do most of your owners use: % of gross, % of net after channel fees, or a flat monthly fee? Do owners need a login, or is an emailed PDF enough?
- [ ] **Free plan.** Offer a permanent free plan for 1 unit, as Hospitable and Zeevou do, to win the largest group of hosts? Today there's a 14-day trial.
- [ ] **Smarter pricing scope.** Simple rules (gap nights, last-minute, events) are planned. Should BalayHub also adjust prices automatically from your own occupancy? This is not AI, but it is more complex.

## Process decisions

- [ ] **Branches.** Keep deploying from `claude/trusting-hopper-lyg8vu`, or merge it into `main` and have the server pull `main`?
- [ ] **Test tenant for QA.** Create a dedicated test workspace and test login on the live site, so `/proverbs3-qa` and `/proverbs3-e2e` can run without touching real data.
- [ ] **Review the eight canon docs** (this file plus PRD, TRD, APP-FLOW, DESIGN-BRIEF, BACKEND-SCHEMA, IMPLEMENTATION-PLAN, DECISIONS). Correct anything that isn't what you want BalayHub to be.

## Questions from QA round 1 (2026-10-13)

Each one has the default we will use if you don't answer. None of them stops the work.

- [ ] **Terms and Privacy drafts.** The Terms and Privacy pages still say "Draft pending review by a Philippine lawyer". Has the legal review been done, so the notice can come off? *Default: keep the notice until you confirm.*
- [ ] **Contact email on the live server.** Is a contact email set on the live server, so "Message us" on the home page has somewhere to go? Without one, the public "Help & support" links need a login, so a visitor who can't log in has no way to reach you. *Default (updated in round 2): with no contact email, logged-out help links go to sign-up with "Create your account and ask us in Help & support", so a visitor is never sent to a login wall.*
- [ ] **Weak passwords.** Passwords only need 8 characters, so "password" works. Should we also refuse the most common passwords? *Default: add a short block list of common passwords (small and easy to undo).*
- [ ] **Starter plan card.** The landing page card says "1 to 3 units" but the Starter plan allows 2 listings. Should it say "1 to 2 units"? *Default: change the copy to "1 to 2 units". Applied in round 2.*
- [ ] **Sign-up and taken emails.** Sign-up says an email is already registered, which tells anyone that address has an account. Keep the friendly message, or use a neutral one? *Default: keep it, as most apps do.*
- [ ] **Building-wide expenses on statements.** Expenses for the whole building (such as association dues) never reach an owner statement; they only show on your profit and loss as "Not linked to a unit". Is that what you want? *Default: keep it (D-44).*
- [ ] **Cleaner pay in the owner portal.** The owner portal's recent activity lists cleaner pay as an expense, but statements never deduct it. Hide it from owners, or deduct it on statements? *Default: hide it from the owner portal activity.*
- [ ] **Bottom tab bar on tablets.** The phone bottom tab bar also shows at tablet width (768px). Is that intended? *Default: keep it.*
- [ ] **Live Reyes manual-payment instructions.** During QA the Reyes manual-payment instructions were cleared on the local test copy only (no live data was touched). If the live Reyes workspace has instructions, please check they are still there. *Default: nothing to do unless you see them missing.*
- [ ] **Landing page description wording.** Check the short description search engines show for the home page (the page's meta description) and tell us if you want different words. *Default: keep the current wording.*
- [ ] **Share image (optional).** Add a 1200 by 630 picture that shows when the site link is shared in chat apps or on social media. *Default: keep the square app icon as the share picture for now.*

## Questions from QA round 2 (2026-10-14)

Each one has the default already applied. None of them stops the work.

- [ ] **Live-site QA stage is blocked.** The live-site sweep can't start until the network allowlist lets the test machine reach the live site and the `QA_TEST_PASSWORD` secret is set for the dedicated test account. *Default: keep sweeping the local copy only.*
- [ ] **Staff and "Your pay for this clean".** Should staff see the cleaner pay on a cleaning job? Today they do when pay is set. *Default: leave it as is.*
- [ ] **Blank deposit percentage on a listing.** Leaving it blank leaves the saved value unchanged rather than clearing it. Keep that? *Default: yes, unchanged.*
- [ ] **Cleaner's out-of-stock note.** When a cleaner's supply use skips an item, the note disappears after 4 seconds. Is that long enough? *Default: 4 seconds.*
- [ ] **Taglish check.** The Taglish drafts for the new supply note and the privacy line need a Taglish speaker to read them. *Default: keep the drafts.*
- [ ] **Audit history without ids.** History no longer shows which booking or unit an entry refers to, because raw ids are hidden. Is that OK, or should it show a name instead? *Default: hidden.*
- [ ] **Add-on limits.** Is a maximum quantity of 1 one per stay or one each time the guest buys? *Default: per stay.*
- [ ] **Archived tenants who still owe rent.** Should the amount keep counting on the dashboard? *Default: yes, labelled "(archived)", and archiving warns.*
- [ ] **Two "net" numbers.** The stay report net ignores refunds; profit and loss subtracts them. *Default: keep both, label the stay report "Net (before refunds)".*
- [ ] **Send-later time in the past.** *Default: it asks "Send it now?".*
- [ ] **Rent payment far above the balance.** *Default: it asks first.*
- [ ] **Bulk price cuts below your lowest price.** *Default: allowed, with a warning in the preview.*
- [ ] **PayMongo key check.** We only check the key looks right. *Default: keep it; a wrong key shows at the first guest payment.*
- [ ] **Managers without properties.** *Default: at least one property is required.*
- [ ] **Public contact email.** Publish one so visitors can ask before signing up? *Default: sign-up page says to ask in Help & support after creating an account.*
- [ ] **Confirmation codes for unit owners.** *Default: no; the owner portal never sends them.*
- [ ] **Reassigning a finished clean.** Pay and inspection score move to the new person. *Default: yes (D-52).*
- [ ] **Logo colour.** The light green "HUB" is hard to read on white. *Default: keep it (logos are exempt).*
- [ ] **Sharing booking links.** `#/book/...` links show the home card; `/stay/...` links show the listing. *Default: no change; recommend sharing the `/stay/` address.*
- [ ] **Check-in form after arrival.** *Default: editable until check-out; only the heading changes.*
