// QA round 28, FOCUSTOP: keyboard focus clears the sticky top bar (WCAG 2.4.11, D-110).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

// Top-level rules only: strip @media blocks (one level of nesting) before scanning.
const outsideMedia = (src) => {
  let out = '', depth = 0, i = 0;
  while (i < src.length) {
    const at = src.indexOf('@media', i);
    if (at < 0) { out += src.slice(i); break; }
    out += src.slice(i, at);
    let j = src.indexOf('{', at); depth = 1; j++;
    while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    i = j;
  }
  return out;
};

test('html:has(.topbar) pads focus scroll by the top bar height, at every width', () => {
  const m = /html:has\(\.topbar\)\s*\{([^}]*)\}/.exec(outsideMedia(css));
  assert.ok(m, 'rule must exist outside any media query');
  assert.match(m[1], /scroll-padding-top:\s*calc\(var\(--topbar-h\)\s*\+\s*8px\)/);
});

test('the phone bottom-bar scroll padding is unchanged', () => {
  assert.ok(css.includes('@media (max-width: 959px) { html { scroll-padding-bottom: calc(var(--bottomnav-h) + 16px + env(safe-area-inset-bottom)); } }'));
});
