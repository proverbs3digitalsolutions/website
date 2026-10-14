# IMPLEMENTATION-PLAN

What gets built, in what order. Below the plan:

- **Build record:** what each round shipped.
- **Session notes:** dated, append-only.

BalayHub is an existing, deployed app, so "Sprint 0" (mockup) and "Sprint 1" (provisioning) from the Proverbs3 template are already behind us. The plan starts from where the app is today.

Last updated: 2026-10-13

## Plan

### Now — before launch (founder items, see BLOCKERS.MD)

1. Rotate the exposed Gmail app password, and decide on the database password.
2. Backups and Hostinger snapshots, uptime monitor, PayMongo test booking, confirm prices.
3. Founder reviews the eight canon docs and corrects anything that's wrong.

### Next — Sprint A: SMS reminders to guests

**Goal:** guests get texts they actually read, for check-in, check-out, balance due and booking confirmation.

| # | Atom | Done looks like |
|---|---|---|
| A1 | SMS provider adapter (provider chosen in BLOCKERS), configured by env var and a test mode | Sending in tests writes to an outbox. A missing key turns SMS off with a clear message. |
| A2 | Workspace SMS settings: on/off per reminder type, English or Taglish, monthly limit | Owners and managers can change them. Staff can't. |
| A3 | Scheduler sends due reminders, at most once per stay per type, and only to guests with a mobile number | No duplicates after a restart. Cancelled stays are skipped. |
| A4 | SMS log on the reservation, plus a usage count against the monthly limit | Each text shows its time, type and status. Sending stops at the limit and warns the owner. |
| A5 | Phone number normalising (09xx → +639xx) and opt-out ("STOP") handling if the provider supports it | Invalid numbers are flagged, not sent. |
| A6 | Tests, a browser check, and doc updates (PRD, TRD, APP-FLOW, BACKEND-SCHEMA, DECISIONS) | `npm test` passes. The docs match the code. |

Before starting, run `/proverbs3-dfss` analysis on this feature so the requirements (CTQs) are written into DECISIONS.MD and the atoms above can be checked against them.

### Small fixes found while writing these docs (do alongside Sprint A)

- **Starter plan:** show an "upgrade for AI drafts" hint. The server already says so, but the app ignores it.
- **Google sign-in:** check that a brand-new Google sign-up lands on workspace setup and not the landing page. Needs a browser check.
- **Launchpad footer:** point "contact support" to Help & support.
- **Trial banner:** show it only in the last few days, not the whole trial.
- **Dead code:** remove the unused `welcomeView`.
- **Old docs:** update `docs/ARCHITECTURE.md`, `docs/PROJECT-PLAN.md` ("Deferred" list) and `docs/SHORT-TERM-GUIDE.md` (the Launchpad replaced the Home checklist). Align README on 1–10 units and Node 22.
- **Design polish:** fix the dark-mode contrast and hard-coded colour list at the end of DESIGN-BRIEF.MD (soft-green text pairs, login caption, modal background, printing in dark mode, channel colour drift, small tap targets).

### Security and privacy fixes found while writing BACKEND-SCHEMA (do before or with Sprint A)

- ✅ 2026-10-13: Staff no longer receive the guest's private check-in link (it exposed guest phone and email). Covered by a test.
- ✅ 2026-10-13: Gate pass link hides guest ID photos when "Include guest ID photos" is off. The setting now covers both the email and the link, and applies to passes already sent.
- ✅ 2026-10-13: An hourly clean-up job deletes expired or idle sessions and old one-time sign-in tokens.
- ✅ 2026-10-13: The workspace export now includes support messages (without internal staff notes), ticket events and consent records.
- Open: when a stay moves to a unit in another property, its open cleaning task keeps its assignee, who may not be able to see the new property. The fix is to clear the assignee in that case.
- **Encryption key backups:** keep the encryption key out of the uploads backup by always setting DATA_ENCRYPTION_KEY and the VAPID keys in `deploy/.env`. The founder action is in BLOCKERS.
- **Lower priority:**
  - Store guest link tokens hashed.
  - Tighten the file path check.
  - Pass ANTHROPIC_BASE_URL through compose only if ever needed.

### Roadmap from the competitor research (2026-10-13)

Full reasoning is in `docs/research/00-SUMMARY.md`. Everything here is built inside BalayHub, with no integrations and no AI. Each phase still needs to be broken into atoms (and checked with `/proverbs3-dfss`) before it is built.

