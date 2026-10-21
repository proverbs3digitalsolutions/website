// UI helpers. All DOM is built with h() (text nodes, never innerHTML with data),
// so user-entered names can't inject markup.

import { ApiError, newIdempotencyKey, inFlight } from './api.js';

// Views pass optional children as `cond && node`; drop false/null/undefined
// instead of rendering them as the text "false" or "null".
for (const name of ['replaceChildren', 'append']) {
  const original = Element.prototype[name];
  Element.prototype[name] = function filtered(...nodes) {
    return original.apply(this, nodes.flat().filter((n) => n !== false && n !== null && n !== undefined && n !== true));
  };
}

// A button whose click handler returns a promise waits for it (D-121): it is marked aria-disabled (dimmed, still focused) until
// the promise settles, and a press while it waits does nothing. Not .disabled: a disabled button drops focus to the page
// (D-97, D-105, D-120). A button dimmed before the press (D-117), or one its own handler marks (D-120), keeps its own mark.
const pressing = new WeakSet();
function busyWhile(el, promise) {
  if (!promise || typeof promise.then !== 'function' || pressing.has(el)) return promise;
  pressing.add(el);
  el.setAttribute('aria-disabled', 'true');
  const done = () => { if (pressing.delete(el)) el.removeAttribute('aria-disabled'); };
  promise.then(done, done);
  return promise;
}
function pressGuard(el, fn) {
  return function onPress(e) {
    if (pressing.has(el)) { e?.preventDefault?.(); return undefined; }
    const before = el.getAttribute('aria-disabled');
    const r = fn.call(this, e);
    if (before === 'true' || el.getAttribute('aria-disabled') !== before) return r;
    return busyWhile(el, r);
  };
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'onclick' && tag === 'button' && typeof v === 'function') el.addEventListener('click', pressGuard(el, v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
      else if (k === 'html') throw new Error('html prop not allowed');
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10',
  building: 'M4 21V5l8-2v18M12 7l8 2v12M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2M2 21h20',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  wallet: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H18v4M3 7.5v10A2.5 2.5 0 0 0 5.5 20H20V9H5.5A2.5 2.5 0 0 1 3 6.5M16 14.5h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  cash: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9v.01M18 15v.01',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  calendar: 'M7 3v4M17 3v4M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 5Z',
  rocket: 'M12 15l-3-3c1-4 4-8.5 10-9 0 6-5 9-9 10M9 12H5.5l2-4h4M12 15v3.5l4-2v-4M6.5 15.5c-1.5 1-2 3.5-2 4 .5 0 3-.5 4-2',
  sparkle: 'M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4L12 3ZM19 15l.8 2 2 .8-2 .7L19 21l-.8-2.5-2-.7 2-.8.8-2ZM5 15l.6 1.4 1.4.6-1.4.5L5 19l-.6-1.5L3 17l1.4-.6L5 15Z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17.2h.01',
  chat: 'M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.1A8 8 0 1 1 20 12ZM8.5 12h.01M12 12h.01M15.5 12h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  bookmark: 'M6 4h12v17l-6-4-6 4V4Z',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2ZM10 21h4',
  star: 'M12 3.5l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9L12 3.5Z',
  close: 'M6 6l12 12M18 6 6 18',
  bed: 'M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01',
};

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.more);
  svg.append(p);
  return svg;
}

// BalayHub mark: a house outline with a door, and a warm sun (Forest Green + Sand).
export function logo() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  const parts = [
    ['circle', { cx: 51, cy: 11, r: 7.5, fill: '#d6a85c' }],
    ['path', { d: 'M5 31 32 8l27 23', fill: 'none', stroke: 'currentColor', 'stroke-width': 5.5, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' }],
    ['path', { d: 'M13 27v28h12V40h14v15h12V27', fill: 'none', stroke: 'currentColor', 'stroke-width': 5.5, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' }],
  ];
  for (const [tag, attrs] of parts) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  }
  return svg;
}

export const brand = (href = '#/') => h('a', { class: 'brand', href, 'aria-label': 'BalayHub' }, logo(), h('span', null, 'Balay', h('b', null, 'Hub')));

// ---------------------------------------------------------------- formatting
const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
export const peso = (v) => pesoFmt.format(Number(v || 0));
export const pesoShort = (v) => {
  const n = Number(v || 0);
  return Number.isInteger(n) ? `₱${n.toLocaleString('en-PH')}` : peso(n);
};
// Reads an amount typed into a money box exactly as the server does (validate.js parseMoney): ₱, spaces and a
// leading PHP are ignored, a comma must sit between thousands ("1,5" is refused, not read as 15), else NaN.
const MONEY_RE = /^-?\d+(\.\d{1,2})?$/;
const MONEY_COMMA_RE = /^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[₱\s]/g, '').replace(/^PHP/i, '');
  if (s.includes(',')) {
    if (!MONEY_COMMA_RE.test(s)) return NaN;
    s = s.replace(/,/g, '');
  }
  return MONEY_RE.test(s) ? Number(s) : NaN;
}

