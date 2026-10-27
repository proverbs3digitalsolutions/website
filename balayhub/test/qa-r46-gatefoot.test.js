'use strict';
require('./helpers');

// QA round 46, GATEFOOT (D-128): the gate pass page draws its footer ("Private gate pass. Please don't forward. The link stops
// working after check-out.") only with a pass on screen. A link that is not valid, has expired or could not be read has no pass,
// so it has no footer. The view is loaded from a temp copy with a stand-in DOM and a stubbed fetch (as qa-r13-f11 does), so the
// test runs the real code. Frontend only, no database.
// R46_GATE_DIR (optional) names a folder holding another gatepass.js, to prove the test red on an older copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const pub = path.join(__dirname, '..', 'public', 'js');
const GATE_SRC = process.env.R46_GATE_DIR ? path.join(process.env.R46_GATE_DIR, 'gatepass.js') : path.join(pub, 'views', 'gatepass.js');
const FOOTER = "Private gate pass. Please don't forward. The link stops working after check-out.";

// Stand-in DOM: an element keeps its children, so the text under a view can be read back.
class Node { }
class Element extends Node {
  constructor(tag) { super(); Object.assign(this, { tagName: tag, attrs: {}, children: [], style: {}, dataset: {}, className: '' }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() { }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = { createElement: (tag) => new Element(tag), createElementNS: (ns, tag) => new Element(tag), createTextNode: (d) => d };
globalThis.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };

const realFetch = globalThis.fetch;
// Every API call answers with this status and body (the view's one GET; the page never posts before a draw).
function answer(status, body) {
  globalThis.fetch = async () => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
}
const text = (node) => (typeof node === 'string' ? node : node.children.map(text).join(' '));

// The shape src/routes/gatepass.js sends for a live pass (one guest, no ids).
const pass = {
  workspace: 'QA r46 gatefoot', property: 'QA r46 gatefoot property', address: '1 Test Street, Makati', unit: 'Unit 1',
  check_in: '2026-12-01', check_out: '2026-12-03', checkin_time: '2:00 PM', checkout_time: '11:00 AM',
  guests: ['QA r46 guest'], num_guests: 1, registered: null, arrival_time: null, vehicle_plate: null, guest_phone: null,
  code: 'BH-R46TEST', notes: null, authorized_by: 'QA r46 owner', contact: null, ids: [], acknowledged_at: null,
};

let gatepass; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r46-gatefoot-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(pub, f), path.join(dir, f));
  fs.copyFileSync(GATE_SRC, path.join(dir, 'views', 'gatepass.js'));
  gatepass = await import(pathToFileURL(path.join(dir, 'views', 'gatepass.js')));
});
test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
  delete globalThis.document; delete globalThis.Element; delete globalThis.Node; delete globalThis.localStorage;
});

// Draws the public gate pass page for one token and returns every word on it.
async function render(status, body) {
  answer(status, body);
  const el = new Element('div');
  await gatepass.gatepassPublicView(el, { params: { token: 'not-a-real-token-0' } });
  return text(el);
}

test('a link that is not valid shows the failure, with no footer about a pass (404)', async () => {
  const t = await render(404, { error: 'This gate pass link is not valid.' });
  assert.match(t, /Gate pass not available/);
  assert.match(t, /This gate pass link is not valid\./);
  assert.doesNotMatch(t, /Private gate pass/);
});

test('an expired link shows the failure, with no footer about a pass (404)', async () => {
  const t = await render(404, { error: 'This gate pass has expired.' });
  assert.match(t, /Gate pass not available/);
  assert.match(t, /This gate pass has expired\./);
  assert.doesNotMatch(t, /Private gate pass/);
});

test('a read that was refused (503) shows the failure, with no footer about a pass', async () => {
  const t = await render(503, { error: 'Gate passes are busy right now. Try again in a few minutes.' });
  assert.match(t, /Gate pass not available/);
  assert.match(t, /Gate passes are busy right now\./);
  assert.doesNotMatch(t, /Private gate pass/);
});

test('a live pass shows its heading and the footer word for word', async () => {
  const t = await render(200, pass);
  assert.match(t, /Guest gate pass/);
  assert.ok(t.includes(FOOTER), 'the footer is drawn under a pass');
});
