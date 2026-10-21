'use strict';
require('./helpers');

// Round 36 FOCUSKEYS (D-118): a button whose words can change carries a fixed data-focus-key, so the focus guard (public/js/ui.js)
// can hand focus back to it after a redraw. This test scans every view, pins the exact keys of contract C1, and checks the guard
// itself with the stand-in DOM. Frontend only, no database.
//
// R36_VIEWS_DIR (optional) points the scan at another copy of public/js/views (used to prove the test red on an older tree).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const VIEWS = process.env.R36_VIEWS_DIR || path.join(JS, 'views');

// Every h('button', { ... }, ...) call: the props object (brace matching that skips strings and template literals) and the children.
function buttons(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    let i = 0;
    while ((i = s.indexOf("h('button',", i)) >= 0) {
      const j = s.indexOf('{', i);
      if (j < 0 || j - i > 20) { i += 10; continue; }
      let d = 0, k = j, q = null;
      for (; k < s.length; k++) {
        const c = s[k];
        if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
        if ('\'"`'.includes(c)) { q = c; continue; }
        if (c === '{') d++; else if (c === '}') { d--; if (!d) break; }
      }
      let p = 1, m = k + 1; q = null;
      for (; m < s.length; m++) {
        const c = s[m];
        if (q) { if (c === '\\') { m++; continue; } if (c === q) q = null; continue; }
        if ('\'"`'.includes(c)) { q = c; continue; }
        if (c === '(') p++; else if (c === ')') { p--; if (!p) break; }
      }
      out.push({ file: f, line: s.slice(0, i).split('\n').length, props: s.slice(j, k + 1), kids: s.slice(k + 1, m), call: s.slice(i, m + 1) });
      i = k;
    }
  }
  return out;
}

const all = buttons(VIEWS);

