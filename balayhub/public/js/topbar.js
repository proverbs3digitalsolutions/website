// The top bar (F53, D-90). Built once inside the persistent shell and updated in place on every route change (never rebuilt).
// Each panel lives in its own module and is imported when first needed. This file never imports app.js: app.js hands in `ctx`
// ({ user, path, hash, nav, home, navigate, logout, routeAllowed }), each read when used because the shell outlives the page it was built on.

import { h, icon, brand, toast } from './ui.js';
import { themeSwitch } from './themeswitch.js';

const PHONE = '(max-width: 959px)';
const ROLES = { owner: 'Owner', manager: 'Manager', staff: 'Staff', cleaner: 'Cleaner' };
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';

// Which controls this person gets, in bar order (TOPBAR-PLAN 1.0).
export function topbarButtons(user) {
  const p = user?.plan || {};
  if (p.card_check_due) return ['help', 'profile']; // until the card is confirmed (APP-FLOW 5.10): no search, bookmarks or alerts
  const canAdd = user?.role !== 'cleaner' && !p.read_only && !p.is_demo;
  return ['search', 'bookmarks', canAdd && 'add', user?.business_type !== 'long_term' && 'bell', 'help', 'profile'].filter(Boolean);
}

// The "/" key opens search, but never while typing, with a dialog open, or without the shell's top bar.
export function isSlashShortcut(e, doc) {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target;
  if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || t.closest?.('[contenteditable]'))) return false;
  if (doc.querySelector('.topbar [data-tb="search"]')?.hidden) return false; // search is not offered to this person right now
  return !doc.querySelector('dialog[open]') && Boolean(doc.querySelector('.topbar'));
}

// ---------------------------------------------------------------- popover kit
let current = null; // the one open panel: { close }
let popSeq = 0;
const MENU_ITEMS = '[role="menuitem"]';
const visible = (el) => !el.closest('[hidden]') && el.getClientRects().length > 0;

// Opens a panel under `trigger`. kind 'menu': arrow keys move between [role=menuitem], the first is focused, Tab leaves.
// kind 'dialog': focus goes to `initial` (a selector) or the first focusable. Opening one closes any other. Escape closes and
// focuses the control that opened it; a press outside, or focus leaving the panel, closes without moving focus.
export function popover({ trigger, label, kind = 'dialog', wide = false, initial = null, build }) {
  let panel = null; let owner = trigger; let cleanup = null;
  const id = `tb-pop-${++popSeq}`;
  const isOpen = () => Boolean(panel?.isConnected);
  function close({ returnFocus = true } = {}) {
    if (!panel) return;
    cleanup?.(); cleanup = null;
    panel.remove(); panel = null;
    owner.setAttribute('aria-expanded', 'false'); owner.removeAttribute('aria-controls');
    if (current === api) current = null; // eslint-disable-line no-use-before-define
    if (returnFocus && owner.isConnected) owner.focus();
  }
  const items = () => [...panel.querySelectorAll(MENU_ITEMS)].filter(visible);
  const rove = (to) => { for (const it of items()) it.tabIndex = it === to ? 0 : -1; to.focus(); };
  async function open(from = trigger) {
    if (isOpen()) return;
    current?.close({ returnFocus: false });
    owner = from;
    const me = h('div', { class: `tb-pop${wide ? ' tb-pop--wide' : ''}`, id, role: kind === 'dialog' ? 'dialog' : null, 'aria-label': kind === 'dialog' ? label : null });
    panel = me;
    current = api; // eslint-disable-line no-use-before-define
    (owner.closest('.tb__actions') || document.querySelector('.tb__actions'))?.append(me);
    owner.setAttribute('aria-expanded', 'true'); owner.setAttribute('aria-controls', id);
    const onDown = (e) => { if (!me.contains(e.target) && !owner.contains(e.target)) close({ returnFocus: false }); };
    const onFocusIn = (e) => { if (!me.contains(e.target) && !owner.contains(e.target)) close({ returnFocus: false }); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (kind !== 'menu' || !me.contains(document.activeElement)) return;
      const list = items(); const i = list.indexOf(document.activeElement);
      const to = { ArrowDown: list[(i + 1) % list.length], ArrowUp: list[(i - 1 + list.length) % list.length], Home: list[0], End: list[list.length - 1] }[e.key];
      if (to && i >= 0) { e.preventDefault(); rove(to); }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKey);
    cleanup = () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('keydown', onKey); };
    try {
      await build(me, api); // eslint-disable-line no-use-before-define
    } catch {
      toast("Couldn't open this. Check your connection and try again.", 'error');
      if (panel === me) close({ returnFocus: false });
      return;
    }
    if (panel !== me) return; // closed while it was loading
    if (kind === 'menu') {
      const list = items();
      for (const it of list) it.tabIndex = -1;
      if (list[0]) rove(list[0]);
    } else {
      (initial && me.querySelector(initial) || me.querySelector('a[href], button:not([disabled]), input:not([disabled]), select, textarea'))?.focus();
    }
  }
  const api = { open, close, isOpen };
  return api;
}

