'use strict';

// QA round 17, lane SR (finding #36, O1): the top bar search also finds cleaning tasks, supplies, expenses,
// discount codes and add-ons, each scoped as its own page is, and calls repair requests by that name.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r17-sr.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const PASSWORD = 'longenough1';
// Money, contact details and notes must never appear in a result.
const LEAK = /@|\+63|secret|1234\.56|1,234|₱/i;
// Random record ids (the add-on id) are UUIDs, and a random UUID can contain "500" by chance. Ids are blanked before the text checks.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

let srv; let owner; let staffA; let staffB; let manager; let longTerm;

const search = (c, q) => c.get(`/api/search?q=${encodeURIComponent(q)}`);
const group = (r, key) => r.data.groups.find((g) => g.key === key);
const titles = (r, key) => (group(r, key)?.items || []).map((i) => i.title);
const keysOf = (r) => r.data.groups.map((g) => g.key);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 'YYYY-MM-DD' plus n days, and that date the way the search shows it ('Nov 18, 2026').
const plusDays = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);
const shortDate = (s) => { const [y, m, day] = s.split('-').map(Number); return `${MON[m - 1]} ${day}, ${y}`; };

async function accept(email, role, propertyIds, fullName) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

// A long-term workspace has its own owner; the search hides the stay-only groups for it.
async function longTermOwner() {
  const email = 'sr-lt-owner@example.com';
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: 'Lia Tan', email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  await sql('UPDATE users SET email_verified_at = now() WHERE email = $1', [email]);
  const w = await c.post('/api/workspace', { name: 'SR Long Term', business_type: 'long_term' });
  assert.equal(w.status, 201, JSON.stringify(w.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'sr-owner@example.com', 'SR Stays');
  const today = manilaToday();

  const propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property.property_id;
  const propB = (await owner.post('/api/properties', { property_name: 'Pine', property_type: 'condominium', address: 'Pine St', city: 'Makati', province: 'Metro Manila' })).data.property.property_id;
  const unitA = (await owner.post(`/api/properties/${propA}/units`, { unit_name: 'Sunrise 7C', unit_type: 'studio', nightly_rate: '2000', security_deposit_amount: '1000' })).data.unit.unit_id;

  // Supplies: one at Azure, one at Pine, and one archived at Azure.
  assert.equal((await owner.post('/api/supplies', { property_id: propA, name: 'QA ops item 07', unit_label: 'pcs', par_level: 2 })).status, 201);
  assert.equal((await owner.post('/api/supplies', { property_id: propB, name: 'QA pine towel', unit_label: 'pcs', par_level: 2 })).status, 201);
  assert.equal((await owner.post('/api/supplies', { property_id: propA, name: 'QA archived item', unit_label: 'pcs', par_level: 1 })).status, 201);
  await sql(`UPDATE supplies SET archived_at = now() WHERE name = 'QA archived item'`);

  // Expenses: one live with a vendor, one voided (set directly, the void route is covered elsewhere).
  assert.equal((await owner.post('/api/expenses', { property_id: propA, category: 'repairs', description: 'Pipe leak fix', amount: '1234.56', expense_date: today, vendor_name: 'Juan Plumbing' })).status, 201);
  assert.equal((await owner.post('/api/expenses', { property_id: propA, category: 'utilities', description: 'Old bill', amount: '99.00', expense_date: today, vendor_name: 'Voided Vendor Co' })).status, 201);
  await sql(`UPDATE expenses SET voided_at = now(), void_reason = 'Duplicate entry' WHERE vendor_name = 'Voided Vendor Co'`);
  // No vendor: the description holds money typed by the owner. The result must show the category, never that text.
  assert.equal((await owner.post('/api/expenses', { property_id: propA, category: 'repairs', description: 'Paid 500 to plumber', amount: '500', expense_date: today })).status, 201);
  // A vendor typed exactly like a category key is the title as typed, not the category name.
  assert.equal((await owner.post('/api/expenses', { property_id: propA, category: 'repairs', description: 'Monthly premium', amount: '250', expense_date: today, vendor_name: 'insurance' })).status, 201);

  // A cleaning task for the unit, due today.
  const [{ organization_id: orgId }] = await sql('SELECT organization_id FROM properties WHERE property_id = $1', [propA]);
  await sql('INSERT INTO cleaning_tasks (organization_id, unit_id, due_date) VALUES ($1, $2, $3)', [orgId, unitA, today]);

  assert.equal((await owner.post('/api/discount-codes', { code: 'SRSUMMER', description: 'Summer offer', percent_off: 10 })).status, 201);
  assert.equal((await owner.post('/api/addons', { name: 'SR Airport pickup', price: '500', pricing: 'per_stay' })).status, 201);
  assert.equal((await owner.post('/api/addons', { name: 'SR Old late checkout', price: '300', pricing: 'per_stay' })).status, 201);
  await sql(`UPDATE listing_addons SET active = false WHERE name = 'SR Old late checkout'`);

  // Discount codes in each status the Discount codes page shows. None has "SR" in its code or note.
  for (const body of [
    { code: 'PAST5', description: 'Old note', percent_off: 5 },
    { code: 'OFF5', description: 'Turned off note', percent_off: 5 },
    { code: 'LATER5', description: 'Future note', amount_off: '100' },
    { code: 'ONCE5', description: 'One time note', amount_off: '50', max_uses: 1 },
  ]) assert.equal((await owner.post('/api/discount-codes', body)).status, 201);
  await sql(`UPDATE discount_codes SET valid_until = $1 WHERE code = 'PAST5'`, [plusDays(today, -1)]);
  await sql(`UPDATE discount_codes SET active = false WHERE code = 'OFF5'`);
  await sql(`UPDATE discount_codes SET valid_from = $1 WHERE code = 'LATER5'`, [plusDays(today, 30)]);
  // One confirmed checkout uses up ONCE5, its only allowed use.
  await sql(`INSERT INTO direct_checkouts (organization_id, unit_id, check_in, check_out, num_guests, guest_name, guest_email, guest_phone, pay_type,
      accommodation_total, cleaning_fee, total_amount, amount_due_now, status, hold_until, consent_at, public_token, discount_code_id, discount_amount)
    VALUES ($1, $2, $3, $4, 1, 'Used Up', 'used@example.com', '09170000000', 'full', 100, 0, 100, 100, 'confirmed', now(), now(), 'sr-used-token',
      (SELECT code_id FROM discount_codes WHERE code = 'ONCE5'), 50)`, [orgId, unitA, today, plusDays(today, 2)]);
  assert.equal((await owner.post('/api/maintenance', { property_id: propA, title: 'SR leaking tap', priority: 'medium' })).status, 201);

  staffA = await accept('sr-staff-a@example.com', 'staff', [propA], 'Staff A');
  staffB = await accept('sr-staff-b@example.com', 'staff', [propB], 'Staff B');
  manager = await accept('sr-manager@example.com', 'manager', [propA], 'Manager A');

  // Long-term workspace: a supply and an expense with a shared label.
  longTerm = await longTermOwner();
  const ltProp = (await longTerm.post('/api/properties', { property_name: 'SR Lt House', property_type: 'condominium', address: 'Lt St', city: 'Quezon City', province: 'Metro Manila' })).data.property.property_id;
  const [{ organization_id: ltOrg }] = await sql('SELECT organization_id FROM properties WHERE property_id = $1', [ltProp]);
  await sql('INSERT INTO supplies (organization_id, property_id, name) VALUES ($1, $2, $3)', [ltOrg, ltProp, 'SR lt item']);
  assert.equal((await longTerm.post('/api/expenses', { property_id: ltProp, category: 'utilities', description: 'Water', amount: '300', expense_date: today, vendor_name: 'SR lt vendor' })).status, 201);
});
test.after(async () => { await srv.close(); });

