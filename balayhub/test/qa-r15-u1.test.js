'use strict';

// QA round 15, lane U1 (home-launchpad). Frontend only: no database.
// Founder request 1: the Home first-run card uses the shared call-to-action layout.
// #34: Home groups sync-problem rows by listing and kind. #29: a step the person skipped stays open.
// node --test --test-concurrency=1 test/qa-r15-u1.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const views = path.join(__dirname, '..', 'public', 'js', 'views');

// The same stand-in DOM as test/qa-r8-c29.test.js: just enough for h(), ui.js and the two views.
class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));
class Element extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '', checked: false, disabled: false });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  // A details element is open when its open attribute is present, as in a browser.
  get open() { return 'open' in this.attrs; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, type }); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
}
const walk = (node, pred, out = []) => {
  if (node instanceof Element) {
    if (pred(node)) out.push(node);
    node.children.forEach((c) => walk(c, pred, out));
  }
  return out;
};

let home; let launchpad; let dir;
const realFetch = globalThis.fetch;

before(async () => {
  globalThis.Node = Node;
  globalThis.Element = Element;
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    createElementNS: (ns, tag) => new Element(tag),
    createTextNode: (data) => new Text(data),
    body: new Element('body'),
    activeElement: null,
  };
  globalThis.location = { hash: '', origin: 'http://balayhub.test' };
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r15-u1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', full_name: 'Ana Owner' } };\nexport function navigate() {}\n");
  fs.writeFileSync(path.join(dir, 'charts.js'), "export const SERIES = ['#111'];\nexport function barChart() {}\nexport function lineChart() {}\n");
  fs.writeFileSync(path.join(dir, 'views', 'deposits.js'), 'export async function depositsDueCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), 'export const CHANNEL_LABEL = { airbnb: \'Airbnb\' };\n');
  fs.copyFileSync(path.join(views, 'launchpad.js'), path.join(dir, 'views', 'launchpad.js'));
  fs.copyFileSync(path.join(views, 'home.js'), path.join(dir, 'views', 'home.js'));
  home = await import(pathToFileURL(path.join(dir, 'views', 'home.js')).href);
  launchpad = await import(pathToFileURL(path.join(dir, 'views', 'launchpad.js')).href);
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('founder request 1: first-run card layout', () => {
  it('uses the shared call-to-action layout', () => {
    const card = home.firstRunCard({ reservations: 0, listings: [{ unit_id: '11111111-1111-1111-1111-111111111111' }] });
    assert.equal(card.className, 'card cta-card');
    assert.deepEqual(card.children.map((c) => c.className), ['cta-card__icon', 'cta-card__text', 'cta-card__actions']);
    assert.equal(card.children[1].children[0].tagName, 'p');
    const actions = card.children[2];
    assert.equal(actions.children.length, 1);
    assert.equal(actions.children[0].getAttribute('href'), '#/listings?channels=11111111-1111-1111-1111-111111111111');
    assert.equal(card.children[0].getAttribute('aria-hidden'), 'true');
  });
});

describe('#34 grouped sync-problem rows', () => {
  it('two rows of one kind for one listing become one row with a count', () => {
    const rows = home.groupSyncProblems([
      { unit_id: 'u1', kind: 'fetch_failed', message: 'a' },
      { unit_id: 'u1', kind: 'fetch_failed', message: 'b' },
      { unit_id: 'u2', kind: 'fetch_failed', message: 'c' },
      { unit_id: 'u1', kind: 'overlap' },
    ]);
    assert.deepEqual(rows.map((r) => [r.p.unit_id, r.p.kind, r.n]), [['u1', 'fetch_failed', 2], ['u2', 'fetch_failed', 1], ['u1', 'overlap', 1]]);
  });
  it('the drawn row ends with the link count only when there is more than one', () => {
    assert.equal(home.syncRowText({ p: { kind: 'failing', unit_name: 'Loft', message: 'x' }, n: 2 }), 'Loft: x (2 links)');
    assert.equal(home.syncRowText({ p: { kind: 'failing', unit_name: 'Loft', message: 'x' }, n: 1 }), 'Loft: x');
  });
});

describe('#29 a skipped step stays open', () => {
  it('stepOpen is true for next, stuck, or a step the person opened', () => {
    assert.equal(launchpad.stepOpen({ key: 'a', isNext: false, isStuck: false }, new Set(['a'])), true);
    assert.equal(launchpad.stepOpen({ key: 'a', isNext: true, isStuck: false }, new Set()), true);
    assert.equal(launchpad.stepOpen({ key: 'a', isNext: false, isStuck: true }, new Set()), true);
    assert.equal(launchpad.stepOpen({ key: 'a', isNext: false, isStuck: false }, new Set(['b'])), false);
  });
});