export function closeTopbarLayers({ returnFocus = false } = {}) {
  current?.close({ returnFocus });
  document.querySelector('dialog.tb-sheet')?.close();
}

// ---------------------------------------------------------------- the bar
const lazy = (file, fn, ctx) => async (panel, pop) => (await import(file))[fn](panel, ctx, pop);

let desktopSearch = null; // promise of the desktop search handle, for the "/" key
let mountDesktopSearch = null; // mounts the desktop search into its slot (once); set by buildTopbar

export function buildTopbar(ctx) {
  const u = ctx.user();
  const want = topbarButtons(u);
  const btn = (key, label, ic, props = {}) => h('button', { type: 'button', class: 'tb__icon', 'data-tb': key, 'aria-label': label, 'aria-expanded': 'false', hidden: !want.includes(key), ...props }, icon(ic));
  const searchBtn = btn('search', 'Search', 'search', { class: 'tb__icon tb-phone-only', 'data-focus-key': 'tb-search', 'aria-haspopup': 'dialog' });
  const bookmarksBtn = btn('bookmarks', 'Bookmarks', 'bookmark', { class: 'tb__icon tb-desktop-only', 'data-focus-key': 'tb-bookmarks', 'aria-haspopup': 'dialog' });
  const addBtn = btn('add', 'Add new', 'plus', { 'data-focus-key': 'tb-add', 'aria-haspopup': 'menu' });
  const bellBtn = btn('bell', 'Notifications', 'bell', { 'data-focus-key': 'tb-bell', 'aria-haspopup': 'dialog' });
  bellBtn.append(h('span', { class: 'tb__badge', 'aria-hidden': 'true', hidden: true }));
  const helpBtn = btn('help', 'Help', 'help', { class: 'tb__icon tb-desktop-only', 'data-focus-key': 'tb-help', 'aria-haspopup': 'dialog' });
  const me = h('button', { type: 'button', class: 'topbar__me tb__avatar', 'data-tb': 'profile', 'aria-label': `${u.full_name}, account menu`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-focus-key': 'tb-profile' },
    h('span', { class: 'acct-avatar acct-avatar--sm', 'aria-hidden': 'true' }, initials(u.full_name)));

  const bookmarksPop = popover({ trigger: bookmarksBtn, label: 'Bookmarks', build: lazy('./topbookmarks.js', 'renderBookmarks', ctx) });
  const helpPop = popover({ trigger: helpBtn, label: 'Help', wide: true, initial: 'input', build: lazy('./tophelp.js', 'renderHelp', ctx) });
  const addPop = popover({ trigger: addBtn, label: 'Add new', kind: 'menu', build: lazy('./topadd.js', 'renderAddMenu', ctx) });
  const bellPop = popover({ trigger: bellBtn, label: 'Notifications', wide: true, initial: '[role="tab"]', build: lazy('./topnotify.js', 'renderNotifications', ctx) });
  const profilePop = popover({ trigger: me, label: 'Account', kind: 'menu', build: (panel, pop) => buildProfile(panel, pop, ctx, me, bookmarksPop, helpPop) });
  const toggle = (pop, from) => () => (pop.isOpen() ? pop.close() : pop.open(from));
  bookmarksBtn.onclick = toggle(bookmarksPop); helpBtn.onclick = toggle(helpPop); addBtn.onclick = toggle(addPop);
  bellBtn.onclick = toggle(bellPop); me.onclick = toggle(profilePop);
  searchBtn.onclick = () => openSearchSheet(ctx, searchBtn);

  const searchSlot = h('div', { class: 'tb__search tb-desktop-only', hidden: !want.includes('search') });
  const mountDesktop = () => { desktopSearch = import('./topsearch.js').then((m) => m.mountSearch(searchSlot, ctx)); desktopSearch.catch(() => {
    desktopSearch = null;
    searchSlot.replaceChildren(h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: mountDesktop }, 'Search'));
  }); };
  // A gated owner has no search: build the slot hidden and leave the module unloaded until search is wanted (updateTopbar).
  let mounted = false;
  mountDesktopSearch = () => { if (!mounted) { mounted = true; mountDesktop(); } };
  if (want.includes('search')) mountDesktopSearch();

  const bar = h('header', { class: 'topbar' }, brand(ctx.home?.() || '#/home'), searchSlot, h('span', { class: 'topbar__assist' }),
    h('div', { class: 'tb__actions' }, searchBtn, bookmarksBtn, addBtn, bellBtn, helpBtn, me));
  syncAdd(bar, ctx);
  refreshBellIn(bar, ctx, true);
  return bar;
}

