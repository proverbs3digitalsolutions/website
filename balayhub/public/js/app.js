// BalayHub single-page app: routing, session state and the app shell.

import { get, post, onAuthLost, ApiError } from './api.js';
import { h, icon, brand, toast, pageError, skeleton, installFocusGuard } from './ui.js';
import { buildTopbar, updateTopbar, installTopbarKeys } from './topbar.js';
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
import { adminCouponsView } from './views/admincoupons.js';
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
import { cardCheckView } from './views/cardcheck.js';
import { routeAllowed } from './routeaccess.js';
import { registerServiceWorker, forgetThisDevice } from './notifications.js';
import { themeSwitch } from './themeswitch.js';
import { assistantButton, placeAssistantButton, resetAssistant } from './assistant.js';
import { h1Title } from './i18n.js';
import * as i18n from './i18n.js';

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
  ['/admin/coupons', adminCouponsView, APP],
  ['/admin/support', adminSupportView, APP],
  ['/admin/support/:id', adminSupportTicketView, APP],
  ['/confirm-card', cardCheckView, APP],
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
// Until the card is confirmed (D-98) the menu is only that page and Help; Account and Log out sit in the sidebar foot.
const CARD_NAV = [['/confirm-card', 'Confirm your card', 'wallet'], ['/help', 'Help & support', 'help']];
export const navFor = (user = state.user) => user?.plan?.card_check_due ? CARD_NAV : user?.role === 'cleaner' ? CLEANER_NAV : [...({ short_term: NAV_SHORT, both: NAV_BOTH }[user?.business_type] || NAV_LONG)
  .filter(([p]) => (p !== '/inbox' || user?.role !== 'staff') && (!['/launchpad', '/owners'].includes(p) || user?.role === 'owner') && (!['/stay-reports', '/pnl'].includes(p) || user?.role !== 'staff') && (!['/quotes', '/addons', '/daily-close'].includes(p) || ['owner', 'manager'].includes(user?.role))),
['/help', 'Help & support', 'help'],
...(user?.is_platform_admin ? [['/admin', 'Admin', 'shield']] : [])].flatMap((n) => (n[0] === '/housekeeping' && user?.business_type !== 'long_term' ? [n, ...(user?.role === 'staff' ? STAFF_OPS_NAV : OPS_NAV)] : [n]));
// The menu in four groups (D-85, alpha hosts own 1 to 3 properties): the daily screens first, the rarely used ones under "More tools".
// Nothing is removed. A path no group lists lands in More tools, so a new menu entry can never go missing. The long-term and cleaner menus stay flat.
const NAV_GROUPS = [
  { id: 'day', title: 'Every day', paths: ['/launchpad', '/home', '/inbox', '/calendar', '/reservations', '/housekeeping', '/guests'] },
  { id: 'money', title: 'Money', paths: ['/stay-reports', '/reports', '/pnl', '/rent?tab=expenses', '/rent'] },
  { id: 'more', title: 'More tools', paths: ['/groups', '/cleaner-pay', '/owners', '/daily-close', '/quotes', '/addons', '/supplies', '/lost-found', '/maintenance', '/dashboard', '/tenants'] },
  { id: 'setup', title: 'Setup', paths: ['/listings', '/settings', '/help', '/admin'] },
];
export function navGroups(user = state.user, items = navFor(user)) {
  if (user?.role === 'cleaner' || user?.business_type === 'long_term' || user?.plan?.card_check_due) return [{ id: 'all', title: null, items }];
  const placed = new Set(NAV_GROUPS.flatMap((g) => g.paths));
  return NAV_GROUPS.map((g) => ({ id: g.id, title: g.title,
    items: [...g.paths.map((p) => items.find((n) => n[0] === p)).filter(Boolean), ...(g.id === 'more' ? items.filter((n) => !placed.has(n[0])) : [])] }))
    .filter((g) => g.items.length);
}

