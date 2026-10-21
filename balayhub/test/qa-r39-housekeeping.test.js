'use strict';

require('./helpers');

// QA round 39, HOUSEKEEPING (audit row 23, OPS-1; D-121). Mark done, Reopen and Cancel task hand their status request back to the
// button: each handler's promise lasts as long as the request, so the shared press guard in ui.js marks the button while it waits.
// Frontend-only: the handlers are extracted from the source and run with stubs (no server, no database).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');

// The source of the block that starts at `start` and ends at the brace that closes it. The blocks read here have balanced
// braces (their strings too), so a plain count is enough; a wrong cut fails the tests below.
function blockAt(start) {
  let depth = 0;
  let opened = false;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') { depth++; opened = true; } else if (src[i] === '}' && --depth === 0 && opened) return src.slice(start, i + 1);
  }
  throw new Error(`no end for the block at ${start}`);
}

// Builds the detail view's handlers from the source, with the view's names stubbed.
function handlers({ task, items, post, toast, rerender, confirmDialog }) {
  const cancelStart = src.search(/onclick: async \(\) => \{\n\s+if \(await confirmDialog\(\{ title: 'Cancel this cleaning task\?'/) + 'onclick: '.length;
  const code = [
    blockAt(src.indexOf('function uncheckedCount(')),
    blockAt(src.indexOf('const setStatus = async')),
    blockAt(src.indexOf('const finish = async')),
    blockAt(src.indexOf('const reopen = async')),
    blockAt(cancelStart),
  ];
  const body = `${code[0]}\n${code[1]};\n${code[2]};\n${code[3]};\nconst cancel = ${code[4]};\nreturn { setStatus, finish, reopen, cancel };`;
  return new Function('t', 'items', 'post', 'toast', 'rerender', 'confirmDialog', 'T', 'peso', body)(
    task, items, post, toast, rerender, confirmDialog, (s) => s, (n) => `P${n}`);
}

// A request the test answers by hand.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// 'settled' once the promise has settled, 'pending' while it still waits after one turn of the event loop.
async function stateOf(p) {
  return Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((res) => setImmediate(() => res('pending')))]);
}

// One view's stubs: the task, its checklist boxes, a question that answers `answer`, and a log of every request.
function view({ answer = true, boxes = [{ checked: true }], pay_amount = null } = {}) {
  const log = { posts: [], toasts: [], asked: [], requests: [] };
  const task = { task_id: 'task-1', status: 'in_progress', pay_amount };
  const post = (url, body) => {
    log.posts.push([url, body]);
    const d = deferred();
    log.requests.push(d);
    return d.promise;
  };
  const toast = (msg) => log.toasts.push(msg);
  const rerender = () => {};
  const confirmDialog = async (opts) => { log.asked.push(opts); return answer; };
  const h = handlers({ task, items: { querySelectorAll: () => boxes }, post, toast, rerender, confirmDialog });
  return { ...h, log };
}

test('Mark done (finish) waits for its status request', async () => {
  const v = view();
  const p = v.finish();
  assert.equal(await stateOf(p), 'pending');
  assert.deepEqual(v.log.posts, [['/cleaning-tasks/task-1/status', { status: 'done' }]]);
  v.log.requests[0].resolve({});
  assert.equal(await stateOf(p), 'settled');
  assert.deepEqual(v.log.toasts, ['Cleaning done. Listing marked clean.']);
});

test('Mark done with an unticked item waits for the answer, then for the request', async () => {
  const v = view({ boxes: [{ checked: true }, { checked: false }], answer: true });
  const p = v.finish();
  assert.equal(await stateOf(p), 'pending');
  assert.equal(v.log.asked.length, 1);
  assert.equal(v.log.posts.length, 1);
  v.log.requests[0].resolve({});
  assert.equal(await stateOf(p), 'settled');
});

test('Mark done with the question answered no sends nothing and settles', async () => {
  const v = view({ boxes: [{ checked: false }], answer: false });
  await v.finish();
  assert.equal(v.log.posts.length, 0);
});

test('Mark done settles after a refused request, with the error on the toast', async () => {
  const v = view();
  const p = v.finish();
  v.log.requests[0].reject(new Error('QA refused.'));
  assert.equal(await stateOf(p), 'settled');
  assert.deepEqual(v.log.toasts, ['QA refused.']);
});

test('Reopen waits for its status request (no pay to clear)', async () => {
  const v = view();
  const p = v.reopen();
  assert.equal(await stateOf(p), 'pending');
  assert.deepEqual(v.log.posts, [['/cleaning-tasks/task-1/status', { status: 'in_progress' }]]);
  v.log.requests[0].resolve({});
  assert.equal(await stateOf(p), 'settled');
});

test('Reopen with a pay amount waits for the answer, then for the request', async () => {
  const v = view({ pay_amount: 500, answer: true });
  const p = v.reopen();
  assert.equal(await stateOf(p), 'pending');
  assert.equal(v.log.asked.length, 1);
  assert.equal(v.log.posts.length, 1);
  v.log.requests[0].resolve({});
  assert.equal(await stateOf(p), 'settled');
});

test('Cancel task waits for its status request after the answer', async () => {
  const v = view({ answer: true });
  const p = v.cancel();
  assert.equal(await stateOf(p), 'pending');
  assert.equal(v.log.asked.length, 1);
  assert.deepEqual(v.log.posts, [['/cleaning-tasks/task-1/status', { status: 'cancelled' }]]);
  v.log.requests[0].resolve({});
  assert.equal(await stateOf(p), 'settled');
  assert.deepEqual(v.log.toasts, ['Task cancelled.']);
});

test('Cancel task answered no sends nothing and settles', async () => {
  const v = view({ answer: false });
  await v.cancel();
  assert.equal(v.log.posts.length, 0);
});

test('every setStatus call is awaited, returned or an arrow body, and the change carries the D-121 comment', () => {
  const dropped = [...src.matchAll(/(?<!await |return |=> )\bsetStatus\(/g)];
  assert.equal(dropped.length, 0, `setStatus calls that drop their request: ${dropped.map((m) => src.slice(0, m.index).split('\n').length).join(', ')}`);
  assert.equal(src.split('// awaited: the button stays busy until the request ends (D-121).').length - 1, 1);
});
