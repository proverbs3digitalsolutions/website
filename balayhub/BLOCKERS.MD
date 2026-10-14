# BLOCKERS

Things only the founder can do or decide before related work can go ahead. Automated runs add items here. The founder clears them by doing the item and ticking it, or by writing the decision in DECISIONS.MD.

Last updated: 2026-10-14 (QA round 6 questions added; round 5 question 13 (my pay) decided by D-82)

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

  Asked again in round 4.
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

## Questions from QA round 3 (2026-10-14)

Each one has the default already applied. None of them stops the work.

- [ ] **Direct-booking channel fees already stored.** A channel fee is what Airbnb or Booking.com keeps. We now stop anyone typing one on a direct booking, and the guest is always asked for the full amount. Some existing direct bookings may already carry a fee. Should we clear them all in one go, or leave them for you to fix one by one? To count them on the server: `SELECT count(*) FROM bookings WHERE channel='direct' AND channel_fee > 0`. *Default: leave the stored numbers alone, ignore them for what the guest owes, and warn on each booking (any Edit save clears it). Profit and loss, owner statements and stay reports keep counting them as a cost until you answer.*
- [ ] **Profit and loss and cancelled stays.** Money you kept from a cancelled stay, and any refund on it, is left out of profit and loss. The tax summary counts both because it follows the money. Should profit and loss count them too, in the month they happened? *Default: leave them out, and the page now says so. Counting them would also change owner statements.*
- [ ] **Guidebook wording before the window opens.** A guest who opens the link more than 14 days before check-in now sees "Your guidebook opens on <date>". Is that the wording you want, or should the guidebook open earlier? *Default: show the opening date; the window stays 14 days before check-in to 2 days after check-out.*
- [ ] **Lowest price above the usual price.** If the lowest price is higher than the usual nightly price, every night costs at least the lowest price. Should Add listing and Edit listing ask first? *Default: yes, they ask "Save anyway?" and Cancel keeps the form open.*
- [ ] **Duplicate-email sign-up message.** Still open from round 1 ("Sign-up and taken emails" above, asked again). Keep the friendly "already registered" message, or use a neutral one? *Default: keep it.*
- [ ] **Maintenance estimate of 0.** Is 0 a useful answer ("no cost expected"), or should it be refused like a 0 price? *Default: allowed; blank means no estimate yet.*
- [ ] **Typed markup in names.** If someone types something like `<b>` into a tenant or vendor name, we store it as typed and show it as plain text. Fine, or should we remove such characters when saving? *Default: stored as typed and shown as text.*
- [ ] **Free stays on manual reservations.** A group room can no longer be saved at 0, but a single manual reservation still can (for example a free stay for family). Keep that? *Default: keep it for single reservations.*
- [ ] **Taglish check.** These drafts need a Taglish speaker to read them: "Nagamit o nadagdag", the guidebook line, and the 8-character password message. *Default: keep the drafts.*
- [x] **Blanking a channel fee on Edit.** On a channel booking, clearing the fee box does nothing; the host must type 0. Logged for round 4. *Default: leave as is.* Resolved by D-79 (2026-10-14): a blank fee now means 0 on every booking, and a save that changes nothing says so.

## Questions from QA round 4 (2026-10-14)

Each one has the default already applied. None of them stops the work.

- [ ] **Staff and property money details.** Staff can't see rent, deposits, the admin email or gate-pass notes on screen, but the app still sends those numbers to a staff member's browser when they open a property. Should we stop sending them to staff? *Default: no change for now. It matches the written access rules, and nothing on the staff screen shows them.*
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
- [ ] **Removing a listing's page address.** Once a listing has its own page address, the form won't save it blank, so you can't remove it, only change it. Should blank be allowed? (The listing page link would stop working.) *Default: unchanged (an address can be changed, not removed).*
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
- [ ] **Staff and booking group notes.** Staff can read the notes on a booking group. The access table says nothing about group notes. Keep it, or hide the notes from staff? Same-name guests also show staff nothing to tell them apart, which is what names-only means. *Default: staff can read group notes (unchanged).*
- [ ] **My pay: cleans paid to someone else.** Today the My pay page hides those rows, then says "No cleans finished this month" even when the cleaner finished some. The access table (6.1) says to show them without a name or money. *Default for round 7: show them as "Paid to another cleaner" rows with no amount, following the table.*