test('owner finds a supply by name with its property, and an archived supply is not found', async () => {
  const r = await search(owner, 'QA ops item 07');
  assert.deepEqual(titles(r, 'supplies'), ['QA ops item 07']);
  assert.equal(group(r, 'supplies').label, 'Supplies');
  assert.equal(group(r, 'supplies').items[0].sub, 'Azure');
  assert.equal(group(r, 'supplies').items[0].href, `#/supplies?q=${encodeURIComponent('QA ops item 07')}`);
  assert.equal(group(await search(owner, 'QA archived'), 'supplies'), undefined);
});

test('a supply is found only by staff assigned to its property', async () => {
  assert.deepEqual(titles(await search(staffA, 'QA ops item 07'), 'supplies'), ['QA ops item 07']);
  assert.deepEqual(titles(await search(staffB, 'QA ops item 07'), 'supplies'), []);
});

test('a cleaning task is found by its unit name, labelled as a cleaning task', async () => {
  const r = await search(owner, 'Sunrise 7C');
  assert.deepEqual(titles(r, 'housekeeping'), ['Cleaning: Sunrise 7C']);
  assert.equal(group(r, 'housekeeping').label, 'Cleaning tasks');
  assert.ok(group(r, 'housekeeping').items[0].sub.endsWith(' · To do'), group(r, 'housekeeping').items[0].sub);
  assert.deepEqual(titles(await search(staffA, 'Sunrise 7C'), 'housekeeping'), ['Cleaning: Sunrise 7C']);
});

test('an expense is found by vendor, and its item shows the category, property and date but no amount', async () => {
  const r = await search(owner, 'Juan Plumbing');
  assert.deepEqual(titles(r, 'expenses'), ['Juan Plumbing']);
  assert.equal(group(r, 'expenses').label, 'Expenses');
  assert.ok(group(r, 'expenses').items[0].sub.startsWith('Repairs · Azure · '), group(r, 'expenses').items[0].sub);
  assert.equal(LEAK.test(JSON.stringify(group(r, 'expenses'))), false, JSON.stringify(group(r, 'expenses')));
  assert.deepEqual(titles(await search(staffB, 'Juan Plumbing'), 'expenses'), []);
});

