'use strict';

// QA round 10, C11 cleaner pay. Covers #27 (Add rate with nothing chosen says what to choose; with both says to pick one;
// the Name box is required only while "Someone outside the team" is chosen), K2 (status=unpaid leaves out an owner's
// "Done by you" cleans), and K5 (a group with only "Done by you" cleans reads "Done by you, no pay"; a month with no
// cleaners drops an unknown cleaner from the address). Server checks use the test database; view checks use a stand-in
// DOM and a stubbed fetch, as test/qa-r9-c08.test.js does.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_04 node --test --test-concurrency=1 test/qa-r10-c11.test.js

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, sql, ownerAccount } = require('./helpers');
const { pool } = require('../src/db');
const { computePay } = require('../src/lib/cleanerpay');

const MONTH = '2026-08';
const VIEW = path.join(__dirname, '../public/js/views/cleanerpay.js');

describe('cleaner pay rates and the unpaid list (server)', () => {
  let srv; let owner; let ownerId; let orgId; let unitId; let cleanTask; let anaTask;

  // A finished clean written straight to the table; its pay is worked out the way the status route does it.
  async function task(o = {}) {
    const { assigneeName = null, completedBy = ownerId, day = 5 } = o;
    const ts = `${MONTH}-${String(day).padStart(2, '0')}T10:00:00+08:00`;
    const [{ task_id: id }] = await sql(
      `INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, assignee_name, completed_by, started_at, completed_at)
       VALUES ($1, $2, $3, 'done', $4, $5, $6::timestamptz - interval '1 hour', $6::timestamptz)
       RETURNING task_id`,
      [orgId, unitId, ts.slice(0, 10), assigneeName, completedBy, ts]);
    await computePay(pool, id);
    return id;
  }

  before(async () => {
    srv = await startServer();
    owner = await ownerAccount(srv.base, 'pay-owner-r10c11@example.com', 'Pay Stays R10');
    ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
    [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);
    const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
    unitId = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
    // An outside cleaner with a rate (set first, so the clean is priced when it is written).
    assert.equal((await owner.raw('PUT', '/api/cleaner-rates', { assignee_name: 'Ana Ramos', rate_type: 'per_clean', amount: '300' })).status, 200);
    anaTask = await task({ assigneeName: 'Ana Ramos', day: 4 });
    // The owner's own clean with no rate: "Done by you, no pay".
    cleanTask = await task({ day: 3 });
  });
  after(async () => { await srv.close(); });

  it('#27: a rate with neither a team member nor a name says to choose one', async () => {
    const r = await owner.raw('PUT', '/api/cleaner-rates', { rate_type: 'per_clean', amount: '300' });
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.assignee_name, 'Choose a team member or type a name for an outside cleaner.');
  });

  it('#27: a rate with both a team member and a name says to pick one, not both', async () => {
    const r = await owner.raw('PUT', '/api/cleaner-rates', { user_id: ownerId, assignee_name: 'Ana Ramos', rate_type: 'per_clean', amount: '300' });
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.assignee_name, 'Pick a team member or type a name, not both.');
  });

  it('K2: status=unpaid leaves out the owner\'s "Done by you" cleans; the priced unpaid clean stays', async () => {
    const unpaid = (await owner.get(`/api/cleaner-pay?month=${MONTH}&status=unpaid`)).data;
    assert.deepEqual(unpaid.tasks.map((t) => t.task_id), [anaTask]);
    assert.equal(unpaid.tasks.some((t) => t.pay_status === 'self'), false);
    assert.equal(unpaid.totals.unpaid, '300.00');
    assert.equal(unpaid.cleaners.some((c) => c.key === `user:${ownerId}`), false, 'a self-only cleaner is not listed under unpaid');
    // With no status filter the owner's clean is still listed, as "self".
    const all = (await owner.get(`/api/cleaner-pay?month=${MONTH}`)).data;
    assert.equal(all.tasks.find((t) => t.task_id === cleanTask).pay_status, 'self');
    // Paid filter: nothing is paid yet.
    assert.equal((await owner.get(`/api/cleaner-pay?month=${MONTH}&status=paid`)).data.tasks.length, 0);
  });

  it('K5: the By cleaner group for the owner counts its "Done by you" cleans', async () => {
    const { cleaners } = (await owner.get(`/api/cleaner-pay?month=${MONTH}`)).data;
    const mine = cleaners.find((c) => c.key === `user:${ownerId}`);
    assert.equal(mine.count, 1);
    assert.equal(mine.self, 1);
    const ana = cleaners.find((c) => c.key === 'name:ana ramos');
    assert.equal(ana.self, 0);
  });
});