// Trial / read-only / demo notice at the top of every app page. The trial reminder shows only in the last 3 days.
function planBanner() {
  const p = state.user?.plan;
  if (!p) return null;
  if (p.card_check_due) return null; // the Confirm your payment card page says it all
  if (p.is_demo) {
    return h('div', { class: 'planbar planbar--demo' },
      h('span', null, "You're exploring the demo. Changes are turned off."),
      h('button', { class: 'btn btn--primary btn--sm', onclick: async () => { try { await post('/auth/logout'); } catch { /* ignore */ } state.user = null; forgetSetupAnswers(); navigate('#/signup', { replace: true }); } }, 'Start your free trial'));
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
  if (p.plan === 'trial' && p.trial_days_left <= 3) {
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
// Shorter names for the phone bottom bar only (#45); the sidebar and More sheet keep the long ones.
const BOTTOM_LABELS = { 'Rent & Expenses': 'Rent', 'Group bookings': 'Groups', 'Help & support': 'Help' };
const bottomNav = () => navFor().filter(([p]) => p !== '/launchpad').slice(0, 4);
const moreNav = () => { const b = bottomNav(); return navFor().filter((n) => !b.includes(n)); };
export const homeRoute = () => (state.user?.plan?.card_check_due ? '#/confirm-card' : state.user?.role === 'cleaner' ? '#/housekeeping' : state.user?.business_type === 'long_term' ? '#/dashboard' : '#/home');

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, q = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(q)) };
}

