'use strict';

// QA round 2, inbox view lane (A10): Mark unread returns to the list, list previews show "@Name",
// composer errors clear when the message or the send-later time changes, a send-later time that has
// passed asks first, a failed list load keeps the filter bar, the no-email hint, and the automatic
// message row hook for phones. Frontend-only: no database. inbox.js is loaded from a temp copy of
// public/js with app.js replaced by a stub that exports the names the view tree imports from it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

let inbox;
let dir;
test.before(async () => {
  globalThis.Element = class { }; // ui.js patches Element.prototype when it loads
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-inbox-view-'));
  fs.cpSync(path.join(__dirname, '..', 'public', 'js'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'app.js'), [
    'export const state = { user: null, requireEmailVerification: true };',
    'export const navigate = () => {};',
    'export const refreshUser = async () => {};',
    'export const logout = async () => {};',
    'export const afterLogin = async () => {};',
    "export const homeRoute = () => '#/home';",
  ].join('\n'));
  inbox = await import(pathToFileURL(path.join(dir, 'views', 'inbox.js')));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('the view tree still exports the functions other screens import', () => {
  for (const name of ['unreadCount', 'inboxView', 'messageGuest', 'inboxSettingsView', 'previewText']) {
    assert.equal(typeof inbox[name], 'function', name);
  }
});

test('the list preview shows a mention as @Name, never the stored user id', () => {
  const id = '749612f5-4297-43c5-b15b-438a535926dd';
  assert.equal(inbox.previewText(`Note: ask @[Mara Lim](${id}) about the key`), 'Note: ask @Mara Lim about the key');
  assert.equal(inbox.previewText(`@[Ana Cruz](${id}) and @[Mara Lim](${id})`), '@Ana Cruz and @Mara Lim');
  assert.equal(inbox.previewText('Plain guest text with @Mara'), 'Plain guest text with @Mara');
  assert.equal(inbox.previewText(`@[Ana\nCruz](${id})`), `@[Ana\nCruz](${id})`, 'a name with a line break is not a mention');
  assert.equal(inbox.previewText(null), '');
  assert.match(src, /previewText\(c\.last_body\) \|\| h\('span', \{ class: 'muted' \}, 'No messages yet'\)/);
});

test('Mark unread goes back to the list, because re-opening the thread marks it read again', () => {
  assert.match(src, /import \{ state, navigate \} from '\.\.\/app\.js';/);
  assert.match(src, /const markUnread = async \(\) => \{\s*try \{ await patch\(`\/inbox\/\$\{id\}`, \{ unread: true \}\); toast\('Marked as unread\.'\); navigate\(back, \{ replace: true \}\); \} catch \(err\) \{ toast\(err\.message, 'error'\); \}\s*\};/);
  assert.match(src, /onclick: markUnread \}, 'Mark unread'\)/);
});

test('composer errors clear when the message or the send-later time changes', () => {
  assert.match(src, /body\.addEventListener\('input', \(\) => \{ err\.textContent = ''; \}\);/);
  assert.match(src, /\['input', 'change'\]\.forEach\(\(ev\) => sendAt\.addEventListener\(ev, \(\) => \{ sendAt\.removeAttribute\('aria-invalid'\); err\.textContent = ''; \}\)\);/);
});

test('a send-later time that has already passed asks before sending now', () => {
  assert.match(src, /let scheduleFor = mode === 'message' \? manilaDateTime\(sendAt\.value\) : null;\s*if \(scheduleFor && scheduleFor <= new Date\(\)\) \{\s*if \(!await confirmDialog\(\{ title: 'That time has passed\. Send it now\?'[^\n]*confirmText: 'Send now' \}\)\) return;\s*scheduleFor = null;/);
  assert.match(src, /if \(scheduleFor\) payload\.send_at = scheduleFor\.toISOString\(\);/);
});

test('a failed list load shows a message and leaves the filter bar on screen', () => {
  assert.match(src, /list = await get\(`\/inbox\$\{qs\(apiFilters\(filters, defaults\)\)\}`\);\s*\} catch \(err\) \{\s*(?:\/\/[^\n]*\n\s*)?items\.replaceChildren\(emptyState\(\{ title: "Couldn't load conversations", text: err\.message \}\)\);\s*return;\s*\}/);
});

test('the composer hint does not promise an email to a guest who has none', () => {
  assert.match(src, /c\.guest_email \? `This will be emailed to \$\{c\.guest_name\}\.` : 'Add an email address before you can send this\.'/);
});

test('automatic message rows carry the stacking hook the phone layout uses', () => {
  assert.match(src, /automations\.map\(\(a\) => h\('li', null, h\('div', \{ class: 'row row--stack-sm' \}/);
});
