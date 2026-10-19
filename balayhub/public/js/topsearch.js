// Top bar global search (D-90): a combobox with a listbox of grouped results. Pages are matched here;
// records come from GET /api/search (cleaners use /help/articles instead, the server refuses them /search).
// Never imports app.js: the shell hands in `ctx` ({ user, nav, navigate, routeAllowed }).

import { h, icon } from './ui.js';
import { get } from './api.js';

// Settings that live inside other pages, so "team" or "dark mode" finds the right screen.
export const SETTINGS_INDEX = [
  { label: 'My account', href: '#/account', keywords: 'profile name password email language' },
  { label: 'Notification settings', href: '#/account', keywords: 'alerts push notifications email' },
  { label: 'Change password', href: '#/account', keywords: 'password security sign in' },
  { label: 'Light or dark mode', href: '#/account', keywords: 'theme dark mode light' },
  { label: 'Team and permissions', href: '#/settings', keywords: 'team invite staff manager cleaner roles access', roles: ['owner'] },
  { label: 'Plan and billing', href: '#/settings', keywords: 'plan billing subscription pay trial', roles: ['owner'] },
  { label: 'Booking page and online payments', href: '#/settings', keywords: 'direct booking paymongo gcash maya', roles: ['owner'], module: 'stay' },
  { label: 'Message templates and automatic messages', href: '#/inbox-settings', keywords: 'templates automation messages', roles: ['owner', 'manager'], module: 'stay' },
  { label: 'Pricing and seasons', href: '#/pricing', keywords: 'price rates seasons discount last-minute', roles: ['owner', 'manager', 'staff'], module: 'stay' },
  { label: 'Discount codes', href: '#/discount-codes', keywords: 'discount code promo returning', roles: ['owner', 'manager'], module: 'stay' },
  { label: 'Guest reviews', href: '#/reviews', keywords: 'reviews rating stars', roles: ['owner', 'manager', 'staff'], module: 'stay' },
  { label: 'Gate pass', href: '#/gatepass-settings', keywords: 'gate pass building admin guard', roles: ['owner', 'manager'], module: 'stay' },
  { label: 'Help and support', href: '#/help', keywords: 'help support ticket contact' },
];
// module 'stay' hides the entry in a long_term workspace; 'rent' hides it in a short_term workspace.

const GROUP_ORDER = ['pages', 'reservations', 'guests', 'listings', 'properties', 'tenants', 'owners', 'quotes', 'maintenance', 'housekeeping', 'supplies', 'expenses', 'discount_codes', 'addons', 'help'];
const ALL_ROLES = ['owner', 'manager', 'staff'];
const HOST = ['owner', 'manager'];
// What the panel says it covers: [word, module, roles]. Mirrors the server's GROUPS (src/lib/search.js) and its inModule rule.
const SCOPE = [['reservations', 'stay', ALL_ROLES], ['guests', 'stay', ALL_ROLES], ['listings', 'stay', ALL_ROLES], ['properties', null, ALL_ROLES],
  ['tenants', 'rent', ALL_ROLES], ['unit owners', 'stay', ['owner']], ['quotes', 'stay', HOST], ['repair requests', null, ALL_ROLES],
  ['cleaning tasks', 'stay', ALL_ROLES], ['supplies', 'stay', ALL_ROLES], ['expenses', null, ALL_ROLES], ['discount codes', 'stay', HOST], ['add-ons', 'stay', HOST]];
const MAX_PAGES = 5;

export const likeTerms = (q) => { const t = String(q ?? '').trim(); return { q: t, ok: t.length >= 2 }; };

export function moveActive(i, n, key) {
  if (!n || (key !== 'ArrowDown' && key !== 'ArrowUp')) return n ? i : -1;
  if (key === 'ArrowDown') return i + 1 >= n ? 0 : i + 1;
  return i <= 0 ? n - 1 : i - 1;
}

