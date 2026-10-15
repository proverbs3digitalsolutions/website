// Top bar help panel (F53): search the help centre without leaving the page.
// Opened by the popover kit in topbar.js. Never imports app.js; lists redraw in place so the search box keeps focus.

import { get, qs } from './api.js';
import { h } from './ui.js';

const PAGE_HELP = {
  home: 'getting started', launchpad: 'getting started', inbox: 'inbox messages', calendar: 'calendar',
  reservations: 'reservations', groups: 'group bookings', 'daily-close': 'daily close', housekeeping: 'cleaning',
  'cleaner-pay': 'cleaner pay', supplies: 'supplies', 'lost-found': 'lost and found', listings: 'listing',
  guests: 'guests', quotes: 'quote', addons: 'add-ons', owners: 'owner statements', 'stay-reports': 'reports',
  pnl: 'profit and loss', rent: 'expenses', maintenance: 'maintenance', settings: 'settings', account: 'notifications',
  dashboard: 'rent', tenants: 'tenants', properties: 'properties', pricing: 'pricing', 'my-pay': 'pay',
};

// '/reservations/abc?x=1' or '#/reservations' -> 'reservations'; '' when the page has no help words.
export function pageHelpQuery(path) {
  const seg = String(path || '').replace(/^#/, '').split('?')[0].split('/').filter(Boolean)[0];
  return seg && Object.hasOwn(PAGE_HELP, seg) ? PAGE_HELP[seg] : '';
}

const articleLink = (a, pop) => h('a', { class: 'tb-item', href: `#/help?q=${encodeURIComponent(a.title)}`, onClick: () => pop?.close({ returnFocus: false }) },
  h('span', { class: 'tb-item__title' }, a.title));

const skeletons = () => [h('div', { class: 'skeleton', 'aria-hidden': 'true' }), h('div', { class: 'skeleton', 'aria-hidden': 'true' })];

export function renderHelp(panel, ctx, pop) {
  const input = h('input', { type: 'search', class: 'input', id: 'tb-help-q', placeholder: 'Search help articles', autocomplete: 'off', maxlength: 200 });
  const results = h('div', { 'aria-live': 'polite' });
  const heading = h('p', { class: 'tb-group-title' }, 'Suggested for this page');
  let timer; let seq = 0;

  // Shows articles in `results`; a newer request makes older replies ignorable.
  async function load(q, { suggested }) {
    const mine = ++seq;
    heading.hidden = !suggested;
    results.replaceChildren(...skeletons());
    try {
      let { articles, categories } = await get(`/help/articles${q ? qs({ q }) : ''}`);
      if (mine !== seq) return;
      if (suggested && !q) {
        // No words for this page: fall back to the Getting started category of the full list.
        const start = (categories || []).find((c) => c.name === 'Getting started')?.key || 'start';
        articles = articles.filter((a) => a.category === start);
      }
      articles = articles.slice(0, suggested ? 5 : 8);
      results.replaceChildren(articles.length
        ? h('ul', { class: 'tb-list' }, articles.map((a) => h('li', null, articleLink(a, pop))))
        : h('p', { class: 'tb-empty muted small' }, 'No articles found. Try other words, or contact us.'));
    } catch {
      if (mine !== seq) return;
      heading.hidden = true;
      results.replaceChildren(h('div', { class: 'tb-empty' },
        h('p', { class: 'muted small' }, "Couldn't load help articles."),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-focus-key': 'tb-help-retry', onClick: () => start() }, 'Try again')));
    }
  }

  const start = () => {
    const q = input.value.trim();
    return q ? load(q, { suggested: false }) : load(pageHelpQuery(location.hash), { suggested: true });
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(start, 250); });

  panel.replaceChildren(
    h('div', { class: 'tb-pop__head' }, h('h2', { class: 'tb-pop__title' }, 'Help')),
    h('div', { class: 'tb-pop__body' },
      h('label', { class: 'sr-only', for: 'tb-help-q' }, 'Search help articles'),
      input, heading, results,
      h('a', { class: 'tb-item', href: '#/help', onClick: () => pop?.close({ returnFocus: false }) }, h('span', { class: 'tb-item__title' }, 'Browse all help'))),
    h('div', { class: 'tb-pop__foot' },
      h('span', { class: 'muted small' }, 'Need a hand?'),
      h('a', { class: 'btn btn--primary btn--sm', href: '#/help/new', onClick: () => pop?.close({ returnFocus: false }) }, 'Contact us')));
  start();
}
