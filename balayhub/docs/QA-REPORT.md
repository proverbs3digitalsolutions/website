# BalayHub — Code Review, QA & Final Check (Stages 5–7)

## Stage 5 — Code Critic review
An independent reviewer audited security, financial correctness and frontend flows. It reproduced each finding before reporting it. Every finding is fixed and covered by a regression test in `test/regressions.test.js`.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | A manager's tenant list showed a tenant's current lease, balance and contact details for a property the manager isn't assigned to (the tenant was visible through an older lease) | The current-lease join is now scoped to the user's assigned properties |
| 2 | High | The duplicate-tenant warning listed matching tenants from the whole workspace, so a manager could find contact details by email or phone | The duplicate check only searches tenants the user may see |
| 3 | Medium | Staff could find hidden phone numbers and emails by searching on them | Staff search covers name, unit and property only |
| 4 | Medium | A tenant was charged for a month that fell due after they moved out | Months whose due date is after move-out are no longer billed (the move-in month is always billed) |
| 5 | Medium | A future move-out date freed the unit immediately, so two leases billed the same unit | `End lease` rejects future dates. Planned move-outs use "Change terms" |
| 6 | Medium | Login rate limiting could be bypassed with a spoofed `X-Forwarded-For` header and by spraying many emails | `TRUST_PROXY` is now configurable (default 0), and a per-IP limiter was added |
| 7 | Low | A malformed cookie made every API call return 500 | Cookie decoding errors are now ignored |
| 8 | Low | An invalid `property_id` on reports returned 500 | It is now checked with the strict UUID pattern |
| 9 | Low | Downloads failed when `STORAGE_DIR` was a relative path | Paths are now resolved to absolute |

The reviewer checked these areas and found them correct: query parameter numbering in every combined scope and ledger query, the FIFO allocation, exclusion of voided records from all totals, PATCH column allow-lists (no SQL injection), staff restrictions on voids, edits and documents, CSRF and session handling, and the absence of `innerHTML` / XSS paths in the UI.

## Stage 6 — Testing & QA

### Automated API tests: `npm test` → 23 / 23 passing
Run against a real PostgreSQL database. They cover:
- Sign-up validation, privacy acceptance, email verification (single-use token), workspace creation, duplicate email
- A generic message for wrong password versus an unknown account, logout, password reset (single-use, signs out other sessions), the CSRF header requirement
- Properties: create, duplicate warning, units, derived occupancy, unique unit names, rejected negative rent
- Tenants and leases: duplicate warning with override, one active lease per unit, date validation, monthly charge generation
- Payments: negative, zero and future amounts rejected; partial payment balance; oldest-first allocation; overdue status
- Double-submit: two simultaneous saves with the same key create one payment
- Voiding: reason required, balance restored, history and audit kept
- Expenses (idempotent), maintenance costs linked as expenses, resolved timestamps
- Dashboard and report totals, CSV export, invalid date range
- Ending a lease, archive protections, an outstanding balance that survives a lease ending
- **Workspace isolation**: another owner gets 404 on every record and can't write into the workspace
- **Roles**: manager scoped to assigned properties; staff can't see contacts, void or create tenants; a removed member is signed out immediately
- File uploads: content signature check, rejected types, private download, cross-workspace denial
- The 8 code-review regressions above

### Browser end-to-end journey: `test/e2e-browser.js` → 28 / 28 steps passing
Chromium at phone size (390×844) and desktop size (1366×900):
1. Welcome → Get Started → sign up (privacy checkbox required) → verify email → create workspace
2. Add property → add unit (₱ input "7,500") → empty "No tenants yet" state
3. Add tenant → assign unit (lease schedule preview) → record a payment: negative amount rejected, then a **double-clicked Save** records exactly one payment
4. Dashboard shows collected ₱5,000 and outstanding ₱17,500, matching the ledger
5. Logout → wrong password shows the generic error → demo login
6. Every screen opens on mobile and desktop: dashboard, properties, tenants, rent due, payments, expenses, reports, maintenance, settings, and the detail pages
7. A search with no results shows "No results found" and Clear search works
8. **Offline**: the required-field check works offline; saving while offline keeps the input, shows the offline banner, and saving again after reconnecting succeeds
9. **Session expiry**: cookies are cleared mid-form → redirect to login → after logging in, the same page reopens and the draft is restored
10. No page scrolls sideways at 390 px (a Reports overflow was found and fixed). The only console message is the expected 401 from `/auth/me` for a signed-out visitor

Other issues the QA stage found and fixed: a single available choice is now preselected (one vacant unit), required fields are checked instantly in the browser, toasts no longer pile up, and an icon on the dashboard rendered oversized.

## Stage 7 — Checker: requirements traceability

| Quality criterion | Result |
|---|---|
| All features work as required (12 must-have stories) | ✅ See `PROJECT-PLAN.md` |
| No critical bugs | ✅ No open critical or high findings |
| Good performance | ✅ Pages are queried with indexes and capped at 500 rows. Suitable for the 5–100 unit target. Not load-tested at scale |
| Secure, follows best practices | ✅ See the Security plan in `ARCHITECTURE.md` |
| Good UX | ✅ Mobile-first, 46–48 px touch targets, plain-language errors, empty states for every list |
| Works on different devices and browsers | 🟡 Verified in Chromium (mobile and desktop sizes). Safari and Firefox not yet tested manually |
| Meets all requirements | ✅ Must-haves met. Should-haves partly delivered (see the plan) |
| Documentation complete | ✅ README, plan, architecture, privacy checklist, this report |
| Complies with the Philippine Data Privacy Act | 🟡 Product controls are in place. Organizational items remain (`PRIVACY-CHECKLIST.md`) |
| Ready for real users | 🟡 Ready for a pilot after deployment, SMTP setup and privacy review. User testing with real landlords is pending (build-order step 8) |

**Checker verdict:** approved to move to deployment as a pilot, with these conditions:
1. Provision production hosting with managed PostgreSQL, backups, a persistent upload volume, HTTPS, and `TRUST_PROXY=1`.
2. Configure SMTP so email verification and password reset work.
3. Complete the privacy organizational items and legal review.
4. Run a moderated test with 3–5 real landlords, plus a Safari/iOS pass.
