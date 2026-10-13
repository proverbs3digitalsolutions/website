'use strict';

// Owner statements: fee types (D-40), review then send (D-41) and the repairs reserve (D-43).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { outbox } = require('../src/lib/mailer');
const { draftMonth } = require('../src/lib/statements');

const JUL = '2026-07';
const AUG = '2026-08';
const SEP = '2026-09';
const JUN = '2026-06';

let srv; let host; let property; let orgId; let userId;
const U = {}; // units by key
const O = {}; // owner ids by key

const createUnit = async (name, nightly, cleaning) => (await host.post(`/api/properties/${property.property_id}/units`,
  { unit_name: name, unit_type: 'studio', nightly_rate: nightly, ...(cleaning ? { cleaning_fee: cleaning } : {}) })).data.unit;
const createOwner = async (body) => {
  const r = await host.post('/api/unit-owners', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.owner_id;
};
const stay = async (unit, checkIn, checkOut, extra = {}) => {
  const r = await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: checkIn, check_out: checkOut, guest_name: 'Guest', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.reservation;
};
const pay = (r, amount, date, method = 'gcash') => host.post(`/api/reservations/${r.booking_id}/payments`, { amount, payment_date: date, payment_method: method });
const refund = (r, amount, date) => host.post(`/api/reservations/${r.booking_id}/refunds`, { amount, refund_date: date, method: 'gcash', reason: 'Refund' });
const expense = (unit, amount, date, receiptFileId = null) => sql(
  `INSERT INTO expenses (organization_id, property_id, unit_id, category, description, amount, expense_date, recorded_by, receipt_file_id)
   VALUES ($1, $2, $3, 'repairs', 'Aircon repair', $4, $5, $6, $7)`, [orgId, unit.property_id, unit.unit_id, amount, date, userId, receiptFileId]);
const view = async (ownerId, month) => (await host.get(`/api/unit-owners/${ownerId}/statement?month=${month}`)).data;
const publish = (ownerId, month) => host.post(`/api/unit-owners/${ownerId}/statement/publish`, { month });
const unpublish = (ownerId, month) => host.post(`/api/unit-owners/${ownerId}/statement/unpublish`, { month });
const send = (ownerId, month) => host.post(`/api/unit-owners/${ownerId}/statement/send`, { month });

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host-stmt@example.com', 'Statements Test');
  property = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Statements Test'`))[0].organization_id;
  userId = (await sql(`SELECT user_id FROM users WHERE email = 'host-stmt@example.com'`))[0].user_id;

  U.net = await createUnit('1201', '2000', '500');
  U.gross = await createUnit('805', '1500');
  U.flat = await createUnit('1407', '2000');
  U.neg = await createUnit('2001', '2000', '500');
  U.res = await createUnit('2002', '2000');
  U.cap = await createUnit('2003', '300');

  O.net = await createOwner({ full_name: 'Net Owner', email: 'net@example.com', management_fee_pct: '20', unit_ids: [U.net.unit_id] });
  O.gross = await createOwner({ full_name: 'Gross Owner', email: 'gross@example.com', management_fee_pct: '15', fee_model: 'gross_pct', unit_ids: [U.gross.unit_id] });
  O.flat = await createOwner({ full_name: 'Flat Owner', email: 'flat@example.com', fee_model: 'flat', flat_monthly_fee: '1000', unit_ids: [U.flat.unit_id] });
  O.empty = await createOwner({ full_name: 'Unitless Owner', fee_model: 'flat', flat_monthly_fee: '1000' });
  O.neg = await createOwner({ full_name: 'Negative Owner', email: 'neg@example.com', management_fee_pct: '20', unit_ids: [U.neg.unit_id] });
  O.res = await createOwner({ full_name: 'Reserve Owner', email: 'res@example.com', management_fee_pct: '20', reserve_target: '500', reserve_monthly: '300', unit_ids: [U.res.unit_id] });
  O.cap = await createOwner({ full_name: 'Cap Owner', email: 'cap@example.com', management_fee_pct: '20', reserve_target: '1000', reserve_monthly: '300', unit_ids: [U.cap.unit_id] });
});
test.after(async () => { await srv.close(); });

