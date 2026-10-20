// R25 CSS: app-focused headings show no focus ring (GST-2); Bulk changes listing box is taller and shows a scroll cue (MNY-4).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/app.css'), 'utf8');

test('GST-2: focused h1/h2 (tabindex -1) lose the ring, after the global rule; controls keep it', () => {
  const global = css.indexOf(':focus-visible { outline: 2px solid var(--focus-ring)');
  const rule = css.indexOf('h1[tabindex="-1"]:focus-visible, h2[tabindex="-1"]:focus-visible { outline: none; }');
  assert.ok(global >= 0 && rule > global, 'heading rule follows the global focus rule');
  assert.doesNotMatch(css, /(^|\n)(button|a|input|select|textarea)[^{\n]*:focus-visible \{ outline: none; \}/);
});

test('MNY-4: .pr-picklist shows ~6 rows and has a scroll shadow', () => {
  const m = css.match(/\.pr-picklist \{[^}]*\}/);
  assert.ok(m);
  assert.match(m[0], /max-height: 300px/);
  assert.match(m[0], /overflow: auto/);
  assert.match(m[0], /local/);
  assert.match(m[0], /scroll/);
  assert.doesNotMatch(m[0], /#[0-9a-f]{3,6}\b|rgba?\(/i, 'tokens only');
});
