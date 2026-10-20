'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');

test('an open Plan & billing card re-reads billing when the tab shows again or the window gets focus', () => {
  assert.match(src, /addEventListener\('visibilitychange', /);
  assert.match(src, /addEventListener\('focus', /);
  assert.match(src, /document\.hidden/);
});

test('the re-read is throttled to one per 5 seconds', () => {
  assert.match(src, /5000/);
  assert.match(src, /Date\.now\(\) - lastWatch/);
});

test('a changed pending payment, paid_until or plan refreshes the user and redraws, like PAYMENT_RECEIVED', () => {
  assert.match(src, /billSigOf\(fresh\) !== billSig\) \{/);
  assert.match(src, /JSON\.stringify\(\[bill\.pending_payment/);
  assert.match(src, /billSig = billSigOf\(bill\)/);
});

test('the listeners are removed when the page is left and before each redraw', () => {
  assert.match(src, /removeEventListener\('visibilitychange'/);
  assert.match(src, /removeEventListener\('focus'/);
  assert.match(src, /stopBillWatch\(\);\n  let billingNotice/);
  assert.match(src, /location\.hash\.startsWith\('#\/settings'\)/);
});

test('the watcher never moves focus or scroll itself', () => {
  const m = src.match(/function startBillWatch[\s\S]*?\n}\n/);
  assert.ok(m, 'startBillWatch exists');
  assert.doesNotMatch(m[0], /\.focus\(|scrollTo|scrollIntoView/);
});

// ---- round 23 SETTINGS: invite check hook (LT-1) and trailing billing check (CARD-2) ----
test('the invite form passes every problem to makeForm in one pass through a check hook', () => {
  assert.match(src, /check: \(d\) => \{ const p = propertyProblem\(d\); return p \? \{ property_ids: p \} : null; \}/);
  assert.match(src, /data-field|dataset: \{ field: 'property_ids' \}/);
});

test('a returning tab inside the 5 s window schedules one trailing check; leaving settings clears it', () => {
  const m = src.match(/function startBillWatch[\s\S]*?\n}\n/)[0];
  assert.match(m, /let trailing = null/);
  assert.match(m, /const wait = 5000 - \(Date\.now\(\) - lastWatch\)/);
  assert.match(m, /if \(wait > 0\) \{ if \(!trailing\) trailing = setTimeout\(/);
  assert.match(m, /clearTimeout\(trailing\)/);
});

test('trailing check behaves: two returns 1 s apart make one request now and one at 5 s', async () => {
  const m = src.match(/function startBillWatch[\s\S]*?\n}\n/)[0];
  const calls = [];
  let now = 1e6;
  const timers = [];
  const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const win = { addEventListener() {}, removeEventListener() {} };
  const loc = { hash: '#/settings' };
  const body = m.replace(/^function startBillWatch/, 'return function startBillWatch');
  const make = new Function('document', 'window', 'location', 'Date', 'setTimeout', 'clearTimeout', 'get', 'billSigOf', 'billSig', 'refreshUser', 'stopBillWatch', body);
  const fakeDate = { now: () => now };
  let stopped = false;
  const start = make(doc, win, loc, fakeDate, (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, async () => { calls.push(now); return {}; }, () => 'x', 'x', async () => {}, () => { stopped = true; });
  let check;
  doc.addEventListener = (ev, fn) => { if (ev === 'visibilitychange') check = fn; };
  start(() => {});
  await check(); assert.equal(calls.length, 1);
  now += 1000; await check();
  assert.equal(calls.length, 1); assert.equal(timers.length, 1); assert.equal(timers[0].ms, 4000);
  await check(); assert.equal(timers.length, 1, 'only one pending timer');
  now += 4000; await timers[0].fn(); await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
});

test('background billing redraw re-seats focus on the new heading only when focus was free or on the heading', () => {
  assert.match(src, /const free = !a \|\| a === document\.body \|\| a === oldH1;/);
  assert.match(src, /if \(free\) await seatOnHeading\(oldH1\);/);
  assert.match(src, /h1\.focus\(\{ preventScroll: true \}\)/);
  // never on a control: focus only moves when BODY holds it
  assert.match(src, /if \(!a \|\| a === document\.body\) \{ h1\.setAttribute/);
  assert.match(src, /wait = 5000 - \(Date\.now\(\) - lastWatch\)/);
});