// Tab inside a modal sheet: the control to focus instead of letting Tab fall out to BODY, or null to let the browser move on.
// `active` not in the list (the dialog itself) counts as before the first control.
export function wrapTarget(items, active, shift) {
  if (!items.length) return null;
  const i = items.indexOf(active);
  if (shift) return i <= 0 ? items[items.length - 1] : null;
  return i === items.length - 1 ? items[0] : null;
}

export function pushRecent(list, q, max = 5) {
  const t = String(q ?? '').trim();
  if (!t) return list;
  return [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, max);
}

export function scopeLine(user) {
  const type = user?.business_type;
  const words = SCOPE.filter(([, m, roles]) => roles.includes(user?.role) && !((m === 'stay' && type === 'long_term') || (m === 'rent' && type === 'short_term'))).map(([w]) => w);
  return `Search covers ${[...words, 'pages', 'help'].join(', ').replace(/, help$/, ' and help')}.`;
}

export function emptyHint(user) {
  if (user?.role === 'cleaner') return 'Try a page name or a help topic.';
  if (user?.business_type === 'long_term') return 'Try a tenant, a property or a repair.';
  return 'Try a guest name, a confirmation code or a listing name.';
}

// Pages the person can open: the menu they see plus the settings index. Label prefix, then word prefix, then keyword or inside the label.
export function pageResults(q, user, nav, routeAllowed) {
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return [];
  const type = user?.business_type;
  const entries = [
    ...nav.map(([p, label]) => ({ label, href: `#${p}`, keywords: '', sub: null })),
    ...(user?.role === 'cleaner' ? [] : SETTINGS_INDEX.map((e) => ({ ...e, sub: 'In Settings' }))),
  ].filter((e) => (!e.roles || e.roles.includes(user?.role))
    && !((e.module === 'stay' && type === 'long_term') || (e.module === 'rent' && type === 'short_term'))
    && routeAllowed(e.href.slice(1).split('?')[0], user));
  const rank = (e) => {
    const l = e.label.toLowerCase();
    if (l.startsWith(s)) return 0;
    if (l.split(/[^a-z0-9]+/).some((w) => w.startsWith(s))) return 1;
    // Keywords match word starts only, so 'ana' does not find 'manager'.
    return l.includes(s) || e.keywords.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(s)) ? 2 : 3;
  };
  const seen = new Set();
  return entries.map((e, i) => ({ e, r: rank(e), i })).filter((x) => x.r < 3).sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e).filter((e) => { const k = `${e.label}|${e.href}`; return seen.has(k) ? false : (seen.add(k), true); })
    .slice(0, MAX_PAGES).map((e) => ({ title: e.label, sub: e.sub, href: e.href }));
}

