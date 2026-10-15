'use strict';

// QA round 15, lane Q1 (public/js/views/quotes.js). Frontend only: no database, no server.
// #4: an add-on quantity over its limit is never cut down silently. The typed value stays, the Add-ons field shows
//     "Up to N <name> per stay.", and the form's check refuses the submit until it is fixed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const quotesSrc = fs.readFileSync(path.join(SRC, 'views', 'quotes.js'), 'utf8');
const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

let dir; let quotes;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-q1-r15-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), 'export function guestsProblem() { return null; }\nexport function addDays(d) { return d; }\nexport function boxValue() { return ""; }\n');
  fs.writeFileSync(path.join(dir, 'views', 'quotes.js'), quotesSrc);
  globalThis.Node ||= class {};
  globalThis.Element ||= class extends globalThis.Node {};
  globalThis.document ||= { createElement: () => ({}), createTextNode: () => ({}) };
  quotes = await import(pathToFileURL(path.join(dir, 'views', 'quotes.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('#4 addonQtyProblem names the limit and the add-on, asks for 0 or more on a bad count, and is silent otherwise', () => {
  assert.equal(quotes.addonQtyProblem(3, 1, 'Airport pickup'), 'Up to 1 Airport pickup per stay.');
  assert.equal(quotes.addonQtyProblem('3', 2, 'Extra towel'), 'Up to 2 Extra towel per stay.');
  assert.equal(quotes.addonQtyProblem(-1, 1, 'Airport pickup'), 'Enter 0 or more.');
  assert.equal(quotes.addonQtyProblem(1.5, 3, 'Airport pickup'), 'Enter 0 or more.');
  assert.equal(quotes.addonQtyProblem(1, 1, 'Airport pickup'), null);
  assert.equal(quotes.addonQtyProblem(0, 1, 'Airport pickup'), null);
  assert.equal(quotes.addonQtyProblem('', 1, 'Airport pickup'), null);
  assert.equal(quotes.addonQtyProblem(2, null, 'Airport pickup'), null);
});

test('#4 the quantity listener no longer writes a clamped value, and the form check refuses a bad count', () => {
  const draw = between(quotesSrc, 'function drawAddons()', 'Once the host types a price');
  assert.doesNotMatch(draw, /qty\.value\s*=/, 'the typed value is never overwritten');
  assert.doesNotMatch(draw, /showAddonProblem\(\)/, 'the qty listener runs before the form handler that clears the message');
  assert.match(quotesSrc, /form\.addEventListener\('input', \(e\) => \{ if \(e\.target\.classList\?\.contains\('hp-qty'\)\) showAddonProblem\(\); \}\);/, 'set again after makeForm clears it');
  assert.ok(quotesSrc.indexOf("form.addEventListener('input'") > quotesSrc.indexOf('const form = makeForm('), 'registered after makeForm');
  assert.match(quotesSrc, /function showAddonProblem\(\)[\s\S]*?addonQtyProblem\(/);
  const form = between(quotesSrc, 'const form = makeForm({', "modal = openModal({ title: 'New quote'");
  assert.match(form, /addons:/, 'the check hook names the Add-ons field');
  assert.match(form, /addonProblem\(\)/);
});
