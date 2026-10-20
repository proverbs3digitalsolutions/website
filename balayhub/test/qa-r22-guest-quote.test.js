'use strict';

// QA round 22, GST-2 (quote): a field's error clears as soon as the guest fixes that field; the banner goes with the last one.
// Frontend only: the handler is cut out of quote.js and run against a stand-in form (no database, no browser).

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/quote.js'), 'utf8');
const m = src.match(/const clearFieldError = \(e\) => \{[\s\S]*?\n {2}\};/);

test('quote.js listens for input and change on the form', () => {
  assert.ok(m, 'clearFieldError is defined');
  assert.match(src, /form\.addEventListener\('input', clearFieldError\);/);
  assert.match(src, /form\.addEventListener\('change', clearFieldError\);/);
});

test('clearFieldError clears only the fixed field, and the banner with the last one', () => {
  const mk = (name) => {
    const err = { textContent: 'bad' }; const inputs = [{ removed: false, removeAttribute() { this.removed = true; } }];
    const classes = new Set(['field--invalid']);
    const wrap = { classList: { contains: (c) => classes.has(c), remove: (c) => classes.delete(c) }, querySelectorAll: () => inputs, querySelector: () => err };
    return { name, wrap, err, inputs, classes, target: { name, closest: () => wrap } };
  };
  const fields = [mk('name'), mk('accept_rules'), mk('consent')];
  let banner = 'shown';
  const form = { querySelector: () => (fields.some((f) => f.classes.size) ? {} : null) };
  const payError = { replaceChildren: () => { banner = ''; } };
  const formError = payError;
  const fn = new Function('form', 'formError', `${m[0]}; return clearFieldError;`)(form, formError);
  fn({ target: fields[0].target });
  assert.equal(fields[0].classes.size, 0); assert.equal(fields[0].err.textContent, ''); assert.ok(fields[0].inputs[0].removed);
  assert.equal(fields[1].err.textContent, 'bad'); assert.equal(banner, 'shown');
  fn({ target: fields[1].target }); assert.equal(banner, 'shown');
  fn({ target: fields[2].target }); assert.equal(banner, '');
});

test('quote.js shows the summary banner when the client-side check fails', () => {
  const line = src.match(/if \(Object\.keys\(problems\)\.length\) \{[^\n]*\}/);
  assert.ok(line, 'client-check branch exists');
  assert.match(line[0], /formError\.replaceChildren\(h\('div', \{ class: 'alert alert--error', role: 'alert' \}, t\('Please check the highlighted fields\.'\)\)\)/);
});
