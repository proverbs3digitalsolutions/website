'use strict';

// Search-friendly public pages (decision D-63): a host page at /stay/:slug, a listing page
// at /stay/:slug/:unitSlug, /sitemap.xml and /robots.txt. The pages are server-rendered HTML
// that uses /css/app.css only, so the strict CSP holds: no scripts, no inline styles.
// Every value that goes into the markup passes through esc().

const express = require('express');
const config = require('../config');
const { query, one } = require('../db');
const { ah } = require('../lib/http');
const { rateLimit } = require('../lib/auth');
const { planStatus } = require('../lib/plans');
const { describePolicy } = require('../lib/policies');

const router = express.Router();
const CACHE = 'public, max-age=300';
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Text cut to n characters, ending in an ellipsis when it was cut.
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const peso = (v) => `₱${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const photoSrc = (id) => `/api/public/listing-photos/${id}`;

// Guest-facing labels. English is the default; a host who sets Taglish gets these.
const T = {
  en: {
    places: 'Places to stay',
    noPlaces: 'No places are listed online yet.',
    moreBy: (name) => `More places by ${name}`,
    from: (price) => `From ${price} / night`,
    upTo: (n) => `Up to ${n} guests`,
    minimum: (n) => `${n}-night minimum`,
    photo: (name, i) => `${name}, photo ${i}`,
    book: 'Check dates and book',
    about: 'About this place',
    rules: 'House rules',
    cancel: 'Cancellation policy',
  },
  tl: {
    places: 'Mga lugar na matutuluyan',
    noPlaces: 'Wala pang lugar na nakalista online.',
    moreBy: (name) => `Iba pang lugar ng ${name}`,
    from: (price) => `Mula ${price} / gabi`,
    upTo: (n) => `Hanggang ${n} guests`,
    minimum: (n) => `Minimum ${n} gabi`,
    photo: (name, i) => `${name}, litrato ${i}`,
    book: 'Tingnan ang petsa at mag-book',
    about: 'Tungkol sa lugar na ito',
    rules: 'House rules',
    cancel: 'Patakaran sa pagkansela',
  },
};

const time12 = (v) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
  if (!m) return v || '';
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
const langOf = (host) => (host.guest_language === 'tl' ? 'tl' : 'en');

// A host's pages are live only with the booking page on, for a real workspace (not the demo)
// that isn't read-only (trial over, plan payment overdue, or scheduled for deletion).
const isLive = (o) => o.booking_enabled && !o.is_demo && !planStatus(o).read_only;

const HOST_COLUMNS = `organization_id, name, booking_slug, booking_intro, booking_enabled, plan,
  trial_ends_at, paid_until, is_demo, deletion_scheduled_at, guest_language`;

async function findHost(slug) {
  const o = await one(`SELECT ${HOST_COLUMNS} FROM organizations WHERE lower(booking_slug) = lower($1)`, [String(slug).slice(0, 60)]);
  return o && isLive(o) ? o : null;
}

// Listings shown on the booking page (same rules as PUBLIC_UNIT in directbooking.js), with
// photo ids in order. from_rate is the lowest of the nightly, weekend and holiday rates,
// because a weekend or holiday rate replaces the nightly one on those nights.
const LISTINGS = `
  SELECT u.unit_id, u.unit_name, u.public_slug, u.description, u.house_rules, u.max_guests, u.min_nights,
         to_char(u.checkin_time, 'HH24:MI') AS checkin_time, to_char(u.checkout_time, 'HH24:MI') AS checkout_time,
         u.cancellation_policy, u.cancellation_policy_text,
         LEAST(u.nightly_rate, u.weekend_rate, u.holiday_rate) AS from_rate,
         p.city, p.province,
         COALESCE((SELECT json_agg(f.file_id ORDER BY f.sort_order, f.uploaded_at) FROM files f
                    WHERE f.related_record_type = 'listing' AND f.related_record_id = u.unit_id), '[]') AS photos
    FROM units u JOIN properties p USING (property_id)
   WHERE p.organization_id = $1 AND u.bookable_online AND u.status = 'active' AND p.status = 'active'
     AND u.nightly_rate IS NOT NULL AND u.public_slug IS NOT NULL`;

const hostPath = (host) => `/stay/${encodeURIComponent(host.booking_slug)}`;
const listingPath = (host, l) => `${hostPath(host)}/${encodeURIComponent(l.public_slug)}`;
const where = (l) => [l.city, l.province].filter(Boolean).join(', ');
const fromLine = (l, t) => t.from(peso(l.from_rate));

function sendHtml(res, html, status = 200) {
  res.status(status).type('html').set('Cache-Control', CACHE).send(html);
}

function sendNotFound(res) {
  sendHtml(res, page({
    lang: 'en',
    title: 'Page not found · BalayHub',
    description: 'This place is not available to book online right now.',
    robots: 'noindex',
    body: `<div class="bk">${shell('/', 'BalayHub', `
    <div class="bk-hero"><h1>Page not found</h1><p class="muted">This place isn't available to book online right now.</p></div>
    <p><a class="btn btn--primary" href="/">Go to BalayHub</a></p>`)}</div>`,
  }), 404);
}

function page({ lang, title, description, canonical, image, robots, body }) {
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    robots ? `<meta name="robots" content="${esc(robots)}">` : '',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="stylesheet" href="/css/app.css">',
  ].filter(Boolean).join('\n');
  return `<!doctype html>\n<html lang="${lang}">\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

