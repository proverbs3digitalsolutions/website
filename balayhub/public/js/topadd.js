// Top bar "+" Add new menu. Never imports app.js: the shell passes ctx in.
import { h, icon } from './ui.js';
import { routeAllowed } from './routeaccess.js';

const MGR = ['owner', 'manager'];
const ALL = ['short_term', 'long_term', 'both'];
const STAY = ['short_term', 'both'];
const RENT = ['long_term', 'both'];
// [key, label, icon, href, roles, workspaces]
const ITEMS = [
  ['reservation', 'Reservation', 'bed', '#/reservations?new=1', MGR, STAY],
  ['listing', 'Listing', 'building', '#/listings?new=1', MGR, STAY],
  ['property', 'Property', 'building', '#/properties?new=1', ['owner'], RENT],
  ['owner', 'Unit owner', 'users', '#/owners?new=1', ['owner'], STAY],
  ['cleaning', 'Cleaning task', 'sparkle', '#/housekeeping?new=1', MGR, STAY],
  ['expense', 'Expense', 'wallet', '#/rent?tab=expenses&new=expense', [...MGR, 'staff'], ALL],
  ['tenant', 'Tenant', 'users', '#/tenants?new=1', MGR, RENT],
  ['rent_payment', 'Rent payment', 'cash', '#/rent?new=payment', [...MGR, 'staff'], RENT],
  ['invite', 'Invite a teammate', 'plus', '#/settings?invite=1', ['owner'], ALL],
];

export function addNewItems(user) {
  if (!user || user.plan?.read_only || user.plan?.is_demo) return [];
  return ITEMS
    .filter(([, , , href, roles, spaces]) => roles.includes(user.role) && spaces.includes(user.business_type) && routeAllowed(href.slice(1).split('?')[0], user))
    .map(([key, label, ic, href]) => ({ key, label, icon: ic, href }));
}

export function renderAddMenu(panel, ctx, pop) {
  panel.replaceChildren(
    h('h2', { class: 'tb-pop__title' }, 'Add new'),
    h('ul', { role: 'menu', 'aria-label': 'Add new', class: 'tb-menu' },
      addNewItems(ctx.user()).map((i) => h('li', { role: 'none' },
        h('a', { role: 'menuitem', class: 'tb-item', href: i.href, onClick: () => pop.close({ returnFocus: false }) }, icon(i.icon), h('span', null, i.label))))));
}
