// BalayHub single-page app: routing, session state and the app shell.

import { get, post, onAuthLost } from './api.js';
import { h, icon, brand, toast, errorState, skeleton } from './ui.js';
import * as authViews from './views/auth.js';
import { dashboardView } from './views/dashboard.js';
import { propertiesView, propertyDetailView } from './views/properties.js';
import { tenantsView, tenantDetailView } from './views/tenants.js';
import { rentView, paymentDetailView, expenseDetailView } from './views/rent.js';
import { reportsView } from './views/reports.js';
import { maintenanceView, maintenanceDetailView } from './views/maintenance.js';
import { settingsView } from './views/settings.js';
import { privacyView } from './views/privacy.js';
import { homeView } from './views/home.js';
import { calendarView } from './views/calendar.js';
import { reservationsView, reservationDetailView, receiptView } from './views/reservations.js';
import { groupsView, groupDetailView } from './views/groups.js';
import { dailyCloseView } from './views/dailyclose.js';
import { listingsView, guestsView, guestDetailView } from './views/listings.js';
import { inboxView, inboxSettingsView, unreadCount } from './views/inbox.js';
import { housekeepingView, housekeepingDetailView } from './views/housekeeping.js';
import { landingView } from './views/landing.js';
import { adminView } from './views/admin.js';
import { guestCheckinView } from './views/checkin.js';
import { termsView } from './views/terms.js';
import { bookHostView, bookListingView, bookDoneView } from './views/book.js';
import { launchpadView } from './views/launchpad.js';
import { payBalanceView } from './views/pay.js';
import { pricingView } from './views/pricing.js';
import { ownersView, ownerStatementView, ownerStatementsView } from './views/owners.js';
import { pnlView } from './views/pnl.js';
import * as portal from './views/ownerportal.js';
import { guestReviewView } from './views/review.js';
import { gatepassSettingsView, gatepassPublicView } from './views/gatepass.js';
import { stayReportsView } from './views/stayreports.js';
import { reviewsView, discountCodesView } from './views/guestcare.js';
import { accountView } from './views/account.js';
import { helpView, helpNewView, helpTicketView, adminSupportView, adminSupportTicketView } from './views/help.js';
import { cleanerPayView, myPayView } from './views/cleanerpay.js';
import { suppliesView } from './views/supplies.js';
import { lostFoundView } from './views/lostfound.js';
import { quoteView } from './views/quote.js';
import { guideView } from './views/guide.js';
import { addonsView } from './views/addons.js';
import { quotesView, quoteDetailView } from './views/quotes.js';
import { routeAllowed } from './routeaccess.js';
import { registerServiceWorker, forgetThisDevice } from './notifications.js';
import { themeSwitch } from './themeswitch.js';
import { assistantButton, placeAssistantButton, resetAssistant } from './assistant.js';

export const state = { user: null, requireEmailVerification: true };

const PUBLIC = 'public';      // only for signed-out visitors
const OPEN = 'open';          // anyone
const SIGNED_IN = 'signed-in'; // signed in, setup may be incomplete
const APP = 'app';            // fully set up workspace member