function match(path) {
  // A blank id (#/payments/%20) or a broken escape (#/payments/%E0%A4%A) is not a record. It gets the Not found state a 404 gives,
  // and the view never calls the API. A guest page (open) still runs its view, with a token that can't exist, so the page shows its own
  // not-valid card in the guest's language.
  const incomplete = async () => { throw new ApiError('This link is incomplete. Check the address, or go back and try again.', { status: 404 }); };
  // A trailing slash (#/pay/) leaves an empty last segment: no route has one, so a second pass lets the last value be empty.
  for (const q of path.length > 1 && path.endsWith('/') ? ['+', '*'] : ['+']) {
    for (const [pattern, view, access] of routes) {
      const names = [];
      const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return `([^/]${q})`; })}$`);
      const m = re.exec(path);
      if (m) {
        let params;
        try { params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])); } catch { return { view: incomplete, access, params: {} }; }
        const blank = Object.keys(params).filter((n) => !params[n].trim());
        if (blank.length) {
          if (access === 'open') params = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v.trim() ? v : '-']));
          // Only a blank id at the end of the address is an incomplete link; a blank one in the middle (#/owners/%20/statement) is no route.
          else if (blank.every((n) => pattern.endsWith(`:${n}`))) return { view: incomplete, access, params };
          else continue;
        }
        return { view, access, params };
      }
    }
  }
  return null;
}

// ---- Back keeps a list's place (D-97). The router owns the scroll: each history entry has a key in history.state and its scroll is
// remembered in memory, so Back (or a page's own ‹ link to the page you came from) returns to the same place. Views never touch the scroll.
// nav-helpers:start
const RESTORE_MS = 1500; // lists fetch their rows after the view returns, so the restore waits this long for the page to grow
const hashPath = (hash) => String(hash || '').replace(/^#/, '').split('?')[0] || '/';
// The other module's home is not an error: /dashboard on a stays workspace, /home on a rentals one.
export const otherHome = (path, user) => Boolean(user?.plan?.card_check_due) || path === '/confirm-card' || (path === '/dashboard' && user?.business_type === 'short_term') || (path === '/home' && user?.business_type === 'long_term');
// from: { fromHash, toKey }, the page this entry was opened from. True when a ‹ link points back at it.
export const backTarget = (linkHref, from, currentKey) => Boolean(from?.fromHash) && from.toKey === currentKey && hashPath(linkHref) === hashPath(from.fromHash);
export const restoreY = (saved, maxY) => Math.max(0, Math.min(saved, maxY));
// One step of a pending restore: 'stop' once the person acted, 'scroll' when the page is tall enough (or time is up), else 'wait'.
export const shouldRestore = (savedY, pageHeight, viewport, elapsed, userActed) => (userActed ? 'stop' : pageHeight - viewport >= savedY || elapsed >= RESTORE_MS ? 'scroll' : 'wait');
// nav-helpers:end
const SCROLL_KEEP = 50;
const positions = new Map(); // entry key -> scrollY
let entrySeq = 0;
let lastForward = null; // { fromHash, toKey }
let lastKey = null;
let lastHash = null;
const newKey = () => `${Date.now()}-${++entrySeq}`;
const entryKey = () => history.state?.bhEntry || null;
try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
// Views call history.replaceState(null, ...) for filter URLs; that must not wipe the entry's key.
const replaceState = history.replaceState.bind(history);
history.replaceState = (st, title, url) => replaceState(st ?? (entryKey() ? { bhEntry: entryKey() } : null), title, url);
window.addEventListener('scroll', () => {
  const k = entryKey();
  if (!k) return;
  positions.delete(k);
  positions.set(k, window.scrollY);
  if (positions.size > SCROLL_KEEP) positions.delete(positions.keys().next().value);
}, { passive: true });
document.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a.back') : null;
  if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (backTarget(a.getAttribute('href'), lastForward, entryKey())) { e.preventDefault(); history.back(); }
}, true);

// A Back to a remembered page arms this before the view loads, so a scroll the person makes while rows are still arriving is noticed
// and the restore then does nothing. It waits (without moving focus) for the page to be tall enough, scrolls once, and gives up if the
// person scrolls, types, taps or navigates.
let stopRestore = () => {};
let restoreActed = false;
let restoreRaf = 0;
function armRestore() {
  stopRestore();
  restoreActed = false;
  const EV = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  const act = () => { restoreActed = true; };
  EV.forEach((n) => window.addEventListener(n, act, { capture: true, passive: true }));
  stopRestore = () => { cancelAnimationFrame(restoreRaf); EV.forEach((n) => window.removeEventListener(n, act, true)); stopRestore = () => {}; };
}
function restoreScroll(savedY) {
  const t0 = performance.now();
  const step = () => {
    const todo = shouldRestore(savedY, document.documentElement.scrollHeight, window.innerHeight, performance.now() - t0, restoreActed);
    if (todo === 'wait') { restoreRaf = requestAnimationFrame(step); return; }
    if (todo === 'scroll') window.scrollTo(0, restoreY(savedY, document.documentElement.scrollHeight - window.innerHeight));
    stopRestore();
  };
  step();
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState({ bhEntry: newKey() }, '', hash); else history.pushState(null, '', hash);
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

// A sidebar group: a heading and its links. "More tools" folds away, open when you are on one of its pages or left it open (remembered in this browser).
const NAV_MORE_KEY = 'bh-nav-more';
function navGroup(g, current) {
  const links = g.items.map((n) => navLink(n, current));
  if (!g.title) return links;
  if (g.id !== 'more') return h('div', { class: 'nav__group' }, h('h2', { class: 'nav__group-title' }, g.title), links);
  return h('details', { class: 'nav__group nav__group--more', open: moreSaved() || g.items.some(([p]) => isCurrent(p, current)) },
    h('summary', { class: 'nav__group-title', onclick: saveMore }, g.title),
    links);
}
// The More tools fold is remembered in this browser, and shared by the sidebar and the phone More sheet.
function moreSaved() { try { return localStorage.getItem(NAV_MORE_KEY) === '1'; } catch { return false; } }
// The click comes before the toggle, so the box still holds the old state.
function saveMore(e) { try { localStorage.setItem(NAV_MORE_KEY, e.currentTarget.parentNode.open ? '0' : '1'); } catch { /* ignore */ } }

// The Get started answers belong to whoever typed them, not to the next person on this browser.
function forgetSetupAnswers() { try { localStorage.removeItem('bh-setup'); } catch { /* ignore */ } }

export async function logout() {
  await forgetThisDevice();
  resetAssistant();
  try { await post('/auth/logout'); } catch { /* ignore */ }
  // Recent searches belong to this person, not to the next one on a shared machine (key as in topsearch.js).
  try { localStorage.removeItem(`bh-recent-search-${state.user?.user_id ?? 'x'}`); } catch { /* ignore */ }
  state.user = null;
  try { sessionStorage.clear(); } catch { /* ignore */ }
  forgetSetupAnswers();
  navigate('#/login', { replace: true });
}

function openMore() {
  const current = parseHash().path; // read when the button is pressed: the shell outlives the page it was built on
  const moreBtn = document.activeElement;
  let panel; let picked = false; // picked: a link in the sheet was chosen
  const pick = () => { picked = true; sheet.close(); };
  const sheet = h('dialog', { class: 'morenav', 'aria-label': 'More', onclick: (e) => { if (e.target === sheet) sheet.close(); }, onkeydown: (e) => {
      if (e.key !== 'Tab') return;
      // A link inside a closed More tools fold can't take focus; its summary can.
      const items = [...sheet.querySelectorAll('a[href], button:not([disabled]), summary')].filter((x) => x.tagName === 'SUMMARY' || !x.closest('details:not([open])'));
      const first = items[0]; const last = items[items.length - 1];
      if (!first) return;
      // Shift+Tab from the first item, the scrollable panel or the dialog itself wraps to the last item.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet || document.activeElement === panel || !sheet.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    },
    // The close event fires after the click, so a route change chosen in the sheet must not pull focus back to More (the new heading takes it).
    // A chosen link to the page already open redraws nothing, so the heading takes focus here; closing without a link returns to More.
    onclose: () => {
      sheet.remove();
      if (parseHash().path !== current) return;
      if (picked) focusPageHeading(document.getElementById('app'));
      else if (moreBtn?.isConnected) moreBtn.focus();
    } },
    panel = h('div', { class: 'morenav__sheet' },
      h('button', { class: 'morenav__close', type: 'button', 'aria-label': 'Close menu', onclick: () => sheet.close() }, 'Close'),
      h('a', { href: '#/account', onclick: pick, 'aria-current': isCurrent('/account', current) ? 'page' : null }, icon('users'), 'My account'),
      navGroups(state.user, moreNav()).map((g) => {
        const links = g.items.map(([p, t, ic]) => h('a', { href: `#${p}`, onclick: pick, 'aria-current': isCurrent(p, current) ? 'page' : null }, icon(ic), t));
        // More tools folds like the sidebar (open on one of its pages or when left open); the other groups stay open.
        if (g.id === 'more' && g.title) {
          return h('details', { class: 'morenav__fold', open: moreSaved() || g.items.some(([p]) => isCurrent(p, current)) },
            h('summary', { class: 'morenav__group-title', onclick: saveMore }, g.title), links);
        }
        return [g.title && h('h2', { class: 'morenav__group-title' }, g.title), links];
      }),
      h('div', { class: 'morenav__theme' }, themeSwitch()),
      h('button', { onclick: () => { sheet.close(); logout(); } }, icon('logout'), 'Log out')));
  document.body.append(sheet);
  sheet.showModal();
  sheet.querySelector('a[href], button:not([disabled])')?.focus();
}

