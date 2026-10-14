'use strict';

// QA round 6, lane C08 (shell-css). Frontend-only: no database.
// - #30 (and O-a): stacked-card labels such as "Check-in" wrap; the label column is capped by a percentage of its own track.
// - #29: a long daily-close section title pushes its "All clear" badge onto a second line.
// - #8: the inbox filter's Channel and Listing dropdowns are squeezed to 76px by the date range's second column.
// - #12: #/payments/%20 shows a raw JavaScript error instead of the Not found state.
// - #13: the assistant footer says "bookings or guests" on a long-term workspace.
// CSS and app.js are read as text. The router's match() is run from its source text with stub routes and error class.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const rawCss = read('public', 'css', 'app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const appJs = read('public', 'js', 'app.js');
const assistantJs = read('public', 'js', 'assistant.js');

// Rules whose selector list includes `sel` (top level and inside @media blocks).
const rules = (sel) => [...rawCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === sel)).map((m) => m[2]).join(' ');
// Body of the first @media block whose query contains `q`.
function media(q) {
  const i = rawCss.indexOf(`@media ${q}`);
  if (i < 0) return '';
  let depth = 0; let start = -1;
  for (let k = rawCss.indexOf('{', i); k < rawCss.length; k++) {
    if (rawCss[k] === '{') { depth++; if (start < 0) start = k + 1; } else if (rawCss[k] === '}' && --depth === 0) return rawCss.slice(start, k);
  }
  return '';
}

test('stacked-card labels stay on one line and are not capped by a percentage of their own track (#30, O-a)', () => {
  const m = media('screen and (max-width: 559px)');
  const labels = [...m.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((x) => /::before/.test(x[1]) && /table--stack td/.test(x[1])).map((x) => x[2]).join(' ');
  assert.match(labels, /white-space:\s*nowrap/);
  assert.doesNotMatch(labels, /max-width/);
  // The value column keeps wrapping, so only the label is held on one line.
  assert.match(m, /grid-template-columns:\s*fit-content\(45%\) minmax\(0, 1fr\)/);
  assert.match(m, /\.table--stack td\[data-label\]:not\(\[data-label=""\]\) > \*\s*\{[^}]*grid-column:\s*2/);
});

test('daily close section titles wrap inside their space and the status badge stays on the heading line (#29)', () => {
  assert.match(rules('.dc-section .card__head'), /flex-wrap:\s*nowrap/);
  assert.match(rules('.dc-section .card__head'), /align-items:\s*flex-start/);
  assert.match(rules('.dc-section .card__head h2'), /flex:\s*1 1 auto/);
  assert.match(rules('.dc-section .card__head h2'), /min-width:\s*0/);
  assert.match(rules('.dc-section .card__head .badge'), /flex:\s*none/);
});

test('the inbox date range spans the whole filter panel, so the dropdowns keep their width (#8)', () => {
  assert.match(rules('.inbox__filters .flt__field--range'), /grid-column:\s*1 \/ -1/);
});

// ---- router: match() is run from app.js's own source with stub routes and a stub error class.
const matchSrc = (() => {
  const start = appJs.indexOf('function match(path) {');
  assert.ok(start > 0, 'app.js has match()');
  let depth = 0;
  for (let k = appJs.indexOf('{', start); k < appJs.length; k++) {
    if (appJs[k] === '{') depth++;
    else if (appJs[k] === '}' && --depth === 0) return appJs.slice(start, k + 1);
  }
  throw new Error('match() has no closing brace');
})();

class ApiError extends Error {
  constructor(message, { status = 0 } = {}) { super(message); this.status = status; }
}

test('app.js imports the error class the router raises for a blank id', () => {
  assert.match(appJs, /import \{[^}]*\bApiError\b[^}]*\} from '\.\/api\.js';/);
});

test('a blank record id (#/payments/%20) gets the Not found state and never calls the view (#12)', async () => {
  const seen = [];
  const view = async () => { seen.push('payments'); return 'rendered'; };
  const match = new Function('routes', 'ApiError', `${matchSrc}\nreturn match;`)([['/payments/:id', view, 'app']], ApiError);

  const blank = match('/payments/%20');
  assert.ok(blank, 'the route still matches');
  assert.notEqual(blank.view, view, 'the real view is not used for a blank id');
  await assert.rejects(() => blank.view({}, {}), (err) => err.status === 404 && err.message.length > 0);
  assert.equal(match('/payments/%20%20').view === view, false);

  const real = match('/payments/abc');
  assert.equal(real.view, view);
  assert.equal(real.params.id, 'abc');
  assert.equal(seen.length, 0);
});

test('a broken escape (#/payments/%E0%A4%A) gets the same Not found state as a blank id, and never throws (#12)', async () => {
  const seen = [];
  const view = async () => { seen.push('payments'); return 'rendered'; };
  const match = new Function('routes', 'ApiError', `${matchSrc}\nreturn match;`)([['/payments/:id', view, 'app']], ApiError);

  const blank = match('/payments/%20');
  let broken;
  assert.doesNotThrow(() => { broken = match('/payments/%E0%A4%A'); }, 'match() must not throw on a malformed escape');
  assert.ok(broken, 'the route still matches');
  assert.notEqual(broken.view, view, 'the real view is not used for a broken id');
  assert.equal(broken.access, 'app', 'the route keeps its access rule');
  const brokenErr = await broken.view({}, {}).then(() => null, (err) => err);
  const blankErr = await blank.view({}, {}).then(() => null, (err) => err);
  assert.equal(brokenErr?.status, 404);
  assert.equal(brokenErr.message, blankErr.message, 'same message as the blank id');
  assert.equal(seen.length, 0);
});

test('the assistant footer names the data a long-term workspace lacks (#13)', () => {
  assert.match(assistantJs, /longTerm \? 'It can[’']t see your tenants, leases or rent records and may make mistakes\. ' : 'It can[’']t see your bookings or guests and may make mistakes\. '/);
});