| Phase | What | Priority |
|---|---|---|
| 1. Money done right (✅ built 2026-10-13, except BIR invoices) | Itemised stay bill with extra charges and pay links; payment proof upload and bank transfer; cancellation policy presets and refund log; payment schedules and reminders; host net per booking; BIR-ready invoices and monthly tax summary (after a tax check) | Must |
| 2. Owners and co-hosts (✅ built 2026-10-13, spec: docs/specs/PHASE-2-OWNERS.md, decisions D-39 to D-45) | Owner portal login (statements, bookings, payouts, operations feed, own date blocks); fee models (gross %, net %, flat); expenses with receipts; review-then-send statements with PDF; payout record; repairs reserve; per-unit P&L; monthly emailed report | Must |
| 3. Operations (✅ built 2026-10-13, spec: docs/specs/PHASE-3-OPERATIONS.md, decisions D-48 to D-55) | Cleaner-only access (no money); cleaner calendar; status board with clean, dirty and inspected; inspections with scores; damage reports linked to deposits; cleaner pay and paid marker; supplies par levels; lost and found; work orders and recurring tasks for stays | Must / Should |
| 4. Guest experience and direct booking (✅ built 2026-10-13, spec: docs/specs/PHASE-4-GUESTS.md, decisions D-57 to D-64) | Guidebook (English and Taglish) and a timed Wi-Fi and door-code template; house rules acceptance; paid add-ons; quote-and-pay links and share links with source tags; private feedback; returning-guest codes; unpaid-booking follow-up; search-friendly listing pages | Should |
| 5. Pricing rules and team (✅ built 2026-10-13, spec: docs/specs/PHASE-5-PRICING-TEAM.md, decisions D-66 to D-74) | Gap nights, last-minute and far-out rules, events, PH holiday auto-fill, bulk rate and block changes, price preview; booking activity log, conversation assignment, @mentions, notification rules, unit tags; group bookings, room types, drag to another unit, daily close; sync-health alerts | Should / Could |

The order of SMS reminders (Sprint A, which needs an SMS provider) against Phase 1 is a founder decision (see BLOCKERS). The recommendation is Phase 1 first.

### Later

- **Sprint B: Facebook Messenger inbox.** Page messages appear in the Inbox next to email, with replies sent from BalayHub. Needs a Meta app and app review (BLOCKERS).
- **Candidate improvements**, not yet agreed:
  - booking page upgrades (gallery, map, reviews, share link)
  - smarter reports (month-to-month and year-to-year, best and worst listings)
  - recurring expenses
- **Quality passes:**
  - `/proverbs3-e2e` (journeys per role) and `/proverbs3-qa` (full click-through) on the live site, once a test workspace exists (BLOCKERS)

## Build record

