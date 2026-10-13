'use strict';

// Phase 4 (Lane E): public review links on the thank-you step, workspace guest settings,
// returning-guest codes, and the by-source breakdown on stay reports.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { codeFor } = require('../src/lib/returning');
const { applyCode } = require('../src/lib/discounts');

let srv; let owner; let mgr; let prop; let unit; let orgId;
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Phase Four Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Phase Four Stays'`))[0].organization_id;

  const inv = await owner.post('/api/team/invitations', { email: 'mgr@example.com', role: 'manager', property_ids: [prop.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  mgr = client(srv.base);
  const s = await mgr.post('/api/auth/signup', { full_name: 'Manager', email: 'mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
});
test.after(async () => { await srv.close(); });

const stay = async (checkIn, checkOut, extra = {}) => (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: checkIn, check_out: checkOut, guest_name: 'Guest', ...extra })).data.reservation;
// The review token is made when a thank-you message is rendered (guestcare.test.js covers that);
// here the fixture just sets one.
const reviewTokenFor = async (checkIn, checkOut, email) => {
  const b = await stay(checkIn, checkOut, { guest_name: 'Mia Cruz', guest_email: email });
  const token = crypto.randomBytes(24).toString('base64url');
  await sql('UPDATE bookings SET review_token = $2 WHERE booking_id = $1', [b.booking_id, token]);
  return token;
};

const LINKS = [{ label: 'Google', url: 'https://g.page/balay' }, { label: 'Facebook', url: 'https://facebook.com/balay' }];

test('guest settings: owners read and change them; managers cannot', async () => {
  assert.deepEqual((await owner.get('/api/workspace/guest-settings')).data, { review_links: [], returning_guest_pct: null, abandoned_followup: false });
  assert.equal((await mgr.get('/api/workspace/guest-settings')).status, 403);
  assert.equal((await mgr.patch('/api/workspace/guest-settings', { abandoned_followup: true })).status, 403);
  assert.equal((await owner.get('/api/workspace/guest-settings')).data.abandoned_followup, false, 'the manager change did nothing');
});

test('guest settings: bad values are refused with 400 and nothing is saved', async () => {
  const bad = [
    { returning_guest_pct: 0 },
    { returning_guest_pct: 51 },
    { returning_guest_pct: 'lots' },
    { review_links: [1, 2, 3, 4, 5].map((i) => ({ label: `Page ${i}`, url: 'https://example.com/p' })) },
    { review_links: [{ label: 'Insecure', url: 'http://example.com/page' }] },
    { review_links: [{ label: 'Script', url: 'javascript:alert(1)' }] },
    { review_links: [{ label: '', url: 'https://example.com/page' }] },
    { review_links: [{ label: 'x'.repeat(41), url: 'https://example.com/page' }] },
    { review_links: [{ label: 'Long', url: `https://example.com/${'a'.repeat(300)}` }] },
    { review_links: 'https://example.com' },
  ];
  for (const body of bad) {
    const r = await owner.patch('/api/workspace/guest-settings', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.data.code, 'VALIDATION');
  }
  assert.deepEqual((await owner.get('/api/workspace/guest-settings')).data.review_links, [], 'nothing saved');
});

test('guest settings: PATCH changes only what is sent, null turns the discount off, and changes are audited', async () => {
  let r = await owner.patch('/api/workspace/guest-settings', { review_links: [{ label: '  Google  ', url: 'https://g.page/balay' }, LINKS[1]], returning_guest_pct: 10 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { review_links: LINKS, returning_guest_pct: 10, abandoned_followup: false });

  r = await owner.patch('/api/workspace/guest-settings', { abandoned_followup: true });
  assert.deepEqual(r.data, { review_links: LINKS, returning_guest_pct: 10, abandoned_followup: true });

  r = await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: null });
  assert.deepEqual(r.data, { review_links: LINKS, returning_guest_pct: null, abandoned_followup: true });

  r = await owner.patch('/api/workspace/guest-settings', {});
  assert.equal(r.status, 200, 'an empty change is fine');

  const audits = await sql(`SELECT action FROM audit_logs WHERE organization_id = $1 AND action = 'workspace.guest_settings_updated'`, [orgId]);
  assert.equal(audits.length, 3, 'one audit row per change, none for the empty one');
});

