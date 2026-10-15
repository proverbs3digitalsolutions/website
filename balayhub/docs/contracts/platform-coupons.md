# Platform plan coupons: contract

Status: round 15, atom D1; updated 2026-10-15 by the docs lane (D2) to match what landed (COUPON_AHEAD, the preview order, the demo answer). This is the reference the build lanes (B2 to B6) work against. Decision number: D-94.

In plain words: BalayHub charges one prepaid period at a time. It never keeps a card and never charges anyone automatically. A platform coupon covers a number of billed months. While months remain, each checkout the owner starts is discounted automatically. When they run out, checkouts are full price and the usual grace (7 days) and read-only rules apply. A free coupon activates a period with no payment.

"Coupon" means only these platform plan coupons. The hosts' guest codes stay "discount codes". Tables: `platform_coupons` and `platform_coupon_redemptions`. Admin page: "Plan coupons". Owner box: "Have a coupon code?".

## 1. Behaviour and price maths


- **Kinds:** `percent` (1 to 99% off), `fixed` (₱ off each covered month), `free` (100%, an explicit choice).
- **Duration (billed months it covers after redemption):** `once` = the first billed month only; `months` = the first N billed months (2 to 36); `forever` = every billed month.
- **Covered months in one checkout:** `forever` covers all months of that checkout; otherwise `min(months bought, months left)`. A 3-month coupon on a 12-month purchase covers 3 of the 12.
- **Price math (integer centavos):** `listC = price(plan, months) * 100`. Per covered month the base is the effective monthly price `listC / months` (so the 12-month "2 months free" price is respected).
  - percent: `discountC = round(listC * covered * pct / (months * 100))`
  - fixed: `discountC = min(covered * amountOffC, round(listC * covered / months))`
  - free: `discountC = round(listC * covered / months)` (equals `listC` when every month is covered)
  - `amountC = listC - discountC`. If `0 < amountC < MIN_CHARGE_C` (2000, ₱20), raise it to `MIN_CHARGE_C` (discount shrinks to match). *The ₱20 floor is BalayHub's own choice kept in this one constant; PayMongo's documented minimum is ₱1 (research 2026-10-15).* If `amountC == 0` and the coupon has `require_card`, set `amountC = MIN_CHARGE_C` and restrict the checkout to card. *(Round 16, D-97/O10: the preview `message` for a free coupon with `require_card` ends " You pay ₱20.00 once by card." when the floor applied; the owner banner and hint say the same, once.)*
