'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const config = require('../src/config');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const HOST = 'Ann & Bob <i>Stays</i>';
const VILLA_SLUG = 'script-alert-1-script';
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

let srv; let owner; let prop; let villa; let paris; let hidden; let slug; let photos;

// Public pages are plain GETs (no session), so read them with fetch and keep the headers.
async function get(path) {
  const res = await fetch(srv.base + path, { redirect: 'manual' });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'ann@example.com', HOST);
  prop = (await owner.post('/api/properties', {
    property_name: 'Azure Tower', property_type: 'condominium', address: 'Bicutan Ave 12', city: 'Parañaque', province: 'Metro Manila',
  })).data.property;
  villa = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: '<script>alert(1)</script>', unit_type: 'studio', nightly_rate: '2500', weekend_rate: '2800', cleaning_fee: '777',
    max_guests: 4, min_nights: 2, checkin_time: '15:00', checkout_time: '11:00', bookable_online: true,
    description: `Bright "corner" unit & pool access.\n\n${'Long line of text. '.repeat(20)}`,
    house_rules: 'No parties & no smoking.', cancellation_policy: 'moderate', wifi_password: 'secret-wifi-99',
  })).data.unit;
  paris = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '3000', bookable_online: true,
  })).data.unit;
  hidden = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Hidden 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const first = await owner.raw('POST', `/api/units/${villa.unit_id}/photos`, PNG, { 'Content-Type': 'image/png' });
  const second = await owner.raw('POST', `/api/units/${villa.unit_id}/photos`, PNG, { 'Content-Type': 'image/png' });
  photos = [first.data.photo.file_id, second.data.photo.file_id];
  const r = await owner.patch('/api/direct-booking', {
    paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true, intro: 'Welcome!\n\nWe host guests from across Metro Manila.',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
});
test.after(async () => { await srv.close(); });

