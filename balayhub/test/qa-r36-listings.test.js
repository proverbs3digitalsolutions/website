'use strict';
require('./helpers');

// Round 36 LISTINGS (ONB-1, KEY-R; D-105, D-118). The Channels form says a calendar link's own refusal in the same press as the
// missing channel (the server's exact sentences; the server stays the gate), and the buttons whose words change carry fixed focus keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');
const ical = require('../src/lib/ical');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/listings.js'), 'utf8');
const stays = fs.readFileSync(path.join(__dirname, '../src/routes/stays.js'), 'utf8');

function feedLinkProblem() {
  const m = src.match(/export function feedLinkProblem[\s\S]*?\n}\n/);
  assert.ok(m, 'feedLinkProblem is exported');
  return new Function(`${m[0].replace('export ', '')}; return feedLinkProblem;`)();
}
function feedLinkRefusal() {
  const m = stays.match(/function feedLinkRefusal[\s\S]*?\n}\n/);
  assert.ok(m, 'server feedLinkRefusal found');
  return new Function('net', `${m[0]}; return feedLinkRefusal;`)(require('node:net'));
}

test('feedLinkProblem is null exactly when the server accepts the link, else the server sentence', () => {
  const p = feedLinkProblem();
  const refusal = feedLinkRefusal();
  for (const link of [
    'https://192.168.1.10/calendar/ical/qa.ics', 'https://127.0.0.1:9/cal.ics', 'https://[::1]/cal.ics',
    'https://www.example-channel.test:8443/calendar/ical/qa.ics', 'https://user:pw@cal.example.com/x.ics', 'https://user@cal.example.com/x.ics',
    'http://cal.example.com/x.ics', 'not a link', 'https://cal.example.com:443/x.ics', 'https://cal.example.com/x.ics',
    'https://www.airbnb.com/calendar/ical/123.ics?s=abc',
  ]) {
    const ok = !!ical.validateFeedUrl(link);
    assert.equal(p(link), ok ? null : refusal(link), link);
  }
});

test('source: the submit handler sets problems.url from feedLinkProblem in the same pass as problems.channel', () => {
  const i = src.indexOf("problems.channel = 'Choose which site");
  const j = src.indexOf('showErrors(addForm, problems)', i);
  assert.ok(i > 0 && j > i);
  const seg = src.slice(i, j);
  assert.match(seg, /feedLinkProblem\(link\)/);
  assert.match(seg, /problems\.url = bad/);
  assert.doesNotMatch(seg, /new URL\(link\)/);
});

let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36list-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// The pressed button, then the redraw: a new button (new words) with the same key, or without it.
function redraw(oldKey, newKey, oldName, newName) {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const b = btn(w, w.main, oldName.split(',')[0], { 'data-focus-key': oldKey, 'aria-label': oldName });
  b.focus(); g.note(b);
  w.remove(b);
  const nb = btn(w, w.main, newName.split(',')[0], { ...(newKey ? { 'data-focus-key': newKey } : {}), 'aria-label': newName });
  g.check(100);
  return { w, nb };
}

test('Mark clean / Mark dirty: focus follows the fixed key, not the heading', () => {
  const { w, nb } = redraw('clean-7', 'clean-7', 'Mark dirty, Unit A', 'Mark clean, Unit A');
  assert.equal(w.activeElement, nb);
  const lost = redraw('clean-7', null, 'Mark dirty, Unit A', 'Mark clean, Unit A');
  assert.equal(lost.w.activeElement, lost.w.h1);
});

test('Edit: a rename keeps focus on Edit through its fixed key', () => {
  const { w, nb } = redraw('listing-edit-7', 'listing-edit-7', 'Edit, Unit A', 'Edit, Unit B');
  assert.equal(w.activeElement, nb);
});

test('source: the fixed keys sit on the right buttons', () => {
  assert.match(src, /'data-focus-key': `clean-\$\{l\.unit_id\}`[^\n]*\n?[\s\S]{0,400}?\} \}, l\.cleaning_status === 'dirty' \? 'Mark clean' : 'Mark dirty'\)/);
  assert.match(src, /'data-focus-key': `listing-edit-\$\{l\.unit_id\}`, 'aria-label': `Edit, \$\{l\.unit_name\}`/);
});