| Date | What shipped |
|---|---|
| 2026-10-10 | MVP for long-term rentals: properties, units, tenants, leases, rent, payments, expenses, maintenance, reports. Hostinger deployment. Review fixes and the first QA report. |
| 2026-10-12 | Short-term module: listings, reservations, guests, multi-calendar, rates and blocks, iCal sync, Home overview. Inbox with templates, automatic messages and AI drafts. Housekeeping. Receipts. Plans, trial, demo, platform admin. Landing page. Google sign-in. Email setup. |
| 2026-10-13 (Phase 1) | Money done right: extra charges with an itemised bill and receipts; GCash, Maya and bank payment proofs that the host confirms or rejects, with a "Payments to check" alert on Home; manual payment settings; cancellation policy presets with suggested refunds, a refund log protected against double saving, and an overpaid warning; deposit % per listing; a "You keep" line and direct-booking savings; `{{cancellation_policy}}` and manual-payment `{{payment_link}}` message variables; 4 help articles; reports and owner statements include extras and refunds. Security review: PASS, plus fixes (D-38). 243 tests pass. |
| 2026-10-13 (later) | Eight canon docs and CLAUDE.md. Staff no longer receive guests' check-in links. Discount codes and message templates are owner-only (D-28). Cleaning tasks can only go to people who can see the property (D-29). The gate pass link respects the guest ID setting. Expired logins are cleaned up hourly. The export is fuller. 182 tests pass. |
| 2026-10-13 | Onboarding Launchpad and guest check-in form. PayMongo plan payments. Launch readiness (terms, password change, export, deletion, health check). Direct booking page and pay-the-balance links. New brand. Installable app and push notifications. Pricing helpers. Owner statements. Reviews, repeat guests and discount codes. Condo gate pass. Security deposits. Short-term reports and tax summary. Taglish for guests. Four-agent QA sweep with fixes. New landing page with a 3-step Get started and EN/TL. Light and dark mode. Help center and support tickets. BalayHub assistant (off until a key is added). Filters on every list page. My account page and the hidden Log out fix. 169 automated tests pass. |
| 2026-10-13 (Phase 2) | Owners and co-hosts. Owner portal: unit owners sign in with an emailed one-time link (separate `bh_owner` session, no team login) to see published statements, payouts, repairs reserve, bookings (guests by first name), an activity list, profit and loss for their units, expense receipts from published statements, and to block and cancel their own dates. Host invites and turns off portal access. Fee types: % of net (default), % of gross, flat monthly. Statements are drafted, published (frozen snapshot), unpublished to correct, emailed with a link, and printed from the browser. Payout records (voided, never deleted, with an idempotency key). Repairs reserve with top-ups and withdrawals. Profit and loss per unit, with CSV. Monthly reminder on the 3rd (Manila) to workspace owners. Help center: 4 new articles and the owner statements article updated. Migration 029. Security review PASS with fixes (D-46, D-47). 300 tests pass. |
| 2026-10-13 (Phase 3) | Operations and housekeeping: cleaner role (cleaners see only their own jobs, checklists, photos and their own pay; every other API route answers 403); status board with Dirty, Clean and Inspected; inspections with scores and cleaner scores; damage reports that become a charge, a deposit deduction or a waiver; cleaner pay rates, per clean or per hour, marked paid with an optional cleaning expense; supplies with par levels and low stock; lost and found; work orders from cleaning jobs; recurring maintenance (hourly job). Security review PASS with fixes (D-56). 410 tests pass. |
| 2026-10-13 (Phase 4) | Guest experience and direct booking. Guidebook per listing (English and Taglish) with a private link; Wi-Fi and door code shown only from the day before check-in to check-out day. House rules accepted on the booking page, quote page and check-in form. Paid add-ons on the booking page and before arrival. Quotes for Facebook and Messenger inquiries, with a pay link. Share links with sources and a by-source report. Public review links for 4 and 5 star guests. Returning-guest codes. One follow-up email for unfinished bookings. Search-friendly listing pages, sitemap and robots.txt. Migration 031. Tests: Security review PASS after fixes (D-65). 492 tests pass. |
| 2026-10-13 (Phase 5) | Pricing rules and team. Booking-window prices (last-minute, far-out, gap nights, fortnight discount, lowest price), season percentages and a price preview. Bulk prices and blocks with preview, tags and room types. Reservation activity log. Conversation assignment, @mentions and notification settings per person. Group bookings, room-type picks, moving a booking on the calendar. Daily close. Calendar sync warnings with one alert per problem. Migration 032. Ten new help articles (63 in all). Small fixes: sync alerts use their own notification type, archived listings raise no sync warnings, assignment refused for a manager who can't see the property. Tests: Security review PASS after fixes (D-75). 586 tests pass. |
| 2026-10-13 (Public page and help refresh) | Landing page: all six feature tabs updated, new "Team & daily work" tab, new "Built from what hosts told us they needed" section with six cards, FAQ on cleaners and the owner login, and Taglish for every new line. Help center: new "What's new in BalayHub" article at the top (64 in all), and 17 older articles corrected against the app (owner-only actions, button names, the Resume button for maintenance schedules). Browser check at 1280 light and 390 dark: no errors, no sideways scroll. 586 tests pass. |
| 2026-10-13 (QA round 1, local) | Full app checked by 12 browser lanes (public, guest, money, calendar, listings, inbox, owners, ops, role access, settings, long-term, phone layout). 85 real bugs adjudicated against DECISIONS and fixed in 34 parallel fix groups plus follow-ups. Biggest: an internal note could be emailed to the guest; refunds of overpayments with a channel fee counted as lost income in P&L and owner statements; per-hour cleaner pay stored 0 when Start was skipped (now 'pay not set'); staff could read maintenance schedules; login limits locked out whole offices. Also: route guards by role and module, lease guard on all stay paths, zero-price and money validation, Manila-day dates on lists, dark-mode contrast, phone layout, keyboard access, plain-language errors, filter bars, no native dialogs. Security review BLOCKED the first login-limit rework (parallel-burst bypass, unlimited sign-ups) -> fixed -> re-review PASS. Browser re-verify: 95 of 97 fixes held; one regression (admin trial end date drifting a day per save) fixed and re-checked. Decisions in D-76. 719 tests pass. |
| 2026-10-14 (QA round 2, local) | Full app checked again by 12 browser lanes. 119 entries adjudicated: 93 real bugs plus 13 deferred with a default applied now (106 fixes) across 36 lanes; the rest were intended behaviour, duplicates or a test-tool artifact. Biggest: staff and cleaners could read damage amounts and other people's reports on a job; a quote with a typed price saved at 0. Decisions in D-77; founder questions in BLOCKERS.MD. Local only, not yet deployed. |
| 2026-10-14 (QA round 3, local) | Full app checked a third time by 12 browser lanes. 45 entries adjudicated: 32 real bugs plus 8 deferred with a default applied now (3 of the deferred changed code or wording), across 27 fix lanes and one docs lane; the rest were intended behaviour or duplicates. Biggest: a channel fee on a direct booking lowered what the guest was asked to pay (now refused, and ignored for what is owed); a group room could be saved at 0 or booked with a count of 0. Decisions in D-78; founder questions in BLOCKERS.MD. Local only, not yet deployed. |
| 2026-10-14 (QA round 4, local) | Full app checked a fourth time by 12 browser lanes. 48 entries adjudicated: 31 real bugs (none severe, 10 significant, 21 minor), 6 deferred with a default applied now, and the rest were intended behaviour, duplicates or notes. Fixed in 17 fix lanes plus follow-up fixes, then one docs lane. Biggest: a misplaced comma in a money box was silently removed (1,5 saved as ₱15); blanking a fee on Edit reservation did nothing but still said "Reservation updated."; the calendar's nightly price box froze nights at today's price; a finished clean could be reopened and its pay cleared, and a cleaner's rate replaced, without asking; wide tables still had no visible cue on phones after three rounds, so the cue now follows the scroll position. Decisions in D-79; founder questions in BLOCKERS.MD. Local only, not yet deployed. |


