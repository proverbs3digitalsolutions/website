'use strict';
require('./helpers');

// QA r44 GUESTHOLD (GST44-1 / contract C2, D-126): a link inside a guest page (a listing card, a link back to the host page) that opens
// another guest page left focus on the page body for the whole load. D-125 covered only the signed-in pages. The public branch of the
// router now puts a placeholder (div.page-hold, tabindex -1, no focus ring) in place while the view loads, when the press was inside the
// page; the drawn page replaces it and its heading takes focus. Frontend only: no database.
//
// R44_HOLD_DIR (optional) points the checks at another copy of public/ (used to prove the test red on an older tree).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = process.env.R44_HOLD_DIR || path.join(__dirname, '../public');
const app = fs.readFileSync(path.join(PUBLIC, 'js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'css/app.css'), 'utf8');

// holdFocusWhileLoading is taken out of the file text and run, as qa-r43-routefocus does.
const holdStart = app.indexOf('export function holdFocusWhileLoading');
const holdFocusWhileLoading = holdStart < 0 ? null : new Function(`${app.slice(holdStart, app.indexOf('\n}', holdStart) + 2).replace('export function', 'function')}; return holdFocusWhileLoading;`)();

// The public branch's placement, taken out of the file text and run: from its mount line to the title reset that follows the view.
const PUB_FROM = "    const mount = h('div');";
const PUB_TO = '    document.title = RESET_TITLE;';
const pubPlacement = app.slice(app.indexOf(PUB_FROM), app.indexOf(PUB_TO, app.indexOf(PUB_FROM)));
const placeGuestPage = new Function('h', 'app', 'document', 'holdFocusWhileLoading', 'restoreTo', `${pubPlacement} return mount;`);

// A stand-in page. `app` records what is put in it; `document` says which node has focus; every element records its focus and attributes.
function stage({ pressedInside }) {
  const log = [];
  const h = (tag, props = {}) => ({
    tag,
    className: props.class || '',
    attrs: {},
    isConnected: false,
    setAttribute(name, value) { this.attrs[name] = value; log.push(['setAttribute', this.className || this.tag, name, value]); },
    focus(opts) { log.push(['focus', this.className || this.tag, opts]); },
  });
  const pressed = { tag: 'a', className: 'listing-card', attrs: {}, isConnected: true, setAttribute() {}, focus() {} };
  const body = { tag: 'body' };
  const page = {
    children: [pressed],
    contains: (node) => pressedInside && node === pressed,
    replaceChildren(...kids) {
      for (const c of this.children) c.isConnected = false;
      this.children = kids;
      for (const c of kids) c.isConnected = true;
      log.push(['replaceChildren', kids.map((k) => k.className || k.tag)]);
    },
  };
  const document = { activeElement: pressedInside ? pressed : body };
  return { log, h, page, document };
}

test('holdFocusWhileLoading: a page area that was focused is held (tabindex -1, focus without a scroll) and true comes back', () => {
  assert.ok(holdFocusWhileLoading, 'holdFocusWhileLoading is exported from app.js');
  const calls = [];
  const content = { isConnected: true, setAttribute: (n, v) => calls.push(['setAttribute', n, v]), focus: (o) => calls.push(['focus', o]) };
  assert.equal(holdFocusWhileLoading(content, true), true);
  assert.deepEqual(calls, [['setAttribute', 'tabindex', '-1'], ['focus', { preventScroll: true }]]);
});

test('guest page, focus was on a control inside the page: a div.page-hold (tabindex -1) holds focus while the view loads, and the mount is not yet in the page', () => {
  assert.ok(placeGuestPage, 'the public branch placement is in app.js');
  const s = stage({ pressedInside: true });
  const mount = placeGuestPage(s.h, s.page, s.document, holdFocusWhileLoading, null);
  assert.equal(s.page.children.length, 1, 'one child on the page while the view loads');
  const hold = s.page.children[0];
  assert.equal(hold.className, 'page-hold', 'the placeholder is a div.page-hold');
  assert.equal(hold.tag, 'div');
  assert.equal(hold.attrs.tabindex, '-1', 'the placeholder is not a Tab stop, only a focus target');
  assert.deepEqual(s.log.filter((e) => e[0] === 'focus'), [['focus', 'page-hold', { preventScroll: true }]], 'the placeholder takes focus once, without a scroll');
  assert.equal(mount.isConnected, false, 'the new page is drawn later, in the placeholder\'s place');
});

test('guest page, focus was on BODY (nothing pressed in the page): the mount goes straight in and nothing is focused', () => {
  const s = stage({ pressedInside: false });
  const mount = placeGuestPage(s.h, s.page, s.document, holdFocusWhileLoading, null);
  assert.equal(s.page.children.length, 1);
  assert.equal(s.page.children[0], mount, 'the page area holds the mount, as before');
  assert.equal(mount.className, '', 'no placeholder');
  assert.deepEqual(s.log.filter((e) => e[0] === 'focus' || e[0] === 'setAttribute'), [], 'nothing is focused or marked');
});

test('a Back that restores a place keeps the old page on screen: nothing is replaced while the view loads', () => {
  const s = stage({ pressedInside: true });
  const mount = placeGuestPage(s.h, s.page, s.document, holdFocusWhileLoading, 240);
  assert.deepEqual(s.log.filter((e) => e[0] === 'replaceChildren'), [], 'no replaceChildren');
  assert.equal(mount.isConnected, false);
});

test('render (public branch): the press is read before the swap, the hold is put in and held before the view, and the drawn page replaces it after', () => {
  const pub = app.slice(app.indexOf(PUB_FROM), app.indexOf(PUB_TO, app.indexOf(PUB_FROM)));
  const at = (s) => { assert.ok(pub.includes(s), `public branch has: ${s}`); return pub.indexOf(s); };
  const read = at('const pressedInPage = app.contains(document.activeElement);');
  const hold = at("const hold = pressedInPage ? h('div', { class: 'page-hold' }) : null;");
  const swap = at('app.replaceChildren(hold || mount);');
  const held = at('holdFocusWhileLoading(hold, pressedInPage);');
  assert.ok(read < hold && hold < swap && swap < held, 'read, then the placeholder, then the swap, then the hold');
  assert.equal(pub.split('holdFocusWhileLoading(hold, pressedInPage);').length - 1, 1, 'one call in the public branch');
  assert.equal(pub.split('if (restoreTo === null) {').length - 1, 1, 'the placement only runs when no place is restored');
  const afterView = app.slice(app.indexOf('await route.view(mount, ctx); } catch', app.indexOf(PUB_FROM)));
  assert.ok(afterView.indexOf('await route.view(mount, ctx);') < afterView.indexOf('if (!mount.isConnected) app.replaceChildren(mount);'), 'the drawn page is put in after the view');
  assert.ok(afterView.indexOf('if (!mount.isConnected) app.replaceChildren(mount);') < afterView.indexOf('focusPageHeading(mount);'), 'the drawn page replaces the placeholder before its heading takes focus');
});

test('app.css: the placeholder draws no focus ring, on the rule directly after the main area rule', () => {
  const main = css.indexOf('main[tabindex="-1"]:focus-visible { outline: none; }');
  const hold = css.indexOf('.page-hold[tabindex="-1"]:focus-visible { outline: none; }');
  assert.ok(main >= 0, 'the main area rule is still there (qa-r43-routefocus)');
  assert.ok(hold > main, 'the placeholder rule comes after the main area rule');
  assert.equal(css.split('.page-hold[tabindex="-1"]:focus-visible { outline: none; }').length - 1, 1, 'one placeholder rule');
  assert.match(css.slice(main, hold), /\/\* The placeholder that holds focus while a guest page loads is not a control either \(D-126\)\. \*\/\s*$/);
});
