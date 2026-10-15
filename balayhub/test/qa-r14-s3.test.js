'use strict';

// QA r14 TB-S3: the notifications feed behind the top bar bell (D-90). Rows are written where every alert
// already passes (push.notify), with the same people and settings as the phone alert, and read back with the
// same scope.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const push = require('../src/lib/push');
const feed = require('../src/lib/notifyfeed');
const ical = require('../src/lib/ical');

const sent = [];
push.webpush.sendNotification = async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); return { statusCode: 201 }; };

async function join(base, ownerClient, email, name, role, propertyIds) {
  const inv = await ownerClient.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const c = client(base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}
const uid = async (email) => (await sql('SELECT user_id FROM users WHERE lower(email) = $1', [email]))[0].user_id;
const rowsFor = (userId) => sql('SELECT * FROM notifications WHERE user_id = $1 ORDER BY notification_id', [userId]);
const prop = (name) => ({ property_name: name, property_type: 'condominium', address: `${name} Ave`, city: 'Taguig', province: 'Metro Manila' });
const list = async (c, qs = '') => (await c.get(`/api/account/notifications${qs}`)).data;

let srv; let owner; let mgrA; let mgrB; let staff; let cleaner; let owner2;
let propA; let propB; let orgId; let org2;
let ownerU; let mgrAU; let mgrBU; let staffU; let cleanerU; let owner2U;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'own-s3@example.com', 'Feed Stays');
  propA = (await owner.post('/api/properties', prop('Azure'))).data.property;
  propB = (await owner.post('/api/properties', prop('Grass'))).data.property;
  mgrA = await join(srv.base, owner, 'mgra-s3@example.com', 'Mgr A', 'manager', [propA.property_id]);
  mgrB = await join(srv.base, owner, 'mgrb-s3@example.com', 'Mgr B', 'manager', [propB.property_id]);
  staff = await join(srv.base, owner, 'staff-s3@example.com', 'Staff A', 'staff', [propA.property_id]);
  cleaner = await join(srv.base, owner, 'clean-s3@example.com', 'Cleaner A', 'cleaner', [propA.property_id]);
  owner2 = await ownerAccount(srv.base, 'own2-s3@example.com', 'Other Stays');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Feed Stays'`))[0].organization_id;
  org2 = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Other Stays'`))[0].organization_id;
  [ownerU, mgrAU, mgrBU, staffU, cleanerU, owner2U] = await Promise.all(
    ['own-s3@example.com', 'mgra-s3@example.com', 'mgrb-s3@example.com', 'staff-s3@example.com', 'clean-s3@example.com', 'own2-s3@example.com'].map(uid));
});
test.after(async () => { await srv.close(); });
test.beforeEach(async () => {
  await sql('DELETE FROM notifications');
  await sql(`UPDATE users SET notify_prefs = '{}'::jsonb`);
  await sql(`UPDATE organizations SET business_type = 'short_term'`);
  await sql(`INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [mgrAU, propA.property_id]);
  sent.length = 0;
});

const say = (type, extra = {}) => push.notify(orgId, type, { title: 'T ' + type, body: 'B', url: '/#/reservations', propertyId: propA.property_id, ...extra });

test('1. the write point: no device needed, same people as the phone alert', async () => {
  await say('new_booking');
  assert.equal((await rowsFor(ownerU)).length, 1);
  assert.equal((await rowsFor(mgrAU)).length, 1);
  assert.equal((await rowsFor(mgrBU)).length, 0, 'manager not assigned to the property');
  assert.equal((await rowsFor(staffU)).length, 0);
  assert.equal((await rowsFor(cleanerU)).length, 0);
  assert.equal((await rowsFor(owner2U)).length, 0, 'another workspace');
  assert.equal((await rowsFor(ownerU))[0].type, 'new_booking');
});

test('2. settings: a type switched off or a filtered property writes no row; old rows are hidden at read', async () => {
  await sql(`UPDATE users SET notify_prefs = '{"new_booking": false}' WHERE user_id = $1`, [ownerU]);
  await say('new_booking');
  assert.equal((await rowsFor(ownerU)).length, 0);
  assert.equal((await rowsFor(mgrAU)).length, 1, 'others unaffected');

  await sql(`UPDATE users SET notify_prefs = $2::jsonb WHERE user_id = $1`, [ownerU, JSON.stringify({ property_ids: [propB.property_id] })]);
  await say('new_booking');
  assert.equal((await rowsFor(ownerU)).length, 0, 'propA is filtered out');

  await sql(`UPDATE users SET notify_prefs = '{}' WHERE user_id = $1`, [ownerU]);
  await say('payment');
  assert.equal((await list(owner)).items.length, 1);
  await sql(`UPDATE users SET notify_prefs = '{"payment": false}' WHERE user_id = $1`, [ownerU]);
  assert.equal((await list(owner)).items.length, 0, 'hidden after turning the type off');
  assert.equal((await owner.get('/api/account/notifications/count')).data.unread, 0);
});

test('3. a cleaner sees their cleaning row and only the cleaning category', async () => {
  await say('cleaning', { userId: cleanerU, title: 'Clean 1201' });
  const r = await list(cleaner);
  assert.deepEqual(r.items.map((i) => i.title), ['Clean 1201']);
  assert.deepEqual(r.categories, ['cleaning']);
  assert.equal(r.items[0].category, 'cleaning');
  assert.equal(r.items[0].read, false);
  assert.equal(r.unread, 1);
});

test('4. losing a property assignment hides its rows', async () => {
  await say('new_booking');
  assert.equal((await list(mgrA)).items.length, 1);
  await sql('DELETE FROM property_assignments WHERE user_id = $1', [mgrAU]);
  assert.equal((await list(mgrA)).items.length, 0);
  assert.equal((await mgrA.get('/api/account/notifications/count')).data.unread, 0);
});

test('5. the API: filters, paging, validation, mark read', async () => {
  await say('new_booking', { title: 'b1' });
  await say('payment', { title: 'p1' });
  await say('payment', { title: 'p2' });
  await say('guest_message', { title: 'm1' });

  const all = await list(owner);
  assert.deepEqual(all.categories, feed.CATEGORY_ORDER, 'the owner can receive every kind');
  assert.equal(all.unread, 4);
  assert.deepEqual(all.items.map((i) => i.title), ['m1', 'p2', 'p1', 'b1'], 'newest first');
  assert.deepEqual(Object.keys(all.items[0]).sort(), ['body', 'category', 'created_at', 'id', 'read', 'title', 'type', 'url']);
  assert.equal(typeof all.items[0].id, 'string');
  assert.match(all.items[0].created_at, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(all.next_before, null);

  const pay = await list(owner, '?category=payments');
  assert.deepEqual(pay.items.map((i) => i.title), ['p2', 'p1']);

  const page1 = await list(owner, '?limit=2');
  assert.equal(page1.items.length, 2);
  assert.equal(page1.next_before, page1.items[1].id);
  const page2 = await list(owner, `?limit=2&before=${page1.next_before}`);
  assert.deepEqual(page2.items.map((i) => i.title), ['p1', 'b1']);
  assert.equal(page2.next_before, null);

  assert.equal((await owner.get('/api/account/notifications?limit=51')).status, 400);
  assert.equal((await owner.get('/api/account/notifications?limit=0')).status, 400);
  assert.equal((await owner.get('/api/account/notifications?category=nope')).status, 400);
  assert.equal((await owner.get('/api/account/notifications?before=abc')).status, 400);

  const own = all.items[3];
  const r1 = await owner.post('/api/account/notifications/read', { ids: [own.id] });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.unread, 3);
  assert.equal((await owner.get('/api/account/notifications/count')).data.unread, 3);

  // Someone else's row: 200, untouched.
  const [mine] = await rowsFor(mgrAU);
  const r2 = await owner.post('/api/account/notifications/read', { ids: [String(mine.notification_id)] });
  assert.equal(r2.status, 200);
  assert.equal((await rowsFor(mgrAU)).find((r) => r.notification_id === mine.notification_id).read_at, null);

  assert.equal((await owner.post('/api/account/notifications/read', {})).status, 400);
  assert.equal((await owner.post('/api/account/notifications/read', { ids: [] })).status, 400);
  assert.equal((await owner.post('/api/account/notifications/read', { ids: ['x'] })).status, 400);
  assert.equal((await owner.post('/api/account/notifications/read', { ids: ['1'], all: true })).status, 400, 'exactly one choice');

  const r3 = await owner.post('/api/account/notifications/read', { category: 'messages' });
  assert.equal(r3.data.unread, 2);
  assert.equal((await owner.post('/api/account/notifications/read', { category: 'nope' })).status, 400);
  const r4 = await owner.post('/api/account/notifications/read', { all: true });
  assert.equal(r4.data.unread, 0);
  assert.ok((await list(owner)).items.every((i) => i.read));
  assert.equal((await rowsFor(mgrAU))[0].read_at, null, 'only my own rows are marked');
});

test('6. workspace isolation', async () => {
  await say('new_booking');
  const r = await list(owner2);
  assert.deepEqual([r.items, r.unread], [[], 0]);
  const ids = (await rowsFor(ownerU)).map((x) => String(x.notification_id));
  assert.equal((await owner2.post('/api/account/notifications/read', { ids })).status, 200);
  assert.equal((await rowsFor(ownerU))[0].read_at, null);
  // A row that points at another workspace's person is never shown, even by id.
  await sql(`INSERT INTO notifications (organization_id, user_id, type, title, url) VALUES ($1, $2, 'new_booking', 'Stray', '/#/home')`, [org2, ownerU]);
  assert.ok(!(await list(owner)).items.some((i) => i.title === 'Stray'));
});

test('7. a long-term workspace has no alert types, so an empty bell', async () => {
  await say('new_booking');
  await sql(`UPDATE organizations SET business_type = 'long_term' WHERE organization_id = $1`, [orgId]);
  const r = await list(owner);
  assert.deepEqual([r.categories, r.items, r.unread], [[], [], 0]);
  assert.equal((await owner.get('/api/account/notifications/count')).data.unread, 0);
});

test('8. stored links are safe and text is capped', async () => {
  await say('new_booking', { url: 'javascript:alert(1)', title: 'x'.repeat(300), body: 'y'.repeat(600) });
  await say('payment', { url: 'https://evil.example/#/x' });
  await say('cleaning', { url: '/#/reservations?view=recent&q=a b' });
  const rows = await rowsFor(ownerU);
  assert.equal(rows[0].url, '/#/home');
  assert.equal(rows[0].title.length, 200);
  assert.equal(rows[0].body.length, 500);
  assert.equal(rows[1].url, '/#/home');
  assert.equal(rows[2].url, '/#/home', 'a space is not allowed');
  await say('payment', { url: '/#/reservations?view=recent' });
  assert.equal((await rowsFor(ownerU))[3].url, '/#/reservations?view=recent');
});

test('9. a unit owner blocking dates tells the workspace owner only', async () => {
  const today = manilaToday();
  const d = (n) => ical.addDays(today, n);
  const unit = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const oid = (await owner.post('/api/unit-owners', { full_name: 'Maria Portal', email: 'maria-s3@example.com', unit_ids: [unit.unit_id] })).data.owner_id;
  const { outbox } = require('../src/lib/mailer');
  outbox.length = 0;
  assert.equal((await owner.post(`/api/unit-owners/${oid}/portal-invite`)).status, 200);
  let mail;
  for (let i = 0; i < 300 && !(mail = outbox.find((m) => m.to === 'maria-s3@example.com')); i++) await new Promise((r) => setTimeout(r, 10));
  const portal = client(srv.base);
  const token = decodeURIComponent(/token=([^&\s]+)/.exec(mail.text)[1]);
  assert.equal((await portal.post('/api/owner-portal/session', { token })).status, 200);

  await sql('DELETE FROM notifications');
  const blk = await portal.post('/api/owner-portal/blocks', { unit_id: unit.unit_id, check_in: d(30), check_out: d(33), reason: 'Family' });
  assert.equal(blk.status, 201, JSON.stringify(blk.data));
  for (let i = 0; i < 100 && !(await rowsFor(ownerU)).length; i++) await new Promise((r) => setTimeout(r, 20));
  const rows = await rowsFor(ownerU);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'owner_activity');
  assert.equal(rows[0].url, '/#/calendar');
  assert.equal(rows[0].title, 'Maria Portal blocked dates');
  assert.match(rows[0].body, /^1201: .+ to .+/);
  assert.equal(rows[0].property_id, propA.property_id);
  assert.equal((await rowsFor(mgrAU)).length, 0);
  assert.equal((await list(owner)).categories.includes('owners'), true);

  await sql('DELETE FROM notifications');
  assert.equal((await portal.post(`/api/owner-portal/blocks/${blk.data.block_id}/cancel`)).status, 200);
  for (let i = 0; i < 100 && !(await rowsFor(ownerU)).length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal((await rowsFor(ownerU))[0].title, 'Maria Portal cancelled a block');
  assert.equal(push.TYPES.owner_activity.label, 'Unit owner activity');
  assert.deepEqual((await owner.get('/api/account/notify-prefs')).data.types.owner_activity, true);
  assert.equal('owner_activity' in (await mgrA.get('/api/account/notify-prefs')).data.types, false);
});

test('10. retention: purgeOld deletes rows older than 90 days', async () => {
  await say('new_booking');
  await say('payment');
  await sql(`UPDATE notifications SET created_at = now() - interval '91 days' WHERE type = 'payment'`);
  const n = await feed.purgeOld();
  assert.ok(n >= 2, 'two people had the payment row');
  assert.deepEqual((await sql('SELECT DISTINCT type FROM notifications')).map((r) => r.type), ['new_booking']);
});

test('11. the phone alert still goes out when the feed write fails', async () => {
  await push.notify(orgId, 'new_booking', { title: 'warm up', body: 'x' });
  const sub = await owner.post('/api/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/s3-abcdef', keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret' } } });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const real = feed.add;
  feed.add = async () => { throw new Error('feed down'); };
  try {
    sent.length = 0;
    assert.equal(await say('new_booking'), 1);
    assert.equal(sent.length, 1);
  } finally { feed.add = real; }
});

test('helpers: category map, visibleTypes and scope SQL', async () => {
  assert.deepEqual(feed.CATEGORY_ORDER, ['reservations', 'payments', 'cleaning', 'messages', 'owners']);
  assert.equal(feed.CATEGORY.owner_activity, 'owners');
  assert.deepEqual(feed.visibleTypes({ role: 'cleaner', business_type: 'short_term' }, {}), ['cleaning']);
  assert.deepEqual(feed.visibleTypes({ role: 'cleaner', business_type: 'long_term' }, {}), []);
  assert.ok(!feed.visibleTypes({ role: 'owner', business_type: 'short_term' }, { payment: false }).includes('payment'));
  assert.equal(await feed.add(orgId, 'payment', [], { title: 'x', url: '/#/home' }), 0);
});
