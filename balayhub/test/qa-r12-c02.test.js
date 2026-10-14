'use strict';

// QA round 12, C02. Every list sends its default tab to the server (apiFilters), and the owner statement
// payload carries portal_enabled. The view scan stays red until the other lanes switch their own files.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount, manilaToday } = require('./helpers');

// Just enough DOM for h(), ui.js and filters.js to load.
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

let dir; let filters;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r12-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('apiFilters sends a non-empty default and drops empty values', () => {
  const d = { status: 'outstanding', q: '', sort: '' };
  assert.deepEqual(filters.apiFilters({ ...d }, d), { status: 'outstanding' });
  assert.deepEqual(filters.apiFilters({ status: 'all', q: '', sort: '' }, d), { status: 'all' });
  assert.deepEqual(filters.apiFilters({ status: 'paid', q: 'lim', sort: 'due' }, d), { status: 'paid', q: 'lim', sort: 'due' });
  // changed() is unchanged: the default is still dropped for addresses.
  assert.deepEqual(filters.changed({ ...d }, d), {});
});

// changed( may only build an address (#/), sit in setUrl( or onUrl, or be Object.keys(changed(.
test('no view sends changed() filters to the server', () => {
  const root = path.join(__dirname, '../public/js/views');
  const bad = [];
  for (const f of fs.readdirSync(root).filter((n) => n.endsWith('.js'))) {
    fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
      if (!line.includes('changed(')) return;
      if (line.includes('#/') || line.includes('setUrl(') || line.includes('onUrl') || line.includes('Object.keys(changed(')) return;
      if (/^\s*(import|\/\/)/.test(line)) return;
      bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('the statement payload carries portal_enabled', async () => {
  const srv = await startServer();
  try {
    const host = await ownerAccount(srv.base, 'host-r12c02@example.com', 'R12 C02');
    const on = (await host.post('/api/unit-owners', { full_name: 'Portal Owner', email: 'po@example.com' })).data.owner_id;
    const off = (await host.post('/api/unit-owners', { full_name: 'No Portal' })).data.owner_id;
    const month = manilaToday().slice(0, 7);
    const a = (await host.get(`/api/unit-owners/${on}/statement?month=${month}`)).data;
    const b = (await host.get(`/api/unit-owners/${off}/statement?month=${month}`)).data;
    const list = (await host.get('/api/unit-owners')).data.owners;
    assert.equal(a.portal_enabled, Boolean(list.find((o) => o.owner_id === on).portal_enabled));
    assert.equal(b.portal_enabled, false);
  } finally { await srv.close?.(); }
});
