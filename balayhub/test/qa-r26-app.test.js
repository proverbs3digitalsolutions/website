'use strict';

// QA r26 APP (PHN-1, PHN-2, OPS-2, PHN-3): a removed layer hands focus to the heading; Back onto the same address redraws when a
// layer is open; one Tab stop per tab list. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(process.env.APP_SRC || path.join(__dirname, '../public/js/app.js'), 'utf8');
const grab = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

test('d2: render notes a layer holding focus before the sweep and refocuses the heading after both draws', () => {
  const i = app.indexOf("const layerHadFocus = Boolean(document.activeElement?.closest?.('dialog.modal, .morenav, .tb-sheet'));");
  assert.ok(i > 0, 'layerHadFocus is computed');
  assert.ok(i < app.indexOf("document.querySelectorAll('dialog.modal, .morenav, .tb-sheet').forEach((d) => d.remove());"), 'before the sweep');
  assert.equal((app.match(/if \(layerHadFocus\) focusPageHeading\(mount\);/g) || []).length, 2);
  assert.match(app, /export const headingFocusDue = \(\{ drawnPath, path, prevKept, redirected, addressChange \}\)/, 'signature unchanged');
});

test('d3: popstate on the same hash with a layer open redraws; otherwise nothing', () => {
  const body = grab("window.addEventListener('popstate'", '\n});');
  assert.ok(body, 'popstate listener exists');
  // Run the handler body with fakes: location, lastHash, document, focusFree, render, and a setter for viaAddress.
  const handler = (hash, last, layer) => {
    const log = { drew: 0, via: 'unset' };
    const src = body.replace("window.addEventListener('popstate', () => {", '').trim().replace('viaAddress = focusFree();', 'set(focusFree());');
    new Function('location', 'lastHash', 'document', 'focusFree', 'render', 'set', src)(
      { hash }, last, { querySelector: () => (layer ? {} : null) }, () => true, () => { log.drew += 1; }, (v) => { log.via = v; });
    return log;
  };
  assert.deepEqual(handler('#/r?view=a', '#/r?view=a', true), { drew: 1, via: true }, 'same hash, layer open');
  assert.equal(handler('#/r?view=a', '#/r?view=a', false).drew, 0, 'same hash, no layer');
  assert.equal(handler('#/b', '#/r?view=a', true).drew, 0, "different hash is hashchange's job");
  assert.match(app, /window\.addEventListener\('hashchange', \(\) => \{ viaAddress = focusFree\(\); render\(\); \}\);/, 'hashchange untouched');
});

// A tiny tab list: enough DOM for rovingTabs. Each tab is [selected, disabled].
function fake(lists) {
  const built = lists.map((set) => {
    const l = { items: [], querySelectorAll() { return this.items; } };
    l.items = set.map(([sel, dis]) => ({ attrs: { 'aria-selected': sel ? 'true' : 'false' }, disabled: Boolean(dis), getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = v; }, closest() { return l; } }));
    return l;
  });
  return { root: { querySelectorAll: () => built }, built };
}
function rovingTabs() {
  const src = grab('export function rovingTabs', '// One handler for every tablist');
  assert.ok(src, 'rovingTabs exists');
  return new Function(`${src.replace('export function', 'function')}; return rovingTabs;`)();
}
const stops = (l) => l.items.map((t) => t.attrs.tabindex);

test('j: rovingTabs gives the selected tab the only Tab stop', () => {
  const rt = rovingTabs();
  const w = fake([[[false], [true], [false]]]);
  rt(w.root);
  assert.deepEqual(stops(w.built[0]), ['-1', '0', '-1']);
  const none = fake([[[false], [false], [false]]]);
  rt(none.root);
  assert.deepEqual(stops(none.built[0]), ['0', '-1', '-1'], 'none selected: first');
  const dis = fake([[[false, true], [false], [false]]]);
  rt(dis.root);
  assert.deepEqual(stops(dis.built[0]), ['-1', '0', '-1'], 'disabled first skipped');
  const items = w.built[0].items;
  items[1].attrs['aria-selected'] = 'false'; items[2].attrs['aria-selected'] = 'true';
  rt(w.root);
  assert.deepEqual(stops(w.built[0]), ['-1', '-1', '0'], 'the stop moves with the selection');
  const two = fake([[[true], [false]], [[false], [true]]]);
  rt(two.root);
  assert.deepEqual(two.built.map(stops), [['0', '-1'], ['-1', '0']], 'each list on its own');
  assert.doesNotThrow(() => rt(null));
});

test('j: rovingTabs runs after both draws and from one guarded observer that never watches tabindex', () => {
  assert.equal((app.match(/rovingTabs\(mount\);/g) || []).length, 2);
  assert.match(app, /typeof MutationObserver === 'function'\) new MutationObserver\(\(records\) => \{ if \(touchesTabs\(records\)\) rovingTabs\(document\.body\); \}\)\.observe\(document\.body, \{ childList: true, subtree: true, attributes: true, attributeFilter: \['aria-selected'\] \}\)/);
  assert.ok(app.indexOf('installFocusGuard();\n  render();\n  if (typeof MutationObserver') > 0, 'after installFocusGuard, beside the pinned render()');
});
