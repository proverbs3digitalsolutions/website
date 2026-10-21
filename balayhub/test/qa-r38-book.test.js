'use strict';
require('./helpers');

// QA r38 BOOK (audit row 20, D-120 class (b)): Continue to payment is busy while its own request waits. It is marked
// aria-disabled, not disabled, so it keeps focus; a second press sends nothing; a refusal clears the mark.
// Frontend only: the submit handler is cut out of book.js by brace matching and run with stubs. No database is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
const MARKER = "form.addEventListener('submit', async (e) => {";

// The handler's body: the text from its "{" to the matching "}". Strings, template text and comments are skipped,
// so a brace inside them does not count.
function handlerBody() {
  assert.equal(src.split(MARKER).length - 1, 1, 'one submit handler in book.js');
  const open = src.indexOf(MARKER) + MARKER.length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('handler body is not closed');
}

const body = handlerBody();

const regexFrom = (name) => {
  const m = new RegExp(`^const ${name} = (/.+/);$`, 'm').exec(src);
  assert.ok(m, `${name} is a regex literal in book.js`);
  return new Function(`return ${m[1]};`)();
};

// `with (ctx)` gives the handler the view's closure: the names it reads come from ctx, and the ones it sets
// (busy, days) stay on ctx between presses, as they do in the real view.
function handlerFor(ctx) {
  return new Function('ctx', `with (ctx) { return async (e) => {${body}\n}; }`)(ctx);
}

// A stand-in page. Like a browser, setting disabled on the focused control drops focus to the page.
function world() {
  return { active: null, body: { tag: 'BODY' } };
}