// QA round 18, longterm finding 4: when the title already is the category, the sub line does not repeat it.
test('an expense with no vendor shows its category as the title, never the description, and the category once', async () => {
  const r = await search(owner, 'Paid 500');
  assert.deepEqual(titles(r, 'expenses'), ['Repairs']);
  assert.equal(group(r, 'expenses').items[0].sub, `Azure · ${shortDate(manilaToday())}`, group(r, 'expenses').items[0].sub);
  assert.equal(JSON.stringify(group(r, 'expenses')).includes('Paid'), false, JSON.stringify(group(r, 'expenses')));
  assert.equal(LEAK.test(JSON.stringify(group(r, 'expenses'))), false, JSON.stringify(group(r, 'expenses')));
});

test('a vendor typed like a category name is the title as typed, and the category stays in the sub line', async () => {
  const r = await search(owner, 'insurance');
  assert.deepEqual(titles(r, 'expenses'), ['insurance']);
  assert.equal(group(r, 'expenses').items[0].sub, `Repairs · Azure · ${shortDate(manilaToday())}`, group(r, 'expenses').items[0].sub);
});

test('a voided expense is not found', async () => {
  assert.equal(group(await search(owner, 'Voided Vendor'), 'expenses'), undefined);
});

test('discount codes and add-ons are for owners and managers only; staff never see them', async () => {
  const forOwner = await search(owner, 'SR');
  assert.ok(keysOf(forOwner).includes('discount_codes'));
  assert.ok(keysOf(forOwner).includes('addons'));
  assert.deepEqual(titles(forOwner, 'discount_codes'), ['SRSUMMER']);
  assert.deepEqual(titles(forOwner, 'addons'), ['SR Airport pickup']);
  assert.equal(group(forOwner, 'discount_codes').label, 'Discount codes');
  assert.equal(group(forOwner, 'addons').label, 'Add-ons');

  const forManager = await search(manager, 'SR');
  assert.ok(keysOf(forManager).includes('discount_codes'));
  assert.ok(keysOf(forManager).includes('addons'));

  const forStaff = await search(staffA, 'SR');
  assert.equal(keysOf(forStaff).includes('discount_codes'), false);
  assert.equal(keysOf(forStaff).includes('addons'), false);
});

test('a discount code or add-on item never shows its percent or amount', async () => {
  const code = await search(owner, 'SRSUMMER');
  assert.equal(group(code, 'discount_codes').items[0].sub, 'Active');
  const addon = await search(owner, 'Airport');
  // Blank out the add-on id first, so a random id that contains "500" is not read as a leaked price.
  const shown = JSON.stringify(group(addon, 'addons')).replace(UUID, ' ');
  assert.equal(LEAK.test(shown), false, shown);
  assert.equal(/500|10%/.test(shown), false, shown);
});

test('an archived add-on is not found; an active add-on has no status line', async () => {
  assert.equal(group(await search(owner, 'SR Old late'), 'addons'), undefined);
  assert.equal(group(await search(owner, 'SR Airport'), 'addons').items[0].sub, null);
});

// Ruling D-99 O1: the sub is the status word the Discount codes page shows on a row. The note is matched but never shown.
test('a discount code shows its status word, never its note, and the note still finds it', async () => {
  const subs = async (q) => group(await search(owner, q), 'discount_codes')?.items.map((i) => [i.title, i.sub]);
  assert.deepEqual(await subs('Summer offer'), [['SRSUMMER', 'Active']]);
  assert.deepEqual(await subs('PAST5'), [['PAST5', 'Expired']]);
  assert.deepEqual(await subs('OFF5'), [['OFF5', 'Off']]);
  assert.deepEqual(await subs('ONCE5'), [['ONCE5', 'Used up']]);
  assert.deepEqual(await subs('LATER5'), [['LATER5', `Starts ${shortDate(plusDays(manilaToday(), 30))}`]]);
  for (const note of ['Old note', 'Turned off note', 'One time note', 'Future note', 'Summer offer']) {
    const g = group(await search(owner, note), 'discount_codes');
    assert.ok(g, `${note} still finds its code`);
    assert.equal(JSON.stringify(g).includes(note), false, note);
  }
});

test('repair requests keep their results and are labelled Repair requests', async () => {
  const r = await search(owner, 'SR leaking');
  assert.equal(group(r, 'maintenance').label, 'Repair requests');
  assert.deepEqual(titles(r, 'maintenance'), ['SR leaking tap']);
});

test('a long-term owner gets no supplies or cleaning tasks, but keeps expenses', async () => {
  const r = await search(longTerm, 'SR lt');
  assert.equal(keysOf(r).includes('supplies'), false);
  assert.equal(keysOf(r).includes('housekeeping'), false);
  assert.deepEqual(titles(r, 'expenses'), ['SR lt vendor']);
});

test('no result carries money, contact details or notes', async () => {
  const r = await search(owner, 'SR');
  assert.equal(LEAK.test(JSON.stringify(r.data.groups)), false, JSON.stringify(r.data.groups));
});
