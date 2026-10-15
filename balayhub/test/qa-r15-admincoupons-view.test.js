'use strict';

// QA round 15, lane B5: the "Plan coupons" admin page, the two bottom-bar labels, and the CSS the orchestrator added for R1 and A1.
// The view imports the app shell, which does not load in Node, so this scans the source and runs the pure helpers read out of the file.
// node --test --test-concurrency=1 test/qa-r15-admincoupons-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', ...p), 'utf8');
const view = read('js', 'views', 'admincoupons.js');
const app = read('js', 'app.js');
const admin = read('js', 'views', 'admin.js');
const css = read('css', 'app.css');

function helpers() {
  const a = view.indexOf('// ---- helpers');
  const b = view.indexOf('// ---- end helpers');
  assert.ok(a !== -1 && b > a, 'helpers block is missing');
  return new Function(`${view.slice(a, b)}\nreturn { genCode, discountText, appliesText, plansText, STATE_BADGE, usedText, monthsText, REDEMPTION_STATUS, manilaParts, toCentavos, totalDiscount, couponBody, LOCKED };`)();
}

test('Generate makes an 8 character code without 0, O, 1 or I', () => {
  const { genCode } = helpers();
  const bytes = (n) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (i * 37 + 11) % 256; return a; };
  const code = genCode({ getRandomValues: (a) => { a.set(bytes(a.length)); return a; } });
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.match(genCode(globalThis.crypto), /^[A-HJ-NP-Z2-9]{8}$/);
});

test('table texts: discount, applies to, used, status', () => {
  const h = helpers();
  assert.equal(h.discountText({ kind: 'percent', percent_off: 50 }), '50% off');
  assert.equal(h.discountText({ kind: 'fixed', amount_off: '200.00' }), '₱200 off');
  assert.equal(h.discountText({ kind: 'fixed', amount_off: '99.50' }), '₱99.50 off');
  assert.equal(h.discountText({ kind: 'free' }), 'Free');
  assert.equal(h.appliesText({ duration: 'once' }), 'First month');
  assert.equal(h.appliesText({ duration: 'months', duration_months: 3 }), 'First 3 months');
  assert.equal(h.appliesText({ duration: 'forever' }), 'Every month');
  assert.equal(h.plansText(['growth', 'pro']), 'Growth, Pro');
  assert.equal(h.plansText(null), 'All plans');
  assert.equal(h.plansText([]), 'All plans');
  assert.equal(h.usedText({ used: 3, max_redemptions: 20 }), '3 of 20');
  assert.equal(h.usedText({ used: 3, max_redemptions: null }), '3');
  assert.deepEqual(h.STATE_BADGE.active, ['paid', 'Active']);
  assert.deepEqual(h.STATE_BADGE.scheduled, ['unpaid', 'Scheduled']);
  assert.deepEqual(h.STATE_BADGE.ended, ['archived', 'Ended']);
  assert.deepEqual(h.STATE_BADGE.off, ['archived', 'Switched off']);
  assert.deepEqual(h.STATE_BADGE.full, ['partial', 'Limit reached']);
  assert.equal(h.monthsText({ months_used: 2, months_total: 3 }), '2 of 3');
  assert.equal(h.monthsText({ months_used: 4, months_total: null }), '4 · every month');
});

test('total discount sums integer centavos, shown in whole pesos', () => {
  const h = helpers();
  assert.equal(h.toCentavos('123.45'), 12345);
  assert.equal(h.toCentavos('0.1'), 10);
  assert.equal(h.toCentavos(null), 0);
  assert.equal(h.totalDiscount([{ discount_total: '0.10' }, { discount_total: '0.20' }, { discount_total: '1000.00' }]), '₱1,000');
  assert.doesNotMatch(view, /parseFloat/);
});

test('Manila date and time parts of a stored time', () => {
  const { manilaParts } = helpers();
  assert.deepEqual(manilaParts('2026-12-31T15:59:00.000Z'), { date: '2026-12-31', time: '23:59' });
  assert.deepEqual(manilaParts('2026-10-15T16:00:00.000Z'), { date: '2026-10-16', time: '00:00' });
  assert.deepEqual(manilaParts(null), { date: '', time: '' });
});

test('create body follows the contract; locked fields are left out of a save', () => {
  const { couponBody, LOCKED } = helpers();
  const v = { name: 'Alpha', code: 'alpha50', kind: 'percent', percent_off: '50', amount_off: '', duration: 'months', duration_months: '3', plans: ['growth'], limit_on: true, max_redemptions: '20', once_per_workspace: true, require_card: false, starts_on: '2026-10-16', starts_time: '00:00', ends_on: '2026-12-31', ends_time: '23:59', note: '' };
  const b = couponBody(v, false);
  assert.deepEqual(b, { name: 'Alpha', code: 'alpha50', kind: 'percent', percent_off: 50, amount_off: null, duration: 'months', duration_months: 3, plans: ['growth'], max_redemptions: 20, once_per_workspace: true, require_card: false, starts_on: '2026-10-16', starts_time: '00:00', ends_on: '2026-12-31', ends_time: '23:59', note: '' });
  const free = couponBody({ ...v, kind: 'free', duration: 'once', limit_on: false, ends_on: '' }, false);
  assert.equal(free.percent_off, null); assert.equal(free.amount_off, null); assert.equal(free.duration_months, null);
  assert.equal(free.max_redemptions, null); assert.equal(free.ends_on, null); assert.equal(free.ends_time, null);
  const fixed = couponBody({ ...v, kind: 'fixed', amount_off: '200' }, false);
  assert.equal(fixed.amount_off, 200); assert.equal(fixed.percent_off, null);
  // Locked fields are sent unchanged, so the server (409 COUPON_LOCKED) judges a real change.
  const again = couponBody({ ...v, active: true });
  for (const k of LOCKED) assert.ok(k in again, k);
  assert.equal(again.code, 'alpha50'); assert.equal(again.percent_off, 50); assert.equal(again.active, true);
  assert.doesNotMatch(view, /delete body\[/);
  assert.match(view, /LOCKED\.includes\(i\.name\)\) i\.disabled = true/);
  assert.ok(!view.includes('couponBody(') || !/couponBody\([^)]*, locked\)/.test(view));
  assert.deepEqual([...LOCKED].sort(), ['amount_off', 'code', 'duration', 'duration_months', 'kind', 'percent_off', 'plans', 'starts_on', 'starts_time']);
});