const routes = [
  ['/', landingView, PUBLIC],
  ['/login', authViews.loginView, PUBLIC],
  ['/signup', authViews.signupView, PUBLIC],
  ['/forgot', authViews.forgotView, PUBLIC],
  ['/reset-password', authViews.resetView, OPEN],
  ['/verify', authViews.verifyView, OPEN],
  ['/privacy', privacyView, OPEN],
  ['/terms', termsView, OPEN],
  ['/pay/:token', payBalanceView, OPEN],
  ['/review/:token', guestReviewView, OPEN],
  ['/gatepass/:token', gatepassPublicView, OPEN],
  ['/book/:slug', bookHostView, OPEN],
  ['/book/:slug/done/:token', bookDoneView, OPEN],
  ['/book/:slug/:unitId', bookListingView, OPEN],
  ['/checkin/:token', guestCheckinView, OPEN],
  ['/quote/:token', quoteView, OPEN],
  ['/guide/:token', guideView, OPEN],
  // Owner portal: its own sign-in (D-39), rendered bare (no team sidebar).
  ['/owner', portal.ownerSignInView, OPEN],
  ['/owner/signin', portal.ownerLinkView, OPEN],
  ['/owner/home', portal.ownerHomeView, OPEN],
  ['/owner/statements', portal.ownerStatementsListView, OPEN],
  ['/owner/statements/:month', portal.ownerStatementView, OPEN],
  ['/owner/bookings', portal.ownerBookingsView, OPEN],
  ['/owner/money', portal.ownerMoneyView, OPEN],
  ['/owner/pnl', portal.ownerPnlView, OPEN],
  ['/verify-pending', authViews.verifyPendingView, SIGNED_IN],
  ['/setup', authViews.setupView, SIGNED_IN],
  ['/dashboard', dashboardView, APP],
  ['/properties', propertiesView, APP],
  ['/properties/:id', propertyDetailView, APP],
  ['/tenants', tenantsView, APP],
  ['/tenants/:id', tenantDetailView, APP],
  ['/rent', rentView, APP],
  ['/payments/:id', paymentDetailView, APP],
  ['/expenses/:id', expenseDetailView, APP],
  ['/reports', reportsView, APP],
  ['/maintenance', maintenanceView, APP],
  ['/maintenance/:id', maintenanceDetailView, APP],
  ['/settings', settingsView, APP],
  ['/home', homeView, APP],
  ['/launchpad', launchpadView, APP],
  ['/calendar', calendarView, APP],
  ['/pricing', pricingView, APP],
  ['/owners', ownersView, APP],
  ['/reviews', reviewsView, APP],
  ['/discount-codes', discountCodesView, APP],
  ['/gatepass-settings', gatepassSettingsView, APP],
  ['/stay-reports', stayReportsView, APP],
  ['/owners/statements', ownerStatementsView, APP],
  ['/owners/:id/statement', ownerStatementView, APP],
  ['/pnl', pnlView, APP],
  ['/reservations', reservationsView, APP],
  ['/reservations/:id', reservationDetailView, APP],
  ['/groups', groupsView, APP],
  ['/groups/:id', groupDetailView, APP],
  ['/daily-close', dailyCloseView, APP],
  ['/listings', listingsView, APP],
  ['/guests', guestsView, APP],
  ['/guests/:id', guestDetailView, APP],
  ['/receipts/:id', receiptView, APP],
  ['/admin', adminView, APP],
  ['/admin/support', adminSupportView, APP],
  ['/admin/support/:id', adminSupportTicketView, APP],
  ['/account', accountView, APP],
  ['/help', helpView, APP],
  ['/help/new', helpNewView, APP],
  ['/help/tickets/:id', helpTicketView, APP],
  ['/inbox', inboxView, APP],
  ['/inbox/:id', inboxView, APP],
  ['/inbox-settings', inboxSettingsView, APP],
  ['/housekeeping', housekeepingView, APP],
  ['/housekeeping/:id', housekeepingDetailView, APP],
  ['/cleaner-pay', cleanerPayView, APP],
  ['/my-pay', myPayView, APP],
  ['/supplies', suppliesView, APP],
  ['/lost-found', lostFoundView, APP],
  ['/addons', addonsView, APP],
  ['/quotes', quotesView, APP],
  ['/quotes/:id', quoteDetailView, APP],
];

