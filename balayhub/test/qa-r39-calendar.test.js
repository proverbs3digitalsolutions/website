'use strict';

require('./helpers');

// QA round 39, CALENDAR (row 35 of the round 39 busy-control audit, D-121). A calendar bar that opens a block's "Remove this
// block?" question started the removal and walked away: the bar was never marked while it waited, so a second press could
// open a second question. openBar now returns the block menu's promise, so the shared press guard in ui.js marks the bar busy
// until the answer and the request end. Frontend-only: openBar and blockMenu are cut out of calendar.js and run with stubs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// R39_CALENDAR_SRC is for the proof runs only (a copy of the 1b4bd92 file, or a copy with one line reverted).
const src = fs.readFileSync(process.env.R39_CALENDAR_SRC || path.join(__dirname, '../public/js/views/calendar.js'), 'utf8');

// The whole text of one function, from its `function` keyword (with `async` when it has it) to the brace that closes its body.
function extract(name) {
  const start = src.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start > -1, `${name} is in calendar.js`);
  let depth = 0;
  for (let k = src.indexOf('{', src.indexOf(')', start)); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(start, k + 1);
  }
  assert.fail(`${name} has a closing brace`);
}

// Runs blockMenu and openBar with the names they call stubbed, and returns openBar.
function load(stubs) {
  const names = Object.keys(stubs);
  const body = `${extract('blockMenu')}\n${extract('openBar')}\nreturn openBar;`;
  return new Function(...names, body)(...names.map((n) => stubs[n]));
}

const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

// answer: what the person says to the question. reply: the server's answer to the removal (a function returning a promise).
function harness({ answer = true, reply = () => Promise.resolve({}) } = {}) {
  const calls = { confirm: 0, post: [], navigate: [], toast: [], reload: 0 };
  const openBar = load({
    confirmDialog: async () => { calls.confirm++; return answer; },
    post: (url) => { calls.post.push(url); return reply(); },
    navigate: (hash) => { calls.navigate.push(hash); },
    canManage: true,
    toast: (msg, kind) => { calls.toast.push([msg, kind]); },
    reload: () => { calls.reload++; },
    addDays,
    fmtDate: (d) => d,
  });
  return { openBar, calls };
}

// 'pending' while the promise still waits. The marker is a macrotask, so anything that settles on microtasks alone has settled by then.
const PENDING = 'pending';
const stateOf = (value) => Promise.race([
  Promise.resolve(value).then(() => 'settled', () => 'settled'),
  new Promise((resolve) => setImmediate(() => resolve(PENDING))),
]);

const BLOCK = { kind: 'block', booking_id: 'BLK1', check_in: '2027-09-20', check_out: '2027-09-21', block_reason: 'Owner stay', from_channel: null };
const STAY = { kind: 'reservation', booking_id: 'RES1', check_in: '2027-09-20', check_out: '2027-09-22', from_channel: null };

test('a block bar: openBar returns the removal, so the bar waits while the question and the request run (D-121)', async () => {
  let finish;
  const { openBar, calls } = harness({ reply: () => new Promise((resolve) => { finish = resolve; }) });
  const press = openBar(BLOCK);
  assert.equal(await stateOf(press), PENDING, 'openBar is still waiting while the removal request is pending');
  assert.deepEqual(calls.post, ['/blocks/BLK1/remove']);
  finish({});
  await press;
  assert.deepEqual(calls.toast, [['Block removed.', undefined]]);
  assert.equal(calls.reload, 1);
});

test('a block removal the server refuses is toasted, and the bar still settles', async () => {
  const { openBar, calls } = harness({ reply: () => Promise.reject(new Error('This block is in use.')) });
  assert.equal(await stateOf(openBar(BLOCK)), 'settled');
  assert.deepEqual(calls.toast, [['This block is in use.', 'error']]);
  assert.equal(calls.reload, 0);
});

test('a block the person keeps sends nothing, and the bar settles at once', async () => {
  const { openBar, calls } = harness({ answer: false });
  assert.equal(await stateOf(openBar(BLOCK)), 'settled');
  assert.equal(calls.confirm, 1);
  assert.deepEqual(calls.post, []);
});

test('a reservation bar opens the reservation at once and sends nothing', async () => {
  const { openBar, calls } = harness();
  assert.equal(await stateOf(openBar(STAY)), 'settled');
  assert.deepEqual(calls.navigate, ['#/reservations/RES1']);
  assert.equal(calls.confirm, 0);
  assert.deepEqual(calls.post, []);
});

test('the bar and the price cell under a booking return openBar, so the press guard waits for it', () => {
  assert.ok(src.includes('async function openBar(b) {'), 'openBar is async, so it always returns a promise');
  assert.ok(src.includes("if (b.kind === 'block') return blockMenu(b);"), 'openBar returns the block menu');
  assert.ok(src.includes('onclick: (e) => { e.stopPropagation(); return openBar(b); },'), 'the bar returns openBar');
  assert.ok(src.includes('if (taken) return openBar(taken);'), 'the price cell under a booking returns openBar');
});
