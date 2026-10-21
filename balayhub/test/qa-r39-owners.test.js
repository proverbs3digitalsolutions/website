'use strict';
require('./helpers');
// QA round 39, OWNERS (D-121, row MNY-1). The statement's Publish, Unpublish to correct and Send to owner handlers started
// their request without waiting for it, so the button was not marked busy while the request ran and a second press asked
// the question again. Rule: a press handler awaits the request it starts, so the press guard in ui.js can mark the button.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/owners.js'), 'utf8');

// The statement's action handlers, as owners.js defines them: from `const act = async` to the line before `const monthInput`.
// They sit inside the statement view's closure, so they run here with a stub for every name they read.
function statementActions(stubs) {
  const start = SRC.indexOf('  const act = async (path, body, okText) => {');
  const end = SRC.indexOf('  const monthInput = h(', start);
  assert.ok(start > 0 && end > start, 'the statement action block is in owners.js');
  const names = Object.keys(stubs);
  const factory = new Function(...names, `${SRC.slice(start, end)}\nreturn { act, publish, unpublish, send };`);
  return factory(...names.map((k) => stubs[k]));
}

function harness({ confirmAnswer = true, post } = {}) {
  const calls = { posts: [], toasts: [], rerenders: 0, questions: [] };
  const stubs = {
    base: '/unit-owners/o1',
    month: '2026-09',
    s: { month_label: 'September 2026' },
    live: { owner: { email: 'owner@example.test' } },
    record: { sent_at: null },
    portalOn: false,
    post: (url, body) => { calls.posts.push({ url, body }); return post(url, body); },
    confirmDialog: async (opts) => { calls.questions.push(opts.title); return confirmAnswer; },
    publishText: () => 'publish text',
    unpublishText: () => 'unpublish text',
    fmtDate: (d) => d,
    manilaDay: (d) => d,
    toast: (text, kind) => { calls.toasts.push({ text, kind }); },
    rerender: () => { calls.rerenders++; },
  };
  return { calls, ...statementActions(stubs) };
}

// True once the promise has settled. It waits a macrotask, so a promise that settles on a microtask has settled by then.
async function settled(p) {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  await new Promise((r) => setTimeout(r, 10));
  return done;
}

test('Publish waits for its request, so the button stays busy while it sends (D-121)', async () => {
  let release;
  const h = harness({ post: () => new Promise((r) => { release = r; }) });
  const p = h.publish();
  assert.equal(await settled(p), false, 'publish is still waiting for the publish request');
  assert.equal(h.calls.posts.length, 1);
  assert.equal(h.calls.posts[0].url, '/unit-owners/o1/statement/publish');
  release({});
  await p;
  assert.equal(h.calls.toasts[0].text, 'Statement published.');
  assert.equal(h.calls.rerenders, 1);
});

test('Unpublish to correct waits for its request, so the button stays busy while it sends (D-121)', async () => {
  let release;
  const h = harness({ post: () => new Promise((r) => { release = r; }) });
  const p = h.unpublish();
  assert.equal(await settled(p), false, 'unpublish is still waiting for the unpublish request');
  assert.equal(h.calls.posts[0].url, '/unit-owners/o1/statement/unpublish');
  release({});
  await p;
  assert.equal(h.calls.toasts[0].text, 'Statement is a draft again.');
});

test('Send to owner waits for its request, so the button stays busy while it sends (D-121)', async () => {
  let release;
  const h = harness({ post: () => new Promise((r) => { release = r; }) });
  const p = h.send();
  assert.equal(await settled(p), false, 'send is still waiting for the send request');
  assert.equal(h.calls.posts[0].url, '/unit-owners/o1/statement/send');
  release({});
  await p;
  assert.equal(h.calls.toasts[0].text, 'Statement sent to owner@example.test.');
});

test('a question answered no sends nothing for any of the three actions', async () => {
  const h = harness({ confirmAnswer: false, post: async () => ({}) });
  await h.publish();
  await h.unpublish();
  await h.send();
  assert.equal(h.calls.questions.length, 3);
  assert.equal(h.calls.posts.length, 0);
});

test('a refused request ends the wait and shows its message as an error toast', async () => {
  let fail;
  const h = harness({ post: () => new Promise((_, rej) => { fail = rej; }) });
  const p = h.publish();
  assert.equal(await settled(p), false);
  fail(new Error('QA owners refused.'));
  await p;
  assert.deepEqual(h.calls.toasts, [{ text: 'QA owners refused.', kind: 'error' }]);
  assert.equal(h.calls.rerenders, 0);
});
