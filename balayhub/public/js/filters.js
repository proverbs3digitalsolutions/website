// Filter bar used by every list page: a search box, quick filters, a
// "Filters" panel, chips for what's active, Clear all, and memory of each
// person's last filters per page (this browser only).
//
//   const f = initFilters('reservations', query, { view: 'upcoming', q: '', channel: '' });
//   const bar = filterBar({ key: 'reservations', values: f, defaults, search: {...}, fields: [...], more: [...], onChange: load });
//
// Field: { name, label, type: 'select' | 'date' | 'daterange' | 'amountrange' | 'number' | 'check', options: [[value, text]], all: 'All …' }
// A daterange field uses `${name}_from` / `${name}_to` (or from/to keys given as `keys`).
// A range that ends before it starts is flagged inline and applies nothing: both of its dates are dropped until it is fixed.
// An amountrange field takes `keys: [min, max]` and follows the same rule for amounts. A number field may give a
// `pattern` (RegExp) and `patternText`: a value that fails it is flagged, not applied, and gets no chip.
// initFilters() drops text and impossible dates in from/to, and non-UUID ids, before any page fetches.
// A select field with an `options` list resets a value that is not one of them to its default before the bar draws,
// so a link with ?rating=9 shows the full list and no chip, and the address loses ?rating=9 too. Dates outside 2000 to 2100 are dropped the same way. A field whose options arrive after the bar is built
// sets `keepUnknown: true` to keep the value.

import { h, fmtDate } from './ui.js';
import { state } from './app.js';

const storeKey = (key) => `bh-filters:${state.user?.user_id || 'anon'}:${key}`;

// Dates typed in a backwards range (from a shared link or a saved filter), kept so the bar can show them once with the message.
const typedBack = new WeakMap();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Dates the whole app accepts (the same 2000 to 2100 window as every other date box). A half-typed year such as 0202 is outside it.
const DATE_MIN = '2000-01-01';
const DATE_MAX = '2100-12-31';
// The one wording for a year outside that window, shared with the stay reports' custom dates.
export const OUT_OF_WINDOW = 'Enter a year from 2000 to 2100.';
export const outOfWindow = (v) => v !== '' && (v < DATE_MIN || v > DATE_MAX);
// A YYYY-MM-DD date outside that window: the one kind of link date the bar drops with its own message.
export const dateOutsideWindow = (v) => DATE_RE.test(v) && outOfWindow(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// True for a real calendar day. 2026-02-30 and 2026-13-01 are not.
function realDate(v) {
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// A date shown in a chip: a value that is not a real day is shown as typed, never as "Invalid Date".
const chipDate = (v) => (DATE_RE.test(v) && realDate(v) ? fmtDate(v) : v);

// Takes dropped keys out of the address bar (#/page?a=1&b=2), so a value the bar refused does not stay in a shared or reloaded link.
function dropFromAddress(keys) {
  try {
    const hash = location.hash || '';
    const i = hash.indexOf('?');
    if (!keys.length || i < 0) return;
    const p = new URLSearchParams(hash.slice(i + 1));
    const hit = keys.filter((k) => p.has(k));
    if (!hit.length) return;
    hit.forEach((k) => p.delete(k));
    const q = p.toString();
    history.replaceState(null, '', hash.slice(0, i) + (q ? `?${q}` : ''));
  } catch { /* no address bar to fix */ }
}

// Runs before any page fetches, so a bad value never reaches the server. Text or an impossible date in a from/to key,
// and a non-UUID *_id, are dropped. A date range that runs backwards is not applied; its dates stay in typedBack for
// the bar to show.
// ponytail: date keys are found by their from/to names, which every range in the app uses. A range with other key
// names would need its pair passed in here to be checked.
function sanitise(out, defaults, dropped = []) {
  const typed = {};
  for (const k of Object.keys(out)) {
    const v = out[k];
    const badDate = /(^|_)(from|to)$/.test(k) && v !== '' && !(DATE_RE.test(v) && realDate(v) && !outOfWindow(v));
    const badId = k.endsWith('_id') && v !== '' && !UUID_RE.test(v);
    if (badDate || badId) { out[k] = defaults[k] ?? ''; dropped.push(k); }
  }
  for (const k of Object.keys(out)) {
    if (!/(^|_)from$/.test(k)) continue;
    const to = k.replace(/from$/, 'to');
    if (!(to in out) || !out[k] || !out[to] || out[to] >= out[k]) continue;
    typed[k] = out[k];
    typed[to] = out[to];
    out[k] = defaults[k] ?? '';
    out[to] = defaults[to] ?? '';
  }
  typedBack.set(out, typed);
  return out;
}

// URL query wins (shared links), then this person's last filters, then defaults.
export function initFilters(key, query, defaults) {
  const urlHas = Object.keys(defaults).some((k) => query[k] !== undefined && query[k] !== '');
  let saved = {};
  if (!urlHas) { try { saved = JSON.parse(localStorage.getItem(storeKey(key))) || {}; } catch { saved = {}; } }
  const out = { ...defaults };
  for (const k of Object.keys(defaults)) {
    const v = urlHas ? query[k] : saved[k];
    // Text is trimmed; a value of only spaces is the default, not an empty-quotes chip.
    if (v !== undefined && v !== null) out[k] = String(v).trim() === '' && String(v) !== '' ? defaults[k] : String(v).trim();
  }
  const dropped = [];
  sanitise(out, defaults, dropped);
  if (urlHas) dropFromAddress(dropped);
  return out;
}

export function rememberFilters(key, values) {
  try { localStorage.setItem(storeKey(key), JSON.stringify(values)); } catch { /* ignore */ }
}

// Only the values that differ from the defaults (for URLs and "is anything set?").
export function changed(values, defaults) {
  return Object.fromEntries(Object.entries(values).filter(([k, v]) => String(v ?? '') !== String(defaults[k] ?? '')));
}

// The values to send to the server: every non-empty one, so a default tab such as status=outstanding is always sent.
// A server that applies no filter when the key is missing would list everything. Addresses keep using changed().
export function apiFilters(values) {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => String(v ?? '') !== ''));
}

