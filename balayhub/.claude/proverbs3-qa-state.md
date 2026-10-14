# proverbs3-qa state — BalayHub

- run_status: running
- stage: local
- round: 2 · phase: 3 fix (sweep done, 93 real bugs, plan in <scratchpad>/qa/r2/STRATEGY.md)
- local_clean_streak: 0/3
- live_clean_streak: 0/3
- merged: n/a (project rule: no merge to main) · deployed_live: false
- live deploy: not yet (live site blocked by this environment's network policy; test password not yet available to the session)
- browser_driver: playwright-fallback (no Chrome extension in the cloud container) · browser_retries: 0 · rounds are DEGRADED
- watchdog_cron_id: e5ee2828
- goal_set: false (no /goal command available in this harness)
- model policy: Haiku classifier, Opus strategist, Haiku-high sweep, Haiku-xhigh fix, Sonnet on 3rd attempt, Opus on 4th, Haiku closure
- dev DB snapshot: <scratchpad>/qa/dev-before-qa.dump
- local deviation: sweep lanes may create and edit records on the LOCAL dev database (emails go to the in-memory outbox) to exercise forms; no deletes of seed workspaces, no password changes on test logins.

## CONFIRMED-INTENDED
## DEFERRED
- Open founder items in BLOCKERS.MD (SMS, Messenger, branches, occupancy pricing, free plan, etc.)
## STANDING-INTENDED
## Persistent-bug ledger
## Pending fix wave
- Round 1: 34 fix lanes + docs lane L35. Running: L01-L20 (20-agent cap). Waiting for a free slot: L21-L34. L35 docs after all land.
- Classifier: hard (systemic classes + decision conflict). SEV1s: inbox note-to-guest, refund rule with channel fee, per-hour pay 0 without Start.

## Round 1 follow-ups to dispatch (F4) once lanes finish
- src/routes/dailyclose.js: GET /api/daily-close should refuse non-real calendar dates (e.g. 2026-02-30) with 400.
- Decision for docs lane: public direct-booking page is not gated on business_type (booking page is off unless the owner turns it on; lease rule now applies there). Record in DECISIONS D-76.
- test/team-notify.test.js: update 'Unknown person' expectation to 'Only owners and managers can be mentioned.' (from L04) and the renderMentions source check in inbox.js.
- test/synchealth.test.js: update old 'The channel returned HTTP 404...' expectation once L19 lands (check L19 report first).
- Decision for docs lane: add-on duplicate names are refused in the app (L27). No unique index migration: live data may already hold duplicates, which would make the migration fail on deploy.
- F5 (after L28 and L34 finish): keyboard-open for clickable rows in reservations.js:~201, help.js:~307 (Enter+Space), groups.js:~258 (add Space); home.js SYNC_TEXT.failing -> `${p.unit_name}: ${p.message}`.
- F5 also: admin.js:~47 trial_ends_at -> manilaDay(w.trial_ends_at); owners.js:10 and ownerportal.js:22 local manilaDay -> import shared (cleanup).
- Docs lane: BACKEND-SCHEMA add "Supplies: movement history" (Owner Yes, Manager Yes, Staff No, Cleaner No); APP-FLOW Supplies: Record use + History per item. Archived supplies: records are kept in the database but History isn't openable once archived (dialog wording "history is kept" is true for the data; left as is).
- Docs lane: settings audit labels now cover all 137 action codes; dashboard unit names read "Unit 101"; consent re-ticked on each check-in save (D-76).

## Round 1 inline re-verify
- rvB: 32/32 fixes held. New SEV3s for round 2: cleaner pay stat says "no rate set" for pay-not-set cleans (cleanerpay.js ~98,114); Connect-calendar toast shows raw DNS error (listings.js ~263); supplies History "Used 1 rolls" plural; at 390px group rooms table / maintenance tabs / cleaner chips cut off with no scroll cue.
- rvA: 15/15 held. New: SEV2 "Guest overpaid" alert + negative Balance stay after the refund is recorded (balance ignores booking_refunds; D-34 says refunds don't change balance — decide in round 2); SEV3 inbox send-later error doesn't clear when the field is cleared.
- rvC: 21/22 held (lease-on-booking-page not browser-testable; covered by qa-r1-followups test).
- rvD: 27/28 held. Regression F1 (trial end +1 day per save) being fixed now (F10). New SEV3: no-change manual-payments save writes an audit row (proofs.js ~182-205); Ask button covers last line of launchpad at 390px.
- Security: first review BLOCK (2 medium in login limits) -> fixed -> re-review PASS. Open LOW for round 2: silent per-email forgot cap lets a stranger suppress a victim's reset emails (consider de-dup by recent unused token instead); forgot-password timing difference (send without awaiting).
- Full suite after security fixes: 719/719.

## Round 2
- Sweep: 12 lanes done. Strategist: 93 real bugs (3 SEV1: staff damage data via job detail, cleaner sees others' damage reports, quote saves at 0 from text), 13 deferred-with-default.
- Fix wave: A01-A20 running; B21-B35 queued for free slots; B36 docs last. Test DBs balayhub_test_r2_01..20.
- Local DB restored from dev-before-qa.dump after the sweep (also undoes the money lane's accidental void).
- Note for round 3 sweep lanes: check an element is VISIBLE before reporting its text (hidden role=alert caused a false 'end date before start date' finding).
- R2 follow-ups (F-r2, after owners finish): rent.js/money.js show "(archived)" not "(former)" when tenant_status='archived' (GET /rent select t.status AS tenant_status); reports.js view outstanding table same; tenants.js archive copy "until it is paid" (no write-off action); listings.js channels list + home.js SYNC_TEXT include p.host; test/housekeeping-phase3.test.js two stale asserts (cleaner no estimate/status/work orders; empty checklist via SQL); confirm A03 accepts {rooms:[...]} and counts confirmed rooms in GROUP_ROWS.
- R2 follow-ups added 2026-10-13 (late lanes): test/filters-a.test.js:221 inbox bad ids now 200 not 404 (B27); housekeeping ?assignee=<bad> still 404s into page error state (A13 concern; client-side drop of non-uuid/non-keyword assignee in housekeeping.js view); groups view should show '-' / Cancelled for a cancelled group (rooms count now confirmed-only, A03); BLOCKERS question: should staff see "Your pay for this clean" card on a housekeeping job (A11 concern); tests posting payment over balance need confirm_over (A08).
- 2026-10-14 00:45 UTC: usage limit hit, worker restarted; Postgres restarted; 5 cut-off lanes resumed (B21, B23, fixup, channel host, assistant); new lanes: public-pages fixup, shared image check. Watchdog now e5ee2828.
- R3 candidates: stay report 'Direct bookings by source' shows 14 stays as 'No source' while the revenue table calls them 'Direct' (rvE).
- R3 candidates: pricing all-listings clash text says a listing season 'wins the shared nights' when a third overlapping season takes some of them (rvC, SEV3, public/js/views/pricing.js clashText).
- R3 candidates: two different reset links used at the same instant can deadlock (500 instead of 400); take the per-user advisory lock first in the reset transaction (security re-check, Low, auth.js:258-267).
- 2026-10-14: Round 2 COMMITTED af38514 and pushed. Full suite 951/951, security PASS, 7 re-verify lanes held (3 new findings fixed). local_clean_streak stays 0 (round 2 had findings). Next: round 3 local sweep from restored dev DB.
- R3 notes: public lane created local test user qa2-public-1@balayhub.test (unverified, no workspace) — cleared by the next DB restore. BLOCKERS needs a founder question: sign-up with an existing email says 'An account with this email already exists' (reveals the account) — keep or make generic?
- R4 candidates: money.js:63 drops the month filter silently for an invalid month; stays.js:1210 /stays/revenue silently uses current month for a bad month (C10 audit).
- R4 candidates: on a channel booking, blanking the channel fee on Edit does nothing (PATCH treats blank money as not provided); host must type 0 (C05 note).
- R4 candidates: ui.js openModal wide sets inline style.width; switch to a modal--wide class and drop the !important in the Get started phone rule (C07 note).
- R4 candidates: proofs image upload can leave an orphan file on disk if audit/commit fails after saveFile (pre-existing, security Low); pending proofs with no screenshot still listed for host (consider label/hide).
- R4 check: owner-portal nav now wraps (C07) — not browser-checked yet; tab rows wrap at all widths.
- R4 candidates: property LIST page in short-term still shows 'N occupied · N vacant' badge and 'Has vacant units/Fully occupied' filter (C17 note).
- 2026-10-14: Round 3 fixes done. Full suite 1107/1107, security PASS, 4 re-verify lanes held (3 follow-ups fixed). Committing.
- 2026-10-14: Round 4 started (local sweep, DB restored from snapshot).
