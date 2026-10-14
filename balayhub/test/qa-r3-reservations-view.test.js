'use strict';
// Reservations view (QA round 3, lane C05): channel fee on direct bookings, cancelled-refund alert wording,
// list column order for phones, and the on-screen receipt's adjustments line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
// The view imports browser modules, so pull the pure helper out of the source and give it a peso formatter.
const grab = (name) => src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Loaded inside the tests that need it, so one missing export does not hide the source-scan results below.
const loadRefundAlertText = () => new Function('peso', `${grab('refundAlertText')}\nreturn refundAlertText;`)(peso);
const loadChannelFeeToSave = () => new Function(`${grab('channelFeeToSave')}\nreturn channelFeeToSave;`)();

test('cancelled with no suggestion says what is held and never blames a policy', () => {
  const refundAlertText = loadRefundAlertText();
  const t = refundAlertText({ suggestion: null, refundable: '5500.00', paid: '8000.00', policy: null });
  assert.doesNotMatch(t, /policy suggests/);
  assert.match(t, /₱5,500\.00 of ₱8,000\.00 paid is still held/);
  assert.match(t, /No cancellation policy is set, so no refund is suggested\./);
});

test('a Custom policy gets no automatic suggestion', () => {
  const refundAlertText = loadRefundAlertText();
  const t = refundAlertText({ suggestion: null, refundable: '5500.00', paid: '8000.00', policy: { key: 'custom', label: 'Custom' } });
  assert.doesNotMatch(t, /policy suggests/);
  assert.match(t, /A Custom policy has no automatic suggestion\./);
});

test('with a suggestion the alert names the suggested amount', () => {
  const refundAlertText = loadRefundAlertText();
  const t = refundAlertText({ suggestion: { amount: '2750.00' }, refundable: '8000.00', paid: '8000.00', policy: { key: 'flexible' } });
  assert.match(t, /policy suggests refunding ₱2,750\.00 of ₱8,000\.00 paid/);
});

test('the reservation page uses the refund alert helper', () => {
  assert.match(src, /refundAlertText\(\{ suggestion: sug, refundable: heldInfo\.refundable, paid: heldInfo\.paid, policy: heldInfo\.policy \}\)/);
});

test('channel fee box is hidden on direct bookings, and switching to Direct empties it (create and edit)', () => {
  assert.match(src, /hint: 'What Airbnb, Booking\.com, Agoda or another channel keeps\.'/);
  assert.match(src, /form\.querySelector\('\[data-field=channel_fee\]'\)\.hidden = direct;/);
  assert.match(src, /if \(switched && direct\) form\.elements\.channel_fee\.value = '';/);
  assert.equal((src.match(/syncChannelFee\(form, true\)/g) || []).length, 2, 'create and edit both wire the change handler');
});

test('a direct booking with a stored fee is sent as 0 on save, so Edit clears it (server contract)', () => {
  const channelFeeToSave = loadChannelFeeToSave();
  assert.equal(channelFeeToSave('direct', '300.00', ''), '0', 'switching to Direct with a stored fee sends 0 with the channel');
  assert.equal(channelFeeToSave('direct', '300.00', '250'), '0', 'a typed fee cannot keep a fee on a direct booking');
  assert.equal(channelFeeToSave('direct', '0.00', ''), '', 'nothing stored: blank is left as it is');
  assert.equal(channelFeeToSave('airbnb', '300.00', '300.00'), '300.00', 'a channel booking keeps what was typed');
  assert.equal(channelFeeToSave('airbnb', '0.00', '150'), '150');
  assert.match(src, /d\.channel_fee = channelFeeToSave\(d\.channel, r\.channel_fee, d\.channel_fee\);/);
});

test('Edit tells the host that saving removes a stored fee on a direct booking', () => {
  assert.match(src, /r\.channel_fee_ignored && h\('p', \{ class: 'muted small' \}, `Direct bookings have no channel fee\. Saving this form removes the \$\{peso\(r\.channel_fee\)\} fee that is stored on it\.`\)/);
});

