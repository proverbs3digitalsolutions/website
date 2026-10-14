'use strict';

// QA round 9, C08 cleaner pay. Covers #41 (an owner's own clean with no rate reads "Done by you, no pay", is not owed
// and cannot be marked paid), #42 (a rate the owner already has, added again, changes nothing: no question, no request),
// #43 (a clean whose name has no rate says so, and the name match is unchanged), and K13 for this page (a cleaner value
// the list does not have leaves the address, also after a failed load and a retry). Server checks use the test database;
// view checks use a stand-in DOM and a stubbed fetch, as test/qa-r8-c29.test.js does.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r9-c08.test.js

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { pool } = require('../src/db');
const { computePay } = require('../src/lib/cleanerpay');
const { hashPassword } = require('../src/lib/auth');

const PASSWORD = 'longenough1';
const MONTH = '2026-08';

describe('cleaner pay with no rate (server)', () => {
  let srv; let owner; let ownerId; let orgId; let unitId; let rosaId; let rosa;

  // A finished clean written straight to the table. Its pay is worked out the way the status route does it.
  async function task(o = {}) {
    const { assignedTo = null, assigneeName = null, completedBy = ownerId, day = 5, hhmm = '10:00', minutes = 60 } = o;
    const ts = `${MONTH}-${String(day).padStart(2, '0')}T${hhmm}:00+08:00`;
    const [{ task_id: id }] = await sql(
      `INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, assigned_to, assignee_name, completed_by, started_at, completed_at)
       VALUES ($1, $2, $3, 'done', $4, $5, $6, $7::timestamptz - make_interval(mins => $8), $7::timestamptz)
       RETURNING task_id`,
      [orgId, unitId, ts.slice(0, 10), assignedTo, assigneeName, completedBy, ts, minutes]);
    await computePay(pool, id);
    return id;
  }
  const row = async (id) => (await sql('SELECT * FROM cleaning_tasks WHERE task_id = $1', [id]))[0];
  const listed = async () => (await owner.get(`/api/cleaner-pay?month=${MONTH}`)).data;
  const find = (data, id) => data.tasks.find((t) => t.task_id === id);

  before(async () => {
    srv = await startServer();
    owner = await ownerAccount(srv.base, 'pay-owner-r9c08@example.com', 'Pay Stays R9');
    ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
    [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);
    const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
    unitId = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
    // A cleaner with a login and no rate.
    [{ user_id: rosaId }] = await sql(
      `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
       VALUES ($1, 'rosa-r9c08@example.com', $2, 'Rosa Reyes', 'cleaner', now()) RETURNING user_id`,
      [orgId, await hashPassword(PASSWORD)]);
    rosa = client(srv.base);
    assert.equal((await rosa.post('/api/auth/login', { email: 'rosa-r9c08@example.com', password: PASSWORD })).status, 200);
  });
  after(async () => { await srv.close(); });

  it('#41: a clean for the owner with no rate reads as done by the owner, is owed nothing, and cannot be marked paid', async () => {
    const assigned = await task({ assignedTo: ownerId, day: 3 });
    const finishedByOwner = await task({ day: 4 });
    const data = await listed();
    for (const id of [assigned, finishedByOwner]) {
      const t = find(data, id);
      assert.equal(t.pay_status, 'self');
      assert.equal(t.pay_amount, null);
      assert.equal(t.no_rate, true);
    }
    assert.equal(data.totals.unpaid, '0.00');
    assert.equal(data.cleaners.find((c) => c.key === `user:${ownerId}`).unpriced, 0);

    const refused = await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [assigned], paid_on: '2026-08-03', method: 'cash' });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.code, 'NO_PAY_AMOUNT');
    assert.equal((await row(assigned)).pay_status, 'unpaid');
  });

  it('#41: once the owner has a rate, a clean finished after it is priced as today; one finished before keeps no pay', async () => {
    const earlier = await task({ assignedTo: ownerId, day: 6 });
    assert.equal((await owner.raw('PUT', '/api/cleaner-rates', { user_id: ownerId, rate_type: 'per_clean', amount: '450' })).status, 200);
    const later = await task({ assignedTo: ownerId, day: 7 });
    const data = await listed();
    assert.equal(find(data, later).pay_status, 'unpaid');
    assert.equal(find(data, later).pay_amount, '450.00');
    assert.equal(find(data, later).no_rate, false);
    // Finished before the rate existed: no pay, as always. "Pay not set" until the owner sets it.
    assert.equal(find(data, earlier).pay_status, 'unpaid');
    assert.equal(find(data, earlier).pay_amount, null);
    assert.equal(data.totals.unpaid, '450.00');
  });

  it('#43: a clean whose name has no rate says so; the same name in another case still matches a rate', async () => {
    const id = await task({ assigneeName: 'Ana Ramos', day: 8 });
    const before = find(await listed(), id);
    assert.equal(before.pay_status, 'unpaid');
    assert.equal(before.pay_amount, null);
    assert.equal(before.no_rate, true);
    assert.equal((await owner.raw('PUT', '/api/cleaner-rates', { assignee_name: 'ana ramos', rate_type: 'per_clean', amount: '300' })).status, 200);
    assert.equal(find(await listed(), id).no_rate, false);
  });

  it('#43: a team member with no rate is an ordinary unpriced clean, not treated as the owner\'s', async () => {
    const id = await task({ assignedTo: rosaId, day: 9 });
    const t = find(await listed(), id);
    assert.equal(t.pay_status, 'unpaid');
    assert.equal(t.no_rate, true);
  });

  it('my pay: a cleaner sees their own clean with no rate field, and a clean another cleaner did stays hidden', async () => {
    const own = await task({ assignedTo: rosaId, day: 10 });
    const hidden = await task({ assignedTo: ownerId, completedBy: rosaId, day: 11 });
    const res = await rosa.get(`/api/my-pay?month=${MONTH}`);
    assert.equal(res.status, 200);
    const mine = res.data.tasks.find((t) => t.task_id === own);
    const theirs = res.data.tasks.find((t) => t.task_id === hidden);
    assert.equal(mine.pay_status, 'unpaid');
    assert.equal(mine.pay_amount, null);
    assert.equal(theirs.pay_visible, false);
    assert.equal(theirs.pay_status, null);
    assert.equal('no_rate' in mine, false);
    assert.equal('no_rate' in theirs, false);
  });
});

