'use strict';
// QA round 14, lane F3 (top bar "+" Add new menu; frontend only, no database).
// topadd.js: addNewItems(user) filters the menu by role and workspace; renderAddMenu builds the menu panel.
// node --test --test-concurrency=1 test/qa-r14-topadd.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'public', 'js');
let dir; let mod; let access;

// A tiny fake DOM, just enough for h() and icon().
class Node_ {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.handlers = {}; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = [...c]; }
  addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); }
  click() { (this.handlers.click || []).forEach((f) => f({ type: 'click' })); }
  find(fn, out = []) { if (fn(this)) out.push(this); this.children.forEach((c) => c.find && c.find(fn, out)); return out; }
}
class Text_ extends Node_ { constructor(t) { super('#text'); this.text = t; } }
const textOf = (n) => (n.text !== undefined ? n.text : n.children.map(textOf).join(''));

test.before(async () => {
  globalThis.Node = Node_;
  globalThis.Element = Node_;
  globalThis.document = {
    createElement: (t) => new Node_(t),
    createElementNS: (_ns, t) => new Node_(t),
    createTextNode: (t) => new Text_(t),
  };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r14-topadd-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'routeaccess.js', 'topadd.js']) {
    if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  }
  access = await import(pathToFileURL(path.join(dir, 'routeaccess.js')).href);
  mod = await import(pathToFileURL(path.join(dir, 'topadd.js')).href);
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const u = (role, business_type, extra = {}) => ({ role, business_type, ...extra });
const keys = (user) => mod.addNewItems(user).map((i) => i.key);

test('addNewItems: keys by role and workspace', () => {
  assert.deepEqual(keys(u('owner', 'short_term')), ['reservation', 'listing', 'owner', 'cleaning', 'expense', 'invite']);
  assert.deepEqual(keys(u('owner', 'both')), ['reservation', 'listing', 'property', 'owner', 'cleaning', 'expense', 'tenant', 'rent_payment', 'invite']);
  assert.deepEqual(keys(u('owner', 'long_term')), ['property', 'expense', 'tenant', 'rent_payment', 'invite']);
  assert.deepEqual(keys(u('manager', 'short_term')), ['reservation', 'listing', 'cleaning', 'expense']);
  assert.deepEqual(keys(u('staff', 'both')), ['expense', 'rent_payment']);
  assert.deepEqual(keys(u('cleaner', 'both')), []);
  assert.deepEqual(keys(null), []);
});

test('addNewItems: labels, icons and links match the plan', () => {
  const all = mod.addNewItems(u('owner', 'both'));
  const want = {
    reservation: ['Reservation', 'bed', '#/reservations?new=1'],
    listing: ['Listing', 'building', '#/listings?new=1'],
    property: ['Property', 'building', '#/properties?new=1'],
    owner: ['Unit owner', 'users', '#/owners?new=1'],
    cleaning: ['Cleaning task', 'sparkle', '#/housekeeping?new=1'],
    expense: ['Expense', 'wallet', '#/rent?tab=expenses&new=expense'],
    tenant: ['Tenant', 'users', '#/tenants?new=1'],
    rent_payment: ['Rent payment', 'cash', '#/rent?new=payment'],
    invite: ['Invite a teammate', 'plus', '#/settings?invite=1'],
  };
  for (const i of all) assert.deepEqual([i.label, i.icon, i.href], want[i.key], i.key);
});

test('addNewItems: hidden for cleaners, view-only and demo workspaces', () => {
  assert.deepEqual(keys(u('owner', 'both', { plan: { read_only: true } })), []);
  assert.deepEqual(keys(u('owner', 'both', { plan: { is_demo: true } })), []);
  assert.ok(keys(u('owner', 'both', { plan: { read_only: false, is_demo: false } })).length > 0);
});

test('addNewItems: every href is a route the user may open', () => {
  for (const type of ['short_term', 'long_term', 'both']) {
    for (const role of ['owner', 'manager', 'staff']) {
      const user = u(role, type);
      for (const i of mod.addNewItems(user)) {
        assert.ok(access.routeAllowed(i.href.slice(1).split('?')[0], user), `${role}/${type}/${i.key}`);
      }
    }
  }
});

test('renderAddMenu: title, menu, items; a click closes without moving focus', () => {
  const panel = new Node_('div');
  const calls = [];
  const pop = { close: (o) => calls.push(o) };
  mod.renderAddMenu(panel, { user: () => u('owner', 'short_term') }, pop);
  const title = panel.find((n) => n.tag === 'h2');
  assert.equal(title.length, 1);
  assert.equal(title[0].className, 'tb-pop__title');
  assert.equal(textOf(title[0]), 'Add new');
  const ul = panel.find((n) => n.tag === 'ul');
  assert.equal(ul.length, 1);
  assert.equal(ul[0].attrs.role, 'menu');
  assert.equal(ul[0].attrs['aria-label'], 'Add new');
  const items = panel.find((n) => n.tag === 'a');
  assert.equal(items.length, 6);
  for (const a of items) {
    assert.equal(a.attrs.role, 'menuitem');
    assert.ok(a.attrs.href.startsWith('#/'));
    assert.equal(a.find((n) => n.tag === 'svg').length, 1);
  }
  assert.equal(textOf(items[0]), 'Reservation');
  items[0].click();
  assert.deepEqual(calls, [{ returnFocus: false }]);
});

test('topadd.js: no inline style, no focus calls, never imports app.js', () => {
  const src = fs.readFileSync(path.join(root, 'topadd.js'), 'utf8');
  assert.ok(!/\.focus\(/.test(src));
  assert.ok(!/style=|\.style\b/.test(src));
  assert.ok(!/from ['"]\.\/app\.js['"]/.test(src));
});
