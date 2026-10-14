// UI helpers. All DOM is built with h() (text nodes, never innerHTML with data),
// so user-entered names can't inject markup.

import { ApiError, newIdempotencyKey } from './api.js';

// Views pass optional children as `cond && node`; drop false/null/undefined
// instead of rendering them as the text "false" or "null".
for (const name of ['replaceChildren', 'append']) {
  const original = Element.prototype[name];
  Element.prototype[name] = function filtered(...nodes) {
    return original.apply(this, nodes.flat().filter((n) => n !== false && n !== null && n !== undefined && n !== true));
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
  const el = h('div', { class: `toast${kind === 'error' ? ' toast--error' : ''}`, role: 'status' }, message);
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
// A page often redraws after a save or click, replacing the button the person used. Find the new control with the
// same tag and accessible name (aria-label, else its text).
const accName = (el) => (el.getAttribute?.('aria-label') || el.textContent || '').trim();
export function sameControl(old, doc = document) {
  if (!old?.tagName) return null;
  const name = accName(old);
  if (!name) return null;
  return [...doc.querySelectorAll(old.tagName.toLowerCase())].find((el) => el.isConnected !== false && accName(el) === name) || null;
}

// What to look for after a redraw: the control's tag and name, and for each ancestor up to #app the ancestor itself, the control's
// index among that ancestor's same-tag elements and their count (so a toggle that renamed itself is still found by place).
export function snapshotControl(old) {
  const tag = old.tagName.toLowerCase();
  const chain = [];
  for (let p = old.parentElement; p; p = p.parentElement) {
    const same = [...p.querySelectorAll(tag)];
    chain.push({ el: p, index: same.indexOf(old), count: same.length });
    if (p.id === 'app' || p === document.body) break;
  }
  return { tag, name: accName(old), chain };
}

// The control that took the old one's place: (1) same tag and name; else (2) the nearest recorded ancestor still on the page whose
// count of same-tag elements is unchanged gives the element at the recorded index; else null.
export function findReplacement(snap, doc = document) {
  if (!snap) return null;
  if (snap.name) {
    const same = [...doc.querySelectorAll(snap.tag)].find((el) => el.isConnected !== false && accName(el) === snap.name);
    if (same) return same;
  }
  for (const { el, index, count } of snap.chain) {
    if (el.isConnected === false || index < 0) continue;
    const now = [...el.querySelectorAll(snap.tag)];
    if (now.length === count && now[index]) return now[index];
  }
  return null;
}

// Checks at these times after the action: dense at first, then every 500 ms to 10 s (a slow connection redraws late).
export const FOCUS_WATCH_MS = 10000;
export const FOCUS_CHECKS = [0, 40, 100, 200, 350, 500, 800, 1200, 1600, 2000];
for (let ms = 2500; ms <= FOCUS_WATCH_MS; ms += 500) FOCUS_CHECKS.push(ms);

// Watches up to FOCUS_WATCH_MS (views redraw after their await) and puts focus where the person was working. While focus is still on
// the old control it keeps waiting (the redraw has not happened). Never takes focus the person (or the view) has put on something else;
// from headingAfter ms with no replacement it falls back to the page heading (and to a new heading if a redraw replaced it), and a
// replacement that shows up later still takes over.
export function keepFocus(old, { refocusOld = true, stop = () => false, snap, headingAfter = 800 } = {}) {
  const taken = old?.tagName ? (snap || snapshotControl(old)) : null;
  let done = false;
  let heading = null;
  let wasDisabled = false; // a button disabled during its own request loses focus; it gets it back when enabled again
  FOCUS_CHECKS.forEach((ms) => setTimeout(() => {
    if (done) return;
    if (stop()) { done = true; return; }
    const a = document.activeElement;
    const free = !a || a === document.body || !a.isConnected || a === heading;
    if (!free && a !== old) { done = true; return; }
    if (old?.isConnected) {
      if (old.disabled) wasDisabled = true;
      else if ((free || a === old) && (refocusOld || wasDisabled)) { done = true; old.focus(); }
      return;
    }
    const next = findReplacement(taken);
    if (next && !next.disabled) { done = true; next.focus(); return; }
    if (ms >= headingAfter) {
      const h1 = document.querySelector('#app h1') || document.querySelector('h1');
      if (h1 && a !== h1) { heading = h1; h1.setAttribute('tabindex', '-1'); h1.focus(); }
    }
  }, ms));
}

// Any button or link whose click drops focus to the page (its control was redrawn away) gets focus back, in dialogs too.
// Tabs have their own rule in app.js; a dialog's own close rule restores focus to its opener.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element && e.target.closest('button, a[href]');
    if (!btn || btn.closest('[role="tablist"]')) return;
    const hash = location.hash;
    const dlg = btn.closest('dialog');
    keepFocus(btn, { refocusOld: false, stop: () => location.hash !== hash || Boolean(dlg && !dlg.isConnected) });
  }, true);
}

