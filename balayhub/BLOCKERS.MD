# BLOCKERS

Things only the founder can do or decide before related work can go ahead. Automated runs add items here. The founder clears them by doing the item and ticking it, or by writing the decision in DECISIONS.MD.

Last updated: 2026-10-15 (QA round 13 questions added, two founder items answered; earlier rounds unchanged apart from inline notes)

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
- [ ] **Sign-up and taken emails.** Sign-up says an email is already registered, which tells anyone that address has an account. Keep the friendly message, or use a neutral one? *Default: keep it, as most apps do.* *Round 7: team invites say the same ("This email already has a BalayHub account"), so the same answer covers both (D-83).*

  Asked again in round 4.
- [ ] **Building-wide expenses on statements.** Expenses for the whole building (such as association dues) never reach an owner statement; they only show on your profit and loss as "Whole-property expenses" (renamed from "Not linked to a unit" in round 13). Is that what you want? *Default: keep it (D-44).*
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

## Questions from QA round 3 (2026-10-14)

Each one has the default already applied. None of them stops the work.

- [ ] **Direct-booking channel fees already stored.** A channel fee is what Airbnb or Booking.com keeps. We now stop anyone typing one on a direct booking, and the guest is always asked for the full amount. Some existing direct bookings may already carry a fee. Should we clear them all in one go, or leave them for you to fix one by one? To count them on the server: `SELECT count(*) FROM bookings WHERE channel='direct' AND channel_fee > 0`. *Default: leave the stored numbers alone, ignore them for what the guest owes, and warn on each booking (any Edit save clears it). Profit and loss, owner statements and stay reports keep counting them as a cost until you answer.*
- [ ] **Profit and loss and cancelled stays.** Money you kept from a cancelled stay, and any refund on it, is left out of profit and loss. The tax summary counts both because it follows the money. Should profit and loss count them too, in the month they happened? *Default: leave them out, and the page now says so. Counting them would also change owner statements.*
- [ ] **Guidebook wording before the window opens.** A guest who opens the link more than 14 days before check-in now sees "Your guidebook opens on <date>". Is that the wording you want, or should the guidebook open earlier? *Default: show the opening date; the window stays 14 days before check-in to 2 days after check-out.*
- [ ] **Lowest price above the usual price.** If the lowest price is higher than the usual nightly price, every night costs at least the lowest price. Should Add listing and Edit listing ask first? *Default: yes, they ask "Save anyway?" and Cancel keeps the form open.*
- [ ] **Duplicate-email sign-up message.** Still open from round 1 ("Sign-up and taken emails" above, asked again). Keep the friendly "already registered" message, or use a neutral one? *Default: keep it.* *Round 7: team invites show the same friendly message, so one answer covers both.*
- [ ] **Maintenance estimate of 0.** Is 0 a useful answer ("no cost expected"), or should it be refused like a 0 price? *Default: allowed; blank means no estimate yet.*
- [ ] **Typed markup in names.** If someone types something like `<b>` into a tenant or vendor name, we store it as typed and show it as plain text. Fine, or should we remove such characters when saving? *Default: stored as typed and shown as text.*
- [ ] **Free stays on manual reservations.** A group room can no longer be saved at 0, but a single manual reservation still can (for example a free stay for family). Keep that? *Default: keep it for single reservations.*
- [ ] **Taglish check.** These drafts need a Taglish speaker to read them: "Nagamit o nadagdag", the guidebook line, and the 8-character password message. *Default: keep the drafts.*
- [x] **Blanking a channel fee on Edit.** On a channel booking, clearing the fee box does nothing; the host must type 0. Logged for round 4. *Default: leave as is.* Resolved by D-79 (2026-10-14): a blank fee now means 0 on every booking, and a save that changes nothing says so.

## Questions from QA round 4 (2026-10-14)

Each one has the default already applied. None of them stops the work.