// Rule 1: the words are a choice between two strings. Rule 2: an Edit button whose accessible name carries a value.
function violation(b) {
  if (/'data-focus-key'/.test(b.props) || /role:\s*'(tab|radio)'/.test(b.props)) return null;
  const al = (b.props.match(/'aria-label':\s*`([^`]*)`/) || [])[1] || '';
  const choice = /\?\s*'[^']*'\s*:\s*'[^']*'/.test(b.kids.split('\n')[0]) || /\$\{[^}]*\?\s*'/.test(al);
  const edit = /^\s*,\s*(icon\([^)]*\),\s*)?'Edit/.test(b.kids) && /\$\{/.test(al);
  return choice ? 'choice of words' : edit ? 'Edit with a value in its name' : null;
}

// Each entry needs its reason. A new entry without one is not allowed.
const ALLOW = [
  { file: 'landing.js', has: 'gs-card__icon', reason: 'Get started cards: the choice is an icon, not words; the card text does not change from its own press.' },
  { file: 'pricing.js', has: 'fmtDate(n.date)', reason: 'Night tiles: the date and price in the name are fixed for the tile; the words do not change from the tile\'s own press.' },
  { file: 'settings.js', has: 'Edit access for ${m.full_name}', reason: 'Edit access: the access dialog cannot change the member\'s name in the label.' },
  { file: 'cleanerpay.js', has: 'Edit rate for ${nameOf(r)}', reason: 'Edit rate: the rate dialog cannot change the cleaner\'s name in the label.' },
];
test('allowlist: every entry has a written reason', () => {
  for (const a of ALLOW) assert.ok(a.reason && a.reason.length > 20, `allowlist entry for ${a.file} needs a reason`);
});

test('class rule: every button whose words can change carries a data-focus-key (allowlist aside)', () => {
  assert.ok(all.length > 300, `expected to find the views' buttons, found ${all.length}`);
  const allowed = (b) => ALLOW.some((a) => a.file === b.file && b.call.includes(a.has));
  const bad = all.filter((b) => violation(b) && !allowed(b)).map((b) => `${b.file}:${b.line} (${violation(b)}) ${(b.props.match(/'aria-label':\s*`([^`]*)`/) || [, b.kids.trim().slice(0, 50)])[1].slice(0, 60)}`);
  assert.deepEqual(bad, [], `buttons whose words can change need a fixed data-focus-key (D-118):\n  ${bad.join('\n  ')}`);
});

test('allowlist: each entry still matches a flagged button (no stale entries)', () => {
  for (const a of ALLOW) {
    assert.ok(all.some((b) => b.file === a.file && b.call.includes(a.has) && violation(b)), `allowlist entry ${a.file} "${a.has}" matches nothing; remove it`);
  }
});

// ---- Pins (contract C1): the exact key on the exact button, found by file and words ----
function find(file, needle) {
  const hits = all.filter((b) => b.file === file && b.call.includes(needle));
  assert.equal(hits.length, 1, `${file}: expected exactly one button containing ${needle}, found ${hits.length}`);
  return hits[0];
}
const PINS = [
  ['inbox.js', 'Edit automatic message: ', '`auto-edit-${a.automation_id}`'],
  ['inbox.js', 'Edit template: ', '`tpl-edit-${t.template_id}`'],
  ['maintenance.js', "'Mark resolved'", "'mt-status'"],
  ['maintenance.js', 'aria-label\': `Edit ${x.title}`', '`mt-sched-edit-${x.schedule_id}`'],
  ['properties.js', 'onclick: archiveProperty', "'prop-archive'"],
  ['properties.js', 'onclick: restoreProperty', "'prop-archive'"],
  ['properties.js', 'Archive unit ${u.unit_name}', '`unit-archive-${u.unit_id}`'],
  ['properties.js', 'Restore unit ${u.unit_name}', '`unit-archive-${u.unit_id}`'],
  ['properties.js', 'Edit unit ${u.unit_name}', '`unit-edit-${u.unit_id}`'],
  ['listings.js', "'Mark clean' : 'Mark dirty'", '`clean-${l.unit_id}`'],
  ['listings.js', 'Edit, ${l.unit_name}', '`listing-edit-${l.unit_id}`'],
  ['addons.js', 'Edit ${a.name}', '`addon-edit-${a.addon_id}`'],
  ['owners.js', 'Edit ${o.full_name}', '`owner-edit-${o.owner_id}`'],
  ['pricing.js', 'Edit rule: ', '`rule-edit-${r.rule_id}`'],
  ['supplies.js', 'Edit ${s.name}', '`supply-edit-${s.supply_id}`'],
  ['gatepass.js', "'Send again' : 'Send now'", "'gp-send'"],
  ['help.js', "'Reply and reopen'", "'ticket-reply'"],
  ['reservations.js', "'Email again' : 'Email'} for", '`pay-email-${p.payment_id}`'],
];
for (const [file, needle, key] of PINS) {
  test(`pin: ${file} button "${needle}" carries data-focus-key ${key}`, () => {
    const b = find(file, needle);
    assert.ok(b.props.includes(`'data-focus-key': ${key}`), `${file}:${b.line} should have 'data-focus-key': ${key}`);
  });
}

test('pin: maintenance.js has no per-target status key (mt-status-${)', () => {
  const s = fs.readFileSync(path.join(VIEWS, 'maintenance.js'), 'utf8');
  assert.ok(!s.includes('mt-status-${'), 'status buttons must share one key, not one per target status');
});

test('pin: properties.js Archive and Restore (property) share the one key prop-archive', () => {
  const a = find('properties.js', 'onclick: archiveProperty');
  const r = find('properties.js', 'onclick: restoreProperty');
  assert.match(a.props, /'data-focus-key': 'prop-archive'/);
  assert.match(r.props, /'data-focus-key': 'prop-archive'/);
});

test('pin: owners.js disablePortal hands over owner-invite-${o.owner_id} before rerender()', () => {
  const s = fs.readFileSync(path.join(VIEWS, 'owners.js'), 'utf8');
  const start = s.indexOf('const disablePortal');
  assert.ok(start >= 0, 'disablePortal not found');
  const body = s.slice(start, s.indexOf('\n  };', start));
  const setAt = body.indexOf("setAttribute('data-focus-key', `owner-invite-${o.owner_id}`)");
  const redraw = body.indexOf('rerender()');
  assert.ok(setAt >= 0, 'disablePortal must set owner-invite-${o.owner_id} on the pressed button');
  assert.ok(redraw >= 0 && setAt < redraw, 'the key must be set before rerender()');
});

// ---- The guard itself: a keyed button is found again after a rename and re-sort ----
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36fk-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('guard: a renamed, re-sorted row gets focus by its key, not the row now in its place', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const draw = (rows) => rows.map(([id, name]) => btn(w, w.main, 'Edit', { 'aria-label': `Edit template: ${name}`, 'data-focus-key': `tpl-edit-${id}` }));
  const first = draw([[1, 'A'], [2, 'B'], [3, 'C']]);
  first[1].focus(); g.note(first[1]);
  first.forEach((n) => w.remove(n));
  const second = draw([[1, 'A'], [3, 'C'], [2, 'Z']]); // B renamed Z, sorted last
  g.check(100);
  assert.equal(w.activeElement, second[2], 'focus belongs on the button keyed tpl-edit-2 (renamed)');
  assert.equal(w.activeElement.getAttribute('data-focus-key'), 'tpl-edit-2');
  assert.notEqual(w.activeElement, second[1], 'not the row that now sits where B was');
});