describe('cleaner pay view (stand-in DOM)', () => {
  // The same stand-in DOM as test/qa-r8-c29.test.js: just enough for h(), ui.js, filters.js and the view.
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

  // The list GET /cleaner-pay gives for August: an owner's clean with no pay (Done by you), a clean whose name has no
  // rate, and a team member's clean with no pay yet. The totals leave all three out of the unpaid total.
  const DATA = {
    tasks: [
      { task_id: 'own', unit_name: 'Loft A', property_name: 'Grass', cleaner_key: 'user:owner', cleaner_name: 'Ana Owner', completed_at: '2026-08-03T02:00:00Z', pay_amount: null, pay_status: 'self', no_rate: true, paid_on: null },
      { task_id: 'norate', unit_name: 'Rio 2210', property_name: 'Azure', cleaner_key: 'name:ana ramos', cleaner_name: 'Ana Ramos', completed_at: '2026-08-04T02:00:00Z', pay_amount: null, pay_status: 'unpaid', no_rate: true, paid_on: null },
      { task_id: 'set', unit_name: 'Tower 3', property_name: 'Azure', cleaner_key: 'user:bea', cleaner_name: 'Bea Reyes', completed_at: '2026-08-05T02:00:00Z', pay_amount: null, pay_status: 'unpaid', no_rate: false, paid_on: null },
    ],
    cleaners: [
      { key: 'user:owner', name: 'Ana Owner', count: 1, unpaid: '0.00', paid: '0.00', unpriced: 0 },
      { key: 'name:ana ramos', name: 'Ana Ramos', count: 1, unpaid: '0.00', paid: '0.00', unpriced: 1 },
      { key: 'user:bea', name: 'Bea Reyes', count: 1, unpaid: '0.00', paid: '0.00', unpriced: 1 },
    ],
    totals: { total: '0.00', paid: '0.00', unpaid: '0.00' },
  };

  let reply; let fail; let calls;
  const failed = { ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Try again in a moment.', code: 'SERVER' }) };
  const realFetch = globalThis.fetch;
  let view; let dir;

  const walk = (node, pred, out = []) => {
    if (node instanceof Element) {
      if (pred(node)) out.push(node);
      node.children.forEach((c) => walk(c, pred, out));
    }
    return out;
  };
  const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));
  const rowOf = (root, task) => walk(root, (n) => n.tagName === 'tr' && walk(n, (c) => c.tagName === 'input' && c.dataset.task === task).length > 0)[0];
  const payCell = (root, task) => walk(rowOf(root, task), (n) => n.tagName === 'td' && n.dataset.label === 'Pay')[0];
  const settle = () => new Promise((r) => setTimeout(r, 10));
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
      if (pathname === '/api/cleaner-pay' && fail) return failed;
      const body = pathname === '/api/cleaner-rates' ? { rates: [] } : pathname === '/api/team' ? { members: [] } : reply();
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
    };
    // The view imports app.js for the signed-in user (an owner here), so load it from a temp copy with a stub app.js.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-cleanerpay-r9-c08-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.mkdirSync(path.join(dir, 'views'));
    for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', user_id: 1 }, requireEmailVerification: true };\n");
    fs.copyFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), path.join(dir, 'views', 'cleanerpay.js'));
    view = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')));
  });
  after(() => { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });
  beforeEach(() => { store.clear(); calls = []; fail = false; reply = () => DATA; globalThis.location.hash = ''; });

  it('#41: the owner\'s own clean reads "Done by you, no pay", has no Set pay button, and is not in the missing-pay count', async () => {
    const { el, done } = open({});
    await done;
    assert.equal(textOf(payCell(el, 'own')), 'Done by you, no pay');
    assert.equal(walk(rowOf(el, 'own'), (n) => n.tagName === 'button' && textOf(n) === 'Set pay').length, 0);
    const text = textOf(el);
    assert.ok(text.includes('2 cleans with no pay set yet'), 'the two cleans with no pay are counted');
    assert.ok(!text.includes('3 cleans with no pay'), 'the owner\'s clean is not counted as missing');
  });

  it('#43: a clean whose name has no rate reads why; a clean with a rate still reads Pay not set', async () => {
    const { el, done } = open({});
    await done;
    assert.equal(textOf(payCell(el, 'norate')), 'No rate for this name. Add a rate or pick the team member.');
    assert.equal(textOf(payCell(el, 'set')), 'Pay not set. Use Set pay.');
  });

  it('#42: a rate with the same basis and amount as the one it replaces is refused as a toast, not asked about or sent', () => {
    const prior = { rate_type: 'per_clean', amount: '450.00' };
    assert.equal(view.sameRate(prior, 'per_clean', 450), true);
    assert.equal(view.sameRate(prior, 'per_hour', 450), false);
    assert.equal(view.sameRate(prior, 'per_clean', 451), false);
    assert.equal(view.sameRate(undefined, 'per_clean', 450), false);
    assert.equal(view.sameRate(prior, 'per_clean', NaN), false);
    assert.equal(view.rateText(prior), '₱450.00 per clean');
    // In the rate form the same-rate check runs before the question and before the request.
    const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');
    const same = src.indexOf('sameRate(prior, d.rate_type');
    assert.ok(same > 0, 'the rate form checks for the same rate');
    assert.ok(same < src.indexOf("confirmText: 'Change rate'"), 'before the change question');
    assert.ok(same < src.indexOf("api('PUT', '/cleaner-rates', body)"), 'before the request');
    assert.ok(src.includes('already has ${rateText(prior)}.'), 'the toast names the rate it keeps');
  });

  it('K13: a cleaner value the list does not have is dropped from the address once the list loads', async () => {
    location.hash = '#/cleaner-pay?cleaner=name%3Aghost';
    const { done } = open({ cleaner: 'name:ghost' });
    await done;
    assert.equal(location.hash, '#/cleaner-pay');
  });

  it('K13: a failed load leaves the address as the link had it; the retry then drops the unknown cleaner', async () => {
    location.hash = '#/cleaner-pay?cleaner=name%3Aghost';
    fail = true;
    const { el, done } = open({ cleaner: 'name:ghost' });
    await done;
    assert.deepEqual(calls, [], 'a failed load does not rewrite the address');
    assert.equal(location.hash, '#/cleaner-pay?cleaner=name%3Aghost');
    fail = false;
    const retry = walk(el, (n) => n.tagName === 'button' && textOf(n) === 'Try again')[0];
    assert.ok(retry, 'the error state offers Try again');
    retry.dispatch('click');
    await settle();
    assert.equal(location.hash, '#/cleaner-pay');
  });
});
