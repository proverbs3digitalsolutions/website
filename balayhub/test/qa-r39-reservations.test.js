'use strict';
require('./helpers');

// QA round 39, RESERVATIONS (audit rows 15 and 34, D-121). "Deduct from deposit" awaits its request, so its button stays busy
// until the request ends (C2.2). The lost-and-found status select marks itself while it saves, puts back a second change, and
// clears its mark after a success or a refusal (C2.4). Frontend-only: the two cards are cut from reservations.js and run with stubs
// (the module itself imports the whole app shell, so it cannot be loaded in Node).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
// The status tables and the two cards, from the first table to the column-0 brace that closes lostFoundCard.
const START = SRC.indexOf('const DAMAGE_STATUS =');
const END = SRC.indexOf('\n}\n', SRC.indexOf('async function lostFoundCard(')) + 3;
const CODE = SRC.slice(START, END);
const NAMES = ['h', 'get', 'post', 'patch', 'toast', 'confirmDialog', 'formModal', 'field', 'peso', 'fmtDate', 'manilaDay', 'badge'];

class El {
  constructor(tag, props, kids) {
    this.tag = tag;
    this.props = props || {};
    this.children = kids;
    this.attrs = {};
    this.dataset = {};
    this.value = '';
    if (tag === 'select') {
      const picked = kids.find((o) => o.props.selected);
      this.value = picked ? picked.props.value : (kids[0] ? kids[0].props.value : '');
    }
  }

  setAttribute(k, v) { this.attrs[k] = String(v); }

  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }

  removeAttribute(k) { delete this.attrs[k]; }
}

const flat = (list) => list.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);

function find(node, pred) {
  if (!(node instanceof El)) return null;
  if (pred(node)) return node;
  for (const c of node.children) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}

// A promise the test settles by hand.
function gate() {
  let resolve;
  let reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { p, resolve, reject };
}

// Records whether a promise has settled, and how.
function track(p) {
  const s = { done: false, value: undefined, error: undefined };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  return s;
}

const flush = () => new Promise((r) => setImmediate(r));

// Loads the two cards from the source with stub helpers. `postImpl` and `patchImpl` return the request each test controls.
function world({ getReply, postImpl, patchImpl, confirmAnswer }) {
  const calls = { post: [], patch: [], toast: [], rerender: 0, confirm: 0 };
  const stubs = {
    h: (tag, props, ...kids) => new El(tag, props, flat(kids)),
    get: async () => getReply,
    post: (...args) => { calls.post.push(args); return postImpl(); },
    patch: (...args) => { calls.patch.push(args); return patchImpl(); },
    toast: (...args) => { calls.toast.push(args); },
    confirmDialog: async () => { calls.confirm++; return confirmAnswer; },
    formModal: () => { throw new Error('not used here'); },
    field: () => null,
    peso: (x) => `P${x}`,
    fmtDate: (x) => String(x),
    manilaDay: (x) => x,
    badge: (cls, text) => new El('span', { class: cls }, [text]),
  };
  const rerender = () => { calls.rerender++; };
  const make = new Function(...NAMES, `${CODE}\nreturn { damageCard, lostFoundCard };`);
  const cards = make(...NAMES.map((n) => stubs[n]));
  return { calls, rerender, ...cards };
}

const DAMAGE = { reports: [{ report_id: 'd1', description: 'Broken lamp', status: 'open', estimated_cost: 500, created_at: '2026-10-01' }] };
const LOST = { items: [{ item_id: 'i1', description: 'Phone charger', status: 'held', found_where: 'Lobby', found_on: '2026-10-01', status_note: null }] };

