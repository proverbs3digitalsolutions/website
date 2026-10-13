# proverbs3-qa state — BalayHub

- run_status: running
- stage: local
- round: 1 · phase: 1 sweep
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