const NAV_SHORT = [
  ['/launchpad', 'Launchpad', 'rocket'],
  ['/home', 'Home', 'home'],
  ['/inbox', 'Inbox', 'inbox'],
  ['/calendar', 'Calendar', 'calendar'],
  ['/reservations', 'Reservations', 'bed'],
  ['/groups', 'Group bookings', 'users'],
  ['/daily-close', 'Daily close', 'file'],
  ['/housekeeping', 'Housekeeping', 'sparkle'],
  ['/listings', 'Listings', 'building'],
  ['/guests', 'Guests', 'users'],
  ['/quotes', 'Quotes', 'file'],
  ['/addons', 'Add-ons', 'sparkle'],
  ['/owners', 'Unit owners', 'file'],
  ['/stay-reports', 'Reports', 'chart'],
  ['/pnl', 'Profit and loss', 'chart'],
  ['/rent?tab=expenses', 'Expenses', 'wallet'],
  ['/maintenance', 'Maintenance', 'wrench'],
  ['/settings', 'Settings', 'settings'],
];
const NAV_LONG = [
  ['/dashboard', 'Dashboard', 'home'],
  ['/properties', 'Properties', 'building'],
  ['/tenants', 'Tenants', 'users'],
  ['/rent', 'Rent & Expenses', 'wallet'],
  ['/reports', 'Reports', 'chart'],
  ['/maintenance', 'Maintenance', 'wrench'],
  ['/settings', 'Settings', 'settings'],
];
const NAV_BOTH = [
  ['/launchpad', 'Launchpad', 'rocket'],
  ['/home', 'Home', 'home'],
  ['/inbox', 'Inbox', 'inbox'],
  ['/calendar', 'Calendar', 'calendar'],
  ['/reservations', 'Reservations', 'bed'],
  ['/groups', 'Group bookings', 'users'],
  ['/daily-close', 'Daily close', 'file'],
  ['/housekeeping', 'Housekeeping', 'sparkle'],
  ['/listings', 'Listings', 'building'],
  ['/dashboard', 'Long-term rentals', 'chart'],
  ['/tenants', 'Tenants', 'users'],
  ['/rent', 'Rent & Expenses', 'wallet'],
  ['/reports', 'Rental reports', 'chart'],
  ['/stay-reports', 'Stay reports', 'chart'],
  ['/pnl', 'Profit and loss', 'chart'],
  ['/guests', 'Guests', 'users'],
  ['/quotes', 'Quotes', 'file'],
  ['/addons', 'Add-ons', 'sparkle'],
  ['/owners', 'Unit owners', 'file'],
  ['/maintenance', 'Maintenance', 'wrench'],
  ['/settings', 'Settings', 'settings'],
];
// Cleaners see only their jobs, their own pay, Help and their account.
const CLEANER_NAV = [['/housekeeping', 'Cleaning', 'sparkle'], ['/my-pay', 'My pay', 'wallet'], ['/help', 'Help & support', 'help']];
const CLEANER_PATHS = ['/housekeeping', '/my-pay', '/account', '/help'];
const isCleanerPath = (path) => CLEANER_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
// Operations pages for owners and managers, placed after Housekeeping.
const OPS_NAV = [['/cleaner-pay', 'Cleaner pay', 'wallet'], ['/supplies', 'Supplies', 'wallet'], ['/lost-found', 'Lost and found', 'file']];// Staff see Supplies (assigned properties) but not pay or lost-and-found.
const STAFF_OPS_NAV = OPS_NAV.filter(([p]) => p === '/supplies');
// Staff don't see guest conversations; the platform admin gets an Admin link.
const navFor = () => state.user?.role === 'cleaner' ? CLEANER_NAV : [...({ short_term: NAV_SHORT, both: NAV_BOTH }[state.user?.business_type] || NAV_LONG)
  .filter(([p]) => (p !== '/inbox' || state.user?.role !== 'staff') && (!['/launchpad', '/owners'].includes(p) || state.user?.role === 'owner') && (!['/stay-reports', '/pnl'].includes(p) || state.user?.role !== 'staff') && (!['/quotes', '/addons', '/daily-close'].includes(p) || ['owner', 'manager'].includes(state.user?.role))),
['/help', 'Help & support', 'help'],
...(state.user?.is_platform_admin ? [['/admin', 'Admin', 'shield']] : [])].flatMap((n) => (n[0] === '/housekeeping' && state.user?.business_type !== 'long_term' ? [n, ...(state.user?.role === 'staff' ? STAFF_OPS_NAV : OPS_NAV)] : [n]));