const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';

// What the top bar reads. Each is read when used: the shell outlives the page it was built on. topbar.js never imports this file.
const topbarCtx = {
  user: () => state.user,
  path: () => parseHash().path,
  hash: () => location.hash,
  nav: () => navFor(),
  home: () => homeRoute(),
  navigate, logout, routeAllowed,
};

function buildShell(path) {
  const u = state.user;
  const content = h('main', { class: 'content', id: 'main' });
  const banner = planBanner();
  const NAV = navFor();
  const bottomKeys = bottomNav();
  const el = h('div', { class: 'shell' },
    h('a', { class: 'skip-link', href: '#main', onclick: skipToMain }, 'Skip to main content'),
    h('aside', { class: 'sidebar' },
      brand(homeRoute()),
      h('nav', { 'aria-label': 'Main' }, navGroups(u, NAV).map((g) => navGroup(g, path))),
      h('div', { class: 'sidebar__foot' },
        h('a', { class: 'sidebar__me', href: '#/account', 'aria-current': isCurrent('/account', path) ? 'page' : null },
          h('span', { class: 'acct-avatar acct-avatar--sm', 'aria-hidden': 'true' }, initials(u.full_name)),
          h('span', null, h('strong', null, u.full_name), h('span', null, `${u.organization_name} · ${({ owner: 'Owner', manager: 'Manager', staff: 'Staff', cleaner: 'Cleaner' })[u.role]}`))),
        themeSwitch({ compact: true }),
        h('button', { class: 'btn btn--secondary btn--sm btn--block', onclick: logout }, 'Log out'))),
    buildTopbar(topbarCtx),
    h('div', { class: 'shell__main' }, banner, content),
    h('nav', { class: 'bottomnav', 'aria-label': 'Main' },
      bottomKeys.map(([p, t, ic]) => h('a', { href: `#${p}`, 'aria-current': isCurrent(p, path) ? 'page' : null }, icon(ic), BOTTOM_LABELS[t] || t)),
      // While the card check is due the bar is only Confirm your card and Help: no More (Account and Log out are in the page footer).
      u.plan?.card_check_due ? null : h('button', { type: 'button', onclick: openMore, 'aria-current': moreNav().some(([p]) => isCurrent(p, path)) ? 'page' : null }, icon('more'), 'More')),
    u.role === 'cleaner' ? null : assistantButton());
  refreshUnread(el);
  return { el, content, banner, main: el.querySelector('.shell__main') };
}