describe('cleaner pay view (stand-in DOM)', () => {
  // The same stand-in DOM as test/qa-r9-c08.test.js: just enough for h(), ui.js, filters.js and the view.
  class Node { }
  class Text extends Node { constructor(data) { super(); this.data = data; } }
  const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
  class Element extends Node {
    constructor(tag) {
      super();
      Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '', checked: false, disabled: false });
    }
    get hidden() { return 'hidden' in this.attrs; }
    set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, type }); }
    append(...nodes) { this.children.push(...nodes.map(toNode)); }
    replaceChildren(...nodes) { this.children = nodes.map(toNode); }
    get textContent() { return textOf(this); }
    set textContent(v) { this.children = [new Text(String(v))]; }
  }
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));

  const EMPTY = { tasks: [], cleaners: [], totals: { total: '0.00', paid: '0.00', unpaid: '0.00' } };
  let reply; let calls; let view; let dir;
  const realFetch = globalThis.fetch;

  const open = (query) => {
    const el = new Element('div');
    return { el, done: view.cleanerPayView(el, { query }) };
  };

  before(async () => {
    globalThis.Node = Node;
    globalThis.Element = Element;
    globalThis.document = {
      createElement: (tag) => new Element(tag),
      createElementNS: (ns, tag) => new Element(tag),
      createTextNode: (data) => new Text(data),
      getElementById: () => null,
      body: new Element('body'),
      documentElement: new Element('html'),
      activeElement: null,
    };
    globalThis.localStorage = storage;
    globalThis.sessionStorage = storage;
    globalThis.location = { hash: '' };
    globalThis.history = { replaceState(_state, _title, url) { calls.push(url); globalThis.location.hash = url; } };
    globalThis.fetch = async (url) => {
      const { pathname } = new URL(url, 'http://balayhub.test');
      const body = pathname === '/api/cleaner-rates' ? { rates: [] } : pathname === '/api/team' ? { members: [] } : reply();
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
    };
    // The view imports app.js for the signed-in user (an owner here), so load it from a temp copy with a stub app.js.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-cleanerpay-r10-c11-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.mkdirSync(path.join(dir, 'views'));
    for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', user_id: 1 }, requireEmailVerification: true };\n");
    fs.copyFileSync(VIEW, path.join(dir, 'views', 'cleanerpay.js'));
    view = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')));
  });
  after(() => { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });
  beforeEach(() => { store.clear(); calls = []; reply = () => EMPTY; globalThis.location.hash = ''; });

  it('K5: a group with only "Done by you" cleans reads "Done by you, no pay"; a mixed group still reads by money', () => {
    const base = { unpaid: '0.00', paid: '0.00', unpriced: 0 };
    assert.equal(view.cleanerStatus({ ...base, count: 1, self: 1 }), 'Done by you, no pay');
    assert.equal(view.cleanerStatus({ ...base, count: 3, self: 3 }), 'Done by you, no pay');
    assert.equal(view.cleanerStatus({ ...base, count: 2, self: 1, paid: '450.00' }), 'All paid');
    assert.equal(view.cleanerStatus({ ...base, count: 2, paid: '450.00' }), 'All paid', 'a group with no self count still reads All paid');
  });

  it('K5: a month with no cleaners drops a cleaner value the list does not have from the address', async () => {
    location.hash = '#/cleaner-pay?cleaner=name%3Aghost';
    const { done } = open({ cleaner: 'name:ghost' });
    await done;
    assert.equal(location.hash, '#/cleaner-pay');
  });

  it('#27: the Name box is required and shown only while "Someone outside the team" is chosen', () => {
    const src = fs.readFileSync(VIEW, 'utf8');
    assert.match(src, /nameF\.hidden = !outside/, 'the Name box is hidden when a team member is chosen');
    assert.match(src, /\.required = outside/, 'the Name box is required exactly while it is shown');
    assert.match(src, /field\(\{ name: 'assignee_name', label: 'Name', required: true/, 'the Name label carries the required mark');
  });
});