// Trial / read-only / demo notice at the top of every app page.
function planBanner() {
  const p = state.user?.plan;
  if (!p) return null;
  if (p.is_demo) {
    return h('div', { class: 'planbar planbar--demo' },
      h('span', null, "You're exploring the demo. Changes are turned off."),
      h('button', { class: 'btn btn--primary btn--sm', onclick: async () => { try { await post('/auth/logout'); } catch { /* ignore */ } state.user = null; navigate('#/signup', { replace: true }); } }, 'Start your free trial'));
  }
  const owner = state.user.role === 'owner';
  if (p.reason === 'deleting') {
    const when = new Date(p.deletion_scheduled_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' });
    return h('div', { class: 'planbar planbar--bad', role: 'status' },
      h('span', null, `This workspace will be permanently deleted on ${when}. It is view-only until then.`),
      owner && h('button', { class: 'btn btn--primary btn--sm', onclick: async () => {
        try { await post('/workspace/delete/cancel'); await refreshUser(); toast('Deletion cancelled. Your workspace is back to normal.'); render(); } catch (err) { toast(err.message, 'error'); }
      } }, 'Cancel deletion'));
  }
  if (p.read_only) {
    return h('div', { class: 'planbar planbar--bad', role: 'status' },
      h('span', null, p.reason === 'trial_ended' ? 'Your free trial has ended. Your data is safe and view-only.' : 'Your plan payment is overdue. Your workspace is view-only.'),
      owner ? h('a', { class: 'btn btn--primary btn--sm', href: '#/settings' }, 'Choose a plan') : h('span', null, 'Ask the workspace owner to renew.'));
  }
  if (p.plan === 'trial' && p.trial_days_left <= 14) {
    return h('div', { class: 'planbar' },
      h('span', null, `Free trial: ${p.trial_days_left} day${p.trial_days_left === 1 ? '' : 's'} left`),
      owner && h('a', { href: '#/settings' }, 'See plans'));
  }
  if (p.reason === 'grace' && owner) {
    return h('div', { class: 'planbar planbar--warn' }, h('span', null, `Your plan was paid until ${p.paid_until}. Please renew soon.`), h('a', { href: '#/settings' }, 'Renew'));
  }
  return null;
}
// Phone bottom bar: the first four everyday screens; everything else is under "More".
const bottomNav = () => navFor().filter(([p]) => p !== '/launchpad').slice(0, 4);
const moreNav = () => { const b = bottomNav(); return navFor().filter((n) => !b.includes(n)); };
export const homeRoute = () => (state.user?.role === 'cleaner' ? '#/housekeeping' : state.user?.business_type === 'long_term' ? '#/dashboard' : '#/home');

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, q = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(q)) };
}

