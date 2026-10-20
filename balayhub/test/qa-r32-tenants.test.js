'use strict';
require('./helpers');

// QA r32 lane TENANTS: LT-1 (lease document refusal on its own line), LBL-R (name = visible label), LT-2 (rent charges full width).
// Frontend-only source scans.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const raw = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'tenants.js'), 'utf8');
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const docs = src.slice(src.indexOf('const leaseDocs'), src.indexOf('const leaseCard'));

test('LBL-R: the lease input is named by its visible label', () => {
  assert.match(docs, /type: 'file', id: 'lease-doc-file'/);
  assert.doesNotMatch(docs, /aria-label/);
  assert.match(docs, /h\('label', \{ for: 'lease-doc-file' \}, 'Upload signed lease or tenant document'\)/);
  assert.match(docs, /id: 'lease-doc-hint'/);
  assert.match(docs, /'aria-describedby': 'lease-doc-hint'/);
});

test('LT-1: a refused file goes on the upload line', () => {
  assert.match(src, /import \{[^}]*\buploadField\b[^}]*\} from '\.\.\/ui\.js'/s);
  assert.match(src, /import \{[^}]*\bfileRefused\b[^}]*\} from '\.\.\/ui\.js'/s);
  assert.match(docs, /const up = uploadField\(input\);/);
  assert.match(docs, /up\.wrap/);
  assert.match(docs, /input\.addEventListener\('change', up\.clear\)/);
  assert.match(docs, /up\.show\('Choose a file first\.'\)/);
  assert.doesNotMatch(docs, /status\.replaceChildren\(h\('div', \{ class: 'alert alert--error' \}, 'Choose a file first\.'\)\)/);
  assert.match(docs, /const status = h\('div', \{ role: 'alert' \}\)/);
  const c = docs.slice(docs.indexOf('catch (err)'));
  assert.ok(c.indexOf('e.target.disabled = false') < c.indexOf('up.show(err.message)'));
  assert.match(c, /if \(fileRefused\(err\)\) up\.show\(err\.message\); else status\.replaceChildren/);
});

test('LT-2: the rent charges card sits outside the two-column grid', () => {
  const g = src.indexOf("h('div', { class: 'grid grid--2' },");
  const card = src.indexOf("charges.length > 0 && h('div', { class: 'card' }");
  const hist = src.indexOf("h('h2', null, 'Payment history')");
  assert.ok(g > 0 && hist > g && card > hist);
  // the grid closes before the card: the text between the history card's end and the charges card closes the stack and the grid
  const between = src.slice(src.indexOf("emptyState({ title: 'No payments recorded'"), card);
  assert.match(between, /\)\),?\s*\),?\s*\n?\s*$/);
  assert.match(raw, /Full width under the two columns, so the five columns fit at 1280 \(D-114\)\./);
});