function shell(homeHref, name, main) {
  return `<header class="bk__top"><div class="bk__wrap bk__top-inner"><a class="bk__host" href="${esc(homeHref)}">${esc(name)}</a></div></header>
<main class="bk__main"><div class="bk__wrap">${main}</div></main>`;
}

function hostPage(host, listings) {
  const lang = langOf(host);
  const t = T[lang];
  const canonical = `${config.appUrl}${hostPath(host)}`;
  const title = `${host.name} · ${t.places}`;
  const description = host.booking_intro ? cut(oneLine(host.booking_intro), 155) : title;
  const cover = listings.find((l) => l.photos.length);
  const cards = listings.map((l) => {
    const img = l.photos.length
      ? `<img class="bk-card__img" src="${photoSrc(l.photos[0])}" alt="${esc(t.photo(l.unit_name, 1))}" loading="lazy">`
      : '<div class="bk-noimg bk-card__img" aria-hidden="true"></div>';
    return `<a class="bk-card" href="${esc(listingPath(host, l))}">${img}<div class="bk-card__body"><h3>${esc(l.unit_name)}</h3><span class="muted">${esc(where(l))}</span><span class="bk-card__price">${esc(fromLine(l, t))}</span></div></a>`;
  }).join('');
  const body = `<div class="bk">${shell(hostPath(host), host.name, `
    <div class="bk-hero"><h1>${esc(host.name)}</h1>${host.booking_intro ? `<p class="bk-desc">${esc(host.booking_intro)}</p>` : ''}</div>
    <h2>${esc(t.places)}</h2>
    ${listings.length ? `<div class="bk-grid">${cards}</div>` : `<p class="muted">${esc(t.noPlaces)}</p>`}`)}</div>`;
  return page({
    lang, title, description, canonical, body,
    image: cover ? `${config.appUrl}${photoSrc(cover.photos[0])}` : null,
  });
}

function listingPage(host, u) {
  const lang = langOf(host);
  const t = T[lang];
  const canonical = `${config.appUrl}${listingPath(host, u)}`;
  const place = where(u);
  const title = [u.unit_name, u.city, host.name].filter(Boolean).join(' · ');
  const description = u.description ? cut(oneLine(u.description), 155) : `${[u.unit_name, place].filter(Boolean).join(', ')}. ${t.book}.`;
  const alt = (i) => t.photo(u.unit_name, i);
  const gallery = u.photos.length ? `<div class="bk-gallery"><img class="bk-gallery__main" src="${photoSrc(u.photos[0])}" alt="${esc(alt(1))}" loading="lazy">${
    u.photos.length > 1 ? `<div class="bk-gallery__thumbs">${u.photos.slice(1).map((id, i) => `<div class="bk-gallery__thumb"><img src="${photoSrc(id)}" alt="${esc(alt(i + 2))}" loading="lazy"></div>`).join('')}</div>` : ''}</div>` : '';
  const facts = [u.max_guests ? t.upTo(u.max_guests) : null, t.minimum(u.min_nights), `Check-in ${time12(u.checkin_time)} · Check-out ${time12(u.checkout_time)}`]
    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  const section = (heading, text) => `<h2>${esc(heading)}</h2><p class="bk-desc">${esc(text)}</p>`;
  const policy = describePolicy(u.cancellation_policy, u.cancellation_policy_text);
  const sections = [
    u.description ? section(t.about, u.description) : '',
    u.house_rules ? section(t.rules, cut(u.house_rules, 500)) : '',
    policy ? `<h2>${esc(t.cancel)}</h2><p><strong>${esc(policy.label)}</strong></p><p class="bk-desc">${esc(lang === 'tl' && policy.tl ? policy.tl : policy.en)}</p>` : '',
  ].join('');
  const bookHref = `/#/book/${encodeURIComponent(host.booking_slug)}/${u.unit_id}`;
  const body = `<div class="bk">${shell(hostPath(host), host.name, `
    <p class="muted"><a href="${esc(hostPath(host))}">${esc(t.moreBy(host.name))}</a></p>
    <h1 class="bk-title">${esc(u.unit_name)}</h1>
    <p class="muted">${esc(place)}</p>
    ${gallery}
    <div class="card bk-book">
      <p class="bk-book__price">${esc(fromLine(u, t))}</p>
      <div class="bk-facts">${facts}</div>
      <p><a class="btn btn--primary" href="${esc(bookHref)}">${esc(t.book)}</a></p>
    </div>
    <div class="bk-details">${sections}</div>`)}</div>`;
  return page({
    lang, title, description, canonical, body,
    image: u.photos.length ? `${config.appUrl}${photoSrc(u.photos[0])}` : null,
  });
}

