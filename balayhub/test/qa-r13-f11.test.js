'use strict';

// QA round 13, lane F11 (guest-auth): the gate pass names one guest without a number (#10), the review
// page's header and questions share the guest-page spacing (#11), the setup "Both" hint says what it adds (#46)
// and the verify toast is English when the person is signed in (K14). Source scans, plus the gate pass helper
// loaded from a temp copy with minimal DOM stubs. Frontend-only: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const pub = path.join(__dirname, '..', 'public', 'js');
const src = (f) => fs.readFileSync(path.join(pub, f), 'utf8');

// Just enough DOM for h() and ui.js to load (the same stub qa-r12-c02 uses).
class Node { }
class Element extends Node {
  constructor(tag) { super(); Object.assign(this, { tagName: tag, attrs: {}, children: [], style: {}, dataset: {}, className: '' }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() { }
  append() { }
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = { createElement: (tag) => new Element(tag), createTextNode: (d) => d };
globalThis.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };

let gatepass; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-f11-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(pub, f), path.join(dir, f));
  fs.copyFileSync(path.join(pub, 'views', 'gatepass.js'), path.join(dir, 'views', 'gatepass.js'));
  gatepass = await import(pathToFileURL(path.join(dir, 'views', 'gatepass.js')));
});
test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete globalThis.document; delete globalThis.Element; delete globalThis.Node; delete globalThis.localStorage;
});

test('#10: one guest is shown as a name with no list and no number; two or more keep the numbered list', () => {
  // The stub keeps the tag as written; a browser reports it in capitals, so compare without case.
  const one = gatepass.guestNamesBlock(['Ana']);
  assert.equal(one.tagName.toUpperCase(), 'P');
  const many = gatepass.guestNamesBlock(['Ana', 'Ben']);
  assert.equal(many.tagName.toUpperCase(), 'OL');
  assert.equal(many.className, 'gp__names');
  assert.match(src('views/gatepass.js'), /h\('dd', null, guestNamesBlock\(d\.guests\)\)/);
});

test('#11: the review header and the questions are sibling blocks in the guest page wrapper, as on check-in and pay', () => {
  const s = src('views/review.js');
  const view = s.slice(s.indexOf('export async function guestReviewView'));
  // The header card closes before the form, so the wrapper's gap (gc__main is a grid with 16px gaps) separates them.
  assert.match(view, /\}\)\)\),\s*form\)\);/, 'the header card closes before the form');
  assert.match(s, /h\('form', \{ class: 'form card', novalidate: true/, 'the form is a card, as on check-in');
  assert.match(src('views/checkin.js'), /h\('form', \{ class: 'form card', novalidate: true/);
});

test('D-81: each gate pass Set up button names its listing', () => {
  assert.match(src('views/gatepass.js'), /'aria-label': `Set up, \$\{p\.property_name\}`/);
});

test('#46: the Both choice at setup says what it adds', () => {
  const s = src('views/auth.js');
  const setup = s.slice(s.indexOf('export async function setupView'));
  assert.ok(setup.includes("hint: 'Both adds monthly rentals: tenants, leases and rent. Most hosts choose Short-term. You can change this later in Settings.'"));
});

test('K14 (round 15 #31): the verify toast always follows the chosen language', () => {
  const s = src('views/auth.js');
  const verify = s.slice(s.indexOf('export async function verifyView'), s.indexOf('export async function verifyPendingView'));
  assert.ok(verify.includes("toast(t('Email verified.'));"));
  assert.doesNotMatch(verify, /toast\(state\.user \?/);
});