// "Skip to main content" moves focus to the page heading. The link is a hash, so the router must not see it.
function skipToMain(e) {
  e.preventDefault();
  const target = document.querySelector('#main h1') || document.getElementById('main');
  if (!target) return;
  target.setAttribute('tabindex', '-1');
  target.focus();
}

// Unread guest messages badge on the Inbox links (sidebar and bottom bar), refreshed in place.
function refreshUnread(el) {
  if (state.user?.role === 'cleaner') return;
  unreadCount().then((n) => {
    el.querySelectorAll('a[href="#/inbox"]').forEach((a) => {
      a.querySelector('.navbadge')?.remove();
      if (n) a.append(h('span', { class: 'navbadge', 'aria-label': `${n} unread` }, n > 99 ? '99+' : String(n)));
    });
  });
}

// Everything buildShell reads. While it is unchanged the shell stays on the page across route changes.
const shellKey = (u) => JSON.stringify([u.user_id, u.role, u.full_name, u.organization_id, u.organization_name, u.business_type, u.is_platform_admin,
  navFor(u).map((n) => n[0]), bottomNav().map((n) => n[0])]);

// A route change on a kept shell: only the current-page marks, the plan banner and the unread badges change. No sidebar element is replaced.
function updateShell(sh, path) {
  const mark = (a, on) => (on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  sh.el.querySelectorAll('.sidebar nav a, .sidebar__me, .bottomnav a').forEach((a) => mark(a, isCurrent(a.getAttribute('href').slice(1), path)));
  const more = sh.el.querySelector('.bottomnav button');
  if (more) mark(more, moreNav().some(([p]) => isCurrent(p, path)));
  const fold = sh.el.querySelector('details.nav__group--more');
  if (fold?.querySelector('a[aria-current="page"]')) fold.open = true; // opened by landing on one of its pages, never closed by navigation
  const banner = planBanner();
  if (sh.banner) { if (banner) sh.banner.replaceWith(banner); else sh.banner.remove(); } else if (banner) sh.main.prepend(banner);
  sh.banner = banner;
  refreshUnread(sh.el);
  updateTopbar(sh.el.querySelector('.topbar'), topbarCtx);
}

// ---------------------------------------------------------------- render
const PUBLIC_TITLES = { '/login': 'Log in', '/signup': 'Sign up', '/forgot': 'Forgot password' };
const RESET_TITLE = 'BalayHub — Rental Property Management';
let renderSeq = 0;
let shellSig = null; // shellKey of the shell on screen: the same key keeps the shell across route changes
let lastDrawing = null; // the path the shell on screen is drawing or showing
let drawnPath = null; // the path last drawn to the end: a different path next moves focus to the new page's heading

// Focus goes to the new page's heading after a route change, but only when nothing (a dialog, a field) has taken it.
// The link the person just clicked in the menu (the shell stays now) counts as free, so the heading still takes focus.
function focusPageHeading(root) {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected && !a.closest('.sidebar, .topbar, .bottomnav, .skip-link, .assist-fab')) return;
  const h1 = root.querySelector('h1');
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
}
export async function render() {
  const seq = ++renderSeq;
  stopRestore();
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
  if (route.access === APP && state.user?.role === 'cleaner' && !state.user.plan?.card_check_due && !isCleanerPath(path)) { navigate('#/housekeeping', { replace: true }); return; }

  // Pages this role or workspace module can't use go home instead of opening by URL.
  if (route.access === APP && !routeAllowed(path, state.user)) { if (!otherHome(path, state.user)) toast("That page isn't available for your role or workspace.", 'error'); navigate(homeRoute(), { replace: true }); return; }

  document.querySelectorAll('dialog.modal, .morenav, .tb-sheet').forEach((d) => d.remove());
  delete document.documentElement.dataset.h1title; // set below when a guest page's tab title is taken from its heading
  const ctx = { params: route.params, query, state, navigate, rerender: render };

  // Signed-in screens are the English host app too; only the verify screens stay in the guest's language.
  if (route.access === SIGNED_IN && route.view !== authViews.verifyView && route.view !== authViews.verifyPendingView) i18n.useHostLang?.();

  if (route.access === APP) {
    // The screen someone was on before Help, attached to a support ticket.
    if (!path.startsWith('/help')) state.lastPage = location.hash;
    i18n.useHostLang?.(); // a guest page may have left the in-memory language on Taglish
    // Same page again (rerender, report tab): the old page stays on screen, busy, until the new one is drawn.
    // A Back or Forward to a page whose scroll was remembered keeps the old page on screen the same way, then restores the place.
    let entry = entryKey();
    if (!entry) { entry = newKey(); history.replaceState({ bhEntry: entry }, ''); }
    const restoreTo = positions.has(entry) && lastDrawing !== path ? positions.get(entry) : null;
    if (restoreTo === null && entry !== lastKey) lastForward = { fromHash: lastHash, toKey: entry };
    if (restoreTo !== null) armRestore();
    lastKey = entry;
    lastHash = location.hash;
    const prev = shell?.content?.isConnected && (lastDrawing === path || restoreTo !== null) ? shell.content : null;
    const key = shellKey(state.user);
    if (shell?.el.isConnected && shellSig === key) updateShell(shell, path);
    else {
      // First render, sign-in, or a role or module change: a new shell, carrying over the sidebar's scroll and the More tools fold.
      const old = shell?.el.isConnected ? shell.el : null;
      const scrolled = old?.querySelector('.sidebar nav')?.scrollTop || 0;
      const folded = old?.querySelector('details.nav__group--more')?.open;
      shell = buildShell(path);
      shellSig = key;
      app.replaceChildren(shell.el);
      placeAssistantButton();
      const nav = shell.el.querySelector('.sidebar nav');
      if (nav) nav.scrollTop = scrolled;
      if (folded) shell.el.querySelector('details.nav__group--more').open = true;
      if (prev) { shell.content.replaceWith(prev); shell.content = prev; }
    }
    // The view always draws into its own detached page, so a slow view that was replaced by a newer one can't write into the page on screen.
    const mount = h('main', { class: 'content', id: 'main' });
    if (prev) prev.setAttribute('aria-busy', 'true');
    else {
      // A new page starts at the top: one scroll, now, and never again when the view finishes.
      shell.content.removeAttribute('aria-busy');
      shell.content.replaceChildren(skeleton());
      window.scrollTo(0, 0);
    }
    lastDrawing = path;
    try {
      await route.view(mount, ctx);
    } catch (err) {
      if (seq !== renderSeq) return;
      if (err.status === 401) return;
      mount.replaceChildren(pageError(err, render));
    }
    if (seq !== renderSeq) return;
    shell.content.replaceWith(mount);
    shell.content = mount;
    if (restoreTo !== null) restoreScroll(restoreTo);
    const title = mount.querySelector('h1')?.textContent;
    document.title = title ? `${title} — BalayHub` : 'BalayHub';
    // A page drawn under a skeleton (no old page kept) lost the old heading's focus, even when a redirect landed on the page it left (Reports to Stay reports).
    if (drawnPath !== null && (!prev || drawnPath !== path)) focusPageHeading(mount);
    drawnPath = path;
  } else {
    lastDrawing = null;
    shell = null;
    shellSig = null;
    const mount = h('div');
    app.replaceChildren(mount);
    document.title = RESET_TITLE;
    try { await route.view(mount, ctx); } catch (err) { mount.replaceChildren(pageError(err, render)); }
    // Landing keeps the site title; sign-in pages have friendly h1s, so name them; others use their h1 (minus a leading brand name).
    // A title the view set itself (the booking page names its host) is kept. Pages titled from the heading are marked so a language switch re-takes it.
    const title = path === '/' ? '' : PUBLIC_TITLES[path] || h1Title(mount);
    if (seq === renderSeq && title && document.title === RESET_TITLE) {
      document.title = `${title} — BalayHub`;
      if (!PUBLIC_TITLES[path]) document.documentElement.dataset.h1title = '1';
    }
    if (seq === renderSeq) {
      if (drawnPath !== null && drawnPath !== path) focusPageHeading(mount);
      drawnPath = path;
    }
  }
}

