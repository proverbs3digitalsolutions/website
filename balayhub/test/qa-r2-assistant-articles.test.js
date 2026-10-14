'use strict';

// QA round 2, assistant help articles (lane R2): the assistant searches the guides with the whole
// chat message ("any" mode, so natural and Taglish questions find a guide), and its knowledge
// prompt and suggestions follow the workspace type. Help page search stays strict.
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ASSISTANT_MODEL = 'claude-opus-5-5';

const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ARTICLES, searchArticles } = require('../src/lib/helpcenter');

const ANY = { mode: 'any' };
const CALENDAR_Q = 'How do I connect my Airbnb calendar so bookings show up?';
const LISTING_TAGLISH = 'paano mag-add ng listing';
const stayOnlyTitles = ARTICLES.filter((a) => a.module === 'stay').map((a) => a.title);

let stub; let calls = []; let nextReply = 'Go to Listings → Add listing.';
let srv; let h; let stays; let rentals;

test.before(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: nextReply }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });
  await new Promise((r) => stub.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
  h = require('./helpers');
  srv = await h.startServer();
  stays = await h.ownerAccount(srv.base, 'stays@example.com', 'Short Stays');
  assert.equal((await stays.patch('/api/workspace', { business_type: 'short_term' })).status, 200);
  rentals = await h.ownerAccount(srv.base, 'rentals@example.com', 'Monthly Rentals');
  assert.equal((await rentals.patch('/api/workspace', { business_type: 'long_term' })).status, 200);
});
test.after(async () => { await srv.close(); stub.close(); });

test('any mode finds the guide for a natural question and for a Taglish one', () => {
  assert.equal(searchArticles(CALENDAR_Q, 'owner', 3, undefined, ANY)[0].slug, 'calendar-sync');
  assert.equal(searchArticles(LISTING_TAGLISH, 'owner', 3, undefined, ANY)[0].slug, 'add-listing');
});

test('any mode ignores filler words, needs one meaningful word, and keeps the limit', () => {
  assert.deepEqual(searchArticles('how do I my so the', 'owner', 6, undefined, ANY), [], 'only filler words: nothing to match');
  assert.deepEqual(searchArticles('zzzz qqqq', 'owner', 6, undefined, ANY), [], 'a nonsense question finds nothing');
  assert.ok(searchArticles('airbnb zzzz', 'owner', 6, undefined, ANY).some((a) => a.slug === 'calendar-sync'), 'one matching word is enough');
  assert.ok(searchArticles(CALENDAR_Q, 'owner', 3, undefined, ANY).length <= 3);
});

test('strict mode, the default, still finds nothing for those two questions', () => {
  assert.deepEqual(searchArticles(CALENDAR_Q, 'owner'), []);
  assert.deepEqual(searchArticles(LISTING_TAGLISH, 'owner'), []);
});

test('the assistant suggests the calendar and listing guides for natural questions', async () => {
  let r = await stays.post('/api/assistant/chat', { messages: [{ role: 'user', content: CALENDAR_Q }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.articles[0]?.slug, 'calendar-sync');
  r = await stays.post('/api/assistant/chat', { messages: [{ role: 'user', content: LISTING_TAGLISH }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.articles[0]?.slug, 'add-listing');
});

test('a long-term workspace gets no stay-only guide in the prompt or the suggestions', async () => {
  calls = [];
  const r = await rentals.post('/api/assistant/chat', { messages: [{ role: 'user', content: CALENDAR_Q }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!r.data.articles.some((a) => stayOnlyTitles.includes(a.title)), 'no stay guide suggested');
  const sys = calls[0].body.system[0].text;
  for (const a of ARTICLES.filter((x) => x.module === 'stay')) {
    assert.ok(!sys.includes(`### ${a.title}`), `no stay-only guide heading in the prompt: ${a.title}`);
    assert.ok(!sys.includes(a.body.join('\n')), `no stay-only guide text in the prompt: ${a.slug}`);
  }
  // Titles anywhere in the prompt, including the "See ..." pointers and the "for other roles" line.
  for (const title of stayOnlyTitles) assert.ok(!sys.includes(title), `no stay-only guide title in the prompt: ${title}`);
  const notUsable = sys.split('\n').find((line) => line.startsWith('Guides for other roles exist'));
  assert.match(notUsable || '', /See your pay/, 'the cleaner-only guide is still named as one for the owner to check');
  assert.match(sys, /### Set up monthly rentals/, 'the monthly-rent guides are still there');
  assert.match(sys, /### What’s new in BalayHub/, 'the shared What’s new guide is still there');
});

test('Help shows the short-term What’s new guide only to short-term workspaces', async () => {
  const slugs = async (c, url) => (await c.get(url)).data.articles.map((a) => a.slug);
  const shortTerm = await slugs(stays, '/api/help/articles');
  assert.ok(shortTerm.includes('whats-new') && shortTerm.includes('whats-new-stays'), 'a short-term workspace sees both What’s new guides');
  const longTerm = await slugs(rentals, '/api/help/articles');
  assert.ok(longTerm.includes('whats-new'), 'a long-term workspace still sees the shared What’s new guide');
  assert.ok(!longTerm.includes('whats-new-stays'), 'a long-term workspace does not see the short-term What’s new guide');
  assert.ok((await slugs(stays, `/api/help/articles?q=${encodeURIComponent('whats new')}`)).includes('whats-new-stays'), 'searching for what’s new finds it too');
  assert.ok(!(await slugs(rentals, `/api/help/articles?q=${encodeURIComponent('whats new')}`)).includes('whats-new-stays'));
});

test('the two What’s new guides share no line', () => {
  const shared = ARTICLES.find((a) => a.slug === 'whats-new').body;
  const stayOnly = ARTICLES.find((a) => a.slug === 'whats-new-stays').body;
  for (const line of stayOnly) assert.ok(!shared.includes(line), `in both guides: ${line.slice(0, 60)}`);
});

test('the knowledge prompt is cached per role and workspace type', async () => {
  calls = [];
  await stays.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'How do I add a listing?' }] });
  await rentals.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'How do I add a listing?' }] });
  await stays.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'How do I add a listing?' }] });
  assert.equal(calls.length, 3);
  assert.match(calls[0].body.system[0].text, /### Connect Airbnb, Booking\.com and Agoda calendars/);
  assert.ok(!calls[1].body.system[0].text.includes('### Connect Airbnb'), 'a long-term owner is not handed the short-term prompt from the cache');
  assert.match(calls[1].body.system[0].text, /### Set up monthly rentals/);
  assert.equal(calls[2].body.system[0].text, calls[0].body.system[0].text, 'same role and type: same cached text');
});