function match(path) {
  for (const [pattern, view, access] of routes) {
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
    const m = re.exec(path);
    if (m) return { view, access, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', hash); else history.pushState(null, '', hash);
  render();
}

export async function refreshUser() {
  try {
    const me = await get('/auth/me');
    state.user = me.user;
    state.requireEmailVerification = me.requireEmailVerification;
  } catch (err) {
    if (err.offline) throw err;
    state.user = null;
  }
}

const isReady = (u) => u && u.organization_id && (u.email_verified || !state.requireEmailVerification);

function setupRedirect() {
  const u = state.user;
  if (!u) return '#/login';
  if (!u.email_verified && state.requireEmailVerification) return '#/verify-pending';
  if (!u.organization_id) return '#/setup';
  return null;
}

// ---------------------------------------------------------------- shell
let shell = null;

const isCurrent = (path, current) => current === path.split('?')[0] || current.startsWith(`${path.split('?')[0]}/`);
function navLink([path, text, ic], current) {
  return h('a', { href: `#${path}`, 'aria-current': isCurrent(path, current) ? 'page' : null }, icon(ic), h('span', null, text));
}

export async function logout() {
  await forgetThisDevice();
  resetAssistant();
  try { await post('/auth/logout'); } catch { /* ignore */ }
  state.user = null;
  try { sessionStorage.clear(); } catch { /* ignore */ }
  navigate('#/login', { replace: true });
}

function openMore(current) {
  const close = () => sheet.remove();
  const sheet = h('div', { class: 'morenav', onclick: (e) => { if (e.target === sheet) close(); } },
    h('div', { class: 'morenav__sheet', role: 'menu' },
      h('a', { href: '#/account', onclick: close, 'aria-current': isCurrent('/account', current) ? 'page' : null }, icon('users'), 'My account'),
      moreNav().map(([p, t, ic]) => h('a', { href: `#${p}`, onclick: close, 'aria-current': isCurrent(p, current) ? 'page' : null }, icon(ic), t)),
      h('div', { class: 'morenav__theme' }, themeSwitch()),
      h('button', { onclick: () => { close(); logout(); } }, icon('logout'), 'Log out')));
  document.body.append(sheet);
}

const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';

function buildShell(path) {
  const u = state.user;
  const content = h('main', { class: 'content', id: 'main' });
  const NAV = navFor();
  const bottomKeys = bottomNav();
  const el = h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      brand(homeRoute()),
      h('nav', { 'aria-label': 'Main' }, NAV.map((n) => navLink(n, path))),
      h('div', { class: 'sidebar__foot' },
        h('a', { class: 'sidebar__me', href: '#/account', 'aria-current': isCurrent('/account', path) ? 'page' : null },
          h('span', { class: 'acct-avatar acct-avatar--sm', 'aria-hidden': 'true' }, initials(u.full_name)),
          h('span', null, h('strong', null, u.full_name), h('span', null, `${u.organization_name} · ${({ owner: 'Owner', manager: 'Manager', staff: 'Staff', cleaner: 'Cleaner' })[u.role]}`))),
        themeSwitch({ compact: true }),
        h('button', { class: 'btn btn--secondary btn--sm btn--block', onclick: logout }, 'Log out'))),
    h('header', { class: 'topbar' }, brand(homeRoute()), h('span', { class: 'topbar__assist' }),
      h('a', { class: 'topbar__me', href: '#/account', 'aria-label': 'My account' }, h('span', { class: 'topbar__org' }, u.organization_name), h('span', { class: 'acct-avatar acct-avatar--sm', 'aria-hidden': 'true' }, initials(u.full_name)))),
    h('div', { class: 'shell__main' }, planBanner(), content),
    h('nav', { class: 'bottomnav', 'aria-label': 'Main' },
      bottomKeys.map(([p, t, ic]) => h('a', { href: `#${p}`, 'aria-current': isCurrent(p, path) ? 'page' : null }, icon(ic), t === 'Rent & Expenses' ? 'Rent' : t)),
      h('button', { type: 'button', onclick: () => openMore(path), 'aria-current': moreNav().some(([p]) => isCurrent(p, path)) ? 'page' : null }, icon('more'), 'More')),
    u.role === 'cleaner' ? null : assistantButton());
  // Unread guest messages badge on the Inbox link.
  if (u.role !== 'cleaner') unreadCount().then((n) => {
    if (!n) return;
    el.querySelectorAll('a[href="#/inbox"]').forEach((a) => a.append(h('span', { class: 'navbadge', 'aria-label': `${n} unread` }, n > 99 ? '99+' : String(n))));
  });
  return { el, content };
}

// ---------------------------------------------------------------- render
const PUBLIC_TITLES = { '/login': 'Log in', '/signup': 'Sign up', '/forgot': 'Forgot password' };
let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  const app = document.getElementById('app');
  const route = match(path);
  if (!route) { navigate(state.user ? homeRoute() : '#/', { replace: true }); return; }

  if (route.access === PUBLIC && isReady(state.user)) { navigate(homeRoute(), { replace: true }); return; }
  if (route.access === SIGNED_IN && !state.user) { navigate('#/login', { replace: true }); return; }
  if (route.access === APP && !isReady(state.user)) {
    if (!state.user) { try { sessionStorage.setItem('bh-return', location.hash); } catch { /* ignore */ } }
    navigate(setupRedirect(), { replace: true });
    return;
  }

  // A cleaner opening anything that isn't theirs goes to their jobs, not an error page.
  if (route.access === APP && state.user?.role === 'cleaner' && !isCleanerPath(path)) { navigate('#/housekeeping', { replace: true }); return; }

  // Pages this role or workspace module can't use go home instead of opening by URL.
  if (route.access === APP && !routeAllowed(path, state.user)) { toast("That page isn't available for your role or workspace.", 'error'); navigate(homeRoute(), { replace: true }); return; }

  document.querySelectorAll('dialog.modal, .morenav').forEach((d) => d.remove());
  const ctx = { params: route.params, query, state, navigate, rerender: render };

  if (route.access === APP) {
    // The screen someone was on before Help, attached to a support ticket.
    if (!path.startsWith('/help')) state.lastPage = location.hash;
    shell = buildShell(path);
    app.replaceChildren(shell.el);
    placeAssistantButton();
    const mount = shell.content;
    mount.replaceChildren(skeleton());
    try {
      await route.view(mount, ctx);
    } catch (err) {
      if (seq !== renderSeq) return;
      if (err.status === 401) return;
      mount.replaceChildren(errorState(err, render));
    }
    const title = mount.querySelector('h1')?.textContent;
    document.title = title ? `${title} — BalayHub` : 'BalayHub';
    if (seq === renderSeq) window.scrollTo(0, 0);
  } else {
    shell = null;
    const mount = h('div');
    app.replaceChildren(mount);
    document.title = 'BalayHub — Rental Property Management';
    try { await route.view(mount, ctx); } catch (err) { mount.replaceChildren(errorState(err, render)); }
    // Landing keeps the site title; sign-in pages have friendly h1s, so name them; others use their h1 (minus a leading brand name).
    const title = path === '/' ? '' : PUBLIC_TITLES[path] || mount.querySelector('h1')?.textContent.replace(/^BalayHub /, '').replace(/^Terms of Service/, 'Terms of service');
    if (seq === renderSeq && title) document.title = `${title} — BalayHub`;
  }
}