// Manila calendar day (YYYY-MM-DD) of a timestamp; plain dates pass through unchanged.
export function manilaDay(ts) {
  if (!ts) return '';
  const s = String(ts);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
}
export function fmtDate(d) {
  if (!d) return '—';
  const s = manilaDay(d);
  const [y, m, day] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function fmtMonth(d) {
  const [y, m] = String(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// Today's date in the Philippines as YYYY-MM-DD.
export function todayManila() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

export const LABELS = {
  apartment: 'Apartment', boarding_house: 'Boarding house', condominium: 'Condominium', house: 'House',
  commercial: 'Commercial', dormitory: 'Dormitory', other: 'Other',
  room: 'Room', studio: 'Studio', bedspace: 'Bedspace', commercial_space: 'Commercial space',
  cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', check: 'Check',
  repairs: 'Repairs & maintenance', utilities: 'Utilities', taxes: 'Taxes & permits', insurance: 'Insurance',
  association_dues: 'Association dues', supplies: 'Supplies', salaries: 'Salaries & caretaker', cleaning: 'Cleaning',
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', overdue: 'Overdue',
  open: 'Open', in_progress: 'In progress', resolved: 'Resolved', cancelled: 'Cancelled',
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
  vacant: 'Vacant', occupied: 'Occupied', unavailable: 'Unavailable', archived: 'Archived',
  active: 'Active', ended: 'Ended', terminated: 'Terminated',
  owner: 'Owner', manager: 'Property manager', staff: 'Staff', cleaner: 'Cleaner',
};
export const label = (k) => LABELS[k] || k;
// "Unit 3B", but not "Unit Unit 1" when the name already says it.
export const unitLabel = (name) => (/^\d/.test(String(name || '')) ? `Unit ${name}` : String(name ?? ''));
export const badge = (status, text) => h('span', { class: `badge badge--${status}` }, text || label(status));
export const options = (keys) => keys.map((k) => [k, label(k)]);

// ---------------------------------------------------------------- feedback
export function toast(message, kind = 'info') {
  // #toasts is the one live region (index.html, aria-live polite, there from page load); a role here would nest a second one (D-109).
  const el = h('div', { class: `toast${kind === 'error' ? ' toast--error' : ''}` }, message);
  const box = document.getElementById('toasts');
  // The same message replaces the one on screen instead of stacking beside it.
  for (const old of [...box.children]) if (old.textContent === String(message)) old.remove();
  while (box.children.length >= 2) box.firstChild.remove();
  box.append(el);
  setTimeout(() => el.remove(), 4000);
}

// A failed save must not sit next to an older "saved" message.
const clearSuccessToasts = () => document.querySelectorAll('#toasts .toast:not(.toast--error)').forEach((t) => t.remove());

export function emptyState({ title, text, action, iconName = 'inbox' }) {
  return h('div', { class: 'empty' }, icon(iconName), h('h3', null, title), text && h('p', null, text), action);
}

export function errorState(err, retry) {
  return h('div', { class: 'card' }, emptyState({
    title: err?.status === 404 ? 'Not found' : "Couldn't load this page",
    text: err?.message || 'Something went wrong.',
    action: retry && ![403, 404].includes(err?.status) && h('button', { class: 'btn btn--secondary', onclick: retry }, 'Try again'),
  }));
}

// The router's page-level error: the card's title is the page heading (h1), unlike errorState inside a page.
export function pageError(err, retry) {
  return h('div', { class: 'card' }, h('div', { class: 'empty' },
    icon('inbox'),
    h('h1', { style: { fontSize: '1.05rem' } }, err?.status === 404 ? 'Not found' : "Couldn't load this page"),
    h('p', null, err?.message || 'Something went wrong.'),
    retry && ![403, 404].includes(err?.status) && h('button', { class: 'btn btn--secondary', onclick: retry }, 'Try again')));
}

export const skeleton = (n = 2) => h('div', { class: 'stack' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' })));

// ---------------------------------------------------------------- focus after a redraw
// ONE mechanism (D-89). A page redraws after a save or click and replaces the control the person used; focus then falls to the page.
// The guard remembers the last control the person used, notices when it leaves the page, and puts focus on the control that took its
// place (same data-focus-key, else same role and name, else same place in the same labelled group), else on the page heading. It reacts
// to the screen change itself (a MutationObserver), so it covers every redraw. Views add only data-focus-key where a label changes.
export const FOCUS_WATCH_MS = 10000;
export const USER_MOVE_MS = 300; // after a Tab key the browser is still moving focus: the guard must not pull it back
export const HEADING_AFTER_MS = 0; // nothing took the old control's place: the heading gets focus at once, a real match later still wins
// Smooth navigation: after a save, search or filter the page stays where the person left it (see the scroll keeper below).
export const SCROLL_SETTLE_MS = 150; // a scroll this soon after the page changed is a side effect of the redraw
export const SCROLL_QUIET_MS = 700;  // the page has stopped changing and nothing is loading: let go

const FOCUSABLE = 'a[href], button, summary, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])';
const NATIVE_FOCUSABLE = new Set(['BUTTON', 'SUMMARY', 'SELECT', 'TEXTAREA']);
function focusable(el) {
  if (!el?.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'A') return el.getAttribute('href') !== null;
  if (tag === 'INPUT') return el.getAttribute('type') !== 'hidden';
  if (NATIVE_FOCUSABLE.has(tag)) return true;
  const ti = el.getAttribute('tabindex');
  return ti !== null && ti !== '-1';
}

const GROUP_ROLES = ['tablist', 'group', 'radiogroup', 'toolbar'];
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

// What identifies a control across a redraw: { key, tag, role, name, group, path }. Computed when the person uses it (ids from field()
// are random per draw, so the label text is used, not the id).
export function focusKeyOf(el) {
  const tag = el.tagName.toLowerCase();
  const type = String(el.getAttribute('type') || '').toLowerCase();
  const implicit = { button: 'button', summary: 'button', a: 'link', select: 'combobox', textarea: 'textbox' }[tag]
    || (tag === 'input' ? ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button' }[type] || 'textbox') : null);
  const role = el.getAttribute('role') || implicit;
  let name = el.getAttribute('aria-label');
  if (!name && ['input', 'select', 'textarea'].includes(tag)) {
    const doc = el.ownerDocument || document;
    const id = el.getAttribute('id');
    const lab = (id && doc.querySelector?.(`label[for="${globalThis.CSS?.escape ? CSS.escape(id) : id}"]`)) || el.closest?.('label');
    name = lab?.textContent || el.getAttribute('name');
  }
  name = squash(name || el.textContent);
  let group = null;
  for (let p = el.parentElement; p && !group; p = p.parentElement) {
    const r = p.getAttribute('role');
    const al = p.getAttribute('aria-label');
    if (al && (GROUP_ROLES.includes(r) || r === 'region' || r === 'navigation')) group = squash(al);
  }
  return { key: el.getAttribute('data-focus-key'), tag, role, name, group, path: String(globalThis.location?.hash || '').split('?')[0] };
}

// Which candidate (focusKeyOf-shaped, in document order) took the old control's place; -1 for none. Pure.
export function pickFocusMatch(snap, candidates, snapNth = 0, snapGroupNth = -1) {
  if (!snap) return -1;
  if (snap.key) {
    const i = candidates.findIndex((c) => c.key === snap.key);
    if (i >= 0) return i;
  }
  const idx = (pred) => candidates.map((c, i) => (pred(c) ? i : -1)).filter((i) => i >= 0);
  if (snap.name) {
    const same = idx((c) => c.tag === snap.tag && c.role === snap.role && c.name === snap.name);
    if (same.length) return same[snapNth] ?? same[same.length - 1];
  }
  if (snap.group && (snap.role === 'tab' || snap.role === 'radio')) { // other buttons repeat per row: a place in the group could be another row's
    const grouped = idx((c) => c.tag === snap.tag && c.role === snap.role && c.group === snap.group);
    if (snapGroupNth >= 0 && grouped[snapGroupNth] !== undefined) return grouped[snapGroupNth];
  }
  return -1;
}

const hiddenBy = (el) => { for (let p = el; p; p = p.parentElement) if (p.hidden) return true; return false; };
const inModal = (el) => { for (let p = el; p; p = p.parentElement) if (p.tagName === 'DIALOG' && p.classList?.contains('modal')) return p; return null; };
const inLayer = (el) => { for (let p = el; p; p = p.parentElement) if (p.classList?.contains('morenav') || p.classList?.contains('assist') || p.classList?.contains('tb-sheet')) return true; return false; };
// ---------------------------------------------------------------- scroll after a redraw
// ONE mechanism (founder priority: smooth navigation). A list that shows a placeholder first makes the page shorter for a moment and the
// browser clamps the scroll; a list replaced in place lets scroll anchoring shift the page. The keeper notes the scroll position when the
// person acts, holds the page height while the redraw runs, and undoes a scroll that the redraw caused. Views never touch the scroll.
// Where the window should go back to, or null to leave it. Pure. `y` is the position when the person acted, `nowY` the position now.
export function keptScroll({ y, nowY, maxY, sinceChange, sinceAction, sameRoute, focusTop = null, focusBottom = null, viewH = 0, focusWasVisible = true }) {
  if (!sameRoute || sinceAction > FOCUS_WATCH_MS || sinceChange > SCROLL_SETTLE_MS || Math.abs(nowY - y) <= 2) return null;
  const target = Math.max(0, Math.min(y, maxY));
  if (typeof focusTop === 'number' && focusWasVisible) { // never scroll the focused field (or the guard's target) out of view; one that was already off screen is not pulled back
    const moved = nowY - target;
    if (focusTop + moved < 0 || (viewH && (focusBottom ?? focusTop) + moved > viewH)) return null;
  }
  return target;
}

// May the held page height go now? A timer (quiet, hard limit) must not: if the page without the hold is too short for the scroll
// position, the browser would clamp the scroll and the page would jump. Only the person's own scroll or a route change lets go then. Pure.
export function shouldRelease(keptY, naturalHeight, viewH, reason) {
  if (reason === 'person' || reason === 'route') return true;
  return Math.max(0, naturalHeight - viewH) >= keptY;
}

// Is the control fully on screen right now? Unknown (no layout) counts as yes.
const onScreen = (el) => {
  const r = el?.getBoundingClientRect?.();
  const vh = globalThis.innerHeight;
  return !(r && vh) || (r.top >= 0 && r.bottom <= vh);
};

const KEEPER_OUTSIDE = '.sidebar, .bottomnav, .morenav, .topbar, .tb-sheet, .assist';
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

function installScrollKeeper(doc) {
  const win = globalThis.window || globalThis;
  let rec = null;        // { y, at, path }
  let lastChange = 0;    // when the page last changed
  let held = null;       // the element whose min-height holds the page height
  let quiet = null; let hard = null;
  const pathNow = () => String(globalThis.location?.hash || '').split('?')[0];
  const release = (reason = 'person') => {
    rec = null; clearTimeout(quiet); clearTimeout(hard);
    if (!held) return;
    const keep = held.style.minHeight;
    const y = win.scrollY;
    held.style.minHeight = '';
    if (reason !== 'person' && reason !== 'route' && !shouldRelease(y, doc.documentElement.scrollHeight, win.innerHeight, reason)) {
      held.style.minHeight = keep; // the clamp would move the page: keep the (invisible) blank space until the person scrolls
      if (win.scrollY !== y) win.scrollTo(0, y); // measuring may have clamped already; put it back before anything is painted
      return;
    }
    held = null;
  };
  const arm = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => { if (inFlight() > 0) arm(); else release('quiet'); }, SCROLL_QUIET_MS);
  };
  const person = (e) => { const t = e.target; return !(t instanceof Element && t.closest?.('input, textarea, select, [contenteditable]')); };

  const act = (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !t.closest('#app, dialog.modal') || t.closest(KEEPER_OUTSIDE)) return;
    const fa = doc.activeElement;
    rec = { y: win.scrollY, at: Date.now(), path: pathNow(), focusWasVisible: !fa || fa === doc.body || onScreen(fa) };
    const app = doc.getElementById('app');
    if (app && !held) { held = app; app.style.minHeight = `${app.offsetHeight}px`; }
    arm(); clearTimeout(hard); hard = setTimeout(() => release('quiet'), FOCUS_WATCH_MS);
  };
  for (const ev of ['input', 'change', 'submit', 'click']) doc.addEventListener(ev, act, true);
  // The person scrolling themselves is never undone.
  for (const ev of ['wheel', 'touchmove']) win.addEventListener(ev, () => release('person'), { passive: true });
  doc.addEventListener('keydown', (e) => { if (SCROLL_KEYS.has(e.key) && person(e)) release('person'); }, true);
  win.addEventListener('hashchange', () => release('route'));
  win.addEventListener('scroll', () => {
    if (!rec) return;
    if (pathNow() !== rec.path) { release('route'); return; }
    const now = Date.now();
    const a = doc.activeElement;
    const r = a && a !== doc.body ? a.getBoundingClientRect() : null;
    const sinceChange = now - lastChange;
    const to = keptScroll({
      y: rec.y, nowY: win.scrollY, maxY: doc.documentElement.scrollHeight - win.innerHeight, sinceChange, sinceAction: now - rec.at,
      sameRoute: true, focusTop: r ? r.top : null, focusBottom: r ? r.bottom : null, viewH: win.innerHeight, focusWasVisible: rec.focusWasVisible,
    });
    if (to !== null) win.scrollTo(0, to);
    else if (sinceChange > SCROLL_SETTLE_MS) rec.y = win.scrollY; // not caused by a redraw: the new place is where the person is
  }, { passive: true });
  return {
    changed(muts) {
      if (muts.some((m) => m.target instanceof Element && m.target.closest('#app') && !m.target.closest('.sidebar, .topbar, .bottomnav'))) {
        lastChange = Date.now();
        if (rec) arm();
      }
    },
  };
}

let guardInstalled = false;

// Returns { check(now), note(el), state() } (the last three for tests). `observe: false` skips the page listeners and the observer.
export function installFocusGuard(doc = document, { observe = true } = {}) {
  let pageRec = null; // { el, snap, nth, groupNth }
  let dlgRec = null;  // the same, plus dlg
  let lossAt = null;  // when the remembered control left the page and was not found again
  let fallback = null; // the heading the guard itself focused
  let movedAt = null; // when the person last pressed Tab

  const pageRoot = () => doc.getElementById?.('main') || doc.getElementById?.('app') || doc.body;
  const openDialogs = () => [...doc.querySelectorAll('dialog')].filter((d) => d.open && d.classList?.contains('modal'));
  const appRoot = () => doc.getElementById?.('app') || doc.body;
  const within = (el, root) => { for (let p = el; p; p = p.parentElement) if (p === root) return true; return false; };
  // A control outside the page (the guest pages' language toggle sits in the header) is looked for in the whole app, so it beats the heading.
  const rootFor = (rec) => (rec.wide ? appRoot() : pageRoot());
  const candidatesIn = (root) => [...root.querySelectorAll(FOCUSABLE)].filter(focusable);
  const pathNow = () => String(globalThis.location?.hash || '').split('?')[0];

  function note(el) {
    if (!focusable(el) || el === fallback || inLayer(el)) return;
    const snap = focusKeyOf(el);
    const dlg = inModal(el);
    const wide = !dlg && !within(el, pageRoot());
    const root = dlg || (wide ? appRoot() : pageRoot());
    const cands = candidatesIn(root);
    const keys = cands.map(focusKeyOf);
    const at = cands.indexOf(el);
    // The control's ordinal among those with its tag, role and name (and, for tabs and groups, among those in its group).
    const nth = keys.filter((k, i) => i < at && k.tag === snap.tag && k.role === snap.role && k.name === snap.name).length;
    const groupNth = snap.group ? keys.filter((k, i) => i < at && k.tag === snap.tag && k.role === snap.role && k.group === snap.group).length : -1;
    const rec = { el, snap, nth, groupNth, wide, visible: onScreen(el) };
    if (dlg) dlgRec = { ...rec, dlg }; else pageRec = rec;
    movedAt = null; // focus landed on a control: the Tab move is over (an action inside the 300 ms window must not make the guard forget it)
  }

  // `reveal`: the person had the control on screen when they acted. A control that was off screen is focused where it is, never scrolled to.
  const focusIt = (el, reveal = true) => {
    el.focus({ preventScroll: true });
    if (reveal && !onScreen(el)) el.scrollIntoView?.({ block: 'nearest' });
  };

  // A match inside a closed "More" fold hands focus to that fold's button.
  function visibleTarget(el, root) {
    let fold = null;
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open) fold = p;
    return fold ? ([...fold.children].find((c) => c.tagName === 'SUMMARY') || el) : el;
  }

  function check(now = Date.now()) {
    if (!pageRec && !dlgRec) return;
    if (movedAt !== null) {
      // The person tabbed away (a blur may hide or redraw things mid-move): never undo that. If focus still ends on the page after the
      // move, the control is forgotten rather than restored (a restore here would trap Tab in a search box).
      if (now - movedAt < USER_MOVE_MS) return;
      movedAt = null;
      const act = doc.activeElement;
      if (!act || act === doc.body || !act.isConnected) { pageRec = null; dlgRec = null; lossAt = null; fallback = null; return; }
    }
    const open = openDialogs();
    const top = open[open.length - 1] || null;
    if (dlgRec && (!dlgRec.dlg.isConnected || !dlgRec.dlg.open)) dlgRec = null;
    const rec = top ? (dlgRec?.dlg === top ? dlgRec : null) : pageRec;
    if (!rec) return;
    const a = doc.activeElement;
    const free = !a || a === doc.body || !a.isConnected || (a === fallback && lossAt !== null && now - lossAt <= FOCUS_WATCH_MS);
    if (!free) {
      if (a === fallback && !top) pageRec = null; // the heading stayed past the watch time: the old control is forgotten
      lossAt = null; fallback = null;
      return;
    }
    if (!top && pathNow() !== rec.snap.path) { pageRec = null; lossAt = null; return; } // the router owns route changes
    const root = top || rootFor(rec);
    let target = null;
    if (rec.el.isConnected && !hiddenBy(rec.el)) {
      if (rec.el.disabled) return; // wait: a later "disabled" change runs this again
      target = visibleTarget(rec.el, root);
    } else {
      const cands = candidatesIn(root);
      const i = pickFocusMatch(rec.snap, cands.map(focusKeyOf), rec.nth, rec.groupNth);
      if (i >= 0) {
        target = visibleTarget(cands[i], root);
        if (target.disabled || hiddenBy(target)) return;
      }
    }
    if (target) {
      focusIt(target, rec.visible !== false);
      if (doc.activeElement === target) { lossAt = null; fallback = null; }
      return;
    }
    if (lossAt === null) {
      const mine = lossAt = now;
      setTimeout(() => { if (lossAt === mine) check(mine + FOCUS_WATCH_MS + 1); }, FOCUS_WATCH_MS);
    }
    if (now - lossAt > FOCUS_WATCH_MS) { if (top) dlgRec = null; else pageRec = null; lossAt = null; return; }
    const h = top ? root.querySelector('h2') : (root.querySelector('[data-page-heading]') || root.querySelector('h1')); // the page's own focus heading first, as the router does (D-116 C1, D-117)
    if (h && a !== h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); fallback = h; }
  }

  if (observe) {
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') movedAt = Date.now();
      else for (const r of [pageRec, dlgRec]) if (r && r.el === e.target) r.visible = onScreen(r.el); // typing in a box: is it on screen now?
    }, true);
    doc.addEventListener('focusin', (e) => { if (e.target instanceof Element) note(e.target); }, true);
    // A file chosen without focusing its control (dropped on it, or set by assistive technology) is remembered like a pressed one, so the
    // redraw after its upload puts focus back on it, never on the page body (D-111). File inputs only: a text box's change fires as the person leaves it.
    doc.addEventListener('change', (e) => { const t = e.target; if (t instanceof Element && t.tagName === 'INPUT' && String(t.getAttribute('type')).toLowerCase() === 'file') note(t); }, true);
    doc.addEventListener('pointerdown', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      const el = t?.closest(FOCUSABLE);
      if (el) { note(el); return; }
      if (t?.closest('.morenav, .assist, .tb-sheet')) return;
      if (t?.closest('dialog.modal')) dlgRec = null; else pageRec = null; // the person moved on to nothing in particular
    }, true);
    const keeper = installScrollKeeper(doc);
    new MutationObserver((muts) => { keeper.changed(muts); check(); }).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'open'] });
  }
  return { check, note, moved: (t = Date.now()) => { movedAt = t; }, state: () => ({ rec: pageRec, dlgRec, lossAt, fallback }) };
}