test('guest settings: changes are blocked while the workspace is view-only', async () => {
  await sql('UPDATE organizations SET is_demo = true WHERE organization_id = $1', [orgId]);
  try {
    assert.equal((await owner.patch('/api/workspace/guest-settings', { abandoned_followup: false })).status, 403);
    assert.equal((await owner.get('/api/workspace/guest-settings')).status, 200, 'reading still works');
  } finally {
    await sql('UPDATE organizations SET is_demo = false WHERE organization_id = $1', [orgId]);
  }
});

test('review: 4 and 5 stars get the host links; 3 stars and empty link lists never do; bad stored links are dropped', async () => {
  await owner.patch('/api/workspace/guest-settings', { review_links: LINKS });
  const guest = client(srv.base);
  const post = async (token, body) => guest.post(`/api/public/review/${token}`, body);

  const five = await post(await reviewTokenFor(d(-50), d(-48), 'five@example.com'), { rating: 5 });
  assert.equal(five.status, 201);
  assert.deepEqual(five.data, { ok: true, share_links: LINKS });

  const four = await post(await reviewTokenFor(d(-45), d(-43), 'four@example.com'), { rating: 4, comment: 'Great stay' });
  assert.deepEqual(four.data, { ok: true, share_links: LINKS });

  const three = await post(await reviewTokenFor(d(-40), d(-38), 'three@example.com'), { rating: 3 });
  assert.deepEqual(three.data, { ok: true }, '3 stars never see the links');

  await owner.patch('/api/workspace/guest-settings', { review_links: [] });
  const none = await post(await reviewTokenFor(d(-35), d(-33), 'none@example.com'), { rating: 5 });
  assert.deepEqual(none.data, { ok: true }, 'no links set, so no share_links key');

  await sql('UPDATE organizations SET review_links = $2::jsonb WHERE organization_id = $1', [orgId, JSON.stringify([
    { label: 'Insecure', url: 'http://example.com/page' },
    { label: 'Script', url: 'javascript:alert(1)' },
    { label: 'Good', url: 'https://ok.example.com/p' },
  ])]);
  const mixed = await post(await reviewTokenFor(d(-30), d(-28), 'mixed@example.com'), { rating: 5 });
  assert.deepEqual(mixed.data, { ok: true, share_links: [{ label: 'Good', url: 'https://ok.example.com/p' }] });
  assert.deepEqual((await owner.get('/api/workspace/guest-settings')).data.review_links, [{ label: 'Good', url: 'https://ok.example.com/p' }]);
});

test('returning-guest code: one per checked-out stay, off without the setting, and it works at checkout', async () => {
  await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: null });
  const past = await stay(d(-20), d(-18), { guest_name: 'Lia Santos', guest_email: 'lia@example.com' });
  assert.equal(await codeFor(past.booking_id), '', 'discount off');

  await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: 15 });
  const code = await codeFor(past.booking_id);
  assert.match(code, /^WELCOME-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(await codeFor(past.booking_id), code, 'same code on the next call');

  const rows = await sql('SELECT * FROM discount_codes WHERE issued_to_booking_id = $1', [past.booking_id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, code);
  assert.equal(rows[0].percent_off, 15);
  assert.equal(rows[0].amount_off, null);
  assert.equal(rows[0].returning_only, true);
  assert.equal(rows[0].max_uses, 1);
  assert.equal(rows[0].active, true);
  const validDays = Math.round((Date.parse(String(rows[0].valid_until)) - Date.parse(manilaToday())) / 86400000);
  assert.ok(validDays >= 360 && validDays <= 372, `valid about 12 months, got ${validDays} days`);

  // The code still works at checkout for the same guest, and not for someone else.
  const ok = await applyCode(orgId, code, { nights: 2, accommodation: 4000, email: 'lia@example.com', name: 'Lia Reyes' });
  assert.equal(ok.discount, 600, '15% of 4000');
  const other = await applyCode(orgId, code, { nights: 2, accommodation: 4000, email: 'other@example.com', name: 'Lia Reyes' });
  assert.match(other.error, /returning guests/);
});