function rangeKeys(f) { return f.keys || [`${f.name}_from`, `${f.name}_to`]; }
const isRange = (f) => f.type === 'daterange' || f.type === 'amountrange';

const BACKWARDS = 'The end date is before the start date. This date filter is off until you fix it.';

// What a date range can apply. A year outside 2000 to 2100 is flagged and dropped on its own, and the other end still
// applies. A backwards pair (both ends in the window) applies neither end. `outside` is true while a box is out of the window.
export function rangeCheck(from, to) {
  // Only a real-looking date is judged by the window; text is left for the bar's own checks and shown as typed.
  const lo = DATE_RE.test(from) && outOfWindow(from);
  const hi = DATE_RE.test(to) && outOfWindow(to);
  const backwards = !lo && !hi && Boolean(from && to && to < from);
  return {
    message: lo || hi ? OUT_OF_WINDOW : backwards ? BACKWARDS : '',
    outside: lo || hi,
    keepFrom: !(lo || backwards),
    keepTo: !(hi || backwards),
    flags: { from: lo || backwards, to: hi || backwards },
  };
}

// Amounts as the server reads them (AMOUNT_RE in src/routes/money.js): digits, up to 10, with at most two decimals.
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;
const NOT_AN_AMOUNT = 'Enter an amount of 0 or more (up to 10 digits).';
const AMOUNTS_BACKWARDS = 'The highest amount is below the lowest. This amount filter is off until you fix it.';