test('owner settings: fee type and reserve are validated, default to today\'s rule, and can be changed', async () => {
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Bad Fee', fee_model: 'percent' })).status, 400);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Bad Flat', fee_model: 'flat', flat_monthly_fee: '-5' })).status, 400);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Bad Reserve', reserve_target: 'lots' })).status, 400);

  const listed = (await host.get('/api/unit-owners')).data.owners.find((o) => o.owner_id === O.net);
  assert.deepEqual([listed.fee_model, listed.flat_monthly_fee, listed.reserve_target, listed.reserve_monthly], ['net_pct', '0.00', '0.00', '0.00']);

  assert.equal((await host.patch(`/api/unit-owners/${O.net}`, { fee_model: 'weird' })).status, 400);
  assert.equal((await host.patch(`/api/unit-owners/${O.net}`, { fee_model: 'gross_pct' })).status, 200);
  assert.equal((await host.get('/api/unit-owners')).data.owners.find((o) => o.owner_id === O.net).fee_model, 'gross_pct');
  assert.equal((await host.patch(`/api/unit-owners/${O.net}`, { fee_model: 'net_pct' })).status, 200);
});

test('each fee model, to the centavo', async () => {
  // Net (today's rule): 4,500 gross, 600 channel fee, 500 cleaning the manager keeps, 20% of the 3,400 left.
  await stay(U.net, '2026-08-03', '2026-08-05', { channel: 'airbnb', channel_fee: '600' });
  let s = (await view(O.net, AUG)).statement;
  assert.deepEqual(
    [s.totals.gross, s.totals.channel_fees, s.totals.cleaning_fees, s.totals.net_rental, s.totals.management_fee, s.totals.payout, s.fee_label],
    ['4500.00', '600.00', '500.00', '3400.00', '680.00', '2720.00', 'Management fee (20% of net)']);
  assert.deepEqual(s.reserve, { balance: '0.00', target: '0.00', monthly: '0.00', topup: '0.00' }, 'no reserve set, so no top-up');

  // Gross: 3,000 gross, 300 channel fee, 3,000 paid, 500 refunded. The overpayment is paid - (gross - channel fee)
  // = 3,000 - 2,700 = 300, so 300 of the refund only returns it and 200 counts (D-37, D-44).
  // Net: 3,000 - 300 - 200 = 2,500. The fee is 15% of the 2,800 left after the counted refund (3,000 - 200) = 420.
  // Payout: 2,500 - 420 = 2,080.
  const g = await stay(U.gross, '2026-08-10', '2026-08-12', { channel: 'airbnb', channel_fee: '300' });
  await pay(g, '3000.00', '2026-08-10');
  await refund(g, '500.00', '2026-08-11');
  s = (await view(O.gross, AUG)).statement;
  assert.deepEqual(
    [s.totals.gross, s.totals.net_rental, s.totals.management_fee, s.totals.payout, s.refunded, s.fee_label],
    ['3000.00', '2500.00', '420.00', '2080.00', '200.00', 'Management fee (15% of gross)']);

  // Flat: a stay-free August still pays the 1,000 for having a unit; a 4,000 September stay pays that same 1,000.
  s = (await view(O.flat, AUG)).statement;
  assert.deepEqual([s.totals.stays, s.totals.management_fee, s.totals.payout, s.fee_label], [0, '1000.00', '-1000.00', 'Management fee (flat)']);
  await stay(U.flat, '2026-09-10', '2026-09-12');
  s = (await view(O.flat, SEP)).statement;
  assert.deepEqual([s.totals.net_rental, s.totals.management_fee, s.totals.payout], ['4000.00', '1000.00', '3000.00']);

  // Flat with no units at all: no fee.
  s = (await view(O.empty, AUG)).statement;
  assert.deepEqual([s.totals.management_fee, s.totals.payout], ['0.00', '0.00']);

  // Net below zero: the fee is never negative, and the payout shows the shortfall.
  const ng = await stay(U.neg, '2026-08-14', '2026-08-16');
  await pay(ng, '4500.00', '2026-08-14', 'cash');
  await refund(ng, '4500.00', '2026-08-15');
  s = (await view(O.neg, AUG)).statement;
  assert.deepEqual(
    [s.totals.gross, s.totals.cleaning_fees, s.refunded, s.totals.net_rental, s.totals.management_fee, s.totals.payout],
    ['4500.00', '500.00', '4500.00', '-500.00', '0.00', '-500.00']);
});

