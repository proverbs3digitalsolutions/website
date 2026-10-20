'use strict';
require('./helpers');

// QA round 31, lane MODALFOOT (LT-2): a long dialog form keeps its action row in view. Source scan of public/css/app.css, comments stripped.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const decls = (sel, src = css) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) if (m[1].split(',').map((s) => s.trim()).includes(sel)) out.push(m[2]);
  return out.join(' ');
};

test('the form action row sticks to the bottom of the dialog body on a token background', () => {
  const d = decls('.modal__body > .form > .form-actions:last-child');
  assert.match(d, /position:\s*sticky/);
  assert.match(d, /bottom:\s*-20px/);
  assert.match(d, /background:\s*var\(--surface\)/);
  assert.match(d, /box-shadow:[^;]*var\(--line\)/);
  assert.doesNotMatch(d, /!important|#[0-9a-f]{3,8}\b/i);
});

test('the dialog and its sticky row share one background token', () => {
  assert.match(decls('dialog.modal'), /background:\s*var\(--surface\)/);
});

test('the dialog body keeps a focused field clear of the action row', () => {
  assert.match(decls('.modal__body'), /scroll-padding-bottom:\s*88px/);
});

test('on phones the body is capped so the bottom sheet does not scroll as well', () => {
  const at = css.indexOf('@media (max-width: 559px) {\n  dialog.modal');
  assert.ok(at >= 0, 'phone dialog block exists');
  const m = css.slice(at, css.indexOf('\n}', at));
  assert.match(m, /\.modal__body\s*\{[^}]*max-height:\s*calc\(92vh - 72px\)/);
});
