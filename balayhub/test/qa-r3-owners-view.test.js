'use strict';

// QA round 3, lane C11 (owners view). Frontend source scan plus pure helpers read out of the view file: the view imports the app shell, which does not load in Node.
// 1. The statements banner counts only drafts whose month has ended (owners#19). A draft for a month still running cannot be published yet.
// 2. A published statement for an owner with no email shows Send to owner disabled, with the reason in plain text (owners#20).
// node --test --test-concurrency=1 test/qa-r3-owners-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'owners.js'), 'utf8');
const between = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const listView = between('export async function ownerStatementsView', 'export async function ownerStatementView');
const statusBar = between('// Status bar.', '// Payouts card.');

// The month rule helpers sit together near the top of the file, ending at a blank line.
function loadHelpers() {
  const start = src.indexOf('const monthHasEnded');
  assert.notEqual(start, -1, 'monthHasEnded helper is missing');
  const end = src.indexOf('\n\n', src.indexOf('const readyCount', start));
  return new Function(`${src.slice(start, end)}\nreturn { monthHasEnded, readyCount };`)();
}

test('a draft counts as ready only once its month has ended (owners#19)', () => {
  const { monthHasEnded, readyCount } = loadHelpers();
  const rows = [{ status: 'draft' }, { status: 'published' }, { status: 'draft' }, { status: 'draft' }];
  assert.equal(monthHasEnded('2026-09', '2026-10-14'), true);
  assert.equal(monthHasEnded('2026-10', '2026-10-14'), false);
  assert.equal(readyCount(rows, '2026-09', '2026-10-14'), 3, 'an ended month: every draft is ready');
  assert.equal(readyCount(rows, '2026-10', '2026-10-14'), 0, 'the running month: no draft is ready');
  assert.equal(readyCount(rows, '2026-11', '2026-10-14'), 0, 'a future month: no draft is ready');
  assert.equal(readyCount(rows, '2026-12', '2027-01-03'), 3, 'the year turns over correctly');
  assert.equal(readyCount([{ status: 'published' }], '2026-09', '2026-10-14'), 0, 'published rows are never counted');
});

test('the banner uses the ready count, and a running month says its drafts can be published once it ends (owners#19)', () => {
  assert.ok(listView.includes('const ready = readyCount(list, month, todayManila());'));
  assert.ok(listView.includes("ready > 0 && h('div', { class: 'alert alert--info' }, `${ready} statement${ready === 1 ? ' is' : 's are'} ready to publish."));
  assert.ok(listView.includes('!ready && drafts > 0'));
  assert.ok(listView.includes('can be published once the month ends.'));
  // The old wording told the host to publish every draft, including months that cannot be published yet.
  assert.doesNotMatch(listView, /still a draft/);
});

test('the Publish gate and the list banner use the same month rule (owners#19)', () => {
  const view = src.slice(src.indexOf('export async function ownerStatementView'));
  assert.ok(view.includes('const monthEnded = monthHasEnded(month, todayManila());'));
  assert.doesNotMatch(src, /const monthEnded = month < todayManila\(\)/);
});

test('Send to owner follows the owner\'s current email, and is disabled with a reason when there is none (owners#20)', () => {
  // Same pattern as the Publish button: disabled, with the reason as the title.
  assert.ok(statusBar.includes("disabled: !live.owner.email, title: live.owner.email ? null : 'Add an email for this owner first.'"));
  // The reason is also visible on screen, not only in a tooltip.
  assert.match(statusBar, /published && !live\.owner\.email && h\('span', \{ class: 'muted small' \}, 'Add an email for this owner first\.'\)/);
  // The server sends to the live owner record, so the gate and the recipient must not use the frozen copy.
  assert.doesNotMatch(src, /s\.owner\.email/);
  assert.doesNotMatch(statusBar, /published && s\.owner\.email/);
});

test('the Send confirmation names the live address the server will use', () => {
  const send = between('const send = async () => {', 'const monthInput');
  assert.ok(send.includes('to ${live.owner.email}?'));
  assert.ok(send.includes('Statement sent to ${live.owner.email}.'));
});