- **Free with no card:** `amountC == 0` and no `require_card` makes no PayMongo call: a `billing_payments` row with `provider='coupon'`, `amount=0`, then `markPaid()` immediately. The plan activates; during the trial the paid period starts when the trial ends (existing `markPaid` rule).
- **Redemption:** one live redemption per workspace per coupon. It is created (status `pending`) when the first checkout with the code starts, becomes `active` on the first paid payment, `used_up` when its months are used, `released` if the checkout expires or fails before any payment. Later checkouts by that workspace apply the remaining months automatically, with no code typed.
- **Validation at preview and at checkout:** code exists, `active`, `starts_at <= now`, `ends_at` null or `> now`, redemption limit not reached (counting `active`, `used_up` and `pending` rows younger than 2 days), once per workspace (any non-released earlier redemption blocks it when `once_per_workspace`), plan eligible, workspace not comped and not demo, online billing on.
- **Paid-ahead limit (`COUPON_AHEAD`, added after the round 15 security review):** a checkout that carries a discount (`discountC > 0`) is refused with 409 `COUPON_AHEAD` ("Your plan is already paid ahead. Your coupon applies at your next renewal.") while `organizations.paid_until` is more than **45 days** after today (Manila). Full-price checkouts are never refused by this rule. *Why:* coupon checkouts could otherwise stack paid time far ahead, and a later plan change converts unused days into another plan at the old price. The preview and the checkout both use one helper, `couponAheadError(org, quote)` in `src/lib/billing.js`, so they cannot disagree.
- **Order of checks (preview and checkout):** online billing on (409 `BILLING_OFF`) **first**, then the workspace and code checks in `coupons.resolve` (invalid code, plan, already used, other coupon, comped, card-only needs card), then the 45-day rule. A comped workspace that sends a code hears the coupon reason; without a code it hears `COMPED`.
- **A failed checkout lets go of its slot:** when PayMongo gives no checkout URL, or the free path fails, the billing row is marked `failed` and the pending redemption is released at once. A payment confirmed for a released redemption does not revive it (`applyPaid` skips released rows).
- **Demo:** the read-only guard answers 403 `DEMO_READ_ONLY` before any coupon code runs; `coupons.resolve` also refuses a demo workspace.
- **No enumeration:** unknown, switched off, not started, ended and full all answer the same 400 `COUPON_INVALID` "This code isn't valid right now. Check it and try again." Only workspace-specific reasons are specific: `COUPON_PLAN` (lists the plans it covers) and `COUPON_USED`.
- **Case-insensitive codes:** trimmed, inner spaces removed, upper-cased before lookup and save. Format `^[A-Z0-9-]{3,32}$`. Generated codes: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, O, 1, I).
- **Brute force:** failed code checks (preview and checkout) limited per workspace (10 per 15 min) and per IP (60 per 15 min) with `rateLimit({ failedOnly: true })`; the existing checkout limiter (15 per hour per workspace) stays.
- **Edits after use:** once a coupon has any non-released redemption, `code`, `kind`, `percent_off`, `amount_off`, `duration`, `duration_months`, `plans` and `starts_at` are locked (409 `COUPON_LOCKED`). Name, note, end date, limit (not below the times used), once per workspace, require card and on/off stay editable. No delete; switch off instead.
- **Remaining months survive the coupon's end date and switching it off:** end date and off stop *new* redemptions only (Founder question 6). Switching off with "Also stop it for workspaces already using it" is not built (YAGNI).
- **When months run out:** the next checkout is full price and the box says "Your coupon's 3 months are used. This payment is the full price." A free period that ends follows the normal grace (7 days) then read-only rule.
- **Trial:** a coupon does not lengthen the trial. Using one during the trial keeps the remaining trial days (existing rule); the covered months start when the trial ends. To lengthen a trial the founder keeps using the admin trial date.

## 2. API contract


Owner endpoints (role `owner`, `requireRole('owner')`; paths under `/billing/` are already exempt from the read-only guard):

**`POST /api/billing/coupon/preview`**
Request: `{ "code"?: string, "plan": "starter"|"growth"|"pro", "months": "1"|"3"|"12" }` (`code` optional when the workspace has a live redemption).
200:
```json
{
  "coupon": { "code": "ALPHA50", "name": "Alpha testers", "kind": "percent", "percent_off": 50, "amount_off": null,
              "duration": "months", "duration_months": 3, "months_left": 3, "plans": null, "require_card": false, "source": "new" },
  "plan": "growth", "months": 1,
  "list_amount": "999.00", "discount_amount": "499.50", "amount": "499.50",
  "covered_months": 1, "free": false, "card_only": false, "min_charge_applied": false,
  "message": "50% off your first 3 months. This payment covers 1 of them."
}
```
`months_left` is null for `forever`. `source` is `new` (typed now) or `redeemed` (already applied to this workspace). When the workspace has a used-up redemption and no code is sent: 200 with `coupon` null and `message` "Your coupon's 3 months are used. This payment is the full price." When there is nothing to apply and no code: 200 `{ coupon: null, list_amount, discount_amount: "0.00", amount, ... }`.
Errors: 400 `VALIDATION` (plan, months, code format "Enter the code using letters, numbers and dashes."), 400 `COUPON_INVALID`, 409 `COUPON_PLAN` ("This code is for Growth and Pro."), 409 `COUPON_USED` ("Your workspace has already used this code."), 409 `COUPON_OTHER` ("Your workspace is already using the coupon ALPHA50. It applies until its months are used."), 409 `COMPED`, 409 `BILLING_OFF` (checked first), 409 `CARD_OFF` (card-only coupon while `card` is not in `PAYMONGO_METHODS`), **409 `COUPON_AHEAD`** (a discounted payment while paid more than 45 days ahead), 429 `RATE_LIMITED`, 403 for non-owners, 403 `DEMO_READ_ONLY` in the demo.