- [ ] **Staff and property money details.** Staff can't see rent, deposits, the admin email or gate-pass notes on screen, but the app still sends those numbers to a staff member's browser when they open a property. Should we stop sending them to staff? *Default: no change for now. It matches the written access rules, and nothing on the staff screen shows them.* *2026-10-15 (D-88): staff no longer receive the admin email or the gate-pass settings; staff do see a listing's cancellation policy and deposit %. Rent and deposit amounts on a property are unchanged.*
- [ ] **Staff invited with no property.** You can invite a staff member without giving them a property. They then see an empty workspace until you assign one. Should staff need a property too, as managers and cleaners do? *Default: allowed, as today.*
- [ ] **Taglish descriptions for add-ons.** Add-on names can have a Taglish version, but their descriptions can't, so guests reading in Taglish see the description in English. Do you want a Taglish description box? *Default: no. Descriptions show as you typed them.*
- [ ] **Inserting a template under a typed message.** When you pick a template after typing a reply, the template now goes below your text, and a typed subject is kept. Would you rather we ask first? *Default: add below.*
- [ ] **Blank number of days on automatic messages.** A "days before check-in" message with the days box left empty used to save as 0 days. Now the app asks for a number. A blank send time still means 10:00. OK? *Default: a number is required for the before and after messages; a blank time is 10:00.*
- [x] **Two cleaning tasks for the same unit on the same day.** That can be right (two short stays on one day, or a redo), but it could also mean paying a cleaner twice. Should the app warn you? *Default: allowed with no warning, as today. Each task's pay shows separately before it is marked paid.* Answered 2026-10-14 (D-80): allowed, with no warning, as today.
- [ ] **Alerts for monthly rentals.** All of today's alerts are about short stays: bookings, guest messages, check-in forms and cleaning. A monthly-rental workspace now sees a note that alerts aren't available yet, instead of a list it can't use. Which alerts would help most for monthly rentals: rent due, rent overdue, lease ending, or maintenance requests? *Default: none until you choose.*
- [ ] **Prices and groups on past dates.** You can set a nightly price on a night that has already passed, and create a group booking for past dates. That helps record what already happened. Keep it, or warn first? *Default: allowed, as today.*
- [ ] **Reopening a finished clean.** Reopening clears the clean's pay, and finishing it again works the pay out from the cleaner's rate, so a special amount you typed would need typing again. The app now asks before reopening. Would you rather keep a typed amount? *Default: ask first, then clear the pay (the same as a failed inspection).* *The gap with a newer clean was fixed in round 6 (D-82).*
- [x] **Wide tables on phones.** On a phone, a wide table or the calendar now fades its cut-off edge to show that more columns are there. The fade is subtle, and it can read as text running off the edge. Keep the fade, add a small "Swipe for more" hint above wide tables on phones, or show those tables as stacked cards on phones? The stacked cards are the biggest change, because each table needs its own layout. The hint is the smallest change that makes the cue clearer. *Default: keep the fade, as it is now.* Answered 2026-10-14 (D-80): stacked cards on phones. Each wide table shows one card per row, with a label and value pair for each column. Tablet and computer keep the table. The calendar is not part of this answer, so it keeps its edge fade as built. Built in QA round 5.
- [ ] **Taglish check.** These new lines need a Taglish speaker to read them: the guest-limit message on the booking page, the "Quantity must be a whole number" message for cleaners, and the Terms message on the Get started sign-up. *Default: keep the drafts.*

## Questions from QA round 5 (2026-10-14)

Each one has the default already applied. None of them stops the work.