// Focus the page heading without scrolling (a dialog opened with no opener closes onto it).
function focusHeadingIfFree() {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected) return;
  const h1 = document.querySelector('#main [data-page-heading]') || document.querySelector('#main h1') || document.querySelector('#app h1'); // the page's own focus heading first (D-117)
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
}

// ---------------------------------------------------------------- modal
export function openModal({ title, body, onClose, wide }) {
  // Closing returns focus to the opener (the browser does it while the opener is on the page; the focus guard finds it if a redraw replaced it).
  // With no opener (a page opened with ?new=1) the dialog closes onto the page heading.
  const hadOpener = Boolean(document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected !== false);
  const dlg = h('dialog', { class: 'modal', 'aria-label': title });
  if (wide) dlg.classList.add('modal--wide');
  const close = () => dlg.close();
  dlg.append(
    h('div', { class: 'modal__head' }, h('h2', null, title), h('button', { class: 'modal__close', type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'modal__body' }, body),
  );
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); if (!hadOpener) focusHeadingIfFree(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  // A dialog with no field starts on its first action (a night's menu: New reservation), the × only when the body has none.
  (dlg.querySelector('input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)') || dlg.querySelector('.modal__body button:not(:disabled), .modal__body a[href]'))?.focus();
  return { close, el: dlg };
}

// An audit reason is at most 500 characters. No maxlength on the box (it cuts a paste silently): Confirm checks and says so.
export const REASON_MAX = 500;
let reasonSeq = 0;
export function confirmDialog({ title, text, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, reason = false, onConfirm = null }) {
  return new Promise((resolve) => {
    let done = false;
    let busy = false;
    const rid = `reason-${++reasonSeq}`;
    const reasonInput = reason ? h('textarea', { class: 'input', id: rid, name: 'reason', required: true, 'aria-describedby': `${rid}-err`, placeholder: 'Required — explain why (kept in the audit log)' }) : null;
    const err = h('div', { class: 'error', id: `${rid}-err`, role: 'alert' });
    // A form asking this question is not saving yet: its button shows its own label until the answer is yes.
    const saving = [...document.querySelectorAll('button[data-own-label]')].filter((b) => b.textContent === 'Saving…');
    for (const b of saving) b.textContent = b.dataset.ownLabel;
    // A refusal from the server is said here and the dialog stays open with the typed reason (D-115).
    const refusal = h('div', { role: 'alert' });
    const cancelBtn = h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => m.close() }, cancelText);
    const confirmBtn = h('button', {
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button',
      onclick: async () => {
        if (busy) return;
        if (reasonInput && !reasonInput.value.trim()) { err.textContent = 'Please enter a reason.'; reasonInput.setAttribute('aria-invalid', 'true'); reasonInput.focus(); return; }
        if (reasonInput && reasonInput.value.trim().length > REASON_MAX) { err.textContent = `Reason must be at most ${REASON_MAX} characters.`; reasonInput.setAttribute('aria-invalid', 'true'); reasonInput.focus(); return; }
        const value = reasonInput ? reasonInput.value.trim() : true;
        if (onConfirm) {
          busy = true; confirmBtn.setAttribute('aria-disabled', 'true'); refusal.replaceChildren();
          try { await onConfirm(value); } catch (e) {
            busy = false; confirmBtn.removeAttribute('aria-disabled');
            if (m.el.open) { refusal.replaceChildren(h('div', { class: 'alert alert--error' }, e.message)); confirmBtn.focus(); } else { done = true; toast(e.message, 'error'); resolve(null); }
            return;
          }
          busy = false;
        }
        done = true;
        for (const b of saving) if (b.dataset.ownLabel !== undefined) b.textContent = 'Saving…';
        if (m.el.open) m.close();
        resolve(value);
      },
    }, confirmText);
    const m = openModal({
      title,
      onClose: () => { if (!done && !busy) resolve(null); },
      body: h('div', { class: 'form' },
        h('p', null, text),
        reasonInput && h('div', { class: 'field' }, h('label', { for: rid }, 'Reason ', h('span', { class: 'req' }, '*')), reasonInput, err),
        refusal,
        h('div', { class: 'form-actions' }, cancelBtn, confirmBtn)),
    });
    reasonInput?.addEventListener('input', () => { err.textContent = ''; reasonInput.removeAttribute('aria-invalid'); refusal.replaceChildren(); });
    // The safe choice first: a confirm without a reason box starts on Cancel, not on the close button.
    if (!reasonInput) cancelBtn.focus();
  });
}