**`POST /api/billing/checkout`** (changed): adds optional `"coupon_code"`. Responses:
- paid checkout: 200 `{ "billing_id", "checkout_url" }` (unchanged shape);
- free activation: 200 `{ "billing_id", "activated": true, "plan": "growth", "paid_until": "2026-11-28" }`.
Same coupon errors as preview.

**`GET /api/billing`** (changed): adds `"coupon": null | { code, name, kind, percent_off, amount_off, duration, duration_months, months_left, plans, require_card, status: "pending"|"active"|"used_up" }` (the workspace's latest non-released redemption) and each `history` row adds `list_amount`, `discount_amount`, `coupon_code`, `provider`. History also lists `provider='coupon'` rows (they are `paid`).

Admin endpoints (behind the existing `platformAdmin` middleware: anyone else gets 404):

**`GET /api/admin/coupons?q=&state=&kind=&plan=&sort=`** → 200 `{ coupons: [Coupon], total, summary: { active, scheduled, ended, off, full } }`.
`Coupon` = `{ coupon_id, code, name, kind, percent_off, amount_off, duration, duration_months, plans, max_redemptions, once_per_workspace, require_card, starts_at, ends_at, active, note, created_at, updated_at, state, used, discount_total }`. `state` ∈ `active|scheduled|ended|off|full`. `used` counts active, used-up and recent pending redemptions. `discount_total` sums `discount_amount` of paid payments, as a string. `q` matches code or name (case-insensitive, 100 chars max). `sort` allow-list: `newest` (default), `oldest`, `code`, `ending`, `most_used`. Unknown filter values are ignored.

**`POST /api/admin/coupons`** body:
```json
{ "name": "Alpha testers", "code": "alpha50", "kind": "percent", "percent_off": 50, "amount_off": null,
  "duration": "months", "duration_months": 3, "plans": ["growth", "pro"],
  "max_redemptions": 20, "once_per_workspace": true, "require_card": false,
  "starts_on": "2026-10-16", "starts_time": "00:00", "ends_on": "2026-12-31", "ends_time": "23:59", "note": "" }
```
→ 201 `{ coupon: Coupon }`. 400 `VALIDATION` with `fields`; 409 `CODE_TAKEN` "Another coupon already uses this code.". `plans` empty or absent means every paid plan. `starts_time` defaults `00:00`, `ends_time` defaults `23:59`; both are Manila time.

**`PATCH /api/admin/coupons/:id`** partial body (same fields plus `active`) → 200 `{ coupon }`; 404; 409 `COUPON_LOCKED` "This coupon has been used, so its discount can't change. Make a new coupon instead."; 409 `CODE_TAKEN`; 400 `fields.max_redemptions` "The limit can't be below the 4 times it has been used."

**`GET /api/admin/coupons/:id/redemptions`** → 200 `{ coupon: Coupon, redemptions: [{ redemption_id, organization_id, workspace_name, owner_email, status, months_total, months_used, created_at, activated_at, discount_total, payments }] }` (`payments` = count of paid payments using it). Newest first, 500 max.

## 3. Audit log


| Action | organization_id | record_type | details |
|---|---|---|---|
| `platform.coupon_created` | NULL (platform level) | `platform_coupon` | `{ code, kind, duration }` |
| `platform.coupon_updated` | NULL | `platform_coupon` | `{ code, changed: [field names] }` (field names only, like `changedKeys` in `src/lib/auditdiff.js`) |
| `platform.coupon_switched_off` / `platform.coupon_switched_on` | NULL | `platform_coupon` | `{ code }` |
| `billing.coupon_applied` | the workspace | `billing_payment` | `{ code, list_amount, discount_amount, covered_months }`, written in `markPaid` |

Actor is the admin or owner. Platform-level rows are safe on purge: `purgeOrganization` already sets `actor_user_id = NULL` for the deleted users (account.js:133). No viewer for platform-level rows is built (the coupon's redemption list is the history the founder needs).

## 4. Role access (adds to BACKEND-SCHEMA section 6)


| Data | Platform admin | Owner | Manager | Staff | Cleaner |
|---|---|---|---|---|---|
| Plan coupons (list, create, edit, switch off, redemptions) | yes | no (404) | no (404) | no (404) | no (403 by cleaner guard / 404) |
| Preview or use a code, see own workspace's coupon | only as owner of own workspace | yes | no (403) | no (403) | no (403) |
