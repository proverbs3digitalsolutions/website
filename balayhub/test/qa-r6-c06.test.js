'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA round 6, lane C06 (daily close).
// #2: a balance due reads its check-in date as "Oct 15, 2026", not the raw ISO date.
// #6: a calendar sync problem links to the listing that has the feed (#/listings?focus=<unit>), as the Calendar warning does.
// #7: updating an existing close says "Close updated."; closing a day for the first time still says "Day closed.".
// The server checks run on their own database (TEST_DATABASE_URL) because the test resets the schema.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

const DAILYCLOSE_JS = path.join(__dirname, '..', 'public', 'js', 'views', 'dailyclose.js');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
// "Oct 15, 2026" for a YYYY-MM-DD date, written out here so the test does not copy the code under test.
const shortDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const day = (date) => `/api/daily-close?date=${date}`;
const section = (body, key) => body.sections.find((s) => s.key === key);

let srv; let owner; let orgId; let today;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r6-c06@example.com', 'Close Fix Stays');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['Close Fix Stays']))[0].organization_id;
  today = manilaToday();
});

test.after(async () => { await srv.close(); });

test('a balance due reads its check-in date as "Oct 15, 2026", not the raw ISO date', async () => {
  const prop = (await owner.post('/api/properties', { property_name: 'Balance Close', property_type: 'house', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1A', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const tomorrow = addDays(today, 1);
  // Checks in tomorrow with nothing paid, so it is on today's balances list.
  const r = await owner.post('/api/reservations', {
    unit_id: unit.unit_id, check_in: tomorrow, check_out: addDays(today, 3), guest_name: 'Juan Dela Cruz', accommodation_total: '3000.00', channel: 'direct',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const body = (await owner.get(day(today))).data;
  const row = section(body, 'balances_due').items.find((i) => i.text === 'Juan · 1A');
  assert.ok(row, 'the guest checking in tomorrow with nothing paid is on the balances list');
  assert.equal(row.detail, `Check-in ${shortDate(tomorrow)}`);
});

test('a calendar sync problem links to its listing, as the Calendar warning does, not to the calendar', async () => {
  const prop = (await owner.post('/api/properties', { property_name: 'Feed Close', property_type: 'house', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unitF = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1F', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const unitC = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1C', unit_type: 'studio', nightly_rate: '2000' })).data.unit;

  // 1F has a feed that failed; 1C has a feed with an overlap that is still open.
  await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
             VALUES ($1, $2, 'airbnb', 'https://example.com/f.ics', now(), 'error', 'boom')`, [orgId, unitF.unit_id]);
  const feedC = (await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status)
                            VALUES ($1, $2, 'agoda', 'https://example.com/c.ics', now(), 'ok') RETURNING feed_id`, [orgId, unitC.unit_id]))[0];
  await sql(`INSERT INTO ical_conflicts (organization_id, feed_id, unit_id, external_uid, check_in, check_out)
             VALUES ($1, $2, $3, 'uid-c06', $4, $5)`, [orgId, feedC.feed_id, unitC.unit_id, today, addDays(today, 1)]);

  const items = section((await owner.get(day(today))).data, 'sync_problems').items;
  const failing = items.find((i) => i.text === '1F · Airbnb');
  const overlap = items.find((i) => i.text === '1C · Agoda');
  assert.ok(failing, 'the failing feed is listed');
  assert.ok(overlap, 'the overlap is listed');
  assert.equal(failing.link, `#/listings?focus=${unitF.unit_id}`);
  assert.equal(overlap.link, `#/listings?focus=${unitC.unit_id}`);
});

test('the overlap line in sync problems reads its dates as "Oct 14, 2026 to Oct 15, 2026"', async () => {
  const prop = (await owner.post('/api/properties', { property_name: 'Overlap Close', property_type: 'house', address: 'Kalayaan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unitD = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1D', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const tomorrow = addDays(today, 1);
  const feedD = (await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status)
                            VALUES ($1, $2, 'agoda', 'https://example.com/d.ics', now(), 'ok') RETURNING feed_id`, [orgId, unitD.unit_id]))[0];
  await sql(`INSERT INTO ical_conflicts (organization_id, feed_id, unit_id, external_uid, check_in, check_out)
             VALUES ($1, $2, $3, 'uid-d06', $4, $5)`, [orgId, feedD.feed_id, unitD.unit_id, today, tomorrow]);

  const overlap = section((await owner.get(day(today))).data, 'sync_problems').items.find((i) => i.text === '1D · Agoda');
  assert.ok(overlap, 'the overlap is listed');
  assert.equal(overlap.detail, `Overlapping dates ${shortDate(today)} to ${shortDate(tomorrow)}`);
});

// The daily close view runs from a temp copy with stub UI modules (as in qa-r5-c16), so the test drives the real Update close button.
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const k of node.kids || []) walk(k, visit);
};

test('updating an existing close says "Close updated."; a first close still says "Day closed."', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c06-dailyclose-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.mkdirSync(path.join(dir, 'views'));
    fs.writeFileSync(path.join(dir, 'api.js'), [
      'export const get = async (p) => (p.startsWith("/daily-closes") ? { closes: [] } : globalThis.__c06Day);',
      'export const post = async (p, body) => { globalThis.__c06Posts.push({ p, body }); return {}; };',
      'export const qs = () => "";',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'ui.js'), [
      'export const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter((k) => k !== false && k !== null && k !== undefined), addEventListener() {} });',
      'export const peso = (v) => `₱${v}`;',
      'export const fmtDate = (d) => String(d);',
      'export const fmtDateTime = (d) => String(d);',
      'export const field = () => ({});',
      'export const formModal = (opts) => { globalThis.__c06Modal = opts; };',
      'export const emptyState = () => ({});',
      'export const confirmDialog = async () => true;',
      'export const toast = (m) => { globalThis.__c06Toasts.push(m); };',
      "export const todayManila = () => '2026-10-14';",
    ].join('\n'));
    const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
    fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
    fs.copyFileSync(DAILYCLOSE_JS, path.join(dir, 'views', 'dailyclose.js'));
    const dailyclose = await import(pathToFileURL(path.join(dir, 'views', 'dailyclose.js')));

    globalThis.__c06Posts = [];
    globalThis.__c06Toasts = [];
    // Opens the page for a day with or without a stored close, presses its main button, and submits the dialog.
    async function submitClose(closed) {
      globalThis.__c06Day = { date: '2026-10-14', closed, sections: [] };
      const el = { nodes: [], replaceChildren(...nodes) { this.nodes = nodes; } };
      await dailyclose.dailyCloseView(el, { query: {}, rerender() {} });
      let button = null;
      for (const n of el.nodes) walk(n, (x) => { if (x.tag === 'button' && /btn--primary/.test(x.attrs.class || '')) button = x; });
      assert.ok(button, 'the page has the close button');
      button.attrs.onclick();
      await globalThis.__c06Modal.onSubmit({ note: '' });
      return globalThis.__c06Toasts.at(-1);
    }

    assert.equal(await submitClose(null), 'Day closed.', 'a first close says the day is closed');
    const updated = { closed_at: '2026-10-14T10:00:00Z', closed_by_name: 'Bea Reyes', note: 'Checked' };
    assert.equal(await submitClose(updated), 'Close updated.', 'updating a close does not say it was closed again');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