// ---------------------------------------------------------------- forms
/**
 * field({ name, label, type, value, required, options, hint, placeholder, ... })
 * type: text | email | tel | password | date | number | money | select | textarea | checkbox
 */
export function field(f) {
  const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
  const common = { id, name: f.name, required: f.required, placeholder: f.placeholder, autocomplete: f.autocomplete || 'off', 'aria-describedby': `${id}-err`,
    // markRequired: the asterisk and aria-required without `required`, so the view's own check sentence is the one shown (LT-2).
    'aria-required': f.markRequired && !f.required ? 'true' : undefined,
    // fromLink: the page filled this box from its link; a saved draft never overwrites it (INB-3). msgLabel: the short noun used in messages (OPS-1).
    'data-from-link': f.fromLink ? true : undefined, 'data-msg-label': f.msgLabel };
  let input;
  // A required choice with only one possible answer is preselected.
  if (f.type === 'select' && f.required && (f.value === undefined || f.value === null || f.value === '') && f.options?.length === 1) {
    f = { ...f, value: f.options[0][0] };
  }
  if (f.type === 'select') {
    input = h('select', { ...common, class: 'input' },
      f.placeholderOption !== false && h('option', { value: '' }, f.placeholderOption || 'Select…'),
      (f.options || []).map(([v, t]) => h('option', { value: v, selected: String(f.value ?? '') === String(v) }, t)));
  } else if (f.type === 'textarea') {
    input = h('textarea', { ...common, class: 'input', maxlength: f.maxlength || 2000 });
    input.value = f.value ?? '';
  } else if (f.type === 'checkbox') {
    input = h('input', { ...common, type: 'checkbox', checked: f.value });
    return h('div', { class: 'field', dataset: { field: f.name } },
      h('label', { class: 'check', for: id }, input, h('span', null, f.label)),
      h('div', { class: 'error', id: `${id}-err`, role: 'alert' }));
  } else {
    const isMoney = f.type === 'money';
    input = h('input', {
      ...common, class: 'input',
      type: isMoney ? 'text' : (f.type || 'text'),
      inputmode: isMoney ? 'decimal' : f.inputmode,
      min: f.min, max: f.max, step: f.step, 'data-positive': isMoney && f.positive ? true : undefined, maxlength: f.maxlength || (f.type === 'date' ? undefined : 200),
      value: f.value ?? '',
    });
    if (isMoney) input = h('div', { class: 'input-money' }, input);
  }
  return h('div', { class: 'field', dataset: { field: f.name } },
    h('label', { for: id }, f.label, (f.required || f.markRequired) && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
    input,
    f.hint && h('div', { class: 'hint' }, f.hint),
    h('div', { class: 'error', id: `${id}-err`, role: 'alert' }));
}

export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.type === 'file') continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi) { (out[el.name] ||= []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else out[el.name] = el.value;
  }
  return out;
}