test('the reserve top-up is the smallest of the monthly amount, the room to the target and the payout', async () => {
  // Reserve owner: target 500, 300 a month. August payout before the top-up is 3,200 (4,000 less the 20% fee).
  await stay(U.res, '2026-08-03', '2026-08-05');
  await stay(U.res, '2026-09-03', '2026-09-05');
  let s = (await view(O.res, AUG)).statement;
  assert.deepEqual([s.reserve.balance, s.reserve.target, s.reserve.monthly, s.reserve.topup], ['0.00', '500.00', '300.00', '300.00']);
  assert.equal(s.totals.payout, '2900.00');

  // Capped by the payout: a 300 night leaves 240 after the fee, so the top-up is 240 and the payout is 0.
  await stay(U.cap, '2026-07-10', '2026-07-11');
  s = (await view(O.cap, JUL)).statement;
  assert.deepEqual([s.totals.management_fee, s.reserve.topup, s.totals.payout], ['60.00', '240.00', '0.00']);

  // Publish August: 300 goes into the reserve. In September only 200 is left to reach the 500 target.
  assert.equal((await publish(O.res, AUG)).status, 200);
  assert.deepEqual(await sql(`SELECT kind, amount::text FROM owner_reserve_entries WHERE owner_id = $1 AND voided_at IS NULL`, [O.res]),
    [{ kind: 'deposit', amount: '300.00' }]);
  s = (await view(O.res, SEP)).statement;
  assert.deepEqual([s.reserve.balance, s.reserve.topup, s.totals.payout], ['300.00', '200.00', '3000.00']);

  // Publishing September adds its 200; unpublishing it voids that deposit and the live numbers are unchanged.
  assert.equal((await publish(O.res, SEP)).status, 200);
  assert.equal((await unpublish(O.res, SEP)).status, 200);
  s = (await view(O.res, SEP)).statement;
  assert.deepEqual([s.reserve.balance, s.reserve.topup], ['300.00', '200.00']);
  assert.deepEqual(await sql(`SELECT amount::text, voided_at IS NOT NULL AS voided FROM owner_reserve_entries WHERE owner_id = $1 ORDER BY created_at`, [O.res]),
    [{ amount: '300.00', voided: false }, { amount: '200.00', voided: true }]);
  assert.equal((await publish(O.res, SEP)).status, 200);
});