// Which ends of an amount range can be applied. An end that doesn't read as an amount is left out, and a range whose
// top is below its bottom applies neither end. An empty end is no filter. `flags` marks the ends to show as wrong.
export function amountRangeCheck(lo, hi) {
  const readable = (v) => v === '' || AMOUNT_RE.test(v);
  const backwards = readable(lo) && readable(hi) && lo !== '' && hi !== '' && Number(hi) < Number(lo);
  return {
    message: !readable(lo) || !readable(hi) ? NOT_AN_AMOUNT : backwards ? AMOUNTS_BACKWARDS : '',
    lo: readable(lo) && !backwards ? lo : '',
    hi: readable(hi) && !backwards ? hi : '',
    flags: { lo: !readable(lo) || backwards, hi: !readable(hi) || backwards },
  };
}

// The funnel on the Filters button. Local so ui.js is untouched; skipped where the page has no SVG support.
const SVG_NS = 'http://www.w3.org/2000/svg';
function filterIcon() {
  if (!document.createElementNS) return '';
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M4 5h16l-6 7.5V19l-4-2v-4.5L4 5z');
  svg.append(p);
  return svg;
}

// A page that redraws its bar (a Property change on Tenants, Maintenance, Rent) builds a new filterBar for the same page.
// The panel stays open and focus stays on the same control. Remembered per page key and only for the same address path.
const panelOpen = new Map();
const pathNow = () => (typeof location === 'undefined' ? '' : location.hash || '').split('?')[0];
const FOCUS_TRIES = 10;

