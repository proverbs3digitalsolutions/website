'use strict';

// QA round 22, GST-2: the check-in form clears a field's error as soon as that field is fixed (D-103).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/checkin.js'), 'utf8');
const start = src.indexOf('const clearFieldError');
const body = src.slice(start, src.indexOf('form.addEventListener', start));

test('the form listens for input and change, before the submit handler', () => {
  assert.match(src, /form\.addEventListener\('input', clearFieldError\)/);
  assert.match(src, /form\.addEventListener\('change', clearFieldError\)/);
  assert.ok(src.indexOf("form.addEventListener('change', clearFieldError)") < src.indexOf("form.addEventListener('submit'"));
});

// A tiny stand-in form: wraps with classes, an .error text and marked inputs.
function wrap(name) {
  const classes = new Set(['field--invalid']);
  const input = { attrs: new Set(['aria-invalid']), removeAttribute(a) { this.attrs.delete(a); } };
  const err = { textContent: 'bad' };
  const w = {
    name, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    querySelectorAll: () => [input], querySelector: () => err, input, err, classes,
  };
  input.closest = (sel) => (sel === '[data-field]' ? w : null);
  input.name = name;
  return w;
}

test('fixing one field clears only that field, and the banner goes with the last one', () => {
  const wraps = [wrap('lead_name'), wrap('consent')];
  let banner = 'shown';
  const form = { querySelector: () => (wraps.some((w) => w.classes.has('field--invalid')) ? {} : null) };
  const others = { querySelector: () => null };
  const formError = { replaceChildren: () => { banner = ''; } };
  const clearFieldError = new Function('form', 'others', 'formError', `${body}; return clearFieldError;`)(form, others, formError);
  clearFieldError({ target: wraps[0].input });
  assert.equal(wraps[0].err.textContent, '');
  assert.equal(wraps[0].input.attrs.has('aria-invalid'), false);
  assert.equal(wraps[1].err.textContent, 'bad');
  assert.equal(banner, 'shown');
  clearFieldError({ target: wraps[1].input });
  assert.equal(banner, '');
});

test('the Other guests message stays while a blank guest row is still marked', () => {
  const g = wrap('guests');
  const row = { classes: new Set(['field--invalid']), classList: { remove(c) { row.classes.delete(c); }, contains: (c) => row.classes.has(c) } };
  const row2 = { classes: new Set(['field--invalid']) };
  const inp = { closest: (sel) => (sel === '.gc__guest' ? row : sel === '[data-field]' ? g : null) };
  const others = { querySelector: () => (row2.classes.size ? {} : null) };
  const form = { querySelector: () => null };
  const fn = new Function('form', 'others', 'formError', `${body}; return clearFieldError;`)(form, others, { replaceChildren() {} });
  fn({ target: inp });
  assert.equal(row.classes.size, 0);
  assert.equal(g.err.textContent, 'bad');
  row2.classes.clear();
  fn({ target: inp });
  assert.equal(g.err.textContent, '');
});