## Session notes

- **2026-10-13** · Competitor research done: 15 reports plus 2 follow-ups in `docs/research/`, summed up in `00-SUMMARY.md`. Integrations and AI features are excluded by founder request. The roadmap is Phases 1–5 above.

- **2026-10-13** · Founder parked the AI chatbot: it stays off until ANTHROPIC_API_KEY is set (D-15).
- **2026-10-13** · Adopted the Proverbs3 toolkit. The eight canon docs and the project CLAUDE.md were written from the existing code. Next feature: SMS reminders (Sprint A), pending founder choices in BLOCKERS.MD.
- **2026-10-13** · Phase 2 (owners and co-hosts) built per `docs/specs/PHASE-2-OWNERS.md`. Security review: PASS, with two medium and several low findings fixed (D-46). Browser check at desktop and phone, light and dark; phone layout of the owner portal fixed after it.
- **2026-10-13** · Phase 3 (operations) built per `docs/specs/PHASE-3-OPERATIONS.md`. Decisions D-48 to D-54 as built, plus D-55 for the deviations agreed in the build. Help center: 10 new articles (44 in all), and 9 articles now open to cleaners. Canon docs updated (PRD, APP-FLOW, BACKEND-SCHEMA, TRD, DECISIONS). Test status: TBD, pending the full suite run. Open: paused schedules can't be resumed; monthly schedules can drift off the 31st; cleaners get no push notifications yet.

- **2026-10-13** · Phase 4 (guest experience and direct booking) docs written from the code. Decisions D-57 to D-63 as built, and D-64 for the agreed deviations. PRD F40 to F46, BACKEND-SCHEMA section 2.4a and access matrix 6.2, TRD scheduler row and section 2.6, APP-FLOW section 13, and nine new help articles (53 in all). Checks: the help center module loads, and the assistant test suite passes 5 of 5. The full `npm test` was not run by this docs lane, so the Build record says TBD. Open gaps (in PRD.MD and BACKEND-SCHEMA.MD): the public search pages have no rate limit of their own, and the listing's own check-in instructions and house rules have no Taglish text. Nothing committed.

- **2026-10-13** · Phase 5 (pricing rules and team) built per `docs/specs/PHASE-5-PRICING-TEAM.md`. Decisions D-66 to D-73 as built, plus D-74 for the agreed build choices and the open differences from the spec. PRD F47 to F52, BACKEND-SCHEMA 2.4b and 6.3 (and gap 15), TRD 2.7 and the new `sync-health` job, APP-FLOW section 14, and ten new help articles (63 in all). Checks: the help center module loads, and the assistant tests pass 5 of 5. The full `npm test` was not run by this docs lane, so the Build record says TBD. The roadmap phases 1 to 5 are now all built. Nothing committed.

