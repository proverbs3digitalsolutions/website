'use strict';

// QA round 15, lane TS: search API total/more, guest last-stay line, en dash dates (server) and top bar search UI (source scans).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r15ts-owner@example.com', 'R15 TS Stays');
  const org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'R15 TS Stays'`))[0].organization_id;
  const prop = (await owner.post('/api/properties', { property_name: 'Paris House', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const ids = [];
  for (let i = 0; i < 8; i += 1) ids.push((await sql(`INSERT INTO guests (organization_id, full_name, email, phone) VALUES ($1,'Stephanie Uy','s@secret.test','+639171234567') RETURNING guest_id`, [org]))[0].guest_id);
  await sql(`INSERT INTO bookings (organization_id, unit_id, kind, guest_id, check_in, check_out, status, confirmation_code) VALUES ($1,$2,'reservation',$3,'2026-10-16','2026-10-17','confirmed','TSR15A')`, [org, unit.unit_id, ids[0]]);
  await sql(`INSERT INTO bookings (organization_id, unit_id, kind, guest_id, check_in, check_out, status, confirmation_code) VALUES ($1,$2,'reservation',$3,'2026-09-01','2026-09-02','confirmed','TSR15B')`, [org, unit.unit_id, ids[0]]);
  await sql(`INSERT INTO guests (organization_id, full_name) VALUES ($1,'Solo Fewname')`, [org]);
});
test.after(async () => { await srv.close(); });

const grp = (r, key) => r.data.groups.find((g) => g.key === key);

test('guests: five shown, total and more say how many matched, sub is the latest stay or none', async () => {
  const r = await owner.get('/api/search?q=Stephanie%20Uy');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = grp(r, 'guests');
  assert.equal(g.items.length, 5);
  assert.equal(g.total, 8);
  assert.equal(g.more, true);
  for (const i of g.items) {
    assert.match(i.sub, /^(Last stay: .+ · [A-Z][a-z]{2} \d{1,2}, \d{4}|No stays yet)$/);
    assert.doesNotMatch(i.sub, /@|\+63/);
  }
  assert.ok(g.items.some((i) => i.sub === 'Last stay: Paris 1208 · Oct 16, 2026'), 'latest stay, not the September one');
});

test('a group that fits has total equal to its length and more false', async () => {
  const r = await owner.get('/api/search?q=Solo%20Fewname');
  const g = grp(r, 'guests');
  assert.equal(g.total, 1);
  assert.equal(g.more, false);
  assert.equal(g.items[0].sub, 'No stays yet');
});

test('reservation dates read Oct 16, 2026 – Oct 17, 2026', async () => {
  const r = await owner.get('/api/search?q=TSR15A');
  assert.equal(grp(r, 'reservations').items[0].sub, 'Paris 1208 · Oct 16, 2026 – Oct 17, 2026 · TSR15A');
});

test('order is explicit: prefix match first, then name, even when more than five match', async () => {
  const org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'R15 TS Stays'`))[0].organization_id;
  for (const n of ['Zed Ordertest', 'Yan Ordertest', 'Xia Ordertest', 'Wes Ordertest', 'Val Ordertest', 'Uma Ordertest', 'Ordertest Aaron']) await sql(`INSERT INTO guests (organization_id, full_name) VALUES ($1,$2)`, [org, n]);
  const g = grp(await owner.get('/api/search?q=Ordertest'), 'guests');
  assert.equal(g.total, 7);
  assert.deepEqual(g.items.map((i) => i.title), ['Ordertest Aaron', 'Uma Ordertest', 'Val Ordertest', 'Wes Ordertest', 'Xia Ordertest']);
});

const ts = read('public/js/topsearch.js');
const bar = read('public/js/topbar.js');

test('source: Settings results are labelled "In Settings"', () => {
  assert.ok(ts.includes("sub: 'In Settings'"));
  assert.ok(!ts.includes("sub: 'Setting'"));
});

test('source: no-results message is one disabled option inside the listbox', () => {
  assert.match(ts, /role: 'option'[^)]*'aria-disabled': 'true'|'aria-disabled': 'true'[^)]*role: 'option'/);
  assert.ok(!/extra\.push\(h\('div', \{ class: 'tb-empty'/.test(ts), 'no-results is no longer an extra beside the list');
});

test('source: mountSearch takes inSheet and draws no back button with it; the header button stays', () => {
  assert.match(ts, /\{ inSheet = false, onDone \}/);
  assert.ok(!/const back\b/.test(ts) && !/tb-back/.test(ts));
  assert.match(bar, /mountSearch\(slot, ctx, \{ inSheet: true/);
  assert.equal((bar.match(/'aria-label': 'Close search'/g) || []).length, 1);
});

test('source: in the sheet the list closes when focus leaves .tb-sheet, not on the input blur', () => {
  assert.match(ts, /closest\('\.tb-sheet'\)/);
  assert.match(ts, /of \$\{[^}]*total\} shown/);
  assert.ok(ts.includes('Type more of the name, or a confirmation code.'));
});

test('sheet Tab wrap: Close, box, Clear then back to Close; Shift+Tab from Close goes to Clear; never BODY', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bh-r15ts-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'topsearch.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  const { wrapTarget } = await import(require('node:url').pathToFileURL(path.join(dir, 'topsearch.js')));
  const [close, box, clear] = ['close', 'box', 'clear'];
  const stops = [close, box, clear];
  assert.equal(wrapTarget(stops, clear, false), close);
  assert.equal(wrapTarget(stops, close, true), clear);
  assert.equal(wrapTarget(stops, box, false), null);
  assert.equal(wrapTarget(stops, box, true), null);
  assert.equal(wrapTarget(stops, 'dialog', true), clear, 'focus on the dialog itself wraps back');
  assert.equal(wrapTarget([close, box], box, false), close, 'no recents: box is last');
  assert.equal(wrapTarget([], box, false), null);
});

test('source: the search sheet wraps Tab itself, the way the More sheet does, over buttons and the input only', () => {
  assert.match(bar, /class: 'tb-sheet'[\s\S]{0,120}onkeydown[\s\S]{0,500}wrapTarget/);
  assert.match(bar, /querySelectorAll\('button:not\(\[disabled\]\), input'\)/);
});

test('source: avatar menu has the shared theme switch after Settings, outside both menu lists, with no extra focus code', () => {
  const fn = bar.slice(bar.indexOf('function buildProfile'));
  const t = fn.indexOf("class: 'tb-theme'");
  assert.ok(fn.indexOf("item(row('settings'") < t && t < fn.indexOf("item(row('bookmark'"));
  assert.match(fn, /themeSwitch\(\{ compact: true \}\)/);
  assert.ok(!/\.focus\(\)/.test(fn.slice(t - 200, t + 200)), 'the switch keeps its own focus');
  assert.match(read('public/css/topbar.css'), /\.tb-theme \{[^}]*var\(--line\)/);
});