test('the source has the two cards and their tables (the cut is not empty)', () => {
  assert.ok(START > 0 && END > START);
  assert.match(CODE, /async function damageCard\(/);
  assert.match(CODE, /async function lostFoundCard\(/);
});

test('Deduct from deposit: the button waits for the deduct request (C2.2)', async () => {
  const pending = gate();
  const w = world({ getReply: DAMAGE, postImpl: () => pending.p, confirmAnswer: true });
  const card = await w.damageCard({ booking_id: 'b1' }, w.rerender);
  const btn = find(card, (n) => n.tag === 'button' && /^Deduct from deposit for/.test(n.props['aria-label']));
  assert.ok(btn, 'the Deduct from deposit button is on the card');

  const p = track(btn.props.onclick());
  await flush();
  assert.equal(w.calls.post.length, 1, 'the deduct request was sent');
  assert.equal(w.calls.post[0][0], '/damage-reports/d1/deduct');
  assert.equal(p.done, false, 'the handler stays pending while the request is pending');

  pending.resolve({});
  await flush();
  assert.equal(p.done, true, 'the handler settles when the request settles');
  assert.equal(p.error, undefined);
  assert.deepEqual(w.calls.toast[0], ['Marked to deduct from the deposit.']);
  assert.equal(w.calls.rerender, 1);
});

test('Deduct from deposit: a refused request settles the handler and shows the refusal', async () => {
  const pending = gate();
  const w = world({ getReply: DAMAGE, postImpl: () => pending.p, confirmAnswer: true });
  const card = await w.damageCard({ booking_id: 'b1' }, w.rerender);
  const btn = find(card, (n) => n.tag === 'button' && /^Deduct from deposit for/.test(n.props['aria-label']));

  const p = track(btn.props.onclick());
  await flush();
  assert.equal(p.done, false);

  pending.reject(new Error('QA r39 refused.'));
  await flush();
  assert.equal(p.done, true, 'the handler settles after a refusal');
  assert.equal(p.error, undefined, 'the refusal is shown by the toast, not thrown');
  assert.deepEqual(w.calls.toast[0], ['QA r39 refused.', 'error']);
});

test('Deduct from deposit: a cancelled question sends nothing and settles', async () => {
  const w = world({ getReply: DAMAGE, postImpl: () => Promise.resolve({}), confirmAnswer: false });
  const card = await w.damageCard({ booking_id: 'b1' }, w.rerender);
  const btn = find(card, (n) => n.tag === 'button' && /^Deduct from deposit for/.test(n.props['aria-label']));

  const p = track(btn.props.onclick());
  await flush();
  assert.equal(p.done, true);
  assert.equal(w.calls.post.length, 0);
});

test('lost and found: the status select marks itself while it saves (C2.4)', async () => {
  const pending = gate();
  const w = world({ getReply: LOST, postImpl: () => Promise.resolve({}), patchImpl: () => pending.p });
  const card = await w.lostFoundCard({ booking_id: 'b1' }, w.rerender);
  const sel = find(card, (n) => n.tag === 'select');
  assert.ok(sel, 'the status select is on the card');
  assert.equal(sel.value, 'held');

  sel.value = 'returned';
  const p = track(sel.props.onchange({ target: sel }));
  await flush();
  assert.equal(w.calls.patch.length, 1);
  assert.deepEqual(w.calls.patch[0], ['/lost-found/i1', { status: 'returned' }]);
  assert.equal(sel.getAttribute('aria-disabled'), 'true', 'the select is marked while it saves');
  assert.notEqual(sel.disabled, true, 'the select is not disabled (it would drop focus)');
  assert.equal(sel.dataset.saving, 'returned', 'the value being saved is recorded');
  assert.equal(p.done, false, 'the handler stays pending while the request is pending');
});

test('lost and found: a second change while the select saves is put back and sends nothing (C2.4)', async () => {
  const pending = gate();
  const w = world({ getReply: LOST, postImpl: () => Promise.resolve({}), patchImpl: () => pending.p });
  const card = await w.lostFoundCard({ booking_id: 'b1' }, w.rerender);
  const sel = find(card, (n) => n.tag === 'select');

  sel.value = 'returned';
  sel.props.onchange({ target: sel });
  await flush();
  sel.value = 'disposed';
  sel.props.onchange({ target: sel });
  await flush();

  assert.equal(sel.value, 'returned', 'the second change is put back to the value being saved');
  assert.equal(w.calls.patch.length, 1, 'no second request was sent');
});

test('lost and found: the mark goes after a success', async () => {
  const pending = gate();
  const w = world({ getReply: LOST, postImpl: () => Promise.resolve({}), patchImpl: () => pending.p });
  const card = await w.lostFoundCard({ booking_id: 'b1' }, w.rerender);
  const sel = find(card, (n) => n.tag === 'select');

  sel.value = 'returned';
  const p = track(sel.props.onchange({ target: sel }));
  await flush();
  pending.resolve({});
  await flush();

  assert.equal(p.done, true);
  assert.equal(sel.getAttribute('aria-disabled'), null, 'the mark is gone after the answer');
  assert.equal(sel.dataset.saving, undefined, 'the saving value is cleared');
  assert.deepEqual(w.calls.toast[0], ['Updated.']);
  assert.equal(w.calls.rerender, 1);
});

test('lost and found: the mark goes after a refusal, and the refusal is shown', async () => {
  const pending = gate();
  const w = world({ getReply: LOST, postImpl: () => Promise.resolve({}), patchImpl: () => pending.p });
  const card = await w.lostFoundCard({ booking_id: 'b1' }, w.rerender);
  const sel = find(card, (n) => n.tag === 'select');

  sel.value = 'disposed';
  const p = track(sel.props.onchange({ target: sel }));
  await flush();
  pending.reject(new Error('QA r39 refused.'));
  await flush();

  assert.equal(p.done, true);
  assert.equal(sel.getAttribute('aria-disabled'), null, 'the mark is gone after a refusal');
  assert.equal(sel.dataset.saving, undefined);
  assert.deepEqual(w.calls.toast[0], ['QA r39 refused.', 'error']);
});

test('lost and found: choosing the status the item already has sends nothing and marks nothing', async () => {
  const w = world({ getReply: LOST, postImpl: () => Promise.resolve({}), patchImpl: () => Promise.resolve({}) });
  const card = await w.lostFoundCard({ booking_id: 'b1' }, w.rerender);
  const sel = find(card, (n) => n.tag === 'select');

  sel.value = 'held';
  const p = track(sel.props.onchange({ target: sel }));
  await flush();
  assert.equal(p.done, true);
  assert.equal(w.calls.patch.length, 0);
  assert.equal(sel.getAttribute('aria-disabled'), null);
});
