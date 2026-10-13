// QA round 1, lane L31: public pages (terms, privacy, landing, verify, index.html head).
// Static checks on the source files, since these are browser views with no server logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = path.join(__dirname, '..', 'public');
const read = (rel) => fs.readFileSync(path.join(pub, rel), 'utf8');
const ORIGIN = 'https://balayhub.proverbs3digitalsolutions.com';

// The source of one exported async view, up to the next top-level export.
function viewBody(src, name) {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return '';
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test('#68 landing head has Open Graph tags and a canonical link for the production address', () => {
  const html = read('index.html');
  for (const prop of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image']) {
    assert.match(html, new RegExp(`<meta property="${prop}" content="[^"]+"`), `${prop} is missing`);
  }
  assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/"`));
  assert.match(html, new RegExp(`<meta property="og:url" content="${ORIGIN}/"`));
  const image = html.match(/<meta property="og:image" content="([^"]+)"/)[1];
  assert.ok(image.startsWith(`${ORIGIN}/`), 'og:image must be an absolute URL on the production host');
  assert.ok(fs.existsSync(path.join(pub, image.slice(ORIGIN.length))), 'og:image must point at a file in public/');
});

test('index.html stays under the strict CSP: no inline script and no style attributes', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\bsrc=/, 'inline <script> found');
  assert.doesNotMatch(html, /\sstyle=/);
});

test('#66 terms page uses the configured contact email and has no hard-coded placeholder', () => {
  const src = read('js/views/terms.js');
  assert.doesNotMatch(src, /\[contact email/);
  assert.match(src, /get\('\/public\/plans'\)/);
  assert.match(src, /contact_email/);
});

test('#66 terms page keeps its draft notice (founder decision pending)', () => {
  assert.match(read('js/views/terms.js'), /Draft pending review by a Philippine lawyer/);
});

test('#72 terms page points at Help & support when no contact email is set', () => {
  const src = read('js/views/terms.js');
  assert.match(src, /href: '#\/help'/);
  assert.match(src, /Help & support/);
});

test('#72 privacy page no longer sends visitors to contact details that may be hidden', () => {
  const src = read('js/views/privacy.js');
  assert.doesNotMatch(src, /contact details on our home page/);
  assert.match(src, /href: '#\/help'/);
});

test('#66 privacy page keeps its draft notice (founder decision pending)', () => {
  assert.match(read('js/views/privacy.js'), /Draft pending review by a Philippine data privacy professional/);
});

test('#69 verify with no token shows a plain message and does not call the server', () => {
  const body = viewBody(read('js/views/auth.js'), 'verifyView');
  assert.match(body, /This verification link is missing or incomplete\. Log in to request a new one\./);
  const guard = body.indexOf('!query.token');
  const call = body.indexOf("post('/auth/verify-email'");
  assert.ok(guard >= 0, 'verifyView must check for a missing token');
  assert.ok(call > guard, 'the token check must come before the server call');
});

test('#72 landing custom-plan note is not hidden when no contact email is set', () => {
  const src = read('js/views/landing.js');
  assert.doesNotMatch(src, /pricing\.contact_email && h\('p', \{ class: 'lp-note' \}/);
});

test('#72 landing contact routes fall back to Help & support (pricing note and footer)', () => {
  const src = read('js/views/landing.js');
  assert.ok((src.match(/href: '#\/help'/g) || []).length >= 2, 'pricing note and footer need the Help & support fallback');
});

test('#72 landing FAQ says "Message us" only when a contact email is configured', () => {
  const src = read('js/views/landing.js');
  assert.match(src, /pricing\.contact_email\s*\?\s*'Monthly, by GCash, Maya or bank transfer\. Message us/);
  assert.match(src, /Ask Help & support when you\\'re ready/);
});

test('#72 new Help & support copy has a Taglish translation', () => {
  const src = read('js/views/landing.js');
  assert.match(src, /'Help & support': 'Help & support'/);
  assert.match(src, /Magtanong sa Help & support kapag handa ka na/);
});

test('lane files never use window.alert, confirm or prompt', () => {
  for (const f of ['js/views/terms.js', 'js/views/privacy.js', 'js/views/landing.js', 'js/views/auth.js', 'index.html']) {
    assert.doesNotMatch(read(f), /window\.(alert|confirm|prompt)\(/, f);
  }
});