function control(f, values, emit, defaults = {}) {
  const id = `flt-${f.name}-${Math.random().toString(36).slice(2, 6)}`;
  if (f.type === 'daterange') {
    const [a, b] = rangeKeys(f);
    const errId = `${id}-err`;
    // A backwards range that initFilters() held back shows its typed dates once, then the bar reads the applied values.
    const typed = typedBack.get(values) || {};
    const shownA = typed[a] ?? values[a];
    const shownB = typed[b] ?? values[b];
    delete typed[a];
    delete typed[b];
    const from = h('input', { class: 'input', type: 'date', id, 'data-flt': f.name, value: shownA || '', 'aria-label': `${f.label}, from`, 'aria-describedby': errId });
    const to = h('input', { class: 'input', type: 'date', value: shownB || '', 'aria-label': `${f.label}, to`, 'aria-describedby': errId });
    const err = h('div', { id: errId, role: 'alert', style: { color: 'var(--red)', fontSize: '.84rem', fontWeight: '650' } });
    // Dates are YYYY-MM-DD, so string order is calendar order. A year outside 2000 to 2100 is flagged at its box and only
    // that end is dropped. A backwards range is flagged and applies nothing: the side that was already applied drops back
    // to its default too, so the list reloads without this range. The message text is set only while a problem shows.
    const check = () => {
      const r = rangeCheck(from.value, to.value);
      err.hidden = !r.message;
      err.replaceChildren(r.message);
      for (const [input, bad] of [[from, r.flags.from], [to, r.flags.to]]) { if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
      return r;
    };
    const apply = () => {
      const r = check();
      const nextA = r.keepFrom ? from.value : (defaults[a] ?? '');
      const nextB = r.keepTo ? to.value : (defaults[b] ?? '');
      // A half-typed year (the box reads 0202 on the way to 2026) changes nothing, so the list is not reloaded for it.
      const same = nextA === values[a] && nextB === values[b];
      values[a] = nextA;
      values[b] = nextB;
      if (!r.outside || !same) emit();
    };
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);
    // From a shared link or an old saved filter: keep the dates on screen with the message, but do not apply what is wrong.
    const first = check();
    if (!first.keepFrom) values[a] = defaults[a] ?? '';
    if (!first.keepTo) values[b] = defaults[b] ?? '';
    const invalid = Boolean(first.message);
    return { el: h('div', { class: 'flt__field flt__field--range' }, h('label', { for: id }, f.label), h('div', { class: 'flt__range' }, from, h('span', { 'aria-hidden': 'true' }, '–'), to), err), sync: () => { from.value = values[a] || ''; to.value = values[b] || ''; check(); }, invalid };
  }
  if (f.type === 'amountrange') {
    const [a, b] = rangeKeys(f);
    const errId = `${id}-err`;
    const from = h('input', { class: 'input', id, 'data-flt': f.name, type: 'number', value: values[a] || '', min: 0, step: '0.01', inputmode: 'decimal', 'aria-label': `${f.label}, from`, 'aria-describedby': errId });
    const to = h('input', { class: 'input', type: 'number', value: values[b] || '', min: 0, step: '0.01', inputmode: 'decimal', 'aria-label': `${f.label}, to`, 'aria-describedby': errId });
    const err = h('div', { id: errId, role: 'alert', style: { color: 'var(--red)', fontSize: '.84rem', fontWeight: '650' } });
    // The message shows once, at the range, and the ends that are wrong are marked. The check reads the boxes, so a
    // typed amount stays on screen while it is fixed.
    const check = () => {
      const r = amountRangeCheck(from.value, to.value);
      err.hidden = !r.message;
      err.replaceChildren(r.message || '');
      for (const [input, bad] of [[from, r.flags.lo], [to, r.flags.hi]]) { if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
      return r;
    };
    // Only the ends that can be applied are written; a wrong end drops back to its default, so the list reloads without it.
    const settle = () => {
      const r = check();
      values[a] = r.lo || (defaults[a] ?? '');
      values[b] = r.hi || (defaults[b] ?? '');
      return r;
    };
    from.addEventListener('change', () => { settle(); emit(); });
    to.addEventListener('change', () => { settle(); emit(); });
    // From a shared link or an old saved filter: keep the typed amounts on screen with the message, and apply only what is readable.
    const invalid = Boolean(settle().message);
    return { el: h('div', { class: 'flt__field flt__field--range' }, h('label', { for: id }, f.label), h('div', { class: 'flt__range' }, from, h('span', { 'aria-hidden': 'true' }, '–'), to), err), sync: () => { from.value = values[a] || ''; to.value = values[b] || ''; check(); }, invalid };
  }
  if (f.type === 'check') {
    const box = h('input', { type: 'checkbox', id, 'data-flt': f.name, checked: values[f.name] === '1' });
    box.addEventListener('change', () => { values[f.name] = box.checked ? '1' : ''; emit(); });
    return { el: h('label', { class: 'check flt__check', for: id }, box, h('span', null, f.label)), sync: () => { box.checked = values[f.name] === '1'; } };
  }
  if (f.type === 'number' || f.type === 'date') {
    // A number with a pattern (an amount) flags a value the server would ignore, and a date outside 2000 to 2100 gets the
    // window message. Either applies nothing until it is fixed, the same as a bad date range. An empty box is no filter.
    const errId = `${id}-err`;
    const err = f.pattern || f.type === 'date' ? h('div', { id: errId, role: 'alert', hidden: true, style: { color: 'var(--red)', fontSize: '.84rem', fontWeight: '650' } }) : null;
    const input = h('input', { class: 'input', id, 'data-flt': f.name, type: f.type, value: values[f.name] || '', min: f.min, step: f.step, placeholder: f.placeholder, inputmode: f.type === 'number' ? 'decimal' : null, 'aria-describedby': err ? errId : null });
    const show = (v) => {
      const outside = f.type === 'date' && outOfWindow(v);
      const bad = outside || Boolean(f.pattern && v !== '' && !f.pattern.test(v));
      const text = outside ? OUT_OF_WINDOW : bad ? f.patternText : '';
      if (err) { err.hidden = !bad; err.replaceChildren(text); }
      if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      return bad;
    };
    input.addEventListener('change', () => {
      const outside = f.type === 'date' && outOfWindow(input.value);
      const before = values[f.name];
      const bad = show(input.value);
      values[f.name] = bad ? (defaults[f.name] ?? '') : input.value;
      // A half-typed year (0202 on the way to 2026) that leaves the applied date as it was does not reload the list.
      if (!outside || values[f.name] !== before) emit();
    });
    // From a shared link or an old saved filter: keep the value on screen with the message, but do not apply it.
    const invalid = show(input.value);
    if (invalid) values[f.name] = defaults[f.name] ?? '';
    return { el: h('div', { class: 'flt__field' }, h('label', { for: id }, f.label), input, err), sync: () => { input.value = values[f.name] || ''; show(input.value); }, invalid };
  }
  const sel = h('select', { class: 'input', id, 'aria-label': f.label, 'data-flt': f.name },
    f.all !== false && h('option', { value: '' }, f.all || `All`),
    (f.options || []).map(([v, t]) => h('option', { value: v, selected: String(values[f.name] ?? '') === String(v) }, t)));
  // A quick select that is off its default is marked, so it reads as a filter that is on.
  const mark = () => sel.classList?.toggle('is-set', String(values[f.name] ?? '') !== String(defaults[f.name] ?? ''));
  sel.addEventListener('change', () => { values[f.name] = sel.value; mark(); emit(); });
  mark();
  return { el: f.inline ? sel : h('div', { class: 'flt__field' }, h('label', { for: id }, f.label), sel), sync: () => { sel.value = values[f.name] ?? ''; mark(); } };
}

function chipText(f, values) {
  if (f.type === 'daterange') {
    const [a, b] = rangeKeys(f);
    if (!values[a] && !values[b]) return null;
    return `${f.label}: ${values[a] ? chipDate(values[a]) : '…'} – ${values[b] ? chipDate(values[b]) : '…'}`;
  }
  if (f.type === 'amountrange') {
    const [a, b] = rangeKeys(f);
    if (!values[a] && !values[b]) return null;
    return `${f.label}: ${values[a] || '…'} – ${values[b] || '…'}`;
  }
  const v = values[f.name];
  if (!v) return null;
  if (f.type === 'check') return f.label;
  if (!f.type || f.type === 'select') return `${f.label}: ${(f.options || []).find(([k]) => String(k) === String(v))?.[1] || v}`;
  return `${f.label}: ${f.type === 'date' ? chipDate(v) : v}`;
}

function clearField(f, values, defaults) {
  if (isRange(f)) rangeKeys(f).forEach((k) => { values[k] = defaults[k] ?? ''; });
  else values[f.name] = defaults[f.name] ?? '';
}

/**
 * Returns the bar element. `quick` fields sit in the toolbar; `more` fields
 * open under "Filters". Calls onChange() after any change (debounced
 * for search), and remembers the values under `key`.
 */
export function filterBar({ key, values, defaults, search, quick = [], more = [], onChange, extra }) {
  const all = [...quick, ...more];
  const dropped = [];
  for (const f of all) {
    if (!f || (f.type && f.type !== 'select') || !Array.isArray(f.options) || f.keepUnknown) continue;
    const v = String(values[f.name] ?? '');
    if (v !== '' && v !== String(defaults[f.name] ?? '') && !f.options.some(([k]) => String(k) === v)) { values[f.name] = defaults[f.name] ?? ''; dropped.push(f.name); }
  }
  dropFromAddress(dropped);
  const chips = h('div', { class: 'flt__chips', 'aria-live': 'polite' });
  const moreBtn = more.length ? h('button', { type: 'button', class: 'btn btn--secondary flt__more', 'aria-expanded': 'false' }) : null;
  const panel = more.length ? h('div', { class: 'flt__panel card card--soft', hidden: true }) : null;
  const controls = [];
  let searchInput;

  const activeMore = () => more.filter((f) => chipText(f, values)).length;
  const isOn = (f, t) => t && (isRange(f) || String(values[f.name] ?? '') !== String(defaults[f.name] ?? ''));
  function paint() {
    const active = all.map((f) => [f, chipText(f, values)]).filter(([f, t]) => isOn(f, t));
    if (moreBtn) {
      const n = active.length;
      moreBtn.replaceChildren(filterIcon(), 'Filters', n ? h('span', { class: 'flt__count' }, String(n)) : '');
      moreBtn.setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
      moreBtn.classList?.toggle('is-active', n > 0);
    }
    const q = search && values[search.name || 'q'];
    chips.replaceChildren(
      ...(q ? [h('button', { type: 'button', class: 'flt__chip', 'aria-label': `Remove search ${q}`, onclick: () => { values[search.name || 'q'] = ''; searchInput.value = ''; emit(); } }, `“${q}”`, h('span', { 'aria-hidden': 'true' }, ' ×'))] : []),
      ...active.map(([f, t]) => h('button', { type: 'button', class: 'flt__chip', 'aria-label': `Remove filter ${t}`, onclick: () => { clearField(f, values, defaults); controls.forEach((c) => c.sync()); emit(); } }, t, h('span', { 'aria-hidden': 'true' }, ' ×'))),
      (q || active.length > 0) ? h('button', { type: 'button', class: 'flt__clear', onclick: () => clearAll() }, 'Clear all') : '');
  }
  function emit() { rememberFilters(key, values); paint(); onChange(); }
  function clearAll() {
    for (const k of Object.keys(defaults)) values[k] = defaults[k];
    if (searchInput) searchInput.value = values[search.name || 'q'] || '';
    controls.forEach((c) => c.sync());
    emit();
  }

  let searchEl = null;
  if (search) {
    let t;
    searchInput = h('input', { class: 'input', type: 'search', 'data-flt': search.name || 'q', value: values[search.name || 'q'] || '', placeholder: search.placeholder || 'Search…', 'aria-label': search.label || search.placeholder || 'Search' });
    searchInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { values[search.name || 'q'] = searchInput.value.trim(); emit(); }, 300); });
    searchEl = h('div', { class: 'search' }, searchInput);
  }
  const quickEls = quick.map((f) => { const c = control({ ...f, inline: f.type === 'select' || !f.type }, values, emit, defaults); controls.push(c); return c.el; });
  if (panel) {
    const moreCtrls = more.map((f) => { const c = control({ type: 'select', ...f }, values, emit, defaults); controls.push(c); return c; });
    panel.append(h('div', { class: 'flt__grid' }, moreCtrls.map((c) => c.el)),
      h('div', { class: 'flt__actions' }, h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onclick: () => clearAll() }, 'Reset filters'),
        h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: () => toggle(false) }, 'Done')));
    const was = panelOpen.get(key);
    if (activeMore() || moreCtrls.some((c) => c.invalid) || (was && was.path === pathNow() && was.open)) panel.hidden = false;
  }
  function toggle(open) {
    panel.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
    panelOpen.set(key, { open, path: pathNow() });
  }
  moreBtn?.addEventListener('click', () => toggle(panel.hidden));
  if (panel && !panel.hidden) moreBtn.setAttribute('aria-expanded', 'true');
  paint();
  // A selected control of the bar being replaced: once this bar is in the page, focus goes to the control with the same name.
  const old = typeof document !== 'undefined' && document.activeElement?.closest?.('.flt');
  const focusName = old ? document.activeElement.getAttribute?.('data-flt') : null;
  const byLabel = !moreBtn && quick.some((f) => !f.type || f.type === 'select');
  const root = h('div', { class: 'flt' }, h('div', { class: 'toolbar flt__bar' }, extra, searchEl, byLabel && h('span', { class: 'flt__by muted small' }, filterIcon(), 'Filter by'), quickEls, moreBtn), panel, chips);
  if (old) {
    let tries = 0;
    const land = () => {
      if (!root.isConnected) { if (++tries < FOCUS_TRIES) setTimeout(land, 50); return; }
      const next = (focusName && root.querySelector(`[data-flt="${focusName}"]`)) || root.querySelector('.flt__more') || root.querySelector('input[type="search"]');
      next?.focus?.({ preventScroll: true });
    };
    setTimeout(land, 0);
  }
  return root;
}