// ---------------------------------------------------------------- modal
export function openModal({ title, body, onClose, wide }) {
  const opener = document.activeElement;
  const openerSnap = opener?.tagName && opener !== document.body && opener.isConnected !== false ? snapshotControl(opener) : null;
  const dlg = h('dialog', { class: 'modal', 'aria-label': title });
  if (wide) dlg.classList.add('modal--wide');
  const close = () => dlg.close();
  dlg.append(
    h('div', { class: 'modal__head' }, h('h2', null, title), h('button', { class: 'modal__close', type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'modal__body' }, body),
  );
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); if (openerSnap) keepFocus(opener, { snap: openerSnap }); else keepFocus(null, { headingAfter: 0 }); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return { close, el: dlg };
}

let reasonSeq = 0;
export function confirmDialog({ title, text, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, reason = false }) {
  return new Promise((resolve) => {
    let done = false;
    const rid = `reason-${++reasonSeq}`;
    const reasonInput = reason ? h('textarea', { class: 'input', id: rid, name: 'reason', required: true, maxlength: 300, 'aria-describedby': `${rid}-err`, placeholder: 'Required — explain why (kept in the audit log)' }) : null;
    const err = h('div', { class: 'error', id: `${rid}-err`, role: 'alert' });
    // A form asking this question is not saving yet: its button shows its own label until the answer is yes.
    const saving = [...document.querySelectorAll('button[data-own-label]')].filter((b) => b.textContent === 'Saving…');
    for (const b of saving) b.textContent = b.dataset.ownLabel;
    const m = openModal({
      title,
      onClose: () => { if (!done) resolve(null); },
      body: h('div', { class: 'form' },
        h('p', null, text),
        reasonInput && h('div', { class: 'field' }, h('label', { for: rid }, 'Reason ', h('span', { class: 'req' }, '*')), reasonInput, err),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => m.close() }, cancelText),
          h('button', {
            class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button',
            onclick: () => {
              if (reasonInput && !reasonInput.value.trim()) { err.textContent = 'Please enter a reason.'; reasonInput.focus(); return; }
              done = true;
              for (const b of saving) if (b.dataset.ownLabel !== undefined) b.textContent = 'Saving…';
              m.close(); resolve(reasonInput ? reasonInput.value.trim() : true);
            },
          }, confirmText))),
    });
  });
}

// ---------------------------------------------------------------- forms
/**
 * field({ name, label, type, value, required, options, hint, placeholder, ... })
 * type: text | email | tel | password | date | number | money | select | textarea | checkbox
 */
export function field(f) {
  const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
  const common = { id, name: f.name, required: f.required, placeholder: f.placeholder, autocomplete: f.autocomplete || 'off', 'aria-describedby': `${id}-err` };
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
      min: f.min, max: f.max, step: f.step, maxlength: f.maxlength || (f.type === 'date' ? undefined : 200),
      value: f.value ?? '',
    });
    if (isMoney) input = h('div', { class: 'input-money' }, input);
  }
  return h('div', { class: 'field', dataset: { field: f.name } },
    h('label', { for: id }, f.label, f.required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
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
    first ||= target.focus;
  }
  first?.focus();
  return unplaced;
}

// Keep unsaved form input in sessionStorage so it survives an expired session
// or a dropped connection. Passwords are never stored.
export function persistDraft(form, key) {
  const storeKey = `bh-draft:${key}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storeKey) || 'null');
    if (saved) {
      for (const el of form.elements) {
        if (!el.name || el.type === 'password' || el.type === 'file' || !(el.name in saved)) continue;
        if (el.type === 'checkbox') { if (!el.dataset.multi) el.checked = saved[el.name]; } else el.value = saved[el.name];
      }
    }
  } catch { /* storage unavailable */ }
  form.addEventListener('input', () => {
    try {
      const data = readForm(form);
      for (const el of form.elements) if (el.type === 'password') delete data[el.name];
      sessionStorage.setItem(storeKey, JSON.stringify(data));
    } catch { /* ignore */ }
  });
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
    const labelOf = (el) => form.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.firstChild?.textContent?.trim() || 'This field';
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
    // The view's own checks (check(data, form) returns null or { field: message }) run in the same pass, so every message shows at once.
    const more = check?.(readForm(form), form);
    if (more && Object.keys(more).length) { mergeChecks(missing, more); requiredOnly = false; }
    if (Object.keys(missing).length) {
      clearSuccessToasts();
      formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert', dataset: { fieldNote: '' } }, requiredOnly ? 'Please fill in the highlighted fields.' : 'Please check the highlighted fields.'));
      showErrors(form, missing);
      busy = false;
      return;
    }
    const focusedBefore = document.activeElement;
    submitBtn.disabled = true;
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
          // Validation: show only the server messages that have no field on this form (else the generic summary).
          const text = err.summary ? (unplaced.length ? [...new Set(unplaced)].join(' ') : err.summary) : err.message;
          // The summary names the highlighted fields only when it is not an unplaced server message.
          const fieldNote = Boolean(err.summary) && !unplaced.length;
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
      submitBtn.disabled = false;
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
    // false means nothing was saved, so the dialog stays open.
    onSubmit: async (data, ctx) => { const result = await formOpts.onSubmit(data, ctx); if (result !== false) modal.close(); },
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
