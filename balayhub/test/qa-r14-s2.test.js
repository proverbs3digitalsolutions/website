'use strict';

// Top bar bookmarks API (QA r14, D-90): per-person saved pages under /api/account/bookmarks.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');

const PASSWORD = 'longenough1';
const LIMIT_MSG = 'You can keep up to 20 bookmarks. Remove one to add another.';
let srv; let owner; let staff; let cleaner; let other; let prop;

async function accept(email, role, fullName) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}
const add = (c, path, label = 'Page') => c.post('/api/account/bookmarks', { path, label });
const list = async (c) => (await c.get('/api/account/bookmarks')).data.bookmarks;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'bm-owner@example.com', 'Bookmark Stays');
  other = await ownerAccount(srv.base, 'bm-other@example.com', 'Other Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  staff = await accept('bm-staff@example.com', 'staff', 'Staff Azure');
  cleaner = await accept('bm-cleaner@example.com', 'cleaner', 'Aling Rosa');
});
test.after(async () => { await srv.close(); });

test('add, re-save with a new label, and list', async () => {
  const a = await add(owner, '#/reservations?view=upcoming', 'Upcoming');
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(a.data.bookmark.path, '#/reservations?view=upcoming');
  assert.equal(a.data.bookmark.label, 'Upcoming');
  assert.ok(a.data.bookmark.bookmark_id && a.data.bookmark.created_at);
  assert.equal('inserted' in a.data.bookmark, false);
  const b = await add(owner, '#/reservations?view=upcoming', 'Coming up');
  assert.equal(b.status, 200);
  assert.equal(b.data.bookmark.label, 'Coming up');
  assert.equal(b.data.bookmark.bookmark_id, a.data.bookmark.bookmark_id);
  const l = await list(owner);
  assert.equal(l.length, 1);
  assert.equal(l[0].label, 'Coming up');
});

test('validation: bad path and bad label answer 400 with field text', async () => {
  for (const path of ['https://x', '#/a//b', '#/' + 'a'.repeat(301), 42]) {
    const r = await add(owner, path);
    assert.equal(r.status, 400, String(path).slice(0, 20));
    assert.equal(r.data.code, 'VALIDATION');
    assert.equal(r.data.error ?? r.data.message, 'Please check the highlighted fields.');
    assert.equal(r.data.fields.path, "This page can't be bookmarked.");
  }
  for (const label of ['', '   ', 'x'.repeat(81), 5]) {
    const r = await add(owner, '#/home', label);
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'VALIDATION');
    assert.equal(r.data.fields.label, 'Give the bookmark a name, up to 80 characters.');
  }
  assert.equal((await add(owner, '#/' + 'a'.repeat(300), 'Edge')).status, 201);
});

test('the 21st distinct path is refused; re-saving an existing one at 20 still works', async () => {
  const c = await accept('bm-limit@example.com', 'manager', 'Manager Limit');
  for (let i = 0; i < 20; i++) assert.equal((await add(c, `#/p${i}`)).status, 201);
  const over = await add(c, '#/p20');
  assert.equal(over.status, 409);
  assert.equal(over.data.code, 'BOOKMARK_LIMIT');
  assert.equal(over.data.error ?? over.data.message, LIMIT_MSG);
  assert.equal((await add(c, '#/p3', 'Renamed')).status, 200);
  assert.equal((await list(c)).length, 20);
});

test('isolation: other workspace and same-workspace staff cannot see or remove it', async () => {
  const mine = (await add(owner, '#/settings', 'Settings')).data.bookmark;
  assert.equal((await list(other)).length, 0);
  assert.equal((await list(staff)).length, 0);
  assert.equal((await other.post(`/api/account/bookmarks/${mine.bookmark_id}/remove`)).status, 404);
  assert.equal((await staff.post(`/api/account/bookmarks/${mine.bookmark_id}/remove`)).status, 404);
  assert.equal((await owner.post('/api/account/bookmarks/not-a-uuid/remove')).status, 404);
  assert.ok((await list(owner)).some((x) => x.bookmark_id === mine.bookmark_id));
  const gone = await owner.post(`/api/account/bookmarks/${mine.bookmark_id}/remove`);
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.data, { ok: true });
  assert.equal((await owner.post(`/api/account/bookmarks/${mine.bookmark_id}/remove`)).status, 404);
});

test('a cleaner can add, list and remove their own', async () => {
  const a = await add(cleaner, '#/cleaning', 'My jobs');
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal((await list(cleaner)).length, 1);
  assert.equal((await cleaner.post(`/api/account/bookmarks/${a.data.bookmark.bookmark_id}/remove`)).status, 200);
  assert.equal((await list(cleaner)).length, 0);
});

test('a view-only workspace can still add bookmarks', async () => {
  await sql(`UPDATE organizations SET plan = 'trial', trial_ends_at = now() - interval '1 day' WHERE name = 'Other Stays'`);
  assert.equal((await other.get('/api/auth/me')).data.user.plan.read_only, true);
  assert.equal((await add(other, '#/home', 'Home')).status, 201);
});

test('the CSRF header is required', async () => {
  const r = await owner.raw('POST', '/api/account/bookmarks', { path: '#/home', label: 'Home' }, { 'X-Requested-With': '' });
  assert.equal(r.status, 403);
});