const recentKey = (user) => `bh-recent-search-${user?.user_id ?? 'x'}`;
function loadRecent(user) {
  try { const v = JSON.parse(localStorage.getItem(recentKey(user)) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : []; } catch { return []; }
}
function saveRecent(user, list) { try { localStorage.setItem(recentKey(user), JSON.stringify(list)); } catch { /* private mode: recents just don't stick */ } }

// Builds the box into `slot`. inSheet: the phone full-screen version (the sheet's header owns the one Close button).
// onDone() asks the top bar to close the sheet. Returns { focus(returnTo) }.
export function mountSearch(slot, ctx, { inSheet = false, onDone } = {}) {
  const sheet = inSheet;
  let seq = 0; let timer = 0; let active = -1; let open = sheet; let returnTo = null;
  let server = []; let loading = false; let message = '';
  const user = () => ctx.user();

  const input = h('input', {
    type: 'search', class: 'tb-input', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
    placeholder: sheet ? 'Search BalayHub' : 'Type / to search', 'aria-label': 'Search BalayHub',
    'aria-expanded': 'false', 'aria-controls': 'tb-results', 'aria-autocomplete': 'list', 'aria-activedescendant': '',
  });
  // The listbox holds only groups of options (axe: aria-required-children). Notes, errors, "no results" and Clear live beside it.
  const list = h('div', { id: 'tb-results', role: 'listbox', 'aria-label': 'Search results', hidden: true });
  const extras = h('div', { class: 'tb-extras' });
  // One muted line for every panel state (O4). Not an option, so screen readers don't count it as a result.
  const scope = h('p', { class: 'muted small tb-scope' }, scopeLine(user()));
  const results = h('div', { class: 'tb-results', hidden: !open }, list, extras);
  const status = h('div', { class: 'tb-status', role: 'status', 'aria-live': 'polite' });
  const kbd = sheet ? null : h('span', { class: 'tb-kbd', 'aria-hidden': 'true' }, '/');
  const box = h('div', { class: 'tb-search' }, h('span', { class: 'tb-search__icon' }, icon('search')), input, kbd);
  // Mouse presses inside the results must not blur the input (that would close the list before the click lands).
  results.addEventListener('mousedown', (e) => e.preventDefault());
  slot.append(h('div', { class: sheet ? 'tb-searchwrap tb-searchwrap--sheet' : 'tb-searchwrap' }, box, results, status));

  const options = () => [...list.querySelectorAll('[role="option"]:not([aria-disabled])')];
  function setActive(i) {
    const opts = options();
    active = i;
    opts.forEach((o, n) => { o.classList.toggle('is-active', n === i); o.setAttribute('aria-selected', n === i ? 'true' : 'false'); });
    if (opts[i]) { input.setAttribute('aria-activedescendant', opts[i].id); opts[i].scrollIntoView?.({ block: 'nearest' }); } else input.setAttribute('aria-activedescendant', '');
  }
  function setOpen(v) {
    open = v;
    results.hidden = !open;
    input.setAttribute('aria-expanded', String(open && list.children.length > 0));
    if (kbd) kbd.hidden = Boolean(input.value) || document.activeElement === input;
  }

  const optionEl = (it, n) => h(it.recent ? 'div' : 'a', {
    role: 'option', id: `tb-opt-${n}`, class: 'tb-opt', 'aria-selected': 'false',
    href: it.recent ? undefined : it.href, 'data-recent': it.recent ? it.title : undefined,
    onClick: (e) => { if (e.button || e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); choose(e.currentTarget); },
  }, h('span', { class: 'tb-opt__title' }, it.title), it.sub ? h('span', { class: 'tb-opt__sub' }, it.sub) : null);

  function render() {
    const { q, ok } = likeTerms(input.value);
    const kids = []; const extra = []; let n = 0; let count = 0;
    let empty = null;
    const group = (key, label, items, note) => {
      const hid = `tb-g-${key}`;
      kids.push(h('div', { role: 'group', 'aria-labelledby': hid, class: 'tb-group' },
        h('div', { class: 'tb-group-head' }, h('div', { class: 'tb-group-title', id: hid }, label)),
        items.map((it) => { count += 1; return optionEl(it, n++); }),
        // Not selectable: a disabled option keeps the listbox children valid for screen readers.
        note ? h('div', { role: 'option', 'aria-disabled': 'true', 'aria-selected': 'false', class: 'tb-note' }, note) : null));
    };
    if (!q) {
      const recent = loadRecent(user());
      if (recent.length) {
        group('recent', 'Recent searches', recent.map((t) => ({ title: t, recent: true })));
        // A normal tab stop beside the listbox. Clearing is the point of the action, so focus goes back to the box.
        extra.push(h('button', { type: 'button', class: 'tb-clear', 'aria-label': 'Clear recent searches', onClick: () => { saveRecent(user(), []); render(); input.focus(); } }, 'Clear'));
      }
    } else {
      const bySrv = Object.fromEntries(server.map((g) => [g.key, g]));
      const pages = pageResults(q, user(), ctx.nav(), ctx.routeAllowed);
      for (const key of GROUP_ORDER) {
        if (key === 'pages') { if (pages.length) group('pages', 'Pages', pages); if (loading) extra.push(h('div', { class: 'tb-note' }, 'Searching…')); } else if (bySrv[key]) group(key, bySrv[key].label, bySrv[key].items, bySrv[key].more ? `${bySrv[key].items.length} of ${bySrv[key].total} shown. Type more of the name, or a confirmation code.` : null);
      }
      if (q.length === 1) extra.push(h('div', { class: 'tb-note' }, 'Type 2 or more letters to search records.'));
      if (message) extra.push(h('div', { class: 'tb-note tb-note--error' }, message));
      if (ok && !count && !loading && !message) empty = h('div', { class: 'tb-empty', role: 'option', 'aria-disabled': 'true', 'aria-selected': 'false' }, h('div', null, `No results for “${q}”.`), h('div', { class: 'tb-note' }, emptyHint(user())));
    }
    list.replaceChildren(...kids, ...(empty ? [empty] : []));
    list.hidden = kids.length === 0 && !empty;
    extras.replaceChildren(...extra, scope);
    active = -1;
    input.setAttribute('aria-activedescendant', '');
    status.textContent = !q || loading ? '' : count === 0 ? 'No results' : count === 1 ? '1 result' : `${count} results`;
    setOpen(open && (kids.length > 0 || Boolean(empty) || extra.length > 0));
  }

  async function run(my, q) {
    try {
      let groups;
      if (user().role === 'cleaner') {
        const r = await get(`/help/articles?q=${encodeURIComponent(q)}`);
        const names = Object.fromEntries((r.categories || []).map((c) => [c.key, c.name]));
        groups = [{ key: 'help', label: 'Help articles', items: (r.articles || []).slice(0, 4).map((a) => ({ title: a.title, sub: names[a.category] || null, href: `#/help?q=${encodeURIComponent(a.title)}` })) }];
      } else groups = (await get(`/search?q=${encodeURIComponent(q)}`)).groups || [];
      if (my !== seq) return;
      server = groups.map((g) => ({ ...g, items: (g.items || []).filter((it) => typeof it.href === 'string' && it.href.startsWith('#/')) })).filter((g) => g.items.length);
      message = '';
    } catch (e) {
      if (my !== seq) return;
      server = [];
      message = e.offline ? "You're offline. Only pages can be searched."
        : e.status === 429 ? 'Too many searches in a minute. Wait a moment and try again.' : "Search isn't working right now. Try again.";
    }
    loading = false;
    render();
  }

  function onInput() {
    clearTimeout(timer);
    seq += 1; server = []; message = ''; loading = false;
    const { q, ok } = likeTerms(input.value);
    if (ok && typeof navigator !== 'undefined' && navigator.onLine === false) message = "You're offline. Only pages can be searched.";
    else if (ok) { loading = true; const my = seq; timer = setTimeout(() => run(my, q), 200); }
    open = true;
    render();
  }

  function choose(el) {
    if (el.dataset.recent !== undefined) { input.value = el.dataset.recent; onInput(); input.focus(); return; }
    const href = el.getAttribute('href');
    if (!href?.startsWith('#/')) return;
    const q = input.value.trim();
    if (q) saveRecent(user(), pushRecent(loadRecent(user()), q));
    clearTimeout(timer); seq += 1;
    input.value = ''; server = []; loading = false; message = '';
    setOpen(false); render(); setOpen(false);
    onDone?.();
    ctx.navigate(href);
  }

  input.addEventListener('input', onInput);
  input.addEventListener('focus', () => { open = true; render(); });
  // Leaving the whole box (in the sheet: the whole sheet) closes the list; Tab from the input to Clear and the recents stays inside it.
  const wrap = box.parentNode;
  wrap.addEventListener('focusout', (e) => { if (!(wrap.closest('.tb-sheet') || wrap).contains(e.relatedTarget)) { setOpen(false); if (kbd) kbd.hidden = Boolean(input.value); } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { open = true; render(); }
      setActive(moveActive(active, options().length, e.key));
    } else if (e.key === 'Enter') {
      const opts = options();
      const el = opts[active] || opts[0];
      if (el) { e.preventDefault(); choose(el); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (sheet) { onDone?.(); return; }
      if (open && !results.hidden) { setOpen(false); return; }
      if (returnTo?.isConnected) returnTo.focus();
    }
  });

  return { focus(from) { returnTo = from || null; input.focus(); } };
}