test('Payment card warns about a stored fee on a direct booking and drops the deduction line', () => {
  assert.match(src, /confirmed && r\.channel_fee_ignored && h\('div', \{ class: 'alert alert--warn'/);
  assert.match(src, /This direct booking has a \$\{peso\(r\.channel_fee\)\} channel fee\. Direct bookings don't have one, so the guest is asked for the full amount\. Edit the booking to clear it, or change Booked through\./);
  // The Channel fee deduction line and the Record payment note both skip an ignored fee.
  const withoutIgnored = src.match(/Number\(r\.channel_fee\) > 0 && !r\.channel_fee_ignored/g) || [];
  assert.ok(withoutIgnored.length >= 2, `expected the ignored-fee guard twice, found ${withoutIgnored.length}`);
  assert.doesNotMatch(src, /Number\(r\.channel_fee\) > 0 \? ` \(after the/);
});

test('cancelled alert and refund wording follow the policy (money#12)', () => {
  assert.doesNotMatch(src, /`Cancelled: policy suggests refunding \$\{peso\(stillToRefund\)\}/);
  assert.match(src, /Cancelled: policy suggests refunding/); // kept inside the helper for the suggested case
});

test('list puts Total and Balance right after the dates and hides Channel and Code on phones (Check-out and Listing show on the phone cards, D-80)', () => {
  const head = src.slice(src.indexOf("h('thead'"), src.indexOf("h('tbody'"));
  assert.ok(head.indexOf("'Total'") < head.indexOf("'Guest'"), 'Total before Guest');
  assert.ok(head.indexOf("'Balance'") < head.indexOf("'Guest'"), 'Balance before Guest');
  assert.ok(head.indexOf("'Check-out'") < head.indexOf("'Total'"), 'Total after Check-out');
  // Phone rows are cards (D-80): only Channel and Code carry col-sm-hide.
  for (const shown of ["h('th', null, 'Check-in')", "h('th', null, 'Check-out')", "h('th', { class: 'num' }, 'Total')", "h('th', { class: 'num' }, 'Balance')", "h('th', null, 'Guest')", "h('th', null, 'Listing')"]) {
    assert.ok(head.includes(shown), `visible on phones: ${shown}`);
  }
  for (const name of ['Channel', 'Code']) {
    assert.match(head, new RegExp(`class: 'col-sm-hide' \\}, '${name}'`), `hidden on phones: ${name}`);
  }
  const body = src.slice(src.indexOf("h('tbody'"), src.indexOf('viewSelect.addEventListener'));
  // The guest cell is the strong name; the check-in link's aria-label (QA round 8 #42) also mentions the guest name, so it is not matched.
  assert.ok(body.indexOf('peso(r.total_amount)') < body.indexOf("h('strong', null, r.guest_name"), 'Total cell before Guest cell');
  assert.ok(body.indexOf('peso(r.balance)') < body.indexOf("h('strong', null, r.guest_name"), 'Balance cell before Guest cell');
  assert.match(body, /h\('td', null, fmtDate\(r\.check_out\)\)/);
  assert.match(body, /h\('td', null, r\.unit_name/);
  assert.match(body, /h\('td', \{ class: 'col-sm-hide' \}, channelBadge/);
  assert.match(body, /h\('td', \{ class: 'small col-sm-hide' \}, r\.confirmation_code\)/);
});

test('on-screen receipt shows the adjustments line between total and remaining balance', () => {
  const rec = src.slice(src.indexOf('export async function receiptView'));
  assert.match(rec, /Number\(r\.adjustments\) > 0 && \[h\('dt', null, 'Adjustments \(settled through the booking channel\)'\), h\('dd', null, `-\$\{peso\(r\.adjustments\)\}`\)\]/);
  const total = rec.indexOf("'Booking total'");
  const adj = rec.indexOf("'Adjustments (settled through the booking channel)'");
  const remaining = rec.indexOf('receiptBalanceLine(r.balance_after)');
  assert.ok(total < adj && adj < remaining, 'order: Booking total, Adjustments, Remaining balance');
});

test('"You keep" ignores a stored fee on a direct booking, like the balance does', () => {
  assert.match(src, /const keep = Number\(r\.total_amount\) - \(r\.channel_fee_ignored \? 0 : Number\(r\.channel_fee\)\);/);
});
