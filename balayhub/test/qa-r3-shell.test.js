'use strict';

// QA round 3, lane C08 (shell). Two findings:
// - longterm#10: on a phone the floating Ask button covers stat labels. Below 960px it now sits in the top bar (the slot app.js leaves
//   before the account link), and it floats over the page only on desktop.
// - phone#22 (WCAG 2.4.11): Tab can reach a control that sits under the bottom bar. A focusin guard scrolls it clear on phones.
// Frontend-only: no database. app.js imports every view, so it is read as text, and its focus guard runs from that text with stub
// window, document and Element objects. assistant.js is loaded from a temp copy with stub api.js, ui.js and app.js modules, as in
// qa-r2-help-client.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_SRC = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const ASSISTANT_SRC = fs.readFileSync(path.join(__dirname, '../public/js/assistant.js'), 'utf8');

test('the top bar leaves an empty slot for the Ask button, before the account button', () => {
  // The bar moved out of app.js into topbar.js (QA r14 F1, D-90); app.js builds it through buildTopbar.
  assert.match(APP_SRC, /buildTopbar\(topbarCtx\)/);
  const bar = fs.readFileSync(path.join(__dirname, '../public/js/topbar.js'), 'utf8');
  const header = bar.slice(bar.indexOf("h('header', { class: 'topbar' }"));
  const slot = header.indexOf("h('span', { class: 'topbar__assist' })");
  assert.ok(slot > 0, 'the slot is in the top bar');
  assert.ok(slot < header.indexOf("tb__actions"), 'the slot comes before the account button');
});

test('the shell moves the Ask button into that slot as soon as the shell is on the page', () => {
  assert.match(APP_SRC, /import \{[^}]*\bplaceAssistantButton\b[^}]*\} from '\.\/assistant\.js';/);
  assert.match(APP_SRC, /app\.replaceChildren\(shell\.el\);\n\s*placeAssistantButton\(\);/);
});

test('cleaners still get no Ask button, and the button keeps its label and expanded state', () => {
  assert.match(APP_SRC, /u\.role === 'cleaner' \? null : assistantButton\(\)/);
  assert.match(ASSISTANT_SRC, /'aria-label': 'Ask the BalayHub assistant', 'aria-expanded': 'false'/);
});

test('the button is placed again when the window crosses the phone width', () => {
  assert.match(ASSISTANT_SRC, /'\(max-width: 959px\)'/);
  assert.match(ASSISTANT_SRC, /globalThis\.matchMedia\?\.\(PHONE\)\.addEventListener\('change', placeAssistantButton\)/);
});

// ---- placement, run from assistant.js itself with a stub DOM: a node remembers its parent, which is all placement needs.
function node(name) {
  const n = { name, parent: null, classes: new Set() };
  n.append = (child) => { child.parent = n; };
  n.classList = { toggle: (c, on) => { if (on) n.classes.add(c); else n.classes.delete(c); return Boolean(on); } };
  return n;
}

let assistant;
let page = {};   // the nodes on the page right now, by selector
let phone = false;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-shell-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'api.js'), 'export async function get() { return { enabled: true }; }\nexport async function post() { return {}; }\n');
  fs.writeFileSync(path.join(dir, 'ui.js'), 'export const h = () => null;\nexport const icon = () => null;\nexport const toast = () => null;\nexport const guardPress = () => {};\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null };\nexport const navigate = () => {};\n');
  fs.writeFileSync(path.join(dir, 'assistant.js'), ASSISTANT_SRC);
  assistant = await import(pathToFileURL(path.join(dir, 'assistant.js')));
  globalThis.document = { querySelector: (sel) => page[sel] ?? null };
  globalThis.matchMedia = () => ({ matches: phone });
});
test.after(() => { delete globalThis.document; delete globalThis.matchMedia; });