test('returning-guest code: two calls at once give one code; stays still to come, cancelled or unknown get none', async () => {
  const fresh = await stay(d(-16), d(-14), { guest_name: 'Ben Cruz', guest_email: 'ben@example.com' });
  const codes = await Promise.all([1, 2, 3, 4, 5].map(() => codeFor(fresh.booking_id)));
  assert.equal(new Set(codes).size, 1);
  assert.match(codes[0], /^WELCOME-/);
  const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM discount_codes WHERE issued_to_booking_id = $1', [fresh.booking_id]);
  assert.equal(n, 1);

  const upcoming = await stay(d(20), d(22), { guest_name: 'Ana Reyes', guest_email: 'ana@example.com' });
  assert.equal(await codeFor(upcoming.booking_id), '', 'not checked out yet');
  const cancelled = await stay(d(-12), d(-10), { guest_name: 'Joy Lim', guest_email: 'joy@example.com' });
  await owner.post(`/api/reservations/${cancelled.booking_id}/cancel`, { reason: 'Changed plans' });
  assert.equal(await codeFor(cancelled.booking_id), '', 'cancelled');
  assert.equal(await codeFor('00000000-0000-0000-0000-000000000000'), '', 'unknown booking');

  await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: null });
  assert.equal(await codeFor(fresh.booking_id), '', 'setting off: the variable is empty');
  await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: 15 });
});

test('returning-guest codes do not use up the owner limit of 50 active codes', async () => {
  await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: 10 });
  const u3 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1305', unit_type: 'studio', nightly_rate: '1000' })).data.unit;
  for (let i = 0; i < 50; i += 1) {
    const b = await owner.post('/api/reservations', { unit_id: u3.unit_id, check_in: d(-300 + i), check_out: d(-299 + i), guest_name: `Guest ${i}`, guest_email: `guest${i}@example.com` });
    assert.equal(b.status, 201, JSON.stringify(b.data));
    assert.match(await codeFor(b.data.reservation.booking_id), /^WELCOME-/);
  }
  const manual = await owner.post('/api/discount-codes', { code: 'MANUAL50', percent_off: 5 });
  assert.equal(manual.status, 201, JSON.stringify(manual.data));
});