function button(w, label) {
  return {
    label,
    textContent: label,
    attrs: {},
    _disabled: false,
    get disabled() { return this._disabled; },
    set disabled(v) { this._disabled = Boolean(v); if (this._disabled && w.active === this) w.active = w.body; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() { if (!this._disabled) w.active = this; },
  };
}

class ApiError extends Error {
  constructor(message, { status = 0, code, fields } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function setup() {
  const w = world();
  w.active = w.body;
  const submit = button(w, 'Continue to payment');
  const payError = { children: [], replaceChildren(...nodes) { this.children = nodes; } };
  const calls = { pending: [], loadDays: 0, drawCal: 0, shown: [] };
  const ctx = {
    busy: false,
    current: { deposit_allowed: false },
    days: new Map(),
    monthStart: '2026-11',
    checkIn: '2026-11-20',
    checkOut: '2026-11-22',
    promoCode: '',
    source: undefined,
    slug: 'qa-r38-book',
    l: { unit_id: 7, max_guests: 4 },
    rulesBox: null,
    EMAIL_RE: regexFrom('EMAIL_RE'),
    PHONE_RE: regexFrom('PHONE_RE'),
    form: { elements: { consent: { checked: true } }, querySelector: () => null },
    formError: { replaceChildren() {} },
    payError,
    submit,
    codeBox: { open: false },
    codeMsg: { textContent: '', className: '' },
    readForm: () => ({ name: 'QA r38 book guest', email: 'qa.r38@example.test', phone: '+639171234567', num_guests: '2', notes: '', consent: true }),
    clearErrors() {},
    showErrors: (form, errors) => { calls.shown.push(errors); return []; },
    selections: () => [],
    guestCountMsg: () => 'At least 1 guest.',
    t: (s) => s,
    tServer: (s) => s,
    tFields: (f) => f,
    h: (tag, attrs, ...kids) => ({ tag, attrs, kids }),
    post: (url) => new Promise((resolve, reject) => { calls.pending.push({ url, resolve, reject }); }),
    ApiError,
    location: { href: '' },
    loadDays: async () => { calls.loadDays++; },
    drawCal: () => { calls.drawCal++; },
  };
  return { ctx, calls, w, submit, payError };
}

// A press: the control takes focus, then its submit handler runs.
function press(w, btn, handler) {
  w.active = btn;
  return handler({ preventDefault() {} });
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('while the request waits, Continue is aria-disabled, not disabled, keeps focus, and a second press sends nothing', async () => {
  const { ctx, calls, w, submit } = setup();
  const handler = handlerFor(ctx);
  const first = press(w, submit, handler);
  await tick();
  assert.equal(calls.pending.length, 1, 'one request is sent');
  assert.equal(calls.pending[0].url, '/public/book/qa-r38-book/units/7/checkout');
  assert.equal(submit.getAttribute('aria-disabled'), 'true', 'busy mark is set');
  assert.notEqual(submit.disabled, true, 'not natively disabled: a disabled control drops focus to the page');
  assert.equal(w.active, submit, 'focus stays on Continue while it waits');
  await press(w, submit, handler);
  assert.equal(calls.pending.length, 1, 'a second press sends no second request');
  calls.pending[0].reject(new ApiError('Those dates were just booked.', { status: 409, code: 'DATES_TAKEN' }));
  await first;
});

test('a refused date (DATES_TAKEN) clears the busy mark, reloads the calendar and shows the refusal', async () => {
  const { ctx, calls, w, submit, payError } = setup();
  const handler = handlerFor(ctx);
  const first = press(w, submit, handler);
  await tick();
  calls.pending[0].reject(new ApiError('Those dates were just booked.', { status: 409, code: 'DATES_TAKEN' }));
  await first;
  assert.equal(submit.getAttribute('aria-disabled'), null, 'busy mark is gone');
  assert.notEqual(submit.disabled, true, 'Continue was never natively disabled by the press');
  assert.equal(ctx.busy, false, 'a new press can send again');
  assert.equal(submit.textContent, 'Continue to payment');
  assert.equal(calls.loadDays, 1);
  assert.equal(calls.drawCal, 1);
  assert.equal(payError.children[0].kids[0], 'Those dates were just booked.');
});

test('a refused field clears the busy mark and shows the check-the-fields line', async () => {
  const { ctx, calls, w, submit, payError } = setup();
  const handler = handlerFor(ctx);
  const first = press(w, submit, handler);
  await tick();
  calls.pending[0].reject(new ApiError('Check the form.', { status: 400, code: 'VALIDATION', fields: { email: 'Enter a valid email address.' } }));
  await first;
  assert.equal(submit.getAttribute('aria-disabled'), null, 'busy mark is gone');
  assert.notEqual(submit.disabled, true, 'Continue was never natively disabled by the press');
  assert.equal(ctx.busy, false, 'a new press can send again');
  assert.deepEqual(calls.shown, [{ email: 'Enter a valid email address.' }]);
  assert.equal(payError.children[0].kids[0], 'Please check the highlighted fields.');
});

test('a request that succeeds sends the guest to the payment page, and Continue stays busy until the page changes', async () => {
  const { ctx, calls, w, submit } = setup();
  const handler = handlerFor(ctx);
  const first = press(w, submit, handler);
  await tick();
  calls.pending[0].resolve({ checkout_url: 'https://checkout.example.test/qa-r38' });
  await first;
  assert.equal(ctx.location.href, 'https://checkout.example.test/qa-r38');
  await press(w, submit, handler);
  assert.equal(calls.pending.length, 1, 'no second checkout is started');
});

// QA r38 BOOK (quote refusal): the quote summary's alert shows the server's own words. The quote function (updateQuote) is cut
// out of book.js from its first line to the cancellation-policy section and run with stubs, the same way as the handler above.
const QUOTE_START = '  async function updateQuote() {';
const QUOTE_END = '  // The cancellation policy';

function quoteUpdater(ctx) {
  const start = src.indexOf(QUOTE_START);
  const end = src.indexOf(QUOTE_END);
  assert.ok(start > 0 && end > start, 'updateQuote sits before the cancellation policy in book.js');
  const fnSrc = src.slice(start, end).trim().replace(/^async function updateQuote/, 'async function');
  return new Function('ctx', `with (ctx) { return ${fnSrc}; }`)(ctx);
}

// What api.js hands the view for a refusal: its fields are always an object (api.js: this.fields = fields || {}).
const refusal = (message, fields = {}) => new ApiError(message, { status: 400, fields });

function quoteSetup() {
  const calls = { get: [], guestErrors: [] };
  const payErr = { textContent: '' };
  const ctx = {
    current: null,
    submit: { disabled: false },
    payChoice: { querySelector: (sel) => (sel === '.error' ? payErr : null) },
    codeBox: { querySelector: () => ({ textContent: '' }) },
    codeMsg: { textContent: '', className: '' },
    codeInput: { setAttribute() {}, removeAttribute() {} },
    guestsFromServer: false,
    setGuestsError: (msg) => { calls.guestErrors.push(msg); },
    guestCountOk: () => true,
    checkIn: '2026-11-20',
    checkOut: '2026-11-22',
    promoCode: '',
    slug: 'qa-r38-book',
    l: { unit_id: 7, max_guests: 4 },
    guestsNow: () => 2,
    picked: new Map(),
    selections: () => [],
    addonRows: [],
    opt: 'either',
    host: { accepting: true },
    summary: { children: null, replaceChildren(...nodes) { this.children = nodes; } },
    get: (url) => new Promise((resolve, reject) => { calls.get.push({ url, resolve, reject }); }),
    showPrice() {},
    drawSummary() {},
    h: (tag, attrs, ...kids) => ({ tag, attrs, kids }),
    t: (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)),
    tServer: (s) => s,
    money: (v) => `₱${v}`,
    fmtDate: (d) => d,
  };
  return { ctx, calls };
}

test('a quote refused with no field messages shows the server\'s words in the summary alert', async () => {
  const { ctx, calls } = quoteSetup();
  const updateQuote = quoteUpdater(ctx);
  const done = updateQuote();
  assert.equal(calls.get.length, 1, 'one quote request is sent');
  calls.get[0].reject(refusal('QA r38 refused.'));
  await done;
  const [alert] = ctx.summary.children;
  assert.equal(alert.attrs.class, 'alert alert--error');
  assert.equal(alert.attrs.role, 'alert');
  assert.equal(alert.kids[0], 'QA r38 refused.');
});

test('a quote refused with a field message shows that field message in the summary alert', async () => {
  const { ctx, calls } = quoteSetup();
  const updateQuote = quoteUpdater(ctx);
  const done = updateQuote();
  calls.get[0].reject(refusal('QA r38 check-out refused.', { check_out: 'QA r38 minimum stay is 2 nights.' }));
  await done;
  const [alert] = ctx.summary.children;
  assert.equal(alert.kids[0], 'QA r38 minimum stay is 2 nights.');
});

test('a guest-limit refusal still goes to the Guests box and leaves the summary empty (D-118)', async () => {
  const { ctx, calls } = quoteSetup();
  const updateQuote = quoteUpdater(ctx);
  const done = updateQuote();
  calls.get[0].reject(refusal('Guests must be at most 4.', { guests: 'Guests must be at most 4.' }));
  await done;
  assert.deepEqual(calls.guestErrors, ['Guests must be at most 4.']);
  assert.deepEqual(ctx.summary.children, []);
});