test('host page: escaped name and intro, bookable listings only, lower-case lookup', async () => {
  const r = await get(`/stay/${slug}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.ok(r.text.includes(`<title>Ann &amp; Bob &lt;i&gt;Stays&lt;/i&gt; · Places to stay</title>`));
  assert.ok(r.text.includes(`<link rel="canonical" href="${config.appUrl}/stay/${slug}">`));
  assert.ok(r.text.includes(`<h1>Ann &amp; Bob &lt;i&gt;Stays&lt;/i&gt;</h1>`));
  assert.ok(r.text.includes('<meta name="description" content="Welcome! We host guests from across Metro Manila.">'));
  assert.ok(r.text.includes('<meta property="og:image" content="' + `${config.appUrl}/api/public/listing-photos/${photos[0]}` + '">'));
  assert.ok(r.text.includes(`href="/stay/${slug}/${VILLA_SLUG}"`));
  assert.ok(r.text.includes(`href="/stay/${slug}/paris-1208"`));
  assert.ok(r.text.includes('From ₱2,500.00 / night'));
  assert.ok(!r.text.includes('Hidden 1'), 'a listing not on the booking page is not shown');
  assert.ok(!r.text.includes('<script'), 'no script tags');
  assert.ok(!/\sstyle=/.test(r.text), 'no inline styles');
  assert.equal((await get(`/stay/${slug.toUpperCase()}`)).status, 200, 'host slug is case-insensitive');
});

test('listing page: title, meta, Open Graph, escaped name, photos, price, policy, booking link', async () => {
  const r = await get(`/stay/${slug}/${VILLA_SLUG}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.ok(r.text.includes('<html lang="en">'));
  assert.ok(r.text.includes('<title>&lt;script&gt;alert(1)&lt;/script&gt; · Parañaque · Ann &amp; Bob &lt;i&gt;Stays&lt;/i&gt;</title>'));
  assert.ok(!r.text.includes('<script'), 'the listing name is escaped, never a tag');
  assert.ok(!/\sstyle=/.test(r.text), 'no inline styles');
  const meta = unesc(/<meta name="description" content="([^"]*)">/.exec(r.text)[1]);
  assert.ok(meta.length <= 155 && meta.endsWith('…'), `meta description cut to 155: ${meta.length}`);
  assert.ok(meta.startsWith('Bright "corner" unit & pool access.'));
  assert.ok(r.text.includes(`<link rel="canonical" href="${config.appUrl}/stay/${slug}/${VILLA_SLUG}">`));
  assert.ok(r.text.includes('<meta property="og:type" content="website">'));
  assert.ok(r.text.includes('<meta property="og:url" content="' + `${config.appUrl}/stay/${slug}/${VILLA_SLUG}` + '">'));
  assert.ok(r.text.includes('<meta property="og:image" content="' + `${config.appUrl}/api/public/listing-photos/${photos[0]}` + '">'));
  assert.ok(r.text.includes('<h1 class="bk-title">&lt;script&gt;alert(1)&lt;/script&gt;</h1>'));
  assert.ok(r.text.includes(`<img class="bk-gallery__main" src="/api/public/listing-photos/${photos[0]}" alt="&lt;script&gt;alert(1)&lt;/script&gt;, photo 1" loading="lazy">`));
  assert.ok(r.text.includes(`src="/api/public/listing-photos/${photos[1]}"`));
  assert.equal((r.text.match(/loading="lazy"/g) || []).length, 2, 'every photo is lazy-loaded');
  assert.ok(r.text.includes('Bright &quot;corner&quot; unit &amp; pool access.'));
  assert.ok(r.text.includes('No parties &amp; no smoking.'));
  assert.ok(r.text.includes('<strong>Moderate</strong>'));
  assert.ok(r.text.includes('Full refund if you cancel at least 5 days before check-in.'));
  assert.ok(r.text.includes('From ₱2,500.00 / night'));
  assert.ok(r.text.includes('Up to 4 guests') && r.text.includes('2-night minimum') && r.text.includes('Check-in 3:00 PM · Check-out 11:00 AM'));
  assert.ok(r.text.includes(`href="/#/book/${slug}/${villa.unit_id}"`));
  assert.ok(r.text.includes('Check dates and book'));
  // Never shown: the street address, exact prices beyond "from", the cleaning fee and Wi-Fi.
  for (const secret of ['Bicutan', '777', '2,800', 'secret-wifi-99']) assert.ok(!r.text.includes(secret), `leaked ${secret}`);
});

test('unknown, unbookable, disabled, demo and read-only hosts or listings give a styled 404', async () => {
  const notFound = async (path) => {
    const r = await get(path);
    assert.equal(r.status, 404, path);
    assert.match(r.headers.get('content-type'), /^text\/html/);
    assert.ok(r.text.includes('<h1>Page not found</h1>'), path);
    assert.ok(r.text.includes('<meta name="robots" content="noindex">'), path);
  };
  await notFound(`/stay/${slug}/hidden-1`);
  await notFound(`/stay/${slug}/nope`);
  await notFound('/stay/no-such-host');
  await notFound('/stay/');
  await notFound(`/stay/${slug}/a/b`);

  assert.equal((await owner.patch('/api/direct-booking', { enabled: false })).status, 200);
  await notFound(`/stay/${slug}`);
  assert.equal((await owner.patch('/api/direct-booking', { enabled: true })).status, 200);
  assert.equal((await get(`/stay/${slug}`)).status, 200);

  await sql('UPDATE organizations SET is_demo = true WHERE booking_slug = $1', [slug]);
  await notFound(`/stay/${slug}`);
  await sql('UPDATE organizations SET is_demo = false WHERE booking_slug = $1', [slug]);

  await sql(`UPDATE organizations SET plan = 'trial', trial_ends_at = now() - interval '1 day' WHERE booking_slug = $1`, [slug]);
  await notFound(`/stay/${slug}/${VILLA_SLUG}`);
  await sql(`UPDATE organizations SET trial_ends_at = now() + interval '10 days' WHERE booking_slug = $1`, [slug]);
  assert.equal((await get(`/stay/${slug}/${VILLA_SLUG}`)).status, 200);
});

