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
import { listingsView, guestsView, guestDetailView } from './views/listings.js';
import { inboxView, inboxSettingsView, unreadCount } from './views/inbox.js';
import { housekeepingView, housekeepingDetailView } from './views/housekeeping.js';

export const state = { user: null, requireEmailVerification: true };

const PUBLIC = 'public';      // only for signed-out visitors
const OPEN = 'open';          // anyone
const SIGNED_IN = 'signed-in'; // signed in, setup may be incomplete
const APP = 'app';            // fully set up workspace member

const routes = [
  ['/', authViews.welcomeView, PUBLIC],
  ['/login', authViews.loginView, PUBLIC],
  ['/signup', authViews.signupView, PUBLIC],
  ['/forgot', authViews.forgotView, PUBLIC],
  ['/reset-password', authViews.resetView, OPEN],
  ['/verify', authViews.verifyView, OPEN],
  ['/privacy', privacyView, OPEN],
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
  ['/calendar', calendarView, APP],
  ['/reservations', reservationsView, APP],
  ['/reservations/:id', reservationDetailView, APP],
  ['/listings', listingsView, APP],
  ['/guests', guestsView, APP],
  ['/guests/:id', guestDetailView, APP],
  ['/receipts/:id', receiptView, APP],
  ['/inbox', inboxView, APP],
  ['/inbox/:id', inboxView, APP],
  ['/inbox-settings', inboxSettingsView, APP],
  ['/housekeeping', housekeepingView, APP],
  ['/housekeeping/:id', housekeepingDetailView, APP],
];

const NAV_SHORT = [
  ['/home', 'Home', 'home'],
  ['/inbox', 'Inbox', 'inbox'],
  ['/calendar', 'Calendar', 'calendar'],
  ['/reservations', 'Reservations', 'bed'],
  ['/housekeeping', 'Housekeeping', 'sparkle'],
  ['/listings', 'Listings', 'building'],
  ['/guests', 'Guests', 'users'],
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
  ['/home', 'Home', 'home'],
  ['/inbox', 'Inbox', 'inbox'],
  ['/calendar', 'Calendar', 'calendar'],
  ['/reservations', 'Reservations', 'bed'],
  ['/housekeeping', 'Housekeeping', 'sparkle'],
  ['/listings', 'Listings', 'building'],
  ['/dashboard', 'Long-term rentals', 'chart'],
  ['/tenants', 'Tenants', 'users'],
  ['/rent', 'Rent & Expenses', 'wallet'],
  ['/reports', 'Reports', 'chart'],
  ['/guests', 'Guests', 'users'],
  ['/maintenance', 'Maintenance', 'wrench'],
  ['/settings', 'Settings', 'settings'],
];
// Staff don't see guest conversations.
const navFor = () => ({ short_term: NAV_SHORT, both: NAV_BOTH }[state.user?.business_type] || NAV_LONG)
  .filter(([p]) => p !== '/inbox' || state.user?.role !== 'staff');
export const homeRoute = () => (state.user?.business_type === 'long_term' ? '#/dashboard' : '#/home');

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

async function logout() {
  try { await post('/auth/logout'); } catch { /* ignore */ }
  state.user = null;
  try { sessionStorage.clear(); } catch { /* ignore */ }
  navigate('#/login', { replace: true });
}

function openMore(current) {
  const close = () => sheet.remove();
  const sheet = h('div', { class: 'morenav', onclick: (e) => { if (e.target === sheet) close(); } },
    h('div', { class: 'morenav__sheet', role: 'menu' },
      navFor().slice(4).map(([p, t, ic]) => h('a', { href: `#${p}`, onclick: close, 'aria-current': isCurrent(p, current) ? 'page' : null }, icon(ic), t)),
      h('button', { onclick: () => { close(); logout(); } }, icon('logout'), 'Log out')));
  document.body.append(sheet);
}

function buildShell(path) {
  const u = state.user;
  const content = h('main', { class: 'content', id: 'main' });
  const NAV = navFor();
  const bottomKeys = NAV.slice(0, 4);
  const el = h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      brand(homeRoute()),
      h('nav', { 'aria-label': 'Main' }, NAV.map((n) => navLink(n, path))),
      h('div', { class: 'sidebar__foot' },
        h('strong', null, u.full_name),
        h('span', null, `${u.organization_name} · ${({ owner: 'Owner', manager: 'Manager', staff: 'Staff' })[u.role]}`),
        h('button', { class: 'btn btn--secondary btn--sm btn--block', onclick: logout }, 'Log out'))),
    h('header', { class: 'topbar' }, brand(homeRoute()), h('span', { class: 'topbar__org' }, u.organization_name)),
    content,
    h('nav', { class: 'bottomnav', 'aria-label': 'Main' },
      bottomKeys.map(([p, t, ic]) => h('a', { href: `#${p}`, 'aria-current': isCurrent(p, path) ? 'page' : null }, icon(ic), t === 'Rent & Expenses' ? 'Rent' : t)),
      h('button', { type: 'button', onclick: () => openMore(path), 'aria-current': NAV.slice(4).some(([p]) => isCurrent(p, path)) ? 'page' : null }, icon('more'), 'More')));
  // Unread guest messages badge on the Inbox link.
  unreadCount().then((n) => {
    if (!n) return;
    el.querySelectorAll('a[href="#/inbox"]').forEach((a) => a.append(h('span', { class: 'navbadge', 'aria-label': `${n} unread` }, n > 99 ? '99+' : String(n))));
  });
  return { el, content };
}

// ---------------------------------------------------------------- render
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

  document.querySelectorAll('dialog.modal, .morenav').forEach((d) => d.remove());
  const ctx = { params: route.params, query, state, navigate, rerender: render };

  if (route.access === APP) {
    shell = buildShell(path);
    app.replaceChildren(shell.el);
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
    try { await route.view(mount, ctx); } catch (err) { mount.replaceChildren(errorState(err, render)); }
    document.title = 'BalayHub — Rental Property Management';
  }
}

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

export function afterLogin() {
  let ret = null;
  try { ret = sessionStorage.getItem('bh-return'); sessionStorage.removeItem('bh-return'); } catch { /* ignore */ }
  const next = setupRedirect() || (ret && ret.startsWith('#/') && !/^#\/(login|signup|$)/.test(ret) ? ret : homeRoute());
  navigate(next, { replace: true });
}

function updateOnline() {
  document.getElementById('offline-banner').hidden = navigator.onLine;
}
window.addEventListener('online', () => { updateOnline(); toast('Back online.'); });
window.addEventListener('offline', updateOnline);
window.addEventListener('hashchange', render);

(async function boot() {
  updateOnline();
  try {
    await refreshUser();
  } catch {
    document.getElementById('app').replaceChildren(errorState({ message: "Can't reach BalayHub. Check your internet connection." }, () => location.reload()));
    return;
  }
  render();
}());