test('redemption statuses are plain words (no "released")', () => {
  const { REDEMPTION_STATUS: r } = helpers();
  assert.deepEqual(r, { released: 'Not completed (slot freed)', used_up: 'Used up', active: 'Active', pending: 'Checkout open' });
  assert.ok(view.includes('REDEMPTION_STATUS[r.status]'));
});

test('workspace name buttons on #/admin use link-btn (44px on phones) with no inline style', () => {
  assert.ok(admin.includes("h('button', { type: 'button', class: 'link-btn', 'aria-haspopup': 'dialog' }, w.name)"));
  assert.doesNotMatch(admin, /background: 'none', border: '0'/);
});

test('page: not found for non-admins, copy, filters, form fields in order, no browser dialogs', () => {
  assert.ok(view.includes('state.user.is_platform_admin'));
  assert.ok(view.includes("title: 'Not found', text: \"This page doesn't exist.\""));
  for (const s of ["'Plan coupons'", "Coupons for BalayHub plans. These are not your hosts' guest discount codes.", "'#/admin'", "'Platform admin'", "'New coupon'", "'Search code or name'", "key: 'admin-coupons'", "'Limit reached'", "'Switched off'", "'Free access'", "'Ending soonest'", "'Most used'", "'No coupons yet'", "'No coupon matches these filters. Try removing a filter.'", "'Redemptions'", "'No workspace has used this coupon yet.'", "'Coupon created.'", "'Coupon saved.'", "'Total discount given'", "'Ended or off'", "Locked because this coupon has been used. Make a new coupon to change the discount.", "'Leave all unticked for every plan.'", "'Manila time.'", "'Generate'", "'Switched on'", "'Require a card payment'", "'Once per workspace'", "'Limit total uses'", "'Total uses'"]) assert.ok(view.includes(s), s);
  // The order of the fields array is the order on screen (the code and plans boxes are built just above it).
  const tokens = ["label: 'Coupon name'", 'codeField,', "label: 'Coupon type'", 'percentField, amountField', "label: 'How long it applies after it is used'", 'monthsField,', 'planChecks,', "label: 'Starts'", "label: 'Ends'", 'limitBox, totalField', "label: 'Once per workspace'", "label: 'Require a card payment'", "label: 'Note'", "label: 'Switched on'"];
  let at = view.indexOf('const fields = [');
  assert.notEqual(at, -1);
  for (const l of tokens) { const i = view.indexOf(l, at); assert.ok(i >= at, `${l} out of order`); at = i; }
  for (const l of ["label: 'Coupon code'", "'Plans'", "label: 'Limit total uses'", "label: 'Total uses'"]) assert.ok(view.includes(l), l);
  assert.doesNotMatch(view, /window\.(alert|confirm|prompt)|\bconfirm\(|\balert\(/);
  assert.doesNotMatch(view, /style="|innerHTML|window\.scroll|\.focus\(\)/);
  assert.ok(view.includes('getRandomValues'));
});

test('routes and links', () => {
  assert.ok(app.includes("import { adminCouponsView } from './views/admincoupons.js';"));
  assert.ok(app.includes("['/admin/coupons', adminCouponsView, APP],"));
  assert.ok(admin.includes("h('a', { class: 'btn btn--secondary', href: '#/admin/coupons' }, 'Plan coupons')"));
  assert.ok(admin.indexOf("'Plan coupons'") < admin.indexOf("'Support queue'"));
});

test('#45 bottom bar says Groups and Help; the sidebar keeps the long names', () => {
  assert.match(app, /BOTTOM_LABELS = \{[^}]*'Group bookings': 'Groups'[^}]*\}/);
  assert.match(app, /BOTTOM_LABELS = \{[^}]*'Help & support': 'Help'[^}]*\}/);
  assert.match(app, /BOTTOM_LABELS = \{[^}]*'Rent & Expenses': 'Rent'[^}]*\}/);
  assert.ok(app.includes('BOTTOM_LABELS[t] || t'));
  assert.ok(app.includes("['/groups', 'Group bookings', 'users']"));
  assert.ok(app.includes("['/help', 'Help & support', 'help']"));
});

test('R1 and A1 CSS needs', () => {
  assert.match(css, /\.col-md-show\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(css, /@media \(min-width: 960px\) and \(max-width: 1439px\)\s*\{[^@]*\.col-md-hide\s*\{\s*display:\s*none;?\s*\}[^@]*\.col-md-show\s*\{\s*display:\s*block;?\s*\}/);
  assert.match(css, /@media \(max-width: 959px\)\s*\{\s*\.table--stack \.col-md-show[^{]*\{\s*display:\s*none/);
  const r = css.match(/\.res-listing__name\s*\{([^}]*)\}/)[1];
  assert.match(r, /overflow-wrap:\s*anywhere/);
  assert.match(r, /-webkit-line-clamp:\s*2/);
  assert.match(r, /(^|[^-])line-clamp:\s*2/);
  assert.match(css, /\.acct-hero__name\s*\{\s*font-size:\s*1\.5rem/);
  assert.doesNotMatch(css, /\.acct-hero__main h1/);
});
