'use strict';
require('./helpers');

// QA r47 SETUPNEXT (ONB47-1 / contract C5, D-98, D-129): the line under "Welcome, {first name}!" on Setup names the screen that comes next.
// While the card check is on, the card comes after Setup (D-98), so the line says "Next, you'll confirm your payment card, then add your
// first listing or property."; otherwise, and for a platform admin, it keeps "Next, you'll add your first listing or property.". The card
// check is read from the public plans answer, as the sign-up page reads it; a failed read keeps the old line. Frontend only: auth.js is
// copied to a temp folder beside stand-ins for app.js and landing.js, and setupView runs on a stand-in DOM (as qa-r44-pressguard does).
//
// R47_SETUP_AUTH_FILE (optional) points the run at another copy of auth.js (used to prove the test red on the round 46 base).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');
const AUTH = process.env.R47_SETUP_AUTH_FILE || path.join(PUBLIC_JS, 'views', 'auth.js');
const OLD = "Let's set up your rental business. Next, you'll add your first listing or property.";
const CARD = "Let's set up your rental business. Next, you'll confirm your payment card, then add your first listing or property.";

// The answer the stand-in server gives to GET /api/public/plans on the next render.
let plansAnswer = { status: 200, body: { card_check: true } };
const requests = []; // every request the page makes, as "METHOD url"

// A stand-in element: children, attributes, text, classes and listeners (enough for h(), field() and makeForm()).
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.listeners = {};
    this.className = ''; this.classList = { add() { }, remove() { }, contains: () => false, toggle() { } };
    this.parentElement = null; this.value = ''; this.checked = false; this.disabled = false;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  append(...c) { for (const x of c.flat(Infinity)) if (x && typeof x === 'object') { x.parentElement = this; this.children.push(x); } }
  replaceChildren(...c) { this.children = []; this.text = undefined; this.append(...c); }
  get textContent() { return this.text ?? this.children.map((x) => x.textContent).join(''); }
  set textContent(v) { this.text = v; this.children = []; }
  all(out = []) { this.children.forEach((x) => { out.push(x); x.all(out); }); return out; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() { }
  remove() { }
}

let auth;
let app;
let tmp;
test.before(async () => {
  globalThis.Node = El;
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  globalThis.window = new EventTarget();
  globalThis.document = {
    activeElement: null,
    createElement: (tag) => new El(tag),
    createElementNS: (ns, tag) => new El(tag), // the icons are SVG
    createTextNode: (s) => { const x = new El('#text'); x.text = String(s); return x; },
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() { }, removeItem() { } } });
  // The only request Setup makes is the public plans read; anything else would be a new request, so it fails loudly here.
  globalThis.fetch = async (url, opts = {}) => {
    requests.push(`${opts.method || 'GET'} ${url}`);
    if (url !== '/api/public/plans') throw new Error(`unexpected request ${url}`);
    if (plansAnswer.fail) throw new TypeError('Failed to fetch');
    const { status, body } = plansAnswer;
    return { ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body };
  };
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r47setup-'));
  fs.mkdirSync(path.join(tmp, 'views'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(PUBLIC_JS, f), path.join(tmp, f));
  fs.copyFileSync(AUTH, path.join(tmp, 'views', 'auth.js'));
  // app.js (the router) and landing.js are stand-ins: setupView needs only state, navigate, refreshUser and afterLogin.
  fs.writeFileSync(path.join(tmp, 'app.js'), 'export const state = { user: null };\nexport function navigate() { }\nexport async function refreshUser() { }\nexport function afterLogin() { }\n');
  fs.writeFileSync(path.join(tmp, 'views', 'landing.js'), 'export async function tryDemo() { }\n');
  auth = await import(pathToFileURL(path.join(tmp, 'views', 'auth.js')));
  app = await import(pathToFileURL(path.join(tmp, 'app.js')));
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

// Renders Setup for a person with this plans answer; returns the page's stand-in tree.
async function render(user, answer = { status: 200, body: { card_check: true } }) {
  plansAnswer = answer;
  requests.length = 0;
  app.state.user = user;
  const el = new El('div');
  await auth.setupView(el);
  return el;
}
const ana = (extra = {}) => ({ full_name: 'Ana Cruz', email: 'a@b.c', organization_id: null, is_platform_admin: false, ...extra });

// The distinct lines on the page that start "Let's set up": the lead under the greeting, read as text.
function leadLines(el) {
  assert.ok(el.all().some((x) => x.tagName === 'H1' && x.textContent === 'Welcome, Ana!'), 'the page greets Ana by first name');
  return [...new Set(el.all().filter((x) => x.tagName !== '#TEXT' && x.textContent.startsWith("Let's set up")).map((x) => x.textContent))];
}

test('setup: while the card check is on, the line names the card page as the next step (ONB47-1, D-98)', async () => {
  const el = await render(ana(), { status: 200, body: { card_check: true } });
  assert.deepEqual(leadLines(el), [CARD]);
  assert.deepEqual(requests, ['GET /api/public/plans'], 'Setup reads the public plans, as the sign-up page does');
});

test('setup: while the card check is off, the line keeps the first-listing sentence', async () => {
  const el = await render(ana(), { status: 200, body: { card_check: false } });
  assert.deepEqual(leadLines(el), [OLD]);
});

test('setup: a plans answer without card_check keeps the first-listing sentence', async () => {
  const el = await render(ana(), { status: 200, body: {} });
  assert.deepEqual(leadLines(el), [OLD]);
});

test('setup: a plans read that fails (offline, or a server error) keeps the first-listing sentence', async () => {
  assert.deepEqual(leadLines(await render(ana(), { fail: true })), [OLD], 'offline');
  assert.deepEqual(leadLines(await render(ana(), { status: 500, body: { error: 'Server error.' } })), [OLD], 'server error');
});

test('setup: a platform admin keeps the first-listing sentence even while the card check is on', async () => {
  const el = await render(ana({ is_platform_admin: true }), { status: 200, body: { card_check: true } });
  assert.deepEqual(leadLines(el), [OLD]);
});

test('setup: the source reads the card check in setupView before the card is drawn, and the first-listing sentence is the no-card branch', () => {
  const src = fs.readFileSync(AUTH, 'utf8');
  const start = src.indexOf('export async function setupView');
  const end = src.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, 'setupView is in auth.js');
  const body = src.slice(start, end);
  const read = body.indexOf("const cardNext = !state.user.is_platform_admin && await get('/public/plans')");
  const draw = body.indexOf('el.append(publicPage(authCard(`Welcome, ');
  assert.ok(read >= 0, 'the card check is read for a person who is not a platform admin');
  assert.ok(draw > read, 'the read comes before the card is drawn');
  assert.ok(body.includes(`cardNext ? "${CARD}"`), 'the card sentence shows when cardNext');
  assert.ok(body.includes(`"${OLD}"`), 'the first-listing sentence stays for the other case');
});