- **2026-10-13** · Public page and help center refreshed to match phases 1 to 5 (see Build record). Correction to the Phase 3 note above: paused maintenance schedules can be resumed; a Resume button exists. Gmail app password rotated and PayMongo plan-payment keys added by the founder (BLOCKERS ticked).

- **2026-10-13** · QA round 1 (local) done; see Build record and D-76. Live check (Stage B) is blocked until the cloud session can reach balayhub.proverbs3digitalsolutions.com and has QA_TEST_PASSWORD as an environment secret. Round 2 queue is in .claude/proverbs3-qa-state.md (overpaid alert after refund, audit row on no-change save, Ask button over launchpad text at 390px, silent reset-email suppression, small copy and phone-layout items).
- **2026-10-14** · QA round 2 swept 2026-10-13 late evening and was fixed in 36 lanes. The run hit the usage limit part way through the fix wave and was restarted; the lanes that had not finished were resumed rather than redone, and the docs lane (B36) ran last once everything had landed. Decisions D-77, canon docs updated (BACKEND-SCHEMA 6.1a, APP-FLOW 15, DESIGN-BRIEF 11, BLOCKERS). Next: re-verify locally, then the live-site stage once the network allowlist and `QA_TEST_PASSWORD` are in place.
- **2026-10-14** · QA round 3 swept and fixed the same day in 27 code lanes, then the docs lane (D01) last. Decisions D-78; canon docs updated (BACKEND-SCHEMA 6.1a and section 9, APP-FLOW 16, DESIGN-BRIEF 12, BLOCKERS). Re-verify locally after restoring the snapshot `qa/dev-before-qa.dump`; the SEV1 check is a direct booking given a fee by SQL, where the host Payment card, guest pay page, payment link and receipt all show total minus paid. Next: round 4 (blank channel fee on Edit), then the live-site stage once the network allowlist and `QA_TEST_PASSWORD` are in place.

- **2026-10-14** · QA round 4 swept and fixed the same day in 17 code lanes, plus follow-up fixes found while re-checking: sign-up consent on the standalone sign-up page, the monthly-rental alerts note in Settings, the 10,000-character limit on inserting a template, the booking page's guest-count re-price (with Taglish), the "Guest overpaid by" wording, the Save rate button while a rate change waits, and hiding "Most vacant units" in short-term workspaces. Then the docs lane (D01) last. Decisions D-79, with the D-78 blank-fee line and its edge-shade bullet marked as superseded. Canon docs updated: APP-FLOW section 17 (and a note on the round 3 blank-fee line), BACKEND-SCHEMA section 10 (and the sign-up limit line in section 8), DESIGN-BRIEF section 13 (and notes on the round 2 and 3 edge-cue bullets), PRD known gaps, BLOCKERS (round 4 questions; the round 1 sign-up item marked as asked again; the round 3 blank-fee item ticked as resolved).
- **2026-10-14** · Hard round: the wide-table cue failed for the third time. Rounds 2 and 3 each shipped a background shade that did not show on phones. This round the cue is a fade on the content itself, driven by scroll position, in both themes. If the re-verify still finds no visible cue, stop tuning the CSS and ask the founder (BLOCKERS) whether phones should show stacked cards for those tables; the swipe hint is the smaller option.
- **2026-10-14** · Re-verify runs after restoring the snapshot `qa/dev-before-qa.dump` (it clears the round 4 test records), in eight groups run in parallel: money and reservations; calendar and pricing; inbox; operations; phone and accessibility; settings, account and long-term; public pages; properties and owner portal. After the restore, check that the Reyes workspace's "Accept manual payments" and its instructions match the dump, because one lane found the setting switched on.
- **2026-10-14** · Carried to round 5 (bugs and checks, not founder decisions, so they are not in BLOCKERS): in Settings, the "Modules for this workspace" select's text is cut off at 390px; a monthly-rental owner still sees "Turn on notifications" with no alert types to turn on (this ties to the monthly-rental alerts question); `PATCH /api/push/settings` does not check the workspace type (only the list is filtered), so a monthly-rental owner calling it directly can store a stay type, although the screen shows none and delivery is not gated; the Properties list and the owner-portal menu in a both-type workspace were not checked locally; negative supply quantities are skipped silently; in the phone More menu the theme switch wraps "Match device" onto two lines and shrinks its icon (older, not from round 4). Also not exercised in round 4: channel-imported locked stays, the PayMongo return page, an expired quote, the Photos modal, the owner portal with a real sign-in, Pay now with a real checkout, the reports date toast between 00:00 and 08:00 Manila, and the recurring maintenance scheduler run.