// Phone search: a full-screen dialog holding the same search. Escape or the back button closes it and returns focus to the Search icon.
function openSearchSheet(ctx, returnTo) {
  closeTopbarLayers();
  let search = null; // topsearch.js, set once it has loaded (a Tab before that just moves on)
  const slot = h('div', { class: 'tb-sheet__body' });
  const sheet = h('dialog', { class: 'tb-sheet', 'aria-label': 'Search', onkeydown: (e) => {
      if (e.key !== 'Tab') return;
      // Same wrap as the More sheet: Close, the box, Clear, back to Close. Results stay arrow-key options, so they are not stops.
      const stops = [...sheet.querySelectorAll('button:not([disabled]), input')].filter((x) => !x.closest('[hidden]'));
      const to = search?.wrapTarget(stops, document.activeElement, e.shiftKey);
      if (to) { e.preventDefault(); to.focus(); }
    }, onclose: () => { sheet.remove(); if (returnTo.isConnected) returnTo.focus(); } },
    h('div', { class: 'tb-sheet__head' }, h('button', { type: 'button', class: 'tb-back', 'aria-label': 'Close search', onclick: () => sheet.close() }, icon('close'))), slot);
  document.body.append(sheet);
  sheet.showModal();
  import('./topsearch.js').then((m) => { search = m; m.mountSearch(slot, ctx, { inSheet: true, onDone: () => sheet.close() }).focus(document.activeElement); })
    .catch(() => { toast("Couldn't open this. Check your connection and try again.", 'error'); sheet.close(); });
}

function buildProfile(panel, pop, ctx, me, bookmarksPop, helpPop) {
  const u = ctx.user();
  // Bookmarks and Help open from here: focus goes to the avatar first (it stays), so closing the menu never drops focus onto the page and the new panel is not closed by the focus guard.
  const done = () => pop.close({ returnFocus: false });
  const item = (content, props) => h('li', { role: 'none', class: props.phone ? 'tb-phone-only' : null }, h(props.href ? 'a' : 'button', { class: 'tb-item', role: 'menuitem', type: props.href ? null : 'button', href: props.href, onclick: props.onclick }, content));
  const row = (ic, text) => [icon(ic), h('span', { class: 'tb-item__title' }, text)];
  panel.append(
    h('div', { class: 'tb-pop__head tb-profile' }, h('span', { class: 'acct-avatar acct-avatar--sm', 'aria-hidden': 'true' }, initials(u.full_name)),
      h('div', { class: 'tb-profile__who' }, h('strong', null, u.full_name), h('span', { class: 'muted small' }, `${u.organization_name} · ${ROLES[u.role] || ''}`))),
    h('ul', { class: 'tb-list tb-menu', role: 'menu', 'aria-label': 'Account' },
      item(row('users', 'My account'), { href: '#/account', onclick: done }),
      u.role !== 'cleaner' && item(row('settings', 'Settings'), { href: '#/settings', onclick: done })),
    // Between two menu lists, not inside one: a menu may own only menu items, and the theme buttons are radios (axe aria-required-children).
    // The switch updates its buttons in place, so choosing a theme keeps the menu open and focus on the chosen radio.
    h('div', { class: 'tb-theme' }, themeSwitch({ compact: true })),
    h('ul', { class: 'tb-list tb-menu', role: 'menu', 'aria-label': 'Help and sign out' },
      !u.plan?.card_check_due && item(row('bookmark', 'Bookmarks'), { phone: true, onclick: () => { me.focus(); done(); bookmarksPop.open(me); } }),
      item(row('help', 'Help & support'), { phone: true, onclick: () => { me.focus(); done(); helpPop.open(me); } }),
      h('li', { class: 'tb-sep', role: 'separator' }),
      item(row('logout', 'Log out'), { onclick: () => { done(); ctx.logout(); } })));
}

// Add new has nothing to offer some people (empty list): hide the button then.
function syncAdd(bar, ctx) {
  const add = bar.querySelector('[data-tb="add"]');
  if (!add || add.hidden) return;
  import('./topadd.js').then((m) => { add.hidden = m.addNewItems(ctx.user()).length === 0; }).catch(() => {});
}

function refreshBellIn(bar, ctx, force = false) {
  const bell = bar.querySelector('[data-tb="bell"]');
  if (!bell || bell.hidden) return;
  import('./topnotify.js').then((m) => m.refreshBell(bell, ctx, { force })).catch(() => {});
}

// A route change: close the panels, show the controls this role and plan may use, refresh the badge. Nothing is rebuilt.
export function updateTopbar(el, ctx) {
  if (!el) return;
  closeTopbarLayers({ returnFocus: false });
  const want = topbarButtons(ctx.user());
  for (const b of el.querySelectorAll('[data-tb]')) b.hidden = !want.includes(b.dataset.tb);
  const slot = el.querySelector('.tb__search'); // the desktop search box has no data-tb: it follows the search control
  if (slot) {
    const wantSearch = want.includes('search');
    slot.hidden = !wantSearch;
    if (wantSearch && !slot.firstChild) mountDesktopSearch?.();
  }
  syncAdd(el, ctx);
  refreshBellIn(el, ctx);
}

let installed = false;
export function installTopbarKeys(ctx) {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', (e) => {
    if (!isSlashShortcut(e, document)) return;
    e.preventDefault();
    const returnTo = document.activeElement;
    if (window.matchMedia(PHONE).matches) { document.querySelector('.topbar [data-tb="search"]')?.click(); return; }
    desktopSearch?.then((s) => s.focus(returnTo)).catch(() => {});
  });
  window.addEventListener('focus', () => { const bar = document.querySelector('.topbar'); if (bar) refreshBellIn(bar, ctx); });
}
