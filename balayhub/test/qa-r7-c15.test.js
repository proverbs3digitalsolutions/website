// QA round 7, lane C15: More sheet focus trap + Close button, date range width, statement header wrap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/app.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
const rule = (sel) => {
  const i = css.indexOf(`${sel} {`);
  assert.ok(i >= 0, `rule ${sel} exists`);
  return css.slice(i, css.indexOf('}', i));
};
const openMore = app.slice(app.indexOf('function openMore'), app.indexOf('const initials'));

test('#37 openMore focuses the first item on open', () => {
  assert.match(openMore, /sheet\.showModal\(\);[\s\S]*querySelector\('a\[href\], button:not\(\[disabled\]\)'\)\?\.focus\(\)/);
});

test('#37 Shift+Tab from the first item, the sheet container or the dialog wraps to the last', () => {
  assert.match(openMore, /document\.activeElement === first \|\| document\.activeElement === sheet \|\| document\.activeElement === panel/);
  assert.match(openMore, /!sheet\.contains\(document\.activeElement\)/);
});

test('#40 a named Close button, 44px, is in the sheet and closes it', () => {
  assert.match(openMore, /'aria-label': 'Close menu'/);
  assert.match(openMore, /morenav__close/);
  assert.match(rule('.morenav__sheet .morenav__close'), /min-height: 44px/);
});

test('#14 date inputs in .flt__range have a min-width wide enough for a full date', () => {
  assert.match(rule('.flt__range input[type=date]'), /min-width: 9\.5rem/);
});

test('#33 statement header text wraps long unbroken names', () => {
  const r = rule('.statement .receipt__head > div');
  assert.match(r, /overflow-wrap: anywhere/);
  assert.match(r, /min-width: 0/);
});
