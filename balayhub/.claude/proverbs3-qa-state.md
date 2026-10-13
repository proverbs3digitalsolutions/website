# proverbs3-qa state — BalayHub

- run_status: running
- stage: local
- round: 1 done (local) · next: round 2 sweep on localhost
- local_clean_streak: 0/3
- live_clean_streak: 0/3
- merged: n/a (project rule: no merge to main) · deployed_live: false
- live deploy: not yet (live site blocked by this environment's network policy; test password not yet available to the session)
- browser_driver: playwright-fallback (no Chrome extension in the cloud container) · browser_retries: 0 · rounds are DEGRADED
- watchdog_cron_id: 6aa14e94
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