test('sitemap lists live hosts and listings only; robots.txt points at it', async () => {
  await ownerAccount(srv.base, 'quiet@example.com', 'Quiet Place');
  const s = await get('/sitemap.xml');
  assert.equal(s.status, 200);
  assert.match(s.headers.get('content-type'), /^application\/xml/);
  assert.equal(s.headers.get('cache-control'), 'public, max-age=300');
  assert.ok(s.text.includes(`<loc>${config.appUrl}/stay/${slug}</loc>`));
  assert.ok(s.text.includes(`<loc>${config.appUrl}/stay/${slug}/${VILLA_SLUG}</loc>`));
  assert.ok(s.text.includes(`<loc>${config.appUrl}/stay/${slug}/paris-1208</loc>`));
  assert.ok(!s.text.includes('hidden-1'));
  assert.ok(!s.text.includes('quiet-place'), 'a workspace without booking is not listed');

  assert.equal((await get('/stay/quiet-place')).status, 404);
  const r = await get('/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/plain/);
  assert.ok(r.text.includes('Allow: /stay/'));
  assert.ok(r.text.includes('Disallow: /api/'));
  assert.ok(r.text.includes(`Sitemap: ${config.appUrl}/sitemap.xml`));
});

test('a Taglish host gets Taglish labels and policy text', async () => {
  await sql(`UPDATE organizations SET guest_language = 'tl' WHERE booking_slug = $1`, [slug]);
  try {
    const r = await get(`/stay/${slug}/${VILLA_SLUG}`);
    assert.ok(r.text.includes('<html lang="tl">'));
    assert.ok(r.text.includes('Mula ₱2,500.00 / gabi'));
    assert.ok(r.text.includes('Hanggang 4 guests') && r.text.includes('Minimum 2 gabi'));
    assert.ok(r.text.includes('Buong refund kung mag-cancel ka ng at least 5 araw'));
    assert.ok(r.text.includes('Tingnan ang petsa at mag-book'));
  } finally {
    await sql(`UPDATE organizations SET guest_language = 'en' WHERE booking_slug = $1`, [slug]);
  }
});

test('the app and its static files still serve, without the public cache header', async () => {
  const root = await get('/');
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /^text\/html/);
  assert.equal(root.headers.get('cache-control'), 'no-cache');
  const css = await get('/css/app.css');
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('cache-control'), 'no-cache');
});

