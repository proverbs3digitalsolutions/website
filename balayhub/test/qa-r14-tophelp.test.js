'use strict';

// QA r14 F5: the top bar help panel (public/js/tophelp.js). Frontend-only: no database.
// pageHelpQuery is pure; the module is loaded from a temp folder with stubbed api.js/ui.js so node can import it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FILE = path.join(__dirname, '../public/js/tophelp.js');
const src = () => fs.readFileSync(FILE, 'utf8');

let dir; let mod;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-tophelp-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'api.js'), 'export const get = async () => ({}); export const qs = () => "";\n');
  fs.writeFileSync(path.join(dir, 'ui.js'), 'export const h = () => ({}); export const icon = () => ({}); export const toast = () => {};\n');
  fs.copyFileSync(FILE, path.join(dir, 'tophelp.js'));
  mod = await import(pathToFileURL(path.join(dir, 'tophelp.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('pageHelpQuery maps the first path segment to search words', () => {
  assert.equal(mod.pageHelpQuery('/reservations/abc'), 'reservations');
  assert.equal(mod.pageHelpQuery('/rent'), 'expenses');
  assert.equal(mod.pageHelpQuery('/home'), 'getting started');
  assert.equal(mod.pageHelpQuery('/daily-close?x=1'), 'daily close');
  assert.equal(mod.pageHelpQuery('#/settings'), 'settings');
  assert.equal(mod.pageHelpQuery('/unknown'), '');
  assert.equal(mod.pageHelpQuery(''), '');
  assert.equal(mod.pageHelpQuery(undefined), '');
  assert.equal(mod.pageHelpQuery('/constructor'), '', 'inherited object keys are not pages');
});

test('renderHelp is exported', () => { assert.equal(typeof mod.renderHelp, 'function'); });

test('copy from the plan is verbatim', () => {
  const s = src();
  for (const t of ['Help', 'Search help articles', 'Suggested for this page', 'Browse all help', 'Need a hand?', 'Contact us',
    'No articles found. Try other words, or contact us.', "Couldn't load help articles.", 'Try again']) {
    assert.ok(s.includes(`'${t}'`) || s.includes(`"${t}"`), `missing copy: ${t}`);
  }
});

test('links: Contact us goes to #/help/new, Browse all help to #/help, articles use encodeURIComponent', () => {
  const s = src();
  assert.match(s, /#\/help\/new/);
  assert.match(s, /'#\/help'/);
  assert.match(s, /#\/help\?q=\$\{encodeURIComponent\(/);
  assert.match(s, /class: 'tb-item'/);
});

test('search is debounced at 250ms, uses type=search, a hidden label, and never touches focus or window scroll', () => {
  const s = src();
  assert.match(s, /type: 'search'/);
  assert.match(s, /250/);
  assert.match(s, /sr-only/);
  assert.match(s, /skeleton/);
  assert.doesNotMatch(s, /\.focus\(|scrollTo\(|scrollY|pageYOffset|innerHTML|alert\(|confirm\(/);
  assert.doesNotMatch(s, /from '\.\/app\.js'|from '\.\.\/app\.js'/, 'topbar modules never import app.js');
});
