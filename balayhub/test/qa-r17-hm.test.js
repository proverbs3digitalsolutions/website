'use strict';

// QA round 17, lane HM (#29, O11). Frontend only: no database.
// The first-run card adapts to a connected calendar and stays out of the way of the sync banner.
// node --test --test-concurrency=1 test/qa-r17-hm.test.js

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r17-hm-'));
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

const OLD = 'No bookings yet. Connect your Airbnb or Booking.com calendar to see them here.';
const CONNECTED = 'Your calendar is connected. Bookings from it show here after the next sync.';
const links = (c) => walk(c, (n) => n.tagName === 'a');

describe('#29 first-run card with a connected calendar', () => {
  it('a listing with a channel gives the connected sentence and no action', () => {
    const card = home.firstRunCard({ reservations: 0, listings: [{ unit_id: 'u1', channel_count: '1' }], syncProblem: false });
    assert.equal(card.className, 'card cta-card');
    assert.deepEqual(card.children.map((c) => c.className), ['cta-card__icon', 'cta-card__text']);
    assert.equal(textOf(card.children[1]), CONNECTED);
    assert.equal(links(card).length, 0);
  });
  it('any listing with a channel counts, even when the first has none', () => {
    const card = home.firstRunCard({ reservations: 0, listings: [{ channel_count: '0' }, { channel_count: 2 }] });
    assert.equal(textOf(card.children[1]), CONNECTED);
  });
  it('a sync problem hides the card (the banner says it)', () => {
    assert.equal(home.firstRunCard({ reservations: 0, listings: [{ channel_count: '1' }], syncProblem: true }), null);
  });
  it('with no channel the old sentence and Connect calendar stay', () => {
    const card = home.firstRunCard({ reservations: 0, listings: [{ unit_id: 'u1', channel_count: '0' }], syncProblem: true });
    assert.equal(textOf(card.children[1]), OLD);
    assert.equal(textOf(links(card)[0]), 'Connect calendar');
  });
  it('a reservation still hides the card, and homeView passes syncProblem', () => {
    assert.equal(home.firstRunCard({ reservations: 3, listings: [{ channel_count: '1' }] }), null);
    const src = fs.readFileSync(path.join(views, 'home.js'), 'utf8');
    assert.match(src, /firstRunCard\(\{ reservations: seen, listings, syncProblem: Boolean\(sync\) \}\)/);
  });
});
