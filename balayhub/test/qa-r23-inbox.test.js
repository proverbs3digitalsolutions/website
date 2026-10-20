'use strict';

// QA r23 lane INBOX (INB-1): the note box shows @Name; the saved body and the draft keep @[Name](id). Frontend-only, no database.

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


const ID = '749612f5-4297-43c5-b15b-438a535926dd';
const ID2 = '849612f5-4297-43c5-b15b-438a535926dd';
const MENTION = /@\[([^\]\n]{1,120})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

test('a picked @Name is saved as @[Name](id)', () => {
  const picked = new Map([['Bea Reyes', ID]]);
  const out = inbox.encodeMentions('Hi @Bea Reyes, see', picked);
  assert.equal(out, `Hi @[Bea Reyes](${ID}), see`);
  assert.equal([...out.matchAll(MENTION)].length, 1);
  assert.equal(inbox.encodeMentions('Hi @Bea Reyes', picked), `Hi @[Bea Reyes](${ID})`);
});

test('@Bea alone, with no pick, stays plain', () => {
  assert.equal(inbox.encodeMentions('ask @Bea', new Map()), 'ask @Bea');
  assert.equal(inbox.encodeMentions('ask @Bea Reyesx', new Map([['Bea Reyes', ID]])), 'ask @Bea Reyesx');
});

test('two picks, longest name first', () => {
  const picked = new Map([['Bea', ID], ['Bea Reyes', ID2]]);
  assert.equal(inbox.encodeMentions('@Bea Reyes and @Bea.', picked), `@[Bea Reyes](${ID2}) and @[Bea](${ID}).`);
});

test('decode round-trips and refills the picks', () => {
  const picked = new Map([['Bea Reyes', ID]]);
  const enc = inbox.encodeMentions('Hi @Bea Reyes, see', picked);
  const d = inbox.decodeMentions(enc);
  assert.equal(d.text, 'Hi @Bea Reyes, see');
  assert.equal(d.picked.get('Bea Reyes'), ID);
  assert.equal(inbox.decodeMentions('plain').text, 'plain');
});

test('source: pick inserts @Name, save encodes, draft stores encoded', () => {
  assert.match(src, /const ins = `@\$\{p\.full_name\} `;/);
  assert.doesNotMatch(src, /const ins = `@\[/);
  assert.match(src, /note: mode === 'note'/);
  assert.match(src, /encodeMentions\(body\.value, picked\)/);
});
