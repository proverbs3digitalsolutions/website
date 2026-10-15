'use strict';

// QA round 13, lane F13 (settings-home). Frontend only: no database.
// #42: the Connect PayMongo dialog says how to get a PayMongo account, with a link to the sign-up page in a new tab.
// #44: an owner with no reservation yet sees one card first on Home, which names the calendar step, and the trend and
//   revenue sections fold into a closed "Trends and revenue" disclosure. With a reservation, and for other roles
//   (the onboarding check that knows about reservations is owners only), Home is as before.
// Home runs against a stand-in DOM and a stubbed fetch, as test/qa-r8-c29.test.js does.
// TEST_DATABASE_URL is not needed. node --test --test-concurrency=1 test/qa-r13-f13.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const views = path.join(__dirname, '..', 'public', 'js', 'views');
const SENTENCE = 'No bookings yet. Connect your Airbnb or Booking.com calendar to see them here.';

// Text from a start marker up to the first end marker after it.
function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `found: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `found the end after: ${startMarker}`);
  return text.slice(start, end);
}

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

// What the API answers for Home's requests. Anything not listed gets an empty object.
let reservationsDone = false;
const ROUTES = {
  '/listings': () => ({ listings: [{ unit_id: 'u1', unit_name: 'Loft A' }] }),
  '/onboarding': () => ({ steps: [{ key: 'reservation', done: reservationsDone }] }),
  '/payment-proofs': () => ({ proofs: [] }),
  '/supplies/low-count': () => ({ count: 0 }),
  '/inbox/assigned-count': () => ({ count: 0 }),
  '/sync-health': () => ({ problems: [] }),
  '/daily-close': () => ({ closed: true }),
  '/stays/overview': () => ({ arrivals: [], departures: [], turnovers: [], staying: [], guests_staying: 0, dirty_listings: 0 }),
  '/stays/trends': () => ({ series: [], totals: { check_ins: 0, check_outs: 0, turnovers: 0, occupancy: 0 } }),
  '/stays/revenue': () => ({
    current: { month: '2026-10', days_in_month: 31, adr: 0, booked_nights: 0, occupancy: 0, total_revenue: 0, accommodation: 0, fees: 0, daily_adr: [], weekly: [] },
    previous: { month: '2026-09', days_in_month: 30, adr: 0, total_revenue: 0, daily_adr: [], weekly: [] },
  }),
};
const realFetch = globalThis.fetch;
let home; let app; let dir;

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
  globalThis.fetch = async (url) => {
    const { pathname } = new URL(url, 'http://balayhub.test');
    const route = ROUTES[pathname.replace(/^\/api/, '')];
    const body = route ? route() : {};
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
  };
  // home.js imports the signed-in user and four sibling modules, so it is loaded from a temp copy with those stubbed.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r13-f13-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', full_name: 'Ana Owner', organization_name: 'Ana Stays' } };\nexport function navigate() {}\n");
  fs.writeFileSync(path.join(dir, 'charts.js'), "export const SERIES = ['#111', '#222', '#333'];\nexport function barChart() { return document.createElement('div'); }\nexport function lineChart() { return document.createElement('div'); }\n");
  fs.writeFileSync(path.join(dir, 'views', 'launchpad.js'), 'export async function launchpadReminder() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'views', 'deposits.js'), 'export async function depositsDueCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), 'export const CHANNEL_LABEL = {};\n');
  fs.copyFileSync(path.join(views, 'home.js'), path.join(dir, 'views', 'home.js'));
  home = await import(pathToFileURL(path.join(dir, 'views', 'home.js')).href);
  app = await import(pathToFileURL(path.join(dir, 'app.js')).href);
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

// Draws Home for a role and returns its stack (the second child, after the page head).
async function homeStack(role) {
  app.state.user.role = role;
  const el = new Element('div');
  await home.homeView(el, { rerender: () => {} });
  assert.equal(el.children[1].className, 'stack', 'Home draws its stack after the page head');
  return el.children[1];
}

describe('#44 first-run card', () => {
  it('draws one card with the sentence and a link to the calendar step when there are no reservations', () => {
    const card = home.firstRunCard({ reservations: 0 });
    assert.ok(card instanceof Element, 'a card is drawn');
    const sentences = walk(card, (n) => n.tagName === 'p');
    assert.equal(sentences.length, 1);
    assert.equal(textOf(sentences[0]), SENTENCE);
    const links = walk(card, (n) => n.tagName === 'a');
    assert.equal(links.length, 1);
    assert.equal(links[0].getAttribute('href'), '#/listings');
    assert.equal(textOf(links[0]), 'Connect calendar');
  });

  it('draws nothing once there is a reservation, or when the count is not known', () => {
    assert.equal(home.firstRunCard({ reservations: 1 }), null);
    assert.equal(home.firstRunCard({ reservations: null }), null);
    assert.equal(home.firstRunCard({}), null);
  });
});

describe('#44 Home for each state', () => {
  it('an owner with no reservations sees the card first, and the trend and revenue sections fold into a closed disclosure', async () => {
    reservationsDone = false;
    const stack = await homeStack('owner');
    assert.equal(textOf(walk(stack.children[0], (n) => n.tagName === 'p')[0]), SENTENCE, 'the card leads the stack');
    const folds = walk(stack, (n) => n.tagName === 'details');
    assert.equal(folds.length, 1, 'one fold');
    const [fold] = folds;
    assert.equal(textOf(walk(fold, (n) => n.tagName === 'summary')[0]), 'Trends and revenue');
    assert.equal(fold.open, false, 'the fold starts closed');
    assert.equal(walk(fold, (n) => n.tagName === 'section').length, 0, 'the charts are not drawn while the fold is closed');
    assert.equal(stack.children.filter((c) => c.tagName === 'section').length, 1, 'only the daily overview stays outside the fold');
    // Opening the fold draws the trend and revenue cards once, so a chart measures the space it is drawn into.
    fold.setAttribute('open', '');
    fold.dispatch('toggle');
    // R14 OB1: the cards wait for their data, then land together.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(walk(fold, (n) => n.tagName === 'section').length, 2, 'the trend and revenue cards are drawn on open');
    fold.dispatch('toggle');
    assert.equal(walk(fold, (n) => n.tagName === 'section').length, 2, 'they are not drawn a second time');
  });

  it('an owner with a reservation sees no card and no fold, and the trend and revenue cards stand alone', async () => {
    reservationsDone = true;
    const stack = await homeStack('owner');
    assert.equal(walk(stack, (n) => n.tagName === 'details').length, 0);
    assert.equal(walk(stack, (n) => n.tagName === 'p' && textOf(n) === SENTENCE).length, 0);
    assert.equal(stack.children.filter((c) => c.tagName === 'section').length, 3, 'overview, trends and revenue');
    reservationsDone = false;
  });

  it('staff get no card and no fold, because the reservation check is for owners', async () => {
    reservationsDone = false;
    const stack = await homeStack('staff');
    assert.equal(walk(stack, (n) => n.tagName === 'details').length, 0);
    assert.equal(walk(stack, (n) => n.tagName === 'p' && textOf(n) === SENTENCE).length, 0);
    assert.equal(stack.children.filter((c) => c.tagName === 'section').length, 3, 'overview, trends and revenue');
    app.state.user.role = 'owner';
  });
});

describe('#42 PayMongo sign-up line', () => {
  const settings = fs.readFileSync(path.join(views, 'settings.js'), 'utf8');
  const connect = between(settings, 'const connect = () => formModal({', 'const edit = () => formModal({');

  it('the Connect PayMongo dialog says how to get an account, with a sign-up link in a new tab, before the key box', () => {
    assert.match(connect, /h\('p', \{ class: 'small' \}, 'No PayMongo account yet\? Sign up at ', h\('a', \{ href: 'https:\/\/dashboard\.paymongo\.com\/signup', target: '_blank', rel: 'noopener' \}, 'paymongo\.com'\), '\. You get a test key right away; the live key comes after PayMongo checks your business\.'\)/);
    assert.ok(connect.indexOf('No PayMongo account yet') < connect.indexOf("field({ name: 'paymongo_secret_key'"), 'the line sits above the key box');
  });
});
