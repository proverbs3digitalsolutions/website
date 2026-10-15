// Top bar notifications: the bell badge and its panel (D-90). Lazy-loaded by topbar.js.
// Never imports app.js; ctx is injected. Pure helpers are exported for node tests.

import { h, icon, toast } from './ui.js';
import { get, post, qs } from './api.js';

export const TAB_LABELS = { all: 'All', reservations: 'Reservations', payments: 'Payments', cleaning: 'Cleaning', messages: 'Messages', owners: 'Owners' };

export const bellLabel = (n) => (n > 0 ? `Notifications, ${n} unread` : 'Notifications');
export const badgeText = (n) => (n > 99 ? '99+' : n > 0 ? String(n) : '');
// Alert links come from the server, but only in-app hash links are followed.
export const safeUrl = (u) => (typeof u === 'string' && /^\/#\//.test(u) ? u : '/#/home');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const manilaKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(ms)); // YYYY-MM-DD

export function relTime(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  const [y, m, d] = manilaKey(t).split('-').map(Number);
  const [ny, nm, nd] = manilaKey(now).split('-').map(Number);
  if (Date.UTC(ny, nm - 1, nd) - Date.UTC(y, m - 1, d) === 86400000) return 'Yesterday';
  return `${d} ${MONTHS[m - 1]}${y === ny ? '' : ` ${y}`}`;
}

// ---------------------------------------------------------------- bell
let lastRefresh = 0;
function setBell(btn, n) {
  if (!btn) return;
  btn.setAttribute('aria-label', bellLabel(n));
  let badge = btn.querySelector('.tb__badge');
  const text = badgeText(n);
  if (!text) { badge?.remove(); return; }
  if (!badge) { badge = h('span', { class: 'tb__badge', 'aria-hidden': 'true' }); btn.append(badge); }
  badge.textContent = text;
}

// Updates the label and badge in place (the button is never replaced). At most once per 15 seconds unless forced.
export async function refreshBell(btn, ctx, { force = false } = {}) {
  if (!force && Date.now() - lastRefresh < 15000) return;
  lastRefresh = Date.now();
  try {
    const { unread } = await get('/account/notifications/count');
    setBell(btn, unread);
  } catch { /* the bell keeps its last count */ }
}

// ---------------------------------------------------------------- panel
export function renderNotifications(panel, ctx, pop) {
  const isCleaner = ctx.user()?.role === 'cleaner';
  const bell = () => document.querySelector('.topbar [data-focus-key="tb-bell"]');
  let category = 'all';
  let nextBefore = null;
  let seq = 0;
  let busy = false; // not `disabled`: that would drop focus from the button just used

  const markAll = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-focus-key': 'tb-mark-all', hidden: true, onclick: () => markAllRead() }, 'Mark all as read');
  // A focused control is never hidden (focus would fall to <body>): when nothing is unread it stays as a
  // disabled "All caught up" (aria-disabled, not `disabled`, so focus stays) and hides once focus leaves.
  const setMarkAll = (unread) => {
    markAll.textContent = unread ? 'Mark all as read' : 'All caught up';
    if (unread) markAll.removeAttribute('aria-disabled'); else markAll.setAttribute('aria-disabled', 'true');
    markAll.hidden = !unread && document.activeElement !== markAll;
  };
  markAll.addEventListener('blur', () => { if (markAll.getAttribute('aria-disabled')) markAll.hidden = true; });
  const tabs = h('div', { class: 'tb-chips', role: 'tablist', 'aria-label': 'Filter notifications' });
  const list = h('ul', { class: 'tb-list' });
  const older = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-focus-key': 'tb-older', hidden: true, onclick: () => load(true) }, 'Show older');
  const body = h('div', { class: 'tb-pop__body' }, list, older);

  const tabBtn = (key) => h('button', {
    type: 'button', role: 'tab', class: 'flt__chip', 'data-tab': key, 'aria-selected': String(key === category), tabindex: key === category ? '0' : '-1',
    onclick: () => select(key),
  }, TAB_LABELS[key]);

  function select(key) {
    if (key === category) return;
    category = key;
    for (const t of tabs.querySelectorAll('[role="tab"]')) {
      const on = t.dataset.tab === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    load(false);
  }

  const row = (it) => {
    const a = h('a', { class: `tb-item${it.read ? '' : ' tb-item--unread'}`, href: safeUrl(it.url), 'data-id': it.id },
      h('span', { class: 'tb-item__title' },
        !it.read && h('span', { class: 'tb-dot', 'aria-hidden': 'true' }),
        !it.read && h('span', { class: 'sr-only' }, 'Unread: '),
        it.title),
      it.body && h('span', { class: 'tb-item__sub' }, it.body),
      h('span', { class: 'tb-item__meta' }, relTime(it.created_at)));
    a.addEventListener('click', () => {
      if (!it.read) post('/account/notifications/read', { ids: [it.id] }).then((r) => setBell(bell(), r.unread)).catch(() => {});
      pop.close({ returnFocus: false });
    });
    return a;
  };
  const li = (it) => h('li', null, row(it));

  const emptyText = () => (category === 'all'
    ? h('div', { class: 'tb-empty' }, h('strong', null, "You're all caught up."), h('p', { class: 'muted small' }, isCleaner ? 'New cleaning jobs show up here.' : 'New bookings, payments, cleaning updates and guest messages show up here.'))
    : h('div', { class: 'tb-empty' }, `Nothing in ${TAB_LABELS[category]} yet.`));

  const load = async (more) => {
    const mine = ++seq;
    if (!more) { list.replaceChildren(h('li', null, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }))); older.hidden = true; }
    let data;
    try {
      data = await get(`/account/notifications${qs({ category: category === 'all' ? '' : category, before: more ? nextBefore : '' })}`);
    } catch {
      if (mine !== seq) return;
      const retry = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onclick: () => load(more) }, 'Try again');
      const err = h('li', null, h('div', { class: 'tb-empty' }, "Couldn't load notifications.", retry));
      if (more) list.append(err); else list.replaceChildren(err);
      return;
    }
    if (mine !== seq) return; // a newer tab switch or page took over
    // The category tabs are built once, from the first answer; the All tab is already there.
    if (tabs.children.length === 1) tabs.append(...data.categories.map(tabBtn));
    nextBefore = data.next_before;
    setMarkAll(data.unread);
    setBell(bell(), data.unread);
    const rows = data.items.map(li);
    if (more) list.append(...rows);
    else list.replaceChildren(...(rows.length ? rows : [h('li', null, emptyText())]));
    // "Show older" had focus: hand it to the first new row before hiding the button.
    if (more && !nextBefore && document.activeElement === older) rows[0]?.querySelector('a')?.focus();
    older.hidden = !nextBefore;
  };

  async function markAllRead() {
    if (busy || markAll.getAttribute('aria-disabled')) return;
    busy = true;
    try {
      const r = await post('/account/notifications/read', category === 'all' ? { all: true } : { category });
      for (const a of list.querySelectorAll('.tb-item--unread')) {
        a.classList.remove('tb-item--unread');
        a.querySelectorAll('.tb-dot, .sr-only').forEach((x) => x.remove());
      }
      setMarkAll(r.unread);
      setBell(bell(), r.unread);
    } catch (e) {
      toast(e.message || "Couldn't mark them as read. Try again.", 'error');
    } finally { busy = false; }
  }

  tabs.append(tabBtn('all'));
  panel.append(
    h('div', { class: 'tb-pop__head' }, h('h2', { class: 'tb-pop__title' }, 'Notifications'), markAll),
    tabs, body,
    h('div', { class: 'tb-pop__foot' }, h('a', { href: '#/account', onclick: () => pop.close({ returnFocus: false }) }, 'Choose which alerts you get')));
  load(false);
  tabs.querySelector('[role="tab"]').focus();
}
