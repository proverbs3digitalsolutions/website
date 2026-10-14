# BalayHub: project rules for Claude

BalayHub is rental and staycation management software for Filipino hosts with 1–10 units. It runs live at https://balayhub.proverbs3digitalsolutions.com.

This project follows the Proverbs3 toolkit (github.com/proverbs3digitalsolutions/p3ds-skills). These rules are specific to BalayHub; the toolkit's general doctrine still applies.

## Read first: the eight canon docs (this folder)

`PRD.MD` · `TRD.MD` · `APP-FLOW.MD` · `DESIGN-BRIEF.MD` · `BACKEND-SCHEMA.MD` · `IMPLEMENTATION-PLAN.MD` · `DECISIONS.MD` · `BLOCKERS.MD`

- Read the relevant ones before planning or changing anything. Don't assume how something works without checking them and the code.
- Keep them true:
  - A shipped change updates the Build record in IMPLEMENTATION-PLAN.
  - A new decision gets a dated entry in DECISIONS (append only; supersede, never delete).
  - A new flow updates APP-FLOW.
  - A schema or permission change updates BACKEND-SCHEMA.
  - A new integration or env var updates TRD.
  - A scope change updates PRD.
  - Anything that needs the founder goes in BLOCKERS.
- A doc that contradicts the code is a bug. Fix one of them.

## How to talk to the founder

- Answer first, in plain English. Keep it short and avoid jargon.
- Explain server steps as exact commands for the Hostinger browser terminal.
- **Never ask for, accept or repeat passwords, API keys or secrets in chat.** They go only in `deploy/.env` on the server.
- If a screenshot shows a secret, say so and tell the founder how to rotate it. Never quote the secret.
- Keep costs down: run independent review agents only for payment and security features. Use the heavy toolkit commands (`/proverbs3-sprint`, `/proverbs3-qa`, `/proverbs3-e2e`, `/proverbs3-dfss`) for big pieces of work, not small fixes.

## Code rules

- **Stack:** Node 22, Express 4, PostgreSQL (`pg`), and a plain-JS single-page app with no framework and no build step. Build the UI with `h()` from `public/js/ui.js`.
- **Strict CSP** (`script-src 'self'`): no inline scripts or `<script>` tags, and no `style="..."` attributes. Set styles through the `style` object in `h()` or with CSS classes.
- **Database changes:** add a new numbered file in `db/migrations/` and never edit an old one. Add any new table to `PURGED_TABLES` and `purgeOrganization()` in `src/lib/account.js`; a test fails otherwise.
- **Access:**
  - Scope every query with `propertyScope()`/`loadX()` helpers from `src/lib/access.js`.
  - Use `requireRole()` for role-only actions.
  - Staff never see guest phone/email or private guest links (`redactGuest` in `src/routes/stays.js`).
  - Read-only workspaces are blocked by `planGuard`. Add a path to `PLAN_EXEMPT` only if it must keep working when view-only (support, account, billing).
- **Validation:** validate every input with `src/lib/validate.js` and keep SQL parameterised. Use allow-lists for enums and sort keys.
- **Money:** `pg` returns NUMERIC as strings, so never compare money as floats in SQL. The guest balance is `total_amount - channel_fee - payments + refunds` (non-voided), written once in `src/lib/balance.js` (D-85); never rewrite the formula. Server peso text goes through `messaging.fmtPeso` (two decimals), the one server peso formatter.
- **Dates:** DATE values come back as `YYYY-MM-DD`. "Today" means Manila time.
- **UI:**
  - Sentence-case text.
  - Use the colour tokens from `public/css/app.css` (light and dark) and never hard-code colours.
  - List pages use the shared `filterBar()` from `public/js/filters.js`.
  - Guest-facing text goes through `public/js/i18n.js` (English and Taglish).
  - Guest pages: money owed or paid shows two decimals; advertised prices may be short (D-86).
- **Claude API code:** use the official `@anthropic-ai/sdk`, following the existing `src/routes/assistant.js`.

## Testing and checks

- Run `npm test` against the `balayhub_test` database; all tests must pass before a commit. Start Postgres with `service postgresql start` if it's down.
- Test files share one database. Never run two test runs (or two agents' tests) at the same time; give parallel agents their own database through `TEST_DATABASE_URL`.
- Check frontend files by copying them to a `.mjs` file and running `node --check` on it.
- After any UI change, check it in a real browser at desktop and phone width, in light and dark mode. Use Playwright at `/opt/node-tools/node_modules/playwright`.
- Local dev logins: `stays@balayhub.test` / `demo-password-1`.

## Git and deploy

- Work on the branch `claude/trusting-hopper-lyg8vu`; the server pulls this branch.
- Don't open pull requests unless asked. Commit only when tests pass.
- Deploy: the founder runs `cd /opt/balayhub-src/balayhub && ./deploy/update.sh`, which backs up, pulls, rebuilds and migrates.
- Settings live in `deploy/.env` on the server. It's ignored by git. The full list of variable names is in TRD.MD.