// Keyboard users can only scroll a table box that can take focus.
function labelTableWraps(root) {
  root.querySelectorAll('.table-wrap:not([role])').forEach((w) => {
    const heading = w.closest('.card, section, main')?.querySelector('h1, h2, h3') || document.querySelector('main h1');
    w.setAttribute('role', 'region');
    w.setAttribute('tabindex', '0');
    w.setAttribute('aria-label', `${heading?.textContent.trim() || 'Table'} (scrollable)`);
  });
}
// Scroll cue: mark a scroll box while columns are hidden on a side; the CSS fades that edge (is-more-left / is-more-right).
const cueSeen = new WeakSet();
const cueResize = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach((e) => updateScrollCue(e.target.__cueBox || e.target))) : null;
function updateScrollCue(box) {
  box.classList.toggle('is-more-left', box.scrollLeft > 1);
  box.classList.toggle('is-more-right', box.scrollLeft + box.clientWidth < box.scrollWidth - 1);
}
function watchScrollCues(root) {
  root.querySelectorAll('.table-wrap, .cal-scroll').forEach((box) => {
    if (cueSeen.has(box)) return;
    cueSeen.add(box);
    box.addEventListener('scroll', () => updateScrollCue(box), { passive: true });
    if (cueResize) {
      cueResize.observe(box);
      [...box.children].forEach((c) => { c.__cueBox = box; cueResize.observe(c); });
    }
  });
  // Content inside a box can be swapped without the box resizing, so re-check every box on each change.
  root.querySelectorAll('.table-wrap, .cal-scroll').forEach((box) => {
    [...box.children].forEach((c) => { if (cueResize && !c.__cueBox) { c.__cueBox = box; cueResize.observe(c); } });
    updateScrollCue(box);
  });
}
// D-80: on phones a wide table becomes one card per row. Copy each column header onto its cells (data-label) and mark the table;
// the CSS (max-width 559px) does the rest. Tables that already stack themselves, or opt out, are left alone.
const STACK_SKIP = '.op-stack, .ops-stack, .op-pnl, .table--nostack';
const stackLabels = new WeakMap(); // table -> its column labels, or false when the table is not stacked
function stackTables(root) {
  root.querySelectorAll('table.table').forEach((table) => {
    let labels = stackLabels.get(table);
    if (labels === undefined) {
      const headRow = table.matches(STACK_SKIP) ? null : [...table.querySelectorAll('thead tr')].pop();
      if (!headRow) { if (table.matches(STACK_SKIP)) stackLabels.set(table, false); return; }
      labels = [];
      [...headRow.children].forEach((th) => {
        const clone = th.cloneNode(true);
        clone.querySelectorAll('.sr-only').forEach((x) => x.remove());
        const text = clone.textContent.trim();
        for (let i = 0; i < (th.colSpan || 1); i++) labels.push(text);
      });
      if (labels.length < 4) labels = false;
      stackLabels.set(table, labels);
      if (!labels) return;
      // Explicit roles keep the table meaning for screen readers once the CSS changes how it is drawn.
      table.classList.add('table--stack');
      table.setAttribute('role', 'table');
      table.querySelectorAll('thead, tbody, tfoot').forEach((g) => g.setAttribute('role', 'rowgroup'));
      table.querySelectorAll('thead th').forEach((c) => c.setAttribute('role', 'columnheader'));
    }
    if (!labels) return;
    // Every pass: rows added later (re-rendered body, filtering, "show more") get labels and roles too.
    table.querySelectorAll(':scope > tbody, :scope > tfoot').forEach((g) => { if (!g.hasAttribute('role')) g.setAttribute('role', 'rowgroup'); });
    table.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
      if (!tr.hasAttribute('role')) tr.setAttribute('role', 'row');
      let col = 0;
      [...tr.children].forEach((cell) => {
        const span = cell.colSpan || 1;
        if (span === 1 && !cell.hasAttribute('data-label')) cell.setAttribute('data-label', labels[col] || '');
        if (!cell.hasAttribute('role')) cell.setAttribute('role', cell.tagName === 'TH' ? 'rowheader' : 'cell');
        col += span;
      });
    });
  });
}
new MutationObserver(() => {
  const app = document.getElementById('app');
  labelTableWraps(app);
  stackTables(app);
  watchScrollCues(app);
}).observe(document.getElementById('app'), { childList: true, subtree: true });

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
  if (!next && u?.role === 'owner' && u.business_type !== 'long_term' && !u.plan?.is_demo && !u.plan?.card_check_due) {
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
  if (e.target.closest('.bottomnav, .assist, .morenav, .tb-pop, dialog')) return;
  const hidden = e.target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
  if (hidden > 0) window.scrollBy(0, hidden + 16);
});

// Index of the tab an arrow, Home or End key moves to (wraps at the ends); -1 for any other key.
function tabKeyTarget(key, i, n) {
  if (key === 'ArrowRight') return (i + 1) % n;
  if (key === 'ArrowLeft') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return -1;
}
// One handler for every tablist (D-81): arrows, Home and End move to a tab and open it. A tablist with its own handler
// (the landing page) calls preventDefault, so it is skipped here.
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !(e.target instanceof Element)) return;
  const tab = e.target.closest('[role="tab"]');
  const list = tab && tab.closest('[role="tablist"]');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')].filter((x) => !x.disabled);
  const next = tabKeyTarget(e.key, tabs.indexOf(tab), tabs.length);
  if (next < 0 || !tabs[next]) return;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
});

(async function boot() {
  updateOnline();
  registerServiceWorker();
  try {
    await refreshUser();
  } catch {
    document.getElementById('app').replaceChildren(pageError({ message: "Can't reach BalayHub. Check your internet connection." }, () => location.reload()));
    return;
  }
  installTopbarKeys(topbarCtx);
  installFocusGuard();
  render();
}());