// Pages and the sitemap are open to anyone, so one IP gets 300 requests per 15 minutes across them.
router.use(['/stay', '/sitemap.xml'], rateLimit({ windowMs: 15 * 60 * 1000, max: 300, key: (req) => `seo|${req.ip}` }));

router.get('/stay/:slug', ah(async (req, res) => {
  const host = await findHost(req.params.slug);
  if (!host) return sendNotFound(res);
  const { rows } = await query(`${LISTINGS} ORDER BY p.property_name, u.unit_name`, [host.organization_id]);
  sendHtml(res, hostPage(host, rows));
}));

router.get('/stay/:slug/:unitSlug', ah(async (req, res) => {
  const host = await findHost(req.params.slug);
  if (!host) return sendNotFound(res);
  const u = await one(`${LISTINGS} AND u.public_slug = lower($2)`, [host.organization_id, String(req.params.unitSlug).slice(0, 60)]);
  if (!u) return sendNotFound(res);
  sendHtml(res, listingPage(host, u));
}));

// Anything else under /stay is a 404 page, not the app's fallback.
router.use('/stay', (req, res) => sendNotFound(res));

// ponytail: no <lastmod> (units and workspaces have no updated_at column); one file, so past 50,000 URLs it needs a sitemap index.
// ponytail: each server process keeps one copy for 5 minutes (a host going live or off shows within that); concurrent misses each rebuild it.
const SITEMAP_TTL_MS = 5 * 60 * 1000;
let sitemapCache = null; // { at, xml }

async function buildSitemap() {
  const hosts = (await query(
    `SELECT ${HOST_COLUMNS} FROM organizations WHERE booking_enabled AND NOT is_demo AND booking_slug IS NOT NULL`)).rows.filter(isLive);
  const listed = hosts.length ? (await query(
    `SELECT p.organization_id, u.public_slug FROM units u JOIN properties p USING (property_id)
      WHERE p.organization_id = ANY($1::uuid[]) AND u.bookable_online AND u.status = 'active' AND p.status = 'active'
        AND u.nightly_rate IS NOT NULL AND u.public_slug IS NOT NULL
      ORDER BY u.unit_name`, [hosts.map((h) => h.organization_id)])).rows : [];
  const urls = [];
  for (const h of hosts) {
    urls.push(`${config.appUrl}${hostPath(h)}`);
    for (const l of listed.filter((x) => x.organization_id === h.organization_id)) {
      urls.push(`${config.appUrl}${hostPath(h)}/${encodeURIComponent(l.public_slug)}`);
    }
  }
  const entries = urls.map((u) => `  <url><loc>${esc(u)}</loc></url>\n`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}</urlset>\n`;
}

router.get('/sitemap.xml', ah(async (req, res) => {
  if (!sitemapCache || Date.now() - sitemapCache.at > SITEMAP_TTL_MS) sitemapCache = { at: Date.now(), xml: await buildSitemap() };
  res.set('Cache-Control', CACHE).type('application/xml').send(sitemapCache.xml);
}));

router.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', CACHE).type('text/plain')
    .send(`User-agent: *\nAllow: /stay/\nDisallow: /api/\n\nSitemap: ${config.appUrl}/sitemap.xml\n`);
});

module.exports = router;