export function clearErrors(form) {
  form.querySelectorAll('.field--invalid').forEach((f) => f.classList.remove('field--invalid'));
  form.querySelectorAll('[aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field .error').forEach((e) => { e.textContent = ''; });
  form.querySelector('.form-error')?.replaceChildren();
}

// Where focus goes for an invalid field: a nested invalid row's own input (guest rows), else data-focus, else the first visible
// control, else the first button of a group (stars, whose input is hidden; the group is marked, not the button).
const FIELD_CONTROL = 'input:not([type=hidden]), select, textarea';
function errorTarget(wrap) {
  const row = wrap.querySelector('.field--invalid');
  const input = row?.querySelector(FIELD_CONTROL) || wrap.querySelector('[data-focus]') || wrap.querySelector(FIELD_CONTROL);
  if (input) return { focus: input, mark: input };
  const group = wrap.querySelector('[role="group"], [role="radiogroup"]');
  return { focus: group?.querySelector('button') || null, mark: group };
}

// Marks the fields it can find on the form; returns the messages of fields that aren't on it.
export function showErrors(form, fields = {}) {
  let first = null;
  const unplaced = [];
  for (const [name, msg] of Object.entries(fields)) {
    const wrap = form.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (!wrap) { unplaced.push(msg); continue; }
    wrap.classList.add('field--invalid');
    // A field inside a collapsed section opens it, so the message and focus are visible.
    for (let d = wrap.closest?.('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    const err = wrap.querySelector('.error');
    if (err) err.textContent = msg;
    const target = errorTarget(wrap);
    target.mark?.setAttribute('aria-invalid', 'true');
    // Focus the first bad field as the form is laid out, not the first in the server's list.
    const t = target.focus;
    if (t && (!first || (t.compareDocumentPosition?.(first) & 4))) first = t; // 4 = first comes after t
  }
  first?.focus();
  return unplaced;
}

// A file refused on the device or by the server: empty, too big, not really its type (D-110 to D-113).
export const fileRefused = (err) => ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE'].includes(err?.code) || err?.status === 413 || err?.status === 415;

// An upload control's own message line (D-113): a refused file is said under the control, which is marked invalid and keeps
// focus; the next pick clears it. Render `wrap` where the input was. One message, read once: no toast for a file refusal.
let uploadSeq = 0;
export function uploadField(input) {
  const line = h('div', { class: 'error', id: `upload-err-${++uploadSeq}`, role: 'alert' });
  input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), line.id].filter(Boolean).join(' '));
  const wrap = h('div', { class: 'field' }, input, line);
  const clear = () => { line.textContent = ''; wrap.classList.remove('field--invalid'); input.removeAttribute('aria-invalid'); };
  const show = (msg) => { line.textContent = msg; wrap.classList.add('field--invalid'); input.setAttribute('aria-invalid', 'true'); input.focus(); };
  return { wrap, show, clear };
}

