'use strict';

// QA r14 F1 (D-90): the persistent top bar shell. topbarButtons and isSlashShortcut are pure and run in node from a temp
// copy (stub Element, as in qa-r13-f01); the shell rules (built once, updated in place), the focus rules and the CSS contract
// are source scans, with comments stripped. Frontend-only: no database.
// The ui.js edits (icons, tb-sheet layer) and the app.css shell lines belong to lanes U1 and P1; their tests live there.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public/js');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let m;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r14f1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'themeswitch.js', 'topbar.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  m = await import(pathToFileURL(path.join(dir, 'topbar.js')));
});

// ------------------------------------------------------------------ topbarButtons
const user = (o = {}) => ({ role: 'owner', business_type: 'short_term', plan: {}, ...o });

test('topbarButtons: owner in a short-term workspace sees every control', () => {
  assert.deepEqual(m.topbarButtons(user()), ['search', 'bookmarks', 'add', 'bell', 'help', 'profile']);
  assert.deepEqual(m.topbarButtons(user({ role: 'manager', business_type: 'both' })), ['search', 'bookmarks', 'add', 'bell', 'help', 'profile']);
  assert.deepEqual(m.topbarButtons(user({ role: 'staff' })), ['search', 'bookmarks', 'add', 'bell', 'help', 'profile']);
});

test('topbarButtons: a cleaner has no Add new', () => {
  assert.deepEqual(m.topbarButtons(user({ role: 'cleaner' })), ['search', 'bookmarks', 'bell', 'help', 'profile']);
});

test('topbarButtons: a long-term workspace has no bell', () => {
  assert.deepEqual(m.topbarButtons(user({ business_type: 'long_term' })), ['search', 'bookmarks', 'add', 'help', 'profile']);
});

test('topbarButtons: a read-only or demo workspace has no Add new', () => {
  assert.deepEqual(m.topbarButtons(user({ plan: { read_only: true } })), ['search', 'bookmarks', 'bell', 'help', 'profile']);
  assert.deepEqual(m.topbarButtons(user({ plan: { is_demo: true } })), ['search', 'bookmarks', 'bell', 'help', 'profile']);
});

// ------------------------------------------------------------------ isSlashShortcut
const doc = (o = {}) => ({ querySelector: (sel) => ({ 'dialog[open]': o.dialog ? {} : null, '.topbar': o.noBar ? null : {} })[sel] ?? null });
const ev = (o = {}) => ({ key: '/', ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'BODY', isContentEditable: false, closest: () => null }, ...o });

test('isSlashShortcut: a plain "/" on the page body', () => {
  assert.equal(m.isSlashShortcut(ev(), doc()), true);
});

test('isSlashShortcut: not with Ctrl, Meta or Alt, and not for another key', () => {
  assert.equal(m.isSlashShortcut(ev({ ctrlKey: true }), doc()), false);
  assert.equal(m.isSlashShortcut(ev({ metaKey: true }), doc()), false);
  assert.equal(m.isSlashShortcut(ev({ altKey: true }), doc()), false);
  assert.equal(m.isSlashShortcut(ev({ key: 'a' }), doc()), false);
});

test('isSlashShortcut: not while typing in a field', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(m.isSlashShortcut(ev({ target: { tagName, closest: () => null } }), doc()), false, tagName);
  assert.equal(m.isSlashShortcut(ev({ target: { tagName: 'DIV', isContentEditable: true, closest: () => null } }), doc()), false);
  assert.equal(m.isSlashShortcut(ev({ target: { tagName: 'DIV', closest: (s) => (s === '[contenteditable]' ? {} : null) } }), doc()), false);
});

test('isSlashShortcut: not with a dialog open, and not without the shell top bar', () => {
  assert.equal(m.isSlashShortcut(ev(), doc({ dialog: true })), false);
  assert.equal(m.isSlashShortcut(ev(), doc({ noBar: true })), false);
});

test('the module exports the whole contract', () => {
  for (const name of ['buildTopbar', 'updateTopbar', 'topbarButtons', 'isSlashShortcut', 'installTopbarKeys', 'popover', 'closeTopbarLayers']) assert.equal(typeof m[name], 'function', name);
});

// ------------------------------------------------------------------ app.js: built once, updated in place
const app = strip(read('public/js/app.js'));
const fnBody = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0; let i = open;
  for (; i < src.length; i += 1) { if (src[i] === '{') depth += 1; else if (src[i] === '}' && !(depth -= 1)) break; }
  return src.slice(open, i + 1);
};