- [ ] **Balance after refunding an overpayment.** When a guest overpays and you refund the extra, the Payment card still shows a negative balance (for example -₱250.00), because refunds are kept as a separate record and don't change the balance. Should the card show ₱0.00 once the extra is refunded? *Default: no change (D-34, D-77). The payment dialog now says "Nothing more is owed on this booking." when nothing is left, instead of "overpaid by ₱0.00".*
- [ ] **Reopening a finished clean.** Reopening a finished clean now marks the unit as dirty, the same as a failed inspection. OK? One gap is left for the next round: if a newer clean of the same unit is already done, reopening an older one still marks the unit dirty. *Default: dirty.* *The gap with a newer clean was fixed in round 6 (D-82).*
- [ ] **Future dates on expenses.** Adding an expense refused a future date, but correcting one allowed it. Both now refuse a future date, the same as payments. OK, or do you want to log bills ahead of time? *Default: refused on both.*
- [ ] **Staff and money on reservations versus groups.** Staff can see the total, balance and payments on a reservation, but group bookings hide money from staff. Which do you want for staff: see money on both, or on neither? *Default: as today (reservations show it, groups don't), because both are written that way.*
- [ ] **Refunds in the daily close.** The daily close counts payments that came in that day, but not refunds you paid out. Should it list refunds paid out too? *Default: payments only, as D-72 says.*
- [ ] **A lease starting tomorrow.** A unit with a signed lease that starts tomorrow already counts as occupied on the dashboard and property lists. Should it count only from the lease start date? *Default: as today (a signed lease counts as occupied).*
- [ ] **The channel-fee saving estimate.** On a direct booking the card says how much you saved compared with a 15% channel fee. It now uses the same amount as "You keep", the stay's total after any channel fee. Would you rather it used the room price only? *Default: the same amount as "You keep".*
- [ ] **Recurring jobs with a past due date.** Saving a recurring maintenance job with a next due date in the past now asks first, because a request opens at the next hourly check. OK? *Default: ask first.*
- [ ] **Payout to an owner who owes you.** When a month's statement says the owner owes you (for example the flat fee was more than the stays earned), you can no longer record a payout for that month. A month with nothing due still lets you pay an advance after a warning. OK? *Default: refused when the owner owes.*
- [ ] **Duplicate add-ons in your live workspace.** Before the name rule existed, the same add-on could be created more than once. Guests now see each name once, but the extra copies are still on your Add-ons page. Nothing in the live database was changed in this round. To see whether your live workspace has any, run this read-only check in the Hostinger browser terminal. It only reads:

    ```
    cd /opt/balayhub-src/balayhub
    C="docker compose -f docker-compose.prod.yml --env-file deploy/.env"
    $C exec -T db psql -U balayhub balayhub -c "select organization_id, lower(btrim(name)), count(*) from listing_addons where active group by 1,2 having count(*) > 1;"
    ```

    If it lists anything, archive the extra copies on the Add-ons page and keep the oldest. *Default: no data change from us.*
- [ ] **Contact email on the plan card.** The plan card says "contact us" with no link when `SALES_CONTACT_EMAIL` isn't set. Please check it is set in `deploy/.env` on the server. *Default: none; a check only.*
- [ ] **Taglish check.** These new lines need a Taglish speaker to read them: on Get started, "Maglagay ng tamang numero ng telepono." (the mobile number message) and "Pangalan ng negosyo" (business name); on the pay page, "Mga patunay na naghihintay sa host" (proofs waiting for the host), "Idagdag ang screenshot", "Bawiin ito" (take it back) and the two proof-limit sentences; for cleaners, "Bayad na." (paid), "Hindi puwedeng negatibo ang dami." (quantity can't be negative), and the found-item labels "Hawak pa" (held), "Naibalik" (returned) and "Itinapon" (disposed). The owner's note on a paid clean is in English only. *Default: keep the drafts.*
- [ ] **The pay list for other roles.** The "My pay" page is for cleaners only, and everyone else is sent home. The data behind that page still answers any signed-in person, but only with that person's own cleans, and it shows pay only on cleans that are theirs. Nobody can read another person's pay that way. Should the data also be closed to everyone except cleaners? *Default: leave it as it is, since nothing leaks. If you say yes, we close it in the next round.* *Superseded by D-82 (2026-10-14): the data is now closed to everyone but cleaners, because it still carried other cleaners' names.*

## Questions from QA round 6 (2026-10-14)

Each one has the default already applied. None of them stops the work.

- [ ] **What staff may see about guests.** Staff now see only a guest's name: on the Guests page, on a guest's page, on a reservation and as a group's lead guest. They no longer see VIP or Do not rebook, how many times someone stayed, their stay dates, their ratings or the review card. Before this, staff saw all of that except contact details and total spent. Is name-only right, or should staff see some of it again (for example Do not rebook, so they are warned at check-in)? *Default: name only.*
- [ ] **Staff and guest reviews.** Staff can still open the Reviews page and read guests' full reviews (names and comments), as the access table and D-62 allow. Now that staff see only names everywhere else, should we keep that, or make reviews owners and managers only so the rules line up? *Default: keep (staff can read reviews in their properties).*
- [ ] **Removing a listing's page address.** Once a listing has its own page address, the form won't save it blank, so you can't remove it, only change it. Should blank be allowed? (The listing page link would stop working.) *Default: unchanged (an address can be changed, not removed).* *Raised again in round 7; still open.*
- [ ] **Discount ladder.** A listing can no longer save a weekly discount above its 14+ night discount, or a 14+ night discount above its monthly one, because only one discount applies and a longer stay would end up dearer per night. OK? *Default: refused. An old listing that already has an inverted ladder is left as it is until someone edits a discount.*
- [ ] **Payouts need a month.** Every payout now has to say which statement month it pays (2000 to 2100). The screens already did this; only a direct call could leave it out. OK? *Default: month required.*
- [ ] **Taglish check.** These new lines need a Taglish speaker to read them: for cleaners, "Pumili ng litrato" (choose a photo), "Wala pang litrato.", "Mag-upload ng JPG, PNG o WEBP na litrato, hanggang 10 MB.", "Mga inspection", "Pasado", "Hindi pasado"; on Get started, "Panandaliang stays (Airbnb, staycation)", the language switch name "Wika: TL", and the taken-email message; on the quote page, "ang host" and the loading line; on the booking page, the new not-found sentence and the guest-limit message. *Default: keep the drafts.*
- [ ] **The staff stay counts promise in the app guide.** APP-FLOW used to say staff see "names and stay counts". Staff now see names only, so that promise was removed from APP-FLOW (line 108 is annotated). Nothing to do unless you want stay counts back (see the first question). *Default: promise removed.*
- [ ] **Two read-only checks on the live database (we change nothing).** Run each and tell us what it lists.
  (a) Notification settings saved with an empty property list before the fix (these accounts stay muted until they save again):

    ```
    cd /opt/balayhub-src/balayhub
    C="docker compose -f docker-compose.prod.yml --env-file deploy/.env"
    $C exec -T db psql -U balayhub balayhub -c "select count(*) from users where notify_prefs->'property_ids' = '[]'::jsonb;"
    ```

  (b) Listings whose discounts were saved with a longer stay cheaper than a shorter one (an inverted ladder):

    ```
    $C exec -T db psql -U balayhub balayhub -c "select unit_id, weekly_discount, fortnight_discount, monthly_discount from units where (weekly_discount > 0 and fortnight_discount > 0 and weekly_discount > fortnight_discount) or (fortnight_discount > 0 and monthly_discount > 0 and fortnight_discount > monthly_discount) or (weekly_discount > 0 and monthly_discount > 0 and weekly_discount > monthly_discount);"
    ```

  *If either lists rows, tell us and we plan a data fix. Default: no data change from us. The names above come from the code (`users.notify_prefs`, and `units.weekly_discount`, `fortnight_discount`, `monthly_discount`); if psql still complains, send us the message.*
- [ ] **Staff and booking group notes.** Staff can read the notes on a booking group. The access table says nothing about group notes. Keep it, or hide the notes from staff? Same-name guests also show staff nothing to tell them apart, which is what names-only means. *Default: staff can read group notes (unchanged).* *Raised again in round 7 (access lane); default unchanged, still open. Round 7 asked the same thing about group notes for staff.*
- [ ] **My pay: cleans paid to someone else.** Today the My pay page hides those rows, then says "No cleans finished this month" even when the cleaner finished some. The access table (6.1) says to show them without a name or money. *Default for round 7: show them as "Paid to another cleaner" rows with no amount, following the table.* *Done in round 7 with the default (D-83).*

## Questions from QA round 7 (2026-10-14)

Each one has the default already applied. None of them stops the work. Earlier open questions are not repeated here.

- [ ] **Editing past nights.** On the calendar you can still set a price or a block on a night that has passed. That's useful for fixing records, but it changes history that reports read from. Keep it, or lock nights before today? *Default: keep (allowed).*
- [ ] **Payments above the balance.** Recording a payment bigger than what's owed now asks first, and the receipt goes out only after you say yes. The guest's overpayment is still allowed, so you can refund it. OK? *Default: ask first.*
- [ ] **Outside cleaner with a team member's name.** You can no longer type a team member's name as an outside cleaner, for a rate or a job. Pick them from the team list instead. OK? *Default: refused.* We also ask for a read-only check on the live database (we change nothing): it lists rates typed with a team member's name before this fix. If it lists rows, tell us and we plan a data fix. *Default: no data change from us.*

    ```
    cd /opt/balayhub-src/balayhub
    C="docker compose -f docker-compose.prod.yml --env-file deploy/.env"
    $C exec -T db psql -U balayhub balayhub -c "select r.organization_id, r.assignee_name from cleaner_rates r join users u on u.organization_id = r.organization_id and lower(trim(u.full_name)) = lower(trim(r.assignee_name)) where r.assignee_name is not null;"
    ```

    The names above come from the code (`cleaner_rates.assignee_name`, `users.full_name`, `users.organization_id`; checked against `db/migrations/001`, `004` and `030`). Cleaning tasks have the same kind of column (`cleaning_tasks.assignee_name`), so jobs typed with a team member's name before the fix can also exist; if you want those listed too, say so and we send the matching line.
- [ ] **The owner's email shown to the team.** Every team member sees the workspace owner's name and email on their account page, so they know whom to ask. Keep it, or show the name only? *Default: keep.*
- [ ] **Both workspaces need a nightly rate on every new unit.** In a Both workspace (short-term and monthly), Add unit now asks for a nightly rate even when the unit will only be rented monthly, because the same screen serves both. Keep that, or let monthly-only units skip it? *Default: required.*
- [ ] **Managers archiving listings.** Managers can archive and restore listings in the properties assigned to them, from the property page, as the access table says. The Listings page's Archive button stays yours only. OK, or should archiving be owner-only everywhere? *Default: managers may, from the property page.*
- [ ] **Booking source and staff.** Staff no longer receive where a booking came from (the source), because the access table hides booking sources from staff. Should staff see it on a reservation? *Default: hidden.*
- [ ] **"1,5" in amounts.** Not a question unless you disagree: "1,5" is refused everywhere, as decided in round 4 (D-79). One line in the app guide said otherwise; it's corrected. *Default: refused.*
- [ ] **Taglish check.** New lines for a Taglish speaker to read: "Hindi valid ang check-in link na ito. Humingi ng bagong link sa host mo.", "Hindi valid ang review link na ito.", "Hindi available ang guidebook para sa stay na ito. Humingi ng bagong link sa host mo.", "Hindi available ang quote na ito.", two booking page sentences (the not-found cards), and on My pay "Bayad sa ibang tagalinis" (paid to another cleaner). *Default: keep the drafts.*

## Questions from QA round 8 (2026-10-14)

Each has the default already applied. Earlier open questions are not repeated here.

- [ ] **Get started on a shared computer.** If two people signed up on the same browser, the second one used to get the first one's business name and mobile number. Now the answers are kept only for the email they were typed for, the setup page shows them for you to check before creating the workspace, and logging out deletes them. OK? *Default: as described.* On the live site, a workspace created this way could carry someone else's business name; if you have had sign-ups from shared computers, check the workspace names in Admin. *Default: no data change from us.*
- [ ] **Recording rent from one month's row.** Record on a month's row now starts at that month's remaining amount, not the tenant's whole balance. The dialog still shows the whole balance. OK? *Default: the row's amount.*
- [ ] **Cancel on a half-filled form.** Pressing Cancel now throws away what you typed in that form. Closing it any other way, or losing your session, still keeps it for next time. OK? *Default: Cancel discards.*
- [ ] **Share link source.** The share link box used to start on Facebook, so a link you copied without choosing was counted as Facebook in your reports. It now starts on Other. Would you rather it make you choose first? *Default: Other.*
- [ ] **Your details on a quote.** When a quote already has the guest's name, email and mobile, the quote page shows them filled in and lets the guest correct them. The app guide said it would hide them; the guide is corrected. OK? *Default: shown and editable.*
- [ ] **Check-in form privacy box.** A guest editing their check-in form has to tick the privacy box again each time they save. Keep that, or remember the tick? *Default: tick each time.*
- [ ] **Wi-Fi password on the listing form.** The door code has a Show/Hide button but the Wi-Fi password is a plain box on the owner's listing form. Hide it too? *Default: keep as is.*
- [ ] **Payouts to an owner with no units.** An owner with no units has no statement, so a payout to them isn't checked against what they owe. Keep that, or refuse payouts to owners with no units? *Default: keep.*
- [ ] **Damage reports on a unit.** Staff can report damage from a cleaning job or a stay, but no longer on a unit with neither (the access table says owners and managers). OK? *Default: owners and managers only.*
- [ ] **Dates from 2000 to 2100.** Every date you type must now be between 2000 and 2100, so a slip like 1900 can't land in your books. The report and list filters still accept 1900 to 2200 for now. OK? *Default: yes.*
- [ ] **Taglish check.** New or changed lines for a Taglish speaker to read: "Pangmatagalang upa (buwanan)" (Long-term rentals on Get started), "Pakitingnan ang mga naka-highlight." (Please check the highlighted fields; on the booking page, quote page, check-in form and Get started), "Alisin ang guest {n}" (Remove guest on the check-in form), "Mag-book nang direkta" (Book direct, the booking page tab title), "Hindi muna tumatanggap ng online booking ang lugar na ito ngayon." (This place isn't taking online bookings right now.), "Ilagay ang bilang ng guests para makita ang kabuuan." (Enter the number of guests to see the total.), and "Ngayon" on the cleaner calendar (an existing word, now used). *Default: keep the drafts.*
- [ ] **"Workspace name" in the activity log.** A rename of the workspace reads "Changed: Workspace name". Fine, or call it "Business name" to match the sign-up form? *Default: Workspace name.*
- [ ] **Archiving an add-on twice.** Archiving an add-on that is already archived writes a second activity row. Keep, or write nothing the second time? *Default: leave as is (rare).*
- [ ] **"Write a reply first." on help tickets.** The empty-reply message on the help page reads "Write a reply first." Fine? *Default: keep.*
- [ ] **Admin support reply.** A platform admin's support reply still confirms with a toast, not a line on the page. Keep? *Default: keep.*
- [ ] **"Tell your manager." for staff.** Only cleaners are told to tell their manager when a supply was out of stock; staff are not (they are the manager's team, not a field crew). OK? *Default: cleaners only.*
- [ ] **Quote that can't be priced.** When the price preview fails, the quote form keeps the sentence "Couldn't price these dates" and hides the rate-card button. Keep, or reword? *Default: keep.*
- [ ] **Rent payments are used oldest month first.** A payment that covers more than one month is applied to the oldest unpaid month first. Is that how you want it? *Default: oldest first.*
  - *Round 9: the payment form now says which month the money goes to first.*
- [ ] **"Settings → Team" arrow.** A few help lines write the path with an arrow ("Settings → Team", "Settings → Plan & billing"). Keep the arrow, or write "Settings, then Team"? *Default: keep the arrow.*

## Questions from QA round 9 (2026-10-14)

Each has the default already applied. Earlier open questions are not repeated here. Background: D-85 (the alpha is for owners of 1 to 3 properties; the Guesty ideas are parked).

- [ ] **Starter plan and the 1 to 3 unit alpha (alpha-relevant).** The Starter plan allows 2 listings, but the alpha target is owners with 1 to 3 properties, so a host with 3 units has to choose Growth. Should Starter allow 3? *Default: no pricing change.*
- [ ] **Real test-mode payments before the alpha (founder action, blocks the alpha).** We can't reach PayMongo from here, so a paid booking, a paid balance and a paid quote have never been checked end to end. Before inviting alpha hosts, please make one test-mode payment of each kind on the live site with a test key. *Default: blocked until you do it.* This is in addition to the PayMongo item under "Launch setup", and the live-site QA items (including the `QA_TEST_PASSWORD` secret and network access) stay open above.
- [ ] **Refunds past the overpayment.** If a guest paid ₱1,000 for a ₱600 stay and you refund the whole ₱1,000, BalayHub now asks first and then shows ₱600 owed again (it used to say nothing was owed). Should a refund on a stay that isn't cancelled stop at the overpayment instead? *Default: allowed up to what was paid, after the question.*
- [ ] **The balance counts refunds everywhere.** The guest's pay link, receipts and messages now show the balance after refunds, so after a refund like the one above the pay link asks for ₱600 again. OK? *Default: yes.* One side effect: a receipt's "balance after" counts every refund on the stay, even one recorded after that payment.
- [ ] **Rent goes to the oldest month first (kept).** The round 8 question stays open. The Record form now says which month the money goes to. *Default: oldest first.*
- [ ] **Photo previews on cleaning jobs.** Photos now show a small thumbnail instead of a file icon. OK? *Default: thumbnails shown.*
- [ ] **Cleans you do yourself.** If you clean a unit yourself and have no pay rate for you, Cleaner pay shows "Done by you, no pay" and does not count it as unpaid. A clean that has a rate stays unpaid with its amount. OK? *Default: yes.* Related: the By cleaner card says "All paid" when a cleaner's only cleans are your own; should it say "Done by you" instead? *Default: leave "All paid".*
- [ ] **Booking page price line.** After a guest picks dates, the line shows this stay's average nightly price before any discount, instead of the lowest "from" price. Show the price after the discount instead? *Default: before discount.*
- [ ] **Two decimals on the public stay pages.** Every peso amount now shows two decimals, so the search-result "From" price on the public stay page reads "From ₱2,500.00". Keep, or make an exception for that one line? *Default: keep two decimals.*
- [ ] **Walk-in bookings.** New reservation now asks where the guest booked (Facebook, Messenger and the others). There is no Walk-in choice; walk-ins are saved as Other. Add Walk-in? *Default: Other.*
- [ ] **Moving a unit to another owner.** Ticking a unit that already has an owner now asks before it moves, because that owner's statements and payouts follow the unit. OK? *Default: ask first.*
- [ ] **Automatic messages start off.** A new automatic message is saved turned off so you can check the wording before guests get it. OK? *Default: off.*
- [ ] **Check-in with empty or missing guests.** The check-in form refuses an empty guest row, and when fewer names than booked guests are given the host sees "booked for N" in the note. OK? *Default: yes.*
- [ ] **Management fee for a new owner.** The fee box now starts empty instead of 20%, so you type it. OK? *Default: empty.*
- [ ] **Add listing in sections.** Add listing shows the basics first, with Price extras, Guest info, Booking page and payments, and Booking rules in sections you open. OK? *Default: yes.*
- [ ] **Spaces in discount codes.** A code typed with spaces is refused with a suggestion using dashes, so guests type exactly what you share. OK? *Default: refuse and suggest.*
- [ ] **Grouped menu.** The menu is now in groups (Every day, Money, More tools, Setup), with More tools closed until you open it. OK? *Default: yes.*
- [ ] **Taglish check (needs a native speaker).** New Taglish lines to read: the check-in empty guest row message, "Piliin" (Select), "Idagdag ang napili sa bill ko" (Add selected to my bill), the "1–3 unit" card on Get started, "Unang pangalan" (First name), and the new booking-page price line. *Default: keep the drafts.* The exact strings are in `public/js/views/checkin.js`, `pay.js`, `book.js`, `launchpad.js` and `landing.js`.

## Questions from QA round 10 (2026-10-15)

- [ ] **Production admin list (deploy check, founder action).** On the live server, open `deploy/.env` and check that `PLATFORM_ADMIN_EMAILS` lists only BalayHub staff. Anyone listed sees every workspace and every support ticket. *Default: blocked until checked.*
- [ ] **Lease over booked stays.** A lease is now refused while short stays are booked inside it, and the message names the stays. Should it instead offer to cancel those stays? *Default: refuse and name the stays.*
- [ ] **Cleaner pay and Unit owners in the menu.** They now sit under More tools for every host. Show them in Money once a host has a cleaner or a unit owner? *Default: More tools.*
- [ ] **Rent receipts.** Printing a rent payment now gives an acknowledgement (not a BIR official receipt) with no receipt number. Should rent receipts get AR numbers like stay payments? *Default: no number.*
- [ ] **Price format on guest pages.** Amounts owed show two decimals; advertised prices show whole pesos when exact, and calendar tiles show ₱2.8k with the exact price in the tile's name. OK? *Default: yes.*
- [ ] **Taglish "Guests".** The Taglish pages keep the word "Guests" and use "Petsa" for Dates. OK, or use "Bisita"? *Default: Guests.*
- [ ] **Inbound email before the alpha (founder action).** Guest replies reach the app only after the one-time inbound email setup on the server. Set it up before inviting alpha hosts so messaging is a full loop. *Default: the inbox banner tells hosts replies go to their email.*

## Questions from QA round 11 (2026-10-15)

Every question has its default already applied in the app; nothing waits on the answer.

- [ ] **Rent roll.** An occupied unit now shows the tenant's lease rent, and the Rent roll adds up lease rents (the list rent shows beside it when different). OK, or should it show the list rent? *Default: lease rent.*
- [ ] **Refund that leaves money owed.** Any refund that leaves the guest owing now asks first, even when the guest had paid exactly. OK? *Default: ask.*
- [ ] **Deposit returned before check-out.** Returning a deposit before the stay ends now asks first, but is allowed. Should it be refused instead? *Default: ask, allow.*
- [ ] **Cleaner rate ceiling.** A cleaner rate is now at most ₱10,000 per clean or ₱1,000 per hour, and the pay typed on one clean is at most ₱10,000. Different limits? *Default: those limits.*
- [ ] **Rates saved before the ceiling.** A rate saved above the new ceiling still prices a clean when it is marked done. Should those be cut down or refused at that point? *Default: leave finishing a clean alone; the owner corrects the rate.*
- [ ] **Hourly pay can pass ₱10,000.** A rate of ₱1,000 an hour over a long job works out to as much as ₱12,000 (12 hours is the cap), above the ₱10,000 limit on one clean. Cap the worked-out pay too? *Default: leave it.*
- [ ] **Reopening a closed day.** Closing a day is one click and now has "Reopen day". Owners can reopen any close; managers only a close covering just their own properties. OK? *Default: yes.*
- [ ] **Housekeeping on the phone's bottom bar.** Housekeeping is under More on phones. Should it take a bottom-bar slot, or should owners pick the four items? *Default: unchanged.*
- [ ] **Taglish check (native speaker).** Please check: "Tuluyan" for the room charge; "{pct}% na deposit"; "Hindi available ang online payment ngayon. Subukan ulit pagkalipas ng ilang minuto, o kontakin ang host."; "Ibinalik sa iyo, idinagdag ulit sa babayaran"; the Check your email and verify screens; and the other new sentences (the guest-count message and the not-available listing message). *Default: as written.*
- [ ] **Rent acknowledgement balance.** Should a printed rent acknowledgement show the tenant's balance after the payment? It needs a rule for advance credit and months paid oldest first. Decide together with rent receipt numbers (round 10 question 4). *Default: no balance line.*

## Questions from QA round 12 (2026-10-15)

Every question has its default already applied in the app; nothing waits on the answer.

- [ ] **Owner portal language.** Should the owner portal be Taglish? Today it is English throughout, because a mixed Taglish heading over an English body was worse. The two strings that were translated are English again. *Default: English.*
- [ ] **Who finished a clean.** A cleaner's task list still sends `completed_by_name`, so a cleaner can see who finished another cleaner's job. May they? Or should a cleaner see only "Done by you" and "Done"? *Default: unchanged (names shown).*
- [ ] **Bulk price changes.** Saving one nightly rate above ₱50,000 now asks "Save anyway?". "Change prices by %" can push many nights over that in one go and does not ask yet. Should it ask when any result is above ₱50,000? *Default: no question on bulk percent changes.*
- [ ] **High nightly rate.** Is ₱50,000 the right limit for the "Save anyway?" question, or should it refuse above some amount instead? *Default: ask above ₱50,000, refuse nothing.* *Round 13 applied the same limit to add-ons and booking totals; see round 13 question 3.*
- [ ] **Host app language.** A host who signs up in Tagalog gets an English app (only guest pages and the verify screens switch). Should the host app offer Tagalog? *Default: English.* *Raised again in round 13 (#36, #37).*
- [ ] **Starter plan and a 3-unit host.** Starter allows 2 short-term listings, so a host with 3 units needs Growth (₱999 a month). Is that right for the alpha? *Default: unchanged (D-03).* *Raised again in round 13 (#36, #37).*
- [ ] **Automatic messages start off.** The page now says the four starter messages are ready but off. Should they start on instead? *Default: off, with the line.*
- [ ] **Rent filters for small hosts.** With 3 or fewer units, Month and Property sit under More filters. OK? *Default: yes.*
- [ ] **Supply row buttons.** Each supply shows Add stock and Record use. Count, History, Edit and Archive are under More. OK? *Default: yes.*
- [ ] **Where did they book?** A direct booking still asks where the guest found you, now marked optional. Fold it into Booked through instead? *Default: keep, optional.*
- [ ] **Record payment method.** A direct booking's payment now starts with no method and the host must pick one. Or remember the last method used? *Default: no method.*
- [ ] **Taglish check (native speaker).** Please check: "Code ng pinto"; "Kasama: ..." and the price-rule names; "Hanggang 50 na guests lang ang puwede."; and the verify screens (Check your email, "I've verified, continue", Resend). The setup screens and the owner portal are English for now. *Default: as written.*

## Questions from QA round 13 (2026-10-15)

Every question has its default already applied in the app; nothing waits on the answer. The two earlier questions about "Host app language" and "Starter plan" (round 12) were raised again this round and stay open.

- [ ] **Gate pass contact.** The gate pass shows the owner's account email to the building admin and guard. Keep that, or add a contact field (name, phone, email) to the gate pass settings? *Default: account email.*
- [ ] **Owner email shared by two owners.** Saving an owner whose email another owner already uses now asks "Save anyway?" instead of refusing. Should it be refused? *Default: ask.*
- [ ] **High amounts.** Add-on prices above ₱50,000, and booking totals that work out above ₱50,000 a night, now ask "Save anyway?" (so do seasons with a fixed price above that). Are those the right limits? *Default: ₱50,000.*
- [ ] **Publish and send in one step.** An owner statement is published, sent and the payout recorded as three separate steps. Add a "Publish and send" button? *Default: separate.*
- [ ] **Paying after check-out.** A guest who still owes money after the stay cannot pay online; the page tells them to contact the host. Is that intended? *Default: unchanged.*
- [ ] **Small-host folds.** With 3 or fewer listings the Calendar folds its filters and colour legend; an owner's Home with no reservations leads with "Connect your calendar" and folds the charts under "Trends and revenue". OK? *Default: yes.*
- [ ] **First-run card for managers and staff.** The "Connect your calendar" card shows to owners only. Should a manager or staff member with no reservations see it too? It needs a reservation count on a Home endpoint. *Default: owners only.*
- [ ] **Identical seasons saved at the same instant.** Two identical seasons sent in the same moment can both save (no database lock yet). Add a unique index? *Default: leave it; it needs a deliberate double-click.*
- [ ] **Theme buttons and small landing buttons.** The theme buttons measure about 33px high (D-88: pass the 24px minimum); the public landing page's small buttons and links are still under 44px on phones. Bring them to 44px? *Default: leave as is.*

### Answered by the founder (round 13)

- [x] **Sidebar jumps to the top on every click.** Reported by the founder 2026-10-15. Fixed in round 13: the menu is kept when you change page, its scroll position and the More tools fold stay where they were, and a new page starts at the top once. Confirmed in the re-verify at 1280x900 and 1366x768 (D-89).
- [x] **A top bar like Guesty's.** Founder decision 2026-10-15: global search in the middle; bookmarks, "+" add new, notifications, help and the profile on the upper right. Recorded as D-90 (overrides D-85's "Guesty features out of scope" for this item only); planned for round 14 (PRD).