// Keep unsaved form input in sessionStorage so it survives an expired session
// or a dropped connection. Passwords are never stored.
export function persistDraft(form, key) {
  const storeKey = `bh-draft:${key}`;
  // A draft keeps only what the person typed: a field is saved while it still holds the value the person last gave it (D-106).
  // `mine` maps a field name to the JSON of that value. A value code wrote (a quote, a suggested amount, a default) never gets in.
  const mine = new Map();
  const storable = (el) => el.name && el.type !== 'password' && el.type !== 'file';
  const linkFilled = (el) => el.dataset?.fromLink !== undefined && String(el.value ?? '') !== '';
  try {
    const saved = JSON.parse(sessionStorage.getItem(storeKey) || 'null');
    if (saved) {
      for (const el of form.elements) {
        if (!storable(el) || !(el.name in saved)) continue;
        // A value the page filled from its link is the newer instruction; a draft never overwrites it (D-107). Defaults are not from the link.
        if (linkFilled(el)) continue;
        if (el.type === 'checkbox') { if (!el.dataset.multi) el.checked = saved[el.name]; } else el.value = saved[el.name];
      }
      const now = readForm(form);
      for (const el of form.elements) if (storable(el) && el.name in saved && !linkFilled(el)) mine.set(el.name, JSON.stringify(now[el.name]));
    }
  } catch { /* storage unavailable */ }
  const given = (e) => {
    try {
      const name = e.target?.name;
      const names = new Set();
      for (const el of form.elements) if (storable(el)) names.add(el.name);
      if (!name || !names.has(name)) return;
      const data = readForm(form);
      mine.set(name, JSON.stringify(data[name]));
      for (const [k, v] of [...mine]) if (!(k in data) || JSON.stringify(data[k]) !== v) mine.delete(k);
      const out = {};
      for (const k of mine.keys()) out[k] = data[k];
      sessionStorage.setItem(storeKey, JSON.stringify(out));
    } catch { /* ignore */ }
  };
  // Capture, so a synthetic event that doesn't bubble still counts as the person giving the value.
  form.addEventListener('input', given, true);
  form.addEventListener('change', given, true);
  return () => { try { sessionStorage.removeItem(storeKey); } catch { /* ignore */ } };
}

