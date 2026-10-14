'use strict';

// QA round 2, help center on the server (lane B28): whole-word search, guides that follow
// the workspace type, and % and _ typed into the support ticket searches.
process.env.SMTP_URL = 'test://';
process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');
const { ARTICLES, searchArticles } = require('../src/lib/helpcenter');

let srv; let stays; let rentals; let both; let boss;
test.before(async () => {
  srv = await startServer();
  stays = await ownerAccount(srv.base, 'stays@example.com', 'Short Stays');
  rentals = await ownerAccount(srv.base, 'rentals@example.com', 'Monthly Rentals');
  assert.equal((await rentals.patch('/api/workspace', { business_type: 'long_term' })).status, 200);
  both = await ownerAccount(srv.base, 'both@example.com', 'Both Ways');
  assert.equal((await both.patch('/api/workspace', { business_type: 'both' })).status, 200);
  boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
});
test.after(async () => { await srv.close(); });

test('search matches whole words, needs every meaningful word, and ranks titles first', async () => {
  assert.deepEqual(searchArticles('zzzz no match', 'owner'), [], 'a nonsense query finds nothing');
  assert.deepEqual(searchArticles('<script>x</script>', 'owner'), [], '"script" sits inside "subscription", so it is not a match');
  assert.deepEqual(searchArticles('listin', 'owner'), [], 'part of "listing" is not a match');
  assert.deepEqual(searchArticles('airbnb zzzz', 'owner'), [], 'a word that matches nothing drops the article');
  assert.equal(searchArticles('how do I add a listing', 'owner')[0].slug, 'add-listing');
  assert.equal(searchArticles('reservations', 'owner')[0].slug, 'reservations');

  const http = await rentals.get(`/api/help/articles?q=${encodeURIComponent('zzzz no match')}`);
  assert.equal(http.status, 200);
  assert.deepEqual(http.data.articles, []);
});

test('help guides follow the workspace type', async () => {
  const slugs = async (c, url = '/api/help/articles') => (await c.get(url)).data.articles.map((a) => a.slug);
  const rentOnly = ARTICLES.filter((a) => a.module === 'rent').map((a) => a.slug);
  const stayOnly = ARTICLES.filter((a) => a.module === 'stay').map((a) => a.slug);
  assert.ok(rentOnly.includes('long-term-setup') && stayOnly.includes('calendar-sync'), 'guides are tagged by module');

  const longTerm = await slugs(rentals);
  assert.ok(longTerm.includes('long-term-setup') && longTerm.includes('rent-payments'));
  assert.ok(!longTerm.some((s) => stayOnly.includes(s)), 'no short-term-only guide on a long-term workspace');
  assert.ok(!(await slugs(rentals, `/api/help/articles?q=${encodeURIComponent('airbnb calendar')}`)).includes('calendar-sync'));
  assert.ok((await slugs(rentals, `/api/help/articles?q=${encodeURIComponent('tenants')}`)).includes('long-term-setup'));

  const shortTerm = await slugs(stays);
  assert.ok(shortTerm.includes('calendar-sync'));
  assert.ok(!shortTerm.some((s) => rentOnly.includes(s)), 'no monthly-rent guide on a short-term workspace');

  const mixed = await slugs(both);
  assert.ok(mixed.includes('calendar-sync') && mixed.includes('long-term-setup'), 'a workspace with both types sees every guide');
});

test('ticket search treats % and _ as ordinary characters', async () => {
  for (const subject of ['Refund 100% of the stay', 'Refund 100 pesos of the stay', 'Lock_code wrong', 'Lockcode wrong']) {
    assert.equal((await stays.post('/api/support/tickets', { subject, category: 'problem', body: 'Details here.' })).status, 201);
  }
  const subjects = async (client, url) => (await client.get(url)).data.tickets.map((t) => t.subject);
  assert.deepEqual(await subjects(stays, `/api/support/tickets?q=${encodeURIComponent('%')}`), ['Refund 100% of the stay']);
  assert.deepEqual(await subjects(stays, `/api/support/tickets?q=${encodeURIComponent('_')}`), ['Lock_code wrong']);
  assert.deepEqual(await subjects(boss, `/api/admin/support/tickets?q=${encodeURIComponent('%')}`), ['Refund 100% of the stay']);
});
