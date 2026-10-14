// QA round 2, lane B30 "landing-public": public landing, terms and booking copy, the Get started
// step-2 errors and the feature tab keyboard pattern. Static checks on the source, since these are
// browser views with no server logic (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = path.join(__dirname, '..', 'public');
const read = (rel) => fs.readFileSync(path.join(pub, rel), 'utf8');
const landing = read('js/views/landing.js');
const terms = read('js/views/terms.js');
const book = read('js/views/book.js');

// Taglish keys registered in a dictionary source (same pattern test/language.test.js uses).
function taglishKeys(src) {
  const keys = new Set();
  for (const m of src.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"):\s*'/gm)) keys.add((m[1] ?? m[2]).replace(/\\'/g, "'"));
  for (const m of src.matchAll(/,\s*'((?:[^'\\]|\\.)*)':/g)) keys.add(m[1].replace(/\\'/g, "'"));
  return keys;
}

test('landing: no public link goes to the log-in wall; the fallback is sign-up', () => {
  assert.doesNotMatch(landing, /#\/help/);
  assert.ok((landing.match(/href: '#\/signup'/g) || []).length >= 2, 'pricing note and footer link to sign-up');
});

test('landing: with no contact email, the copy says to create an account and ask in Help & support', () => {
  assert.ok(landing.includes("t(' and ask us in Help & support about a custom plan.')"));
  assert.match(landing, /Create your account, then ask us in Help & support when you\\'re ready/);
  assert.doesNotMatch(landing, /Ask Help & support when you\\'re ready/);
});

test('landing: the Starting out card says 1 to 2 units, to match the 2-listing Starter plan', () => {
  assert.ok(landing.includes("'Starting out', '1–2 units'"));
  assert.ok(!landing.includes("'Starting out', '1–3 units'"));
  assert.ok(landing.includes("'1–2 units': '1–2 unit'"), 'Taglish for 1–2 units');
});

test('landing: sign-up step 1 shows 1 to 2 units for the smallest band; the saved band key stays 1-3', () => {
  assert.ok(landing.includes("['1-3', '1–2 units']"));
  assert.ok(!landing.includes("'1–3 units'"));
});

test('landing: footer links have real Taglish wording, not the English words', () => {
  assert.ok(landing.includes("'Terms of service': 'Mga tuntunin ng serbisyo'"));
  assert.ok(landing.includes("'Privacy notice': 'Paunawa sa privacy'"));
  assert.ok(!landing.includes("'Terms of service': 'Terms of service'"));
});

test('landing: Get started step 2 names each missing field, in English and Taglish', () => {
  assert.doesNotMatch(landing, /errs\[k\] = t\('Please fill in the highlighted fields\.'\)/);
  assert.ok(landing.includes("t('Enter your first name.')"));
  assert.ok(landing.includes("t('Enter your last name.')"));
  assert.ok(landing.includes("t('Enter your business name.')"));
  assert.ok(landing.includes("'Enter your first name.': 'Ilagay ang first name mo.'"));
  assert.ok(landing.includes("'Enter your last name.': 'Ilagay ang last name mo.'"));
  assert.ok(landing.includes("'Enter your business name.': 'Ilagay ang business name mo.'"));
});

test('landing: feature tabs use the tab pattern (roving tabindex, arrow, Home and End keys, aria-controls and aria-labelledby)', () => {
  for (const s of ["role: 'tab'", "id: `lp-tab-${i}`", "'aria-controls': 'lp-panel'", "id: 'lp-panel'", "setAttribute('aria-labelledby'",
    "tabindex: i === activeGroup ? '0' : '-1'", 'ArrowRight', 'ArrowLeft', 'Home: 0', 'End: last', "onkeydown:"]) {
    assert.ok(landing.includes(s), `missing: ${s}`);
  }
});

test('book: zero guests says "At least 1 guest." with Taglish wording', () => {
  assert.doesNotMatch(book, /tServer\('Guests is required\.'\)/);
  assert.ok(book.includes("t('At least 1 guest.')"));
  assert.ok(book.includes("'At least 1 guest.': 'Hindi bababa sa 1 guest.'"));
});

test('terms: no public link goes to the log-in wall; the fallback is sign-up', () => {
  assert.doesNotMatch(terms, /#\/help/);
  assert.match(terms, /href: '#\/signup'/);
  assert.ok(terms.includes("t(' and ask us in Help & support.')"));
});

test('every literal t() on the landing, terms and booking pages has a Taglish entry', () => {
  const i18n = read('js/i18n.js');
  const missing = [];
  for (const [name, src] of [['landing.js', landing], ['terms.js', terms], ['book.js', book]]) {
    const keys = taglishKeys(i18n);
    for (const k of taglishKeys(src)) keys.add(k);
    for (const m of src.matchAll(/\bt\((?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
      const k = (m[1] ?? m[2]).replace(/\\'/g, "'");
      if (!keys.has(k)) missing.push(`${name}: ${k}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('lane files never use window.alert, confirm or prompt', () => {
  for (const f of ['js/views/landing.js', 'js/views/terms.js', 'js/views/book.js']) {
    assert.doesNotMatch(read(f), /window\.(alert|confirm|prompt)\(/, f);
  }
});