test('below 960px the Ask button moves into the top-bar slot and is marked as the bar button', () => {
  const fab = node('fab'); const shell = node('shell'); const slot = node('slot');
  shell.append(fab); // as the shell builds it
  page = { '.assist-fab': fab, '.shell': shell, '.topbar__assist': slot };
  phone = true;
  assistant.placeAssistantButton();
  assert.equal(fab.parent, slot);
  assert.ok(fab.classes.has('assist-fab--bar'));
});

test('at 960px and wider the Ask button is in the shell, floating over the page, without the bar class', () => {
  const fab = node('fab'); const shell = node('shell'); const slot = node('slot');
  slot.append(fab); // left in the bar from a phone-width visit
  fab.classes.add('assist-fab--bar');
  page = { '.assist-fab': fab, '.shell': shell, '.topbar__assist': slot };
  phone = false;
  assistant.placeAssistantButton();
  assert.equal(fab.parent, shell);
  assert.ok(!fab.classes.has('assist-fab--bar'));
});

test('on a signed-out page (no shell, no slot, no button) placement does nothing and throws nothing', () => {
  page = {};
  phone = true;
  assert.doesNotThrow(() => assistant.placeAssistantButton());
});

// ---- focus guard: the focusin handler from app.js, run from its source text.
const GUARD_START = "document.addEventListener('focusin', ";
const guardSrc = () => {
  const from = APP_SRC.indexOf(GUARD_START) + GUARD_START.length;
  assert.ok(from > GUARD_START.length, 'a focusin guard is registered in app.js');
  return APP_SRC.slice(from, APP_SRC.indexOf('\n});', from) + 2);
};

class StubElement {
  constructor(bottom, layer = null) { this.bottom = bottom; this.layer = layer; }
  getBoundingClientRect() { return { bottom: this.bottom }; }
  closest(sel) { return this.layer && sel.split(',').some((s) => s.trim() === this.layer) ? {} : null; }
}

// Returns the scrollBy calls the guard makes for a focused element.
function runGuard({ phone: isPhone, hasBar = true, barTop = 700, target }) {
  const scrolls = [];
  const bar = hasBar ? { getBoundingClientRect: () => ({ top: barTop }) } : null;
  const doc = { querySelector: (sel) => (sel === '.bottomnav' ? bar : null) };
  const win = { matchMedia: () => ({ matches: isPhone }), scrollBy: (x, y) => scrolls.push([x, y]) };
  const handler = new Function('document', 'window', 'Element', `return ${guardSrc()};`)(doc, win, StubElement);
  handler({ target });
  return scrolls;
}

test('on a phone a control under the bottom bar is scrolled clear of it, with 16px to spare', () => {
  assert.deepEqual(runGuard({ phone: true, target: new StubElement(760) }), [[0, 76]]);
});

test('on a phone a control clear of the bottom bar is left where it is', () => {
  assert.deepEqual(runGuard({ phone: true, target: new StubElement(650) }), []);
});

test('at 960px and wider the guard does nothing, because there is no bottom bar', () => {
  assert.deepEqual(runGuard({ phone: false, target: new StubElement(760) }), []);
});

test('controls inside the bottom bar itself are not scrolled, or the page would jump for a nav link', () => {
  assert.deepEqual(runGuard({ phone: true, target: new StubElement(790, '.bottomnav') }), []);
});

test('controls in the chat panel or the More sheet are not scrolled, since those layers do not move with the page', () => {
  assert.deepEqual(runGuard({ phone: true, target: new StubElement(760, '.assist') }), []);
  assert.deepEqual(runGuard({ phone: true, target: new StubElement(760, '.morenav') }), []);
});

test('a page with no bottom bar (signed out) does nothing and throws nothing', () => {
  assert.deepEqual(runGuard({ phone: true, hasBar: false, target: new StubElement(760) }), []);
});

test('a focus target that is not an element (the window or document) is ignored', () => {
  assert.deepEqual(runGuard({ phone: true, target: { not: 'an element' } }), []);
});