// The server accepts dates from 2000 to 2100 only; a typed year like 0202 or 12345 is out of range.
export function dateOutOfRange(v) {
  const m = /^(\d{4,6})-\d{2}-\d{2}$/.exec(String(v ?? ''));
  return Boolean(m) && (Number(m[1]) < 2000 || Number(m[1]) > 2100);
}

/**
 * Build a <form> that validates on the server, shows field errors, prevents
 * double submission, and keeps input when offline.
 */
// A view's own field messages (the `check` hook) join the required-field ones; they never replace one.
export function mergeChecks(missing, extra) {
  for (const [k, v] of Object.entries(extra || {})) if (v && !missing[k]) missing[k] = v;
  return missing;
}

// The summary above a form after a failed save. When every field message sits on its field the summary does not repeat it.
export function formErrorText(err, unplaced = []) {
  const messages = Object.values(err?.fields || {});
  if (messages.length && !unplaced.length && (err.summary || messages.includes(err.message))) return { text: 'Please check the highlighted fields.', fieldNote: true };
  if (unplaced.length) return { text: [...new Set(unplaced)].join(' '), fieldNote: false };
  return { text: err.message, fieldNote: false };
}

// The address shape every view checks; makeForm applies it to every filled email box in the same pass as the required ones.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function emailProblems(form, missing) {
  const out = {};
  for (const el of form.querySelectorAll('input[type=email]')) {
    const v = String(el.value ?? '').trim();
    if (el.name && !missing[el.name] && v && !EMAIL_RE.test(v)) out[el.name] = 'Enter a valid email address.';
  }
  return out;
}

// The server's field-type rules (src/lib/validate.js), read from each control, for fields that have no message yet.
export const PHONE_RE = /^[+\d][\d\s()-]{6,19}$/;
export function typeProblems(form, missing, labelOf) {
  const out = {};
  const live = (el) => el.name && !missing[el.name] && !el.disabled && !el.closest('[hidden]') && String(el.value ?? '').trim();
  for (const el of form.querySelectorAll('.input-money input')) {
    if (!live(el)) continue;
    const n = parseAmount(el.value);
    if (Number.isNaN(n)) out[el.name] = `${labelOf(el)} must be a valid amount (e.g. 8500 or 8500.50).`;
    else if (n < 0) out[el.name] = `${labelOf(el)} cannot be negative.`;
    else if (n === 0 && el.hasAttribute('data-positive')) out[el.name] = `${labelOf(el)} must be greater than zero.`;
  }
  for (const el of form.querySelectorAll('input[type=number]')) {
    if (!live(el)) continue;
    const n = Number(String(el.value).trim());
    const step = el.getAttribute('step');
    const whole = !step || (step !== 'any' && Number.isInteger(Number(step)));
    if (!Number.isFinite(n) || (whole && !Number.isInteger(n))) out[el.name] = `${labelOf(el)} must be a whole number.`;
    else if (el.min !== '' && Number(el.min) === 0 && n < 0) out[el.name] = `${labelOf(el)} cannot be negative.`;
    else if (el.min !== '' && n < Number(el.min)) out[el.name] = `${labelOf(el)} must be at least ${el.min}.`;
    else if (el.max !== '' && n > Number(el.max)) out[el.name] = `${labelOf(el)} must be at most ${el.max}.`;
  }
  for (const el of form.querySelectorAll('input[type=tel]')) {
    if (live(el) && !PHONE_RE.test(String(el.value).trim())) out[el.name] = 'Enter a valid phone number.';
  }
  // A date box's own min and max are what the server refuses outside of (the 2000-2100 check runs first, in makeForm).
  for (const el of form.querySelectorAll('input[type=date]')) {
    if (!live(el) || out[el.name] || dateOutOfRange(el.value)) continue;
    const v = String(el.value).trim();
    const min = el.min || '';
    const max = el.max || '';
    const today = todayManila();
    if (min && max && (v < min || v > max)) out[el.name] = `Pick a date between ${fmtDate(min)} and ${fmtDate(max)}.`;
    else if (max && v > max) out[el.name] = max === today ? `${labelOf(el)} cannot be in the future.` : `${labelOf(el)} must be on or before ${fmtDate(max)}.`;
    else if (min && v < min) out[el.name] = min === today ? `${labelOf(el)} cannot be in the past.` : `${labelOf(el)} must be on or after ${fmtDate(min)}.`;
  }
  return out;
}