// Keyboard users can only scroll a table box that can take focus.
function labelTableWraps(root) {
  root.querySelectorAll('.table-wrap:not([role])').forEach((w) => {
    const heading = w.closest('.card, section, main')?.querySelector('h1, h2, h3');
    w.setAttribute('role', 'region');
    w.setAttribute('tabindex', '0');
    w.setAttribute('aria-label', `${heading?.textContent.trim() || 'Table'} (scrollable)`);
  });
}
new MutationObserver(() => labelTableWraps(document.getElementById('app'))).observe(document.getElementById('app'), { childList: true, subtree: true });

// ---------------------------------------------------------------- session events
onAuthLost(async (err) => {
  if (err.status === 401) {
    const wasSignedIn = Boolean(state.user);
    state.user = null;
    try { sessionStorage.setItem('bh-return', location.hash); } catch { /* ignore */ }
    if (wasSignedIn) toast('Your session expired. Log in again — your unsaved input is kept.', 'error');
    navigate('#/login?expired=1', { replace: true });
  } else {
    await refreshUser();
    navigate(setupRedirect() || homeRoute(), { replace: true });
  }
});

export async function afterLogin() {
  let ret = null;
  try { ret = sessionStorage.getItem('bh-return'); sessionStorage.removeItem('bh-return'); } catch { /* ignore */ }
  let next = setupRedirect() || (ret && ret.startsWith('#/') && !/^#\/(login|signup|$)/.test(ret) ? ret : null);
  // Owners still setting up start on the Launchpad (until it's finished or they hide the reminder).
  const u = state.user;
  if (!next && u?.role === 'owner' && u.business_type !== 'long_term' && !u.plan?.is_demo) {
    try {
      const o = await get('/onboarding');
      if (!o.complete && !o.dismissed) next = '#/launchpad';
    } catch { /* fall back to Home */ }
  }
  navigate(next || homeRoute(), { replace: true });
}

function updateOnline() {
  document.getElementById('offline-banner').hidden = navigator.onLine;
}
window.addEventListener('online', () => { updateOnline(); toast('Back online.'); });
window.addEventListener('offline', updateOnline);
window.addEventListener('hashchange', render);

// Below 960px the bottom bar covers the lower edge of the screen, and the browser only scrolls a focused control to that edge, so Tab can
// reach a control hidden under the bar (WCAG 2.4.11). Scroll such a control clear of the bar.
document.addEventListener('focusin', (e) => {
  const bar = document.querySelector('.bottomnav');
  if (!bar || !window.matchMedia('(max-width: 959px)').matches || !(e.target instanceof Element)) return;
  // The bar's own controls and the layers above the page (chat panel, More sheet, dialogs) don't move with the page, so scrolling would only shift the page.
  if (e.target.closest('.bottomnav, .assist, .morenav, dialog')) return;
  const hidden = e.target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
  if (hidden > 0) window.scrollBy(0, hidden + 16);
});

(async function boot() {
  updateOnline();
  registerServiceWorker();
  try {
    await refreshUser();
  } catch {
    document.getElementById('app').replaceChildren(errorState({ message: "Can't reach BalayHub. Check your internet connection." }, () => location.reload()));
    return;
  }
  render();
}());