test('stay reports: direct stays by source, by check-in date, confirmed only', async () => {
  const p2 = (await owner.post('/api/properties', { property_name: 'Harbor', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  const u2 = (await owner.post(`/api/properties/${p2.property_id}/units`, { unit_name: 'H2', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  const book = async (ci, co, extra = {}) => (await owner.post('/api/reservations', { unit_id: u2.unit_id, check_in: ci, check_out: co, guest_name: 'Report Guest', ...extra })).data.reservation;
  const setSource = (b, source) => sql('UPDATE bookings SET source = $2 WHERE booking_id = $1', [b.booking_id, source]);

  const facebook = await book('2025-03-03', '2025-03-05'); // 2 nights: 4000 + 500 cleaning
  await setSource(facebook, 'facebook');
  const noSource = await book('2025-03-10', '2025-03-13'); // 3 nights: 6000 + 500 cleaning
  await setSource(noSource, null);
  const cancelled = await book('2025-03-20', '2025-03-21');
  await setSource(cancelled, 'facebook');
  await owner.post(`/api/reservations/${cancelled.booking_id}/cancel`, { reason: 'x' });
  const airbnb = await book('2025-03-25', '2025-03-27', { channel: 'airbnb' });
  await setSource(airbnb, 'google');
  const february = await book('2025-02-26', '2025-02-28');
  await setSource(february, 'facebook');
  const april = await book('2025-04-01', '2025-04-02');
  await setSource(april, 'instagram');

  const r = (await owner.get('/api/stay-reports?month=2025-03')).data;
  assert.deepEqual(r.by_source.map((s) => s.source), [null, 'facebook'], 'largest revenue first');
  assert.deepEqual(r.by_source.find((s) => s.source === 'facebook'), { source: 'facebook', stays: 1, nights: 2, revenue: '4500.00' });
  assert.deepEqual(r.by_source.find((s) => s.source === null), { source: null, stays: 1, nights: 3, revenue: '6500.00' });

  assert.deepEqual((await owner.get('/api/stay-reports?month=2025-03&channel=airbnb')).data.by_source, []);
  assert.equal((await owner.get('/api/stay-reports?month=2025-03&channel=direct')).data.by_source.length, 2);
  assert.equal((await owner.get(`/api/stay-reports?month=2025-03&unit_id=${u2.unit_id}`)).data.by_source.length, 2);

  // A manager sees only the properties assigned to them, and this one has no March stays.
  const m = await mgr.get('/api/stay-reports?month=2025-03');
  assert.equal(m.status, 200);
  assert.deepEqual(m.data.by_source, []);

  // Earned March revenue: facebook 4500 + no-source 6500 + the airbnb stay 4500 (all channels).
  assert.equal(r.totals.revenue, '15500.00');
  assert.equal((await owner.get('/api/stay-reports/tax?year=2025')).data.months.find((x) => x.month === '2025-03').revenue, '15500.00');
});

test('discount codes: each shows whether a personal code was issued to a guest; ?issued=yes|no filters; the default list has all', async () => {
  await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: 10 });
  const gone = await stay(d(-150), d(-148), { guest_name: 'Nina Cruz', guest_email: 'nina@example.com' });
  const personal = await codeFor(gone.booking_id);
  assert.match(personal, /^WELCOME-/);
  const list = async (query) => (await owner.get(`/api/discount-codes${query}`)).data;

  const all = await list('');
  const issued = all.codes.find((c) => c.code === personal);
  assert.equal(issued.issued, true);
  assert.equal(issued.issued_to_booking_id, gone.booking_id);
  const hostMade = all.codes.find((c) => c.code === 'MANUAL50');
  assert.equal(hostMade.issued, false);
  assert.equal(hostMade.issued_to_booking_id, null);

  const yes = await list('?issued=yes');
  assert.ok(yes.codes.some((c) => c.code === personal));
  assert.ok(yes.codes.every((c) => c.issued === true));
  assert.equal(yes.total, all.total, 'the total still counts every code');
  const no = await list('?issued=no');
  assert.ok(no.codes.some((c) => c.code === 'MANUAL50'));
  assert.ok(no.codes.every((c) => c.issued === false));
  assert.equal(yes.codes.length + no.codes.length, all.codes.length);
  assert.equal((await list('?issued=maybe')).codes.length, all.codes.length, 'an unknown value filters nothing');
});

test('returning-guest code: only the guest it was issued to can use it; another guest with a past stay under the same first name is refused', async () => {
  await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: 10 });
  const first = await stay(d(-60), d(-58), { guest_name: 'Rosa Mendoza', guest_email: 'rosa@example.com' });
  const code = await codeFor(first.booking_id);
  assert.match(code, /^WELCOME-/);
  await stay(d(-70), d(-68), { guest_name: 'Rosa Diaz', guest_email: 'rosa2@example.com' });

  const other = await applyCode(orgId, code, { nights: 2, accommodation: 4000, email: 'rosa2@example.com', name: 'Rosa Lim' });
  assert.equal(other.error, 'This code is not valid.');
  assert.equal(other.discount, undefined);
  const same = await applyCode(orgId, code, { nights: 2, accommodation: 4000, email: 'ROSA@example.com', name: 'Rosa Mendoza' });
  assert.equal(same.discount, 400, '10% of 4000, email matched without regard to case');
});