export function makeForm({ fields, submitText = 'Save', onSubmit, cancel, draftKey, idempotent = false, extra, check }) {
  const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, submitText);
  const formError = h('div', { class: 'form-error' });
  const form = h('form', { class: 'form', novalidate: true },
    formError, fields, extra,
    h('div', { class: 'form-actions' },
      cancel && h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => { clearDraft(); cancel(); } }, 'Cancel'),
      submitBtn));
  // A field's message clears as soon as the person changes that field; the summary goes with the last marked field.
  const clearFieldError = (e) => {
    const wrap = e.target.closest?.('[data-field]');
    if (!wrap?.classList.contains('field--invalid')) return;
    wrap.classList.remove('field--invalid');
    wrap.querySelectorAll('[aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
    const err = wrap.querySelector('.error');
    if (err) err.textContent = '';
    if (!form.querySelector('.field--invalid')) formError.querySelector('[data-field-note]')?.remove();
  };
  form.addEventListener('input', clearFieldError);
  form.addEventListener('change', clearFieldError);
  const clearDraft = draftKey ? persistDraft(form, draftKey) : () => {};
  // One key per form instance: a retried or double-clicked save is recorded once.
  let idemKey = idempotent ? newIdempotencyKey() : null;
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    clearErrors(form);
    // Quick required-field check so obvious gaps show instantly (and offline);
    // the server still validates everything.
    const missing = {};
    let requiredOnly = true;
    const labelOf = (el) => el.dataset?.msgLabel || form.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.firstChild?.textContent?.trim() || 'This field';
    for (const el of form.elements) {
      if (el.required && el.name && el.type !== 'checkbox' && !String(el.value).trim()) missing[el.name] = `${labelOf(el)} is required.`;
    }
    // An amount over the server's cap is refused here, before onSubmit can ask any question about it.
    for (const el of form.querySelectorAll('.input-money input')) {
      if (el.name && !missing[el.name] && parseAmount(el.value) > 99999999.99) { missing[el.name] = `${labelOf(el)} is too large.`; requiredOnly = false; }
    }
    // A date outside 2000 to 2100 is refused here too, before onSubmit can ask "Date is in the past?" about it.
    for (const el of form.querySelectorAll('input[type=date]')) {
      if (el.name && !missing[el.name] && dateOutOfRange(el.value)) { missing[el.name] = `${labelOf(el)} must be between 2000 and 2100.`; requiredOnly = false; }
    }
    // A filled email box that is not an address is marked now too, not only after a missing field is fixed.
    const badEmails = emailProblems(form, missing);
    if (Object.keys(badEmails).length) { Object.assign(missing, badEmails); requiredOnly = false; }
    // The view's own checks (check(data, form) returns null or { field: message }) run in the same pass, so every message shows at once.
    let more = check?.(readForm(form), form);
    // A view's check may read a file (the first-bytes check, D-112), so it can return a promise; it is waited for in the same pass.
    // A check that fails to read counts as no problem: the server still checks.
    if (typeof more?.then === 'function') { try { more = await more; } catch { more = null; } }
    if (more && Object.keys(more).length) { mergeChecks(missing, more); requiredOnly = false; }
    // Then the server's field-type rules, for fields still without a message, so a second problem shows on the first Save.
    const typed = typeProblems(form, missing, labelOf);
    if (Object.keys(typed).length) { Object.assign(missing, typed); requiredOnly = false; }
    if (Object.keys(missing).length) {
      clearSuccessToasts();
      formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert', dataset: { fieldNote: '' } }, requiredOnly ? 'Please fill in the highlighted fields.' : 'Please check the highlighted fields.'));
      showErrors(form, missing);
      busy = false;
      return;
    }
    const focusedBefore = document.activeElement;
    submitBtn.setAttribute('aria-disabled', 'true'); // not .disabled: a disabled button drops focus to the page; `busy` blocks a second submit
    const original = submitBtn.textContent;
    submitBtn.textContent = 'Saving…';
    submitBtn.dataset.ownLabel = original;
    try {
      const result = await onSubmit(readForm(form), { idempotencyKey: idemKey, form });
      // onSubmit returns false when nothing was saved (the person backed out of a question): the draft stays.
      if (result !== false) clearDraft();
    } catch (err) {
      clearSuccessToasts();
      if (err instanceof ApiError) {
        if (err.offline) {
          formError.replaceChildren(h('div', { class: 'alert alert--warn' }, "Couldn't reach BalayHub. Nothing was saved yet — your input is kept. Check your connection and press Save again."));
        } else {
          if (err.status === 400 && idempotent) idemKey = newIdempotencyKey();
          const unplaced = showErrors(form, err.fields);
          // Messages with a field on this form show there once; the summary shows only the ones that have no field (else the generic text).
          const { text, fieldNote } = formErrorText(err, unplaced);
          formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert', dataset: fieldNote ? { fieldNote: '' } : undefined }, text));
          if (err.onRender) err.onRender(formError);
        }
      } else {
        formError.replaceChildren(h('div', { class: 'alert alert--error' }, 'Something went wrong. Please try again.'));
        console.error(err);
      }
      formError.scrollIntoView?.({ block: 'nearest' });
    } finally {
      busy = false;
      submitBtn.removeAttribute('aria-disabled');
      submitBtn.textContent = original;
      delete submitBtn.dataset.ownLabel;
      // The disabled button lost focus: put it on the first invalid field, else where it was, else the button.
      if (form.isConnected && !form.contains(document.activeElement)) {
        const bad = form.querySelector('.field--invalid input, .field--invalid select, .field--invalid textarea');
        (bad || (form.contains(focusedBefore) ? focusedBefore : submitBtn)).focus();
      }
    }
  });
  return form;
}

export function formModal({ title, ...formOpts }) {
  let modal;
  const form = makeForm({
    ...formOpts,
    cancel: () => modal.close(),
    // false means nothing was saved, so the dialog stays open. Pass the view's false on, so makeForm keeps the draft (D-106, D-108).
    onSubmit: async (data, ctx) => { const result = await formOpts.onSubmit(data, ctx); if (result !== false) modal.close(); return result; },
  });
  modal = openModal({ title, body: form });
  return modal;
}

// Debounced search input.
export function searchBox({ value = '', placeholder = 'Search…', onSearch }) {
  let t;
  const input = h('input', { class: 'input', type: 'search', value, placeholder, 'aria-label': placeholder });
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => onSearch(input.value.trim()), 300); });
  return h('div', { class: 'search' }, input);
}

export function pageHead({ title, sub, back, actions }) {
  return h('div', null,
    back && h('a', { class: 'back', href: back.href }, '‹ ', back.label),
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, title), sub && h('p', null, sub)),
      actions && h('div', { class: 'page-head__actions' }, actions)));
}

export function filesList(files, canView = true) {
  if (!files?.length) return h('p', { class: 'muted small' }, 'No attachments yet.');
  // Photos show a small preview (the file name still follows, so the link keeps its name).
  const lead = (f) => (canView && String(f.mime_type || '').startsWith('image/')
    ? h('img', { class: 'file-thumb', src: `/api/files/${f.file_id}`, alt: '', loading: 'lazy' })
    : icon('file'));
  return h('div', { class: 'files' }, files.map((f) => canView
    ? h('a', { class: 'file-link', href: `/api/files/${f.file_id}`, target: '_blank', rel: 'noopener' }, lead(f), f.file_name)
    : h('span', { class: 'file-link muted' }, icon('file'), f.file_name)));
}