test('page addresses: generated from the name, de-duplicated, validated and unique per workspace', async () => {
  const a = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'A', unit_type: 'room' });
  assert.equal(a.status, 201);
  assert.equal(a.data.unit.public_slug, 'listing-a');

  const second = await owner.post('/api/properties', {
    property_name: 'Second Tower', property_type: 'condominium', address: 'Ortigas', city: 'Pasig', province: 'Metro Manila',
  });
  const dup = await owner.post(`/api/properties/${second.data.property.property_id}/units`, { unit_name: 'Paris 1208', unit_type: 'studio' });
  assert.equal(dup.data.unit.public_slug, 'paris-1208-2', 'the second Paris 1208 is de-duplicated');
  const thirdProp = (await owner.post('/api/properties', {
    property_name: 'Third Tower', property_type: 'house', address: 'Elm 3', city: 'Pasig', province: 'Metro Manila',
  })).data.property;
  const third = await owner.post(`/api/properties/${thirdProp.property_id}/units`, { unit_name: 'Paris 1208 ', unit_type: 'studio', public_slug: '' });
  assert.equal(third.status, 201);
  assert.equal(third.data.unit.public_slug, 'paris-1208-3');

  for (const bad of ['Bad Slug', 'ab', 'x'.repeat(61), 'under_score']) {
    const r = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Bad', unit_type: 'room', public_slug: bad });
    assert.equal(r.status, 400, bad);
    assert.ok(r.data.fields.public_slug, bad);
  }
  const taken = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Taken', unit_type: 'room', public_slug: 'paris-1208' });
  assert.equal(taken.status, 409);
  assert.equal(taken.data.code, 'SLUG_TAKEN');

  const villaUnit = await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Sunset Villa', unit_type: 'house', nightly_rate: '1800', bookable_online: true, public_slug: 'my-sunset-villa',
  });
  assert.equal(villaUnit.status, 201);
  const detail = await owner.get(`/api/properties/${prop.property_id}`);
  assert.ok(detail.data.units.some((u) => u.unit_id === villaUnit.data.unit.unit_id && u.public_slug === 'my-sunset-villa'));
  assert.equal((await get(`/stay/${slug}/my-sunset-villa`)).status, 200);

  const up = `/api/units/${villaUnit.data.unit.unit_id}`;
  assert.equal((await owner.patch(up, { public_slug: 'paris-1208' })).data.code, 'SLUG_TAKEN');
  assert.equal((await owner.patch(up, { public_slug: '' })).status, 400, 'a blank address is refused on edit');
  assert.equal((await owner.patch(up, { public_slug: 'Sunset' })).status, 400);
  assert.equal((await owner.patch(up, { public_slug: 'my-sunset-villa' })).status, 200, 'keeping its own address is fine');
  const renamed = await owner.patch(up, { public_slug: 'sunset-villa-2' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.unit.public_slug, 'sunset-villa-2');
  assert.equal((await owner.patch(up, { description: 'Pool view' })).data.unit.public_slug, 'sunset-villa-2', 'other edits keep the address');
  assert.equal((await get(`/stay/${slug}/my-sunset-villa`)).status, 404, 'the old address stops working');
  assert.equal((await get(`/stay/${slug}/sunset-villa-2`)).status, 200);

  const other = await ownerAccount(srv.base, 'other@example.com', 'Other Co');
  const otherProp = (await other.post('/api/properties', {
    property_name: 'Elsewhere', property_type: 'house', address: 'Elm St', city: 'Cebu City', province: 'Cebu',
  })).data.property;
  const elsewhere = await other.post(`/api/properties/${otherProp.property_id}/units`, { unit_name: 'Cebu Loft', unit_type: 'studio', public_slug: 'sunset-villa-2' });
  assert.equal(elsewhere.status, 201, 'the same address is fine in another workspace');
});

test('two listings saved at the same moment with the same name get different addresses', async () => {
  const p1 = (await owner.post('/api/properties', { property_name: 'Race A', property_type: 'house', address: 'Race St 1', city: 'Makati', province: 'Metro Manila' })).data.property;
  const p2 = (await owner.post('/api/properties', { property_name: 'Race B', property_type: 'house', address: 'Race St 2', city: 'Makati', province: 'Metro Manila' })).data.property;
  const [r1, r2] = await Promise.all([
    owner.post(`/api/properties/${p1.property_id}/units`, { unit_name: 'Race Unit', unit_type: 'room' }),
    owner.post(`/api/properties/${p2.property_id}/units`, { unit_name: 'Race Unit', unit_type: 'room' }),
  ]);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.deepEqual([r1.data.unit.public_slug, r2.data.unit.public_slug].sort(), ['race-unit', 'race-unit-2']);
});

test('sitemap is kept for five minutes, then rebuilt', async (t) => {
  const first = await get('/sitemap.xml');
  assert.equal(first.status, 200);
  const added = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Cache Check', unit_type: 'room', nightly_rate: '1500', bookable_online: true, public_slug: 'cache-check' });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  assert.equal((await get('/sitemap.xml')).text, first.text, 'the new listing waits for the cache to expire');

  const realNow = Date.now();
  t.mock.method(Date, 'now', () => realNow + 5 * 60 * 1000 + 1000);
  assert.ok((await get('/sitemap.xml')).text.includes(`<loc>${config.appUrl}/stay/${slug}/cache-check</loc>`));
});

// Keep this the last test in the file: it uses up the 300 requests this IP gets in 15 minutes.
test('/stay and /sitemap.xml refuse an IP after 300 requests in 15 minutes', async () => {
  let refused = null;
  for (let i = 0; i < 330 && !refused; i += 1) {
    const r = await get(`/stay/${slug}`);
    if (r.status === 429) refused = r;
  }
  assert.ok(refused, 'a request over the limit gets 429');
  assert.ok(Number(refused.headers.get('retry-after')) > 0, 'with a Retry-After hint');
});