test('app.js: buildShell builds the top bar through buildTopbar; updateShell only updates it', () => {
  assert.match(fnBody(app, 'buildShell'), /buildTopbar\(/);
  const upd = fnBody(app, 'updateShell');
  assert.match(upd, /updateTopbar\(/);
  assert.doesNotMatch(upd, /buildTopbar\(/);
  assert.doesNotMatch(upd, /\.topbar'?\)?\.replaceWith/);
  assert.doesNotMatch(upd, /h\('header'/);
});

test('app.js: the shell key is the round 13 key (the bar needs no new field)', () => {
  const key = app.slice(app.indexOf('const shellKey'), app.indexOf('function updateShell')).replace(/\s+/g, ' ');
  assert.match(key, /JSON\.stringify\(\[u\.user_id, u\.role, u\.full_name, u\.organization_id, u\.organization_name, u\.business_type, u\.is_platform_admin, navFor\(u\)\.map\(\(n\) => n\[0\]\), bottomNav\(\)\.map\(\(n\) => n\[0\]\)\]\)/);
});

test('app.js: the context is injected (read when used), the layers are cleared on render, the keys are installed once', () => {
  assert.match(app, /const topbarCtx = \{/);
  const ctxSrc = app.slice(app.indexOf('const topbarCtx'), app.indexOf('const topbarCtx') + 500);
  for (const k of ['user:', 'path:', 'hash:', 'nav:', 'navigate', 'logout', 'routeAllowed']) assert.ok(ctxSrc.includes(k), `ctx has ${k}`);
  assert.match(app, /document\.querySelectorAll\('dialog\.modal, \.morenav, \.tb-sheet'\)\.forEach\(\(d\) => d\.remove\(\)\)/);
  assert.match(app, /e\.target\.closest\('\.bottomnav, \.assist, \.morenav, \.tb-pop, dialog'\)/);
  assert.match(app, /installTopbarKeys\(topbarCtx\);/);
  assert.equal(app.split('installTopbarKeys(').length - 1, 1);
  assert.match(app, /import \{[^}]*\bbuildTopbar\b[^}]*\} from '\.\/topbar\.js'/);
});

test('app.js: the old inline header and the workspace-name link are gone; the Ask slot and the avatar class survive', () => {
  assert.doesNotMatch(app, /h\('header', \{ class: 'topbar' \}/);
  assert.doesNotMatch(app, /topbar__org/);
  const bar = strip(read('public/js/topbar.js'));
  assert.match(bar, /'topbar__assist'/);
  assert.match(bar, /topbar__me tb__avatar/);
});

// ------------------------------------------------------------------ focus and imports
test('topbar.js: no focus put back by hand after a redraw, and no top bar module imports app.js', () => {
  const bar = strip(read('public/js/topbar.js'));
  assert.doesNotMatch(bar, /(rerender|load)\([^)]*\)\s*;?\s*[\w.?()]*\.focus\(/);
  assert.doesNotMatch(bar, /setTimeout\([^)]*focus/);
  for (const f of fs.readdirSync(JS).filter((n) => /^top.*\.js$/.test(n))) assert.doesNotMatch(strip(read(`public/js/${f}`)), /from\s+['"]\.\/app\.js['"]/, `${f} must not import app.js`);
});

test('topbar.js: no window scroll code, no inline script or style attributes, no innerHTML', () => {
  const bar = strip(read('public/js/topbar.js'));
  assert.doesNotMatch(bar, /window\.scrollTo\(|scrollY|pageYOffset/);
  assert.doesNotMatch(bar, /innerHTML|insertAdjacentHTML|setAttribute\('style'/);
});

test('topbar.js: the panels are dynamic imports of their own modules, with the failure toast', () => {
  const bar = strip(read('public/js/topbar.js'));
  for (const f of ['topadd.js', 'topnotify.js', 'tophelp.js', 'topbookmarks.js', 'topsearch.js']) assert.ok(bar.includes(`./${f}`), f);
  assert.ok(bar.includes("Couldn't open this. Check your connection and try again."));
  assert.doesNotMatch(bar, /^import .*top(add|notify|help|bookmarks|search)\.js/m);
});

test('topbar.js: the exact labels and keys of the controls', () => {
  const bar = strip(read('public/js/topbar.js'));
  for (const s of ["'Bookmarks'", "'Add new'", "'Help'", "'Notifications'", "'Search'", "'tb-bookmarks'", "'tb-add'", "'tb-bell'", "'tb-help'", "'tb-profile'", "'Close search'", "'My account'", "'Help & support'", "'Log out'", "'Settings'"]) assert.ok(bar.includes(s), s);
  assert.match(bar, /'data-focus-key': 'tb-profile'/);
  assert.match(bar, /\$\{u\.full_name\}, account menu/);
});

// ------------------------------------------------------------------ topbar.css
const css = strip(read('public/css/topbar.css'));
const CLASSES = ['tb__search', 'tb__actions', 'tb__icon', 'tb__badge', 'tb__avatar', 'tb-desktop-only', 'tb-phone-only', 'tb-kbd', 'tb-pop', 'tb-pop--wide',
  'tb-pop__head', 'tb-pop__title', 'tb-pop__body', 'tb-pop__foot', 'tb-list', 'tb-item', 'tb-item__title', 'tb-item__sub', 'tb-item__meta', 'tb-item--unread',
  'is-active', 'tb-group-title', 'tb-chips', 'tb-empty', 'tb-status', 'tb-sep', 'tb-sheet', 'tb-sheet__head'];

test('topbar.css defines every class in the contract', () => {
  for (const c of CLASSES) assert.ok(new RegExp(`\\.${c}(?![\\w-])`).test(css), `.${c}`);
});

test('topbar.css: tokens only and no !important', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla)\(/);
});

test('topbar.css: under 960px the icon buttons and panel rows are 44px; panels are a full-width layer', () => {
  const start = css.indexOf('@media (max-width: 959px)');
  assert.ok(start >= 0);
  const phone = css.slice(start);
  for (const sel of ['.tb__icon', '.tb-item', '.tb-chips [role="tab"]', '.tb-pop .btn', '.tb-sheet__head button']) assert.ok(phone.includes(sel), sel);
  assert.match(phone, /min-height:\s*44px/);
  assert.match(phone, /min-width:\s*44px/);
  assert.match(phone, /position:\s*fixed/);
  assert.match(phone, /100dvh/);
});

test('topbar.css: desktop bar is 64px, panels sit at z 35, the search sheet at z 50', () => {
  assert.match(css, /--topbar-h:\s*64px/);
  assert.match(css, /height:\s*var\(--topbar-h\)/);
  assert.match(css, /\.tb-pop\s*\{[^}]*z-index:\s*35/);
  assert.match(css, /\.tb-sheet\s*\{[^}]*z-index:\s*50/);
  assert.match(css, /prefers-reduced-motion/);
});

test('index.html links topbar.css right after app.css', () => {
  const html = read('public/index.html');
  const a = html.indexOf('href="/css/app.css"');
  const t = html.indexOf('href="/css/topbar.css"');
  assert.ok(a > 0 && t > a, 'topbar.css comes after app.css');
  assert.ok(t < html.indexOf('type="module"'), 'before the app script');
});

test('logout() clears this person\'s recent searches (shared machines), with the key topsearch.js uses', () => {
  const out = fnBody(app, 'logout').replace(/\s+/g, ' ');
  assert.match(out, /try \{ localStorage\.removeItem\(`bh-recent-search-\$\{state\.user\?\.user_id \?\? 'x'\}`\); \} catch/);
  assert.ok(out.indexOf('bh-recent-search-') < out.indexOf('state.user = null'), 'removed before the user is cleared');
  assert.ok(strip(read('public/js/topsearch.js')).includes("`bh-recent-search-${user?.user_id ?? 'x'}`"), 'same key format as topsearch.js');
});

test('avatar menu: menu lists own only menu items and separators; the theme switch sits between the lists, right after Settings (axe aria-required-children)', () => {
  const bar = strip(read('public/js/topbar.js'));
  const fn = bar.slice(bar.indexOf('function buildProfile'));
  const theme = fn.indexOf("h('div', { class: 'tb-theme'");
  assert.ok(theme > fn.indexOf("item(row('settings'") && theme < fn.indexOf("item(row('bookmark'"), 'the theme row comes after Settings and before Bookmarks');
  for (const ul of fn.split("h('ul'").slice(1)) assert.doesNotMatch(ul.slice(0, ul.indexOf("h('div', { class: 'tb-theme'") > 0 ? ul.indexOf("h('div', { class: 'tb-theme'") : undefined).replace(/themeSwitch\(/g, ''), /role: 'radiogroup'|tb-theme/, 'no theme row inside a ul');
  assert.match(fn, /themeSwitch\(\{ compact: true \}\)/);
});

test('sidebar More tools summary is at least 24px tall on desktop (axe target-size)', () => {
  const sheet = strip(read('public/css/app.css'));
  const m = sheet.match(/details\.nav__group--more > summary\.nav__group-title \{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /min-height:\s*(2[4-9]|[3-9]\d)px/);
});

test('topbar.css: the search extras box hides when empty, the hidden listbox stays hidden, Clear is a 24px button (44px on phones)', () => {
  assert.match(css, /\.tb-extras:empty\s*\{[^}]*display:\s*none/);
  assert.match(css, /#tb-results\[hidden\]\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.tb-clear\s*\{[^}]*min-height:\s*(2[4-9]|[3-9]\d)px/);
  assert.match(css.slice(css.indexOf('@media (max-width: 959px)')), /\.tb-clear[^{]*\{[^}]*min-height:\s*44px|\.tb-clear[^{]*,[^{]*\{[^}]*min-height:\s*44px|min-height:\s*44px/);
  const phone = css.slice(css.indexOf('@media (max-width: 959px)'));
  assert.ok(/[^{}]*\.tb-clear[^{}]*\{[^}]*min-height:\s*44px/.test(phone), '.tb-clear is in a 44px phone rule');
});

test('avatar menu Bookmarks / Help: focus moves to the avatar (which stays on the page) before the menu closes, then the panel opens', () => {
  const bar = strip(read('public/js/topbar.js'));
  for (const pop of ['bookmarksPop', 'helpPop']) {
    const re = new RegExp(`me\\.focus\\(\\); done\\(\\); ${pop}\\.open\\(me\\);`);
    assert.match(bar, re, pop);
  }
});

test('topbar.css: the phone-only menu rows are hidden at 960px and up with a selector that beats the list styles', () => {
  const start = css.indexOf('@media (min-width: 960px)');
  const desk = css.slice(start, css.indexOf('@media (max-width: 959px)'));
  assert.match(desk, /\.tb-pop \.tb-phone-only[^{]*\{[^}]*display:\s*none/);
});