test('publish freezes the numbers; send only after publishing; unpublish to correct', async () => {
  await expense(U.net, '800.00', '2026-08-20', '6f1c2d4e-1111-4000-8000-000000000001');
  assert.equal((await send(O.net, AUG)).data.code, 'NOT_PUBLISHED', 'a draft is never emailed');

  const pub = await publish(O.net, AUG);
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.equal(pub.data.record.status, 'published');
  assert.equal(pub.data.published.totals.payout, '1920.00');
  assert.equal(pub.data.published.expenses[0].has_receipt, true, 'the receipt is in the frozen copy');
  assert.equal((await publish(O.net, AUG)).status, 409, 'publishing twice is refused');
  const current = await publish(O.net, manilaToday().slice(0, 7));
  assert.equal(current.status, 409);
  assert.equal(current.data.code, 'MONTH_NOT_ENDED');

  // A later expense changes the live statement, not the published copy.
  await expense(U.net, '200.00', '2026-08-25');
  const live = await view(O.net, AUG);
  assert.deepEqual([live.statement.totals.expenses, live.statement.totals.payout], ['1000.00', '1720.00']);
  assert.deepEqual([live.published.totals.expenses, live.published.totals.payout], ['800.00', '1920.00']);

  // The email carries the frozen payout and the portal link (portal access is on for this owner).
  await sql('UPDATE unit_owners SET portal_enabled = true WHERE owner_id = $1', [O.net]);
  outbox.length = 0;
  const sent = await send(O.net, AUG);
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const mail = outbox.find((m) => m.to === 'net@example.com');
  assert.match(mail.subject, /August 2026/);
  assert.match(mail.text, /Management fee \(20% of net\): ₱680\.00/);
  assert.match(mail.text, /Expenses: +₱800\.00/);
  assert.match(mail.text, /Payout to owner: +₱1,920\.00/);
  assert.match(mail.text, /\/#\/owner/);
  const afterSend = await view(O.net, AUG);
  assert.equal(afterSend.record.sent_to, 'net@example.com');
  assert.ok(afterSend.record.sent_at);

  // The review list: the published payout, the payouts made for the month (voided ones left out) and the sent date.
  await sql(`INSERT INTO owner_payouts (organization_id, owner_id, month, amount, paid_on, method, recorded_by)
             VALUES ($1, $2, $3, 1000, '2026-09-05', 'gcash', $4)`, [orgId, O.net, AUG, userId]);
  await sql(`INSERT INTO owner_payouts (organization_id, owner_id, month, amount, paid_on, method, recorded_by, voided_at, voided_by, void_reason)
             VALUES ($1, $2, $3, 500, '2026-09-06', 'bank_transfer', $4, now(), $4, 'Entered twice')`, [orgId, O.net, AUG, userId]);
  const list = (await host.get(`/api/owner-statements?month=${AUG}`)).data;
  const row = list.owners.find((o) => o.owner_id === O.net);
  assert.deepEqual([row.status, row.payout, row.paid, row.unit_count], ['published', '1920.00', '1000.00', 1]);
  assert.ok(row.sent_at);
  assert.equal(list.month_label, 'August 2026');

  // Unpublish: back to a draft with nothing sent, the live numbers apply, and the email is refused until it is published again.
  const un = await unpublish(O.net, AUG);
  assert.equal(un.status, 200, JSON.stringify(un.data));
  assert.deepEqual([un.data.record.status, un.data.record.sent_at, un.data.published], ['draft', null, null]);
  assert.equal((await unpublish(O.net, AUG)).data.code, 'NOT_PUBLISHED');
  assert.equal((await send(O.net, AUG)).data.code, 'NOT_PUBLISHED');
  assert.equal((await view(O.net, AUG)).statement.totals.payout, '1720.00');
  assert.equal((await publish(O.net, AUG)).data.published.totals.payout, '1720.00', 'the corrected numbers are published');
});

test('unpublish is refused while the reserve has paid out money the statement added', async () => {
  // Reserve now: August 300 and September 200 deposited. A 300 withdrawal (written directly) leaves 200.
  const [w] = await sql(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, note, recorded_by)
                         VALUES ($1, $2, 'withdrawal', 300, '2026-09-20', 'Pump repair', $3) RETURNING entry_id`, [orgId, O.res, userId]);
  // Unpublishing August would leave the reserve at -100 (September's 200 less the 300), so it is refused.
  const refused = await unpublish(O.res, AUG);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'RESERVE_IN_USE');

  // Voiding the withdrawal first lets August be unpublished, and its deposit goes with it.
  await sql(`UPDATE owner_reserve_entries SET voided_at = now(), voided_by = $2, void_reason = 'Entered by mistake' WHERE entry_id = $1`, [w.entry_id, userId]);
  assert.equal((await unpublish(O.res, AUG)).status, 200);
  assert.deepEqual(await sql(`SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount ELSE -amount END), 0)::text AS bal
                                FROM owner_reserve_entries WHERE owner_id = $1 AND voided_at IS NULL`, [O.res]), [{ bal: '200.00' }]);
});

test('managers, other workspaces and bad months are refused', async () => {
  const inv = await host.post('/api/team/invitations', { email: 'stmt-mgr@example.com', role: 'manager', property_ids: [property.property_id] });
  const manager = client(srv.base);
  await manager.post('/api/auth/signup', {
    full_name: 'Mona Manager', email: 'stmt-mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal((await manager.get(`/api/unit-owners/${O.net}/statement?month=${AUG}`)).status, 403);
  assert.equal((await manager.post(`/api/unit-owners/${O.net}/statement/publish`, { month: AUG })).status, 403);
  assert.equal((await manager.post(`/api/unit-owners/${O.net}/statement/unpublish`, { month: AUG })).status, 403);
  assert.equal((await manager.post(`/api/unit-owners/${O.net}/statement/send`, { month: AUG })).status, 403);
  assert.equal((await manager.get(`/api/owner-statements?month=${AUG}`)).status, 403);

  const other = await ownerAccount(srv.base, 'other-stmt@example.com', 'Other Statements');
  assert.equal((await other.get(`/api/unit-owners/${O.net}/statement?month=${AUG}`)).status, 404);
  assert.equal((await other.post(`/api/unit-owners/${O.net}/statement/publish`, { month: AUG })).status, 404);
  assert.equal((await other.post(`/api/unit-owners/${O.net}/statement/unpublish`, { month: AUG })).status, 404);
  assert.equal((await other.post(`/api/unit-owners/${O.net}/statement/send`, { month: AUG })).status, 404);
  assert.deepEqual((await other.get(`/api/owner-statements?month=${AUG}`)).data.owners, []);

  assert.equal((await host.get('/api/owner-statements')).status, 400, 'a month is required');
  assert.equal((await host.get('/api/owner-statements?month=2026-13')).status, 400);
  assert.equal((await publish(O.net, '2026-8')).status, 400);
});

test('draft rows: owners with an active unit get a draft for the month; repeats and archived owners add nothing', async () => {
  // Six owners have an active unit (the unitless owner does not).
  assert.equal(await draftMonth(orgId, JUN), 6);
  assert.equal(await draftMonth(orgId, JUN), 6);
  const drafted = (await view(O.net, JUN)).record;
  assert.equal(drafted.status, 'draft');
  assert.equal((await view(O.empty, JUN)).record, null, 'no row for an owner without units');

  await host.post(`/api/unit-owners/${O.cap}/archive`);
  assert.equal(await draftMonth(orgId, JUN), 5, 'archived owners are not counted');
});

test('changing or clearing the owner email signs the owner out of the portal; other edits keep the session', async () => {
  // Turns portal access on (or re-sends the link) and returns the token from the mail, without using it.
  const linkFor = async (ownerId, email) => {
    outbox.length = 0;
    const r = await host.post(`/api/unit-owners/${ownerId}/portal-invite`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return decodeURIComponent(/token=([^&\s]+)/.exec(outbox.find((m) => m.to === email).text)[1]);
  };
  const signIn = async (token) => {
    const oc = client(srv.base);
    assert.equal((await oc.post('/api/owner-portal/session', { token })).status, 200);
    return oc;
  };
  const lastUpdateDetails = async (ownerId) => (await sql(
    `SELECT details FROM audit_logs WHERE action = 'unit_owner.updated' AND record_id = $1 ORDER BY audit_id DESC LIMIT 1`, [ownerId]))[0].details;
  const portalOn = async (ownerId) => (await sql('SELECT portal_enabled FROM unit_owners WHERE owner_id = $1', [ownerId]))[0].portal_enabled;

  const id = await createOwner({ full_name: 'Portal Email Owner', email: 'portal-a@example.com', management_fee_pct: '20' });
  const bystander = await createOwner({ full_name: 'Bystander Owner', email: 'bystander@example.com' });
  const oc = await signIn(await linkFor(id, 'portal-a@example.com'));
  const bOc = await signIn(await linkFor(bystander, 'bystander@example.com'));
  assert.equal((await oc.get('/api/owner-portal/me')).status, 200);

  // Other fields, and the same email in other capitals, keep the session.
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { notes: 'Prefers email' })).status, 200);
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { email: 'Portal-A@Example.com' })).status, 200);
  assert.equal((await oc.get('/api/owner-portal/me')).status, 200);
  assert.equal((await lastUpdateDetails(id)).portal_signed_out, undefined);

  // A new email signs this owner out everywhere and voids a sign-in link not yet used. Other owners are untouched.
  const unused = await linkFor(id, 'portal-a@example.com');
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { email: 'portal-b@example.com' })).status, 200);
  const gone = await oc.get('/api/owner-portal/me');
  assert.equal(gone.status, 401);
  assert.equal(gone.data.code, 'OWNER_SIGNED_OUT');
  assert.equal((await client(srv.base).post('/api/owner-portal/session', { token: unused })).data.code, 'INVALID_LINK');
  assert.equal((await lastUpdateDetails(id)).portal_signed_out, true);
  assert.equal((await bOc.get('/api/owner-portal/me')).status, 200, 'another owner keeps their session');
  assert.equal(await portalOn(id), true, 'a new email keeps portal access on');

  // Clearing the email signs out again and turns the portal off.
  const newOc = await signIn(await linkFor(id, 'portal-b@example.com'));
  assert.equal((await newOc.get('/api/owner-portal/me')).status, 200);
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { email: null })).status, 200);
  assert.equal((await newOc.get('/api/owner-portal/me')).status, 401);
  assert.equal(await portalOn(id), false);
  assert.equal((await lastUpdateDetails(id)).portal_signed_out, true);
});
