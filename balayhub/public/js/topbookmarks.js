// Top bar bookmarks panel (F53, D-90). Personal saved pages, kept on the server (GET/POST /account/bookmarks).
// Never imports app.js or topbar.js: app.js hands in `ctx` (user, path, hash, nav, routeAllowed).

import { h, icon, toast, skeleton } from './ui.js';
import { get, post } from './api.js';

// Keys that open a dialog once or show a one-off notice; a saved page should not reopen them.
const VOLATILE = new Set(['new', 'invite', 'assign', 'expired', 'billing', 'billing_cancelled']);

// '#/reservations?new=1&view=upcoming' -> '#/reservations?view=upcoming'
export function bookmarkPath(hash) {
  const [base, query = ''] = String(hash || '').split('?');
  const kept = query.split('&').filter((kv) => kv && !VOLATILE.has(kv.split('=')[0]));
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

// The page title without the app name, else the nav label; at most 80 characters (the server's limit).
export function bookmarkLabel(title, fallback) {
  const t = String(title || '').replace(/\s*—\s*BalayHub\s*$/, '').trim();
  return (t && t !== 'BalayHub' ? t : String(fallback || '').trim()).slice(0, 80);
}

// Saved pages this role or workspace may no longer open stay stored but are not shown.
export const visibleBookmarks = (list, user, routeAllowed) =>
  list.filter((b) => routeAllowed(b.path.slice(1).split('?')[0], user));

// Row to focus after the row at `index` is removed and the list redrawn with `count` rows: the one
// that took its place, else the previous one, else -1 (the toggle).
export const focusIndexAfterRemove = (index, count) => (count === 0 ? -1 : Math.min(index, count - 1));

// The section name is only worth showing when it says something the label doesn't.
export const subLine = (label, sub) => (sub && String(sub).toLowerCase() !== String(label).toLowerCase() ? sub : null);

const sectionOf = (nav, p) => {
  const first = `/${p.slice(2).split(/[/?]/)[0]}`;
  return nav.find((n) => n[0] === first)?.[1] || null;
};

export function renderBookmarks(panel, ctx, pop) {
  let list = [];
  const nav = ctx.nav();
  const here = () => bookmarkPath(ctx.hash());
  const hereLabel = () => bookmarkLabel(document.title, sectionOf(nav, here()));
  const saved = () => list.find((b) => b.path === here());

  const toggleText = h('span', null);
  const toggle = h('button', { type: 'button', class: 'btn btn--secondary', 'data-focus-key': 'tb-bm-toggle', 'aria-pressed': 'false', onclick: onToggle },
    icon('star'), toggleText);
  const body = h('div', { class: 'tb-pop__body' });
  panel.append(h('div', { class: 'tb-pop__head' }, h('h2', { class: 'tb-pop__title' }, 'Bookmarks')), toggle, body);

  // Updated in place (same element, text and state), so focus stays on the toggle.
  function syncToggle() {
    const on = Boolean(saved());
    toggle.hidden = !hereLabel();
    toggle.classList.toggle('is-on', on);
    toggle.setAttribute('aria-pressed', String(on));
    toggleText.textContent = on ? 'Remove this page from bookmarks' : 'Bookmark this page';
  }

  function row(b) {
    const sub = subLine(b.label, sectionOf(nav, b.path));
    const li = h('li', null,
      h('a', { class: 'tb-item', href: b.path, onclick: () => pop.close({ returnFocus: false }) },
        h('span', { class: 'tb-item__title' }, b.label), sub && h('span', { class: 'tb-item__sub muted small' }, sub)),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `Remove ${b.label} from bookmarks`, onclick: () => remove(b, li) }, icon('close')));
    return li;
  }

  function draw() {
    const shown = visibleBookmarks(list, ctx.user(), ctx.routeAllowed);
    body.replaceChildren(shown.length
      ? h('ul', { class: 'tb-list' }, shown.map(row))
      : h('div', { class: 'tb-empty' }, h('p', null, 'No bookmarks yet.'), h('p', { class: 'muted small' }, 'Open a page you use often and press Bookmark this page.')));
    syncToggle();
  }

  async function load() {
    body.replaceChildren(skeleton(2));
    try {
      list = (await get('/account/bookmarks')).bookmarks;
      draw();
    } catch {
      body.replaceChildren(h('div', { class: 'tb-empty' }, h('p', null, "Couldn't load your bookmarks."),
        h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onclick: load }, 'Try again')));
    }
  }

  // `li` is the row whose remove button was used (null from the toggle, which keeps focus).
  async function remove(b, li) {
    // The row is going away and draw() rebuilds the list, so remember its position, not its neighbours.
    const at = li ? [...li.parentNode.children].indexOf(li) : -1;
    try {
      await post(`/account/bookmarks/${b.bookmark_id}/remove`);
    } catch (err) { toast(err.message, 'error'); return; }
    list = list.filter((x) => x.bookmark_id !== b.bookmark_id);
    draw();
    if (li) {
      const rows = body.querySelectorAll('a.tb-item');
      (rows[focusIndexAfterRemove(at, rows.length)] || toggle).focus();
    }
    toast('Removed from bookmarks.');
  }

  async function onToggle() {
    const cur = saved();
    if (cur) {
      await remove(cur, null);
      return;
    }
    const label = hereLabel();
    try {
      const { bookmark } = await post('/account/bookmarks', { path: here(), label });
      list = [...list.filter((b) => b.bookmark_id !== bookmark.bookmark_id), bookmark];
      draw();
      toast(`Bookmarked: ${label}.`);
    } catch (err) { toast(err.message, 'error'); }
  }

  syncToggle();
  return load();
}
