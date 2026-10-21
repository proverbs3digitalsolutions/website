'use strict';
require('./helpers');

// QA round 38, lane CHECKIN (row 8, D-120): the guest's Submit registration button is busy with its own request. It is
// marked aria-disabled, not disabled, so it keeps focus while the save waits (a disabled button drops focus to the page).
// The submit handler is cut out of public/js/views/checkin.js by brace matching and run with stubs on a stand-in page.
// Frontend only, no database. R38_CHECKIN_SRC (optional) points the test at another copy of checkin.js (used to show it red on b6426e3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { world } = require('./focus-world');

const SRC = fs.readFileSync(process.env.R38_CHECKIN_SRC || path.join(__dirname, '../public/js/views/checkin.js'), 'utf8');

// The body of `form.addEventListener('submit', async (e) => { ... })`. Strings, template literals and comments are skipped,
// so an apostrophe or a brace inside them does not move the end of the body.
function submitBody() {
  const head = "form.addEventListener('submit', async (e) => {";
  const at = SRC.indexOf(head);
  assert.ok(at >= 0, 'the submit handler is in checkin.js');
  const start = at + head.length;
  let depth = 1;
  let quote = null;
  for (let i = start; i < SRC.length; i++) {
    const c = SRC[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); continue; }
    if (c === '/' && SRC[i + 1] === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return SRC.slice(start, i);
  }
  throw new Error('the submit handler is not closed');
}
const BODY = submitBody();

class ApiError extends Error {}
const flush = () => new Promise((resolve) => setImmediate(resolve));

// One guest's page: the Submit button on the stand-in page, the form's stubs, and the request the handler waits on.
// The one rule of a real browser that matters here: a disabled button can't hold focus, so setting disabled drops it to the page.
function page() {
  const w = world();
  const submit = w.make('button', { type: 'submit' }, 'Submit registration');
  w.main.add(submit);
  submit.removeAttribute = (k) => { delete submit.attrs[k]; }; // the stand-in node has get and set only
  let off = false;
  Object.defineProperty(submit, 'disabled', {
    get: () => off,
    set(v) { off = Boolean(v); if (off && w.activeElement === submit) w.activeElement = w.body; },
  });
  const requests = [];
  let waiting = null;
  const post = (url, body) => { requests.push({ url, body }); return new Promise((resolve, reject) => { waiting = { resolve, reject }; }); };
  const formError = { kids: [], replaceChildren(...k) { this.kids = k; }, append(...k) { this.kids.push(...k); } };
  const heading = { textContent: '' };
  const uploads = [];
  const stubs = {
    clearErrors: () => {},
    showErrors: () => [],
    readForm: () => ({ lead_name: 'Ana Cruz', phone: '0917 123 4567', email: '', arrival_time: '', vehicle_plate: '', notes: '' }),
    formError,
    photos: { files: [{ name: 'id.png', size: 10, type: 'image/png' }] },
    form: { elements: { consent: { checked: true }, accept_rules: { checked: false } } },
    others: { querySelectorAll: () => [] },
    t: (s) => s,
    tServer: (s) => s,
    tFields: (f) => f,
    rules: '',
    rulesAt: null,
    r: null,
    ID_PHOTO_TYPE: /^image\/(jpeg|png|webp)$/,
    EMAIL_RE: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    PHONE_RE: /^[+\d][\d\s()-]{6,19}$/,
    fileContentError: async () => null,
    fileRefused: () => false,
    ApiError,
    submit,
    post,
    api: async (...args) => { uploads.push(args); return {}; },
    shrinkImage: async () => ({ type: 'image/png' }),
    token: 'QA-r38-token',
    uploaded: new Set(),
    progress: { textContent: '' },
    heading,
    document: { title: '' },
    intro: { hidden: false },
    el: { replaceChildren() {} },
    page: (...kids) => ({ page: kids }),
    header: {},
    h: (tag, props, ...kids) => ({ tag, props, kids }),
    s: { workspace_name: 'Santos Rentals' },
    draftNote: 'Your answers are saved.',
    navigator: { onLine: true },
    guestCheckinView: () => {},
    params: {},
  };
  // The handler's own busy flag lives in the wrapper, as `busy` does in guestCheckinView.
  const handler = new Function(...Object.keys(stubs), `let busy = false; return async (e) => {${BODY}\n};`)(...Object.values(stubs));
  return {
    w,
    submit,
    requests,
    uploads,
    heading,
    formError,
    press: () => { w.activeElement = submit; return handler({ preventDefault() {} }); }, // the guest presses it, so it has focus
    settle: (ok, err) => (ok ? waiting.resolve({}) : waiting.reject(err)),
  };
}

test('while the save waits, Submit keeps focus and is aria-disabled, not disabled', async () => {
  const p = page();
  const done = p.press();
  await flush();
  assert.equal(p.requests.length, 1);
  assert.equal(p.submit.getAttribute('aria-disabled'), 'true');
  assert.notEqual(p.submit.disabled, true);
  assert.equal(p.w.activeElement, p.submit);
  assert.equal(p.submit.textContent, 'Saving…');
  p.settle(true);
  await done;
});

test('a second press while the save waits sends no second request', async () => {
  const p = page();
  const done = p.press();
  await flush();
  await p.press();
  await flush();
  assert.equal(p.requests.length, 1);
  p.settle(true);
  await done;
});

test('when the save succeeds the mark goes, the photo is sent and the thank-you replaces the form', async () => {
  const p = page();
  const done = p.press();
  await flush();
  p.settle(true);
  await done;
  assert.equal(p.submit.getAttribute('aria-disabled'), null);
  assert.equal(p.submit.disabled, false);
  assert.equal(p.uploads.length, 1);
  assert.equal(p.heading.textContent, "Thank you! You're registered.");
});

test('a refused save clears the mark, puts the label back and shows the refusal', async () => {
  const p = page();
  const done = p.press();
  await flush();
  p.settle(false, new ApiError('QA r38 refused.'));
  await done;
  assert.equal(p.submit.getAttribute('aria-disabled'), null);
  assert.equal(p.submit.disabled, false);
  assert.equal(p.submit.textContent, 'Submit registration');
  assert.ok(p.formError.kids.some((n) => n.kids?.includes('QA r38 refused.')), 'the refusal is shown in the form');
});

test('the submit handler never sets the button disabled (D-120)', () => {
  assert.doesNotMatch(BODY, /\.disabled\s*=/);
  assert.match(BODY, /setAttribute\('aria-disabled', 'true'\)/);
  assert.match(BODY, /removeAttribute\('aria-disabled'\)/);
});
