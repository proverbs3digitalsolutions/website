'use strict';
require('./helpers');

// QA round 38, LANDING (rows 27 and 28). A press that starts a request keeps focus while the request runs: the control is
// marked aria-disabled, not disabled, so a second press sends nothing and a refusal gives the control back (D-97, D-105, D-120).
// Runs tryDemo and the sign-up sheet's submit handler, both extracted from the source by brace matching, with stand-ins for the page.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'landing.js'), 'utf8');

// The source from a header to the brace that closes its body (every header here ends with the body's opening brace).
function fromHeader(head) {
  const start = SRC.indexOf(head);
  assert.ok(start >= 0, `${head} is in landing.js`);
  let depth = 0;
  for (let j = start + head.length - 1; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces after ${head}`);
}

const tryDemoSrc = fromHeader('export async function tryDemo(e) {').replace('export ', '');
const signupSrc = fromHeader('onsubmit: async (e) => {').replace('onsubmit: ', '');
// Each handler reads its module-level names from these parameters, so the source runs unchanged.
const tryDemoFn = new Function('post', 'refreshUser', 'navigate', 'homeRoute', 'toast', 't', `${tryDemoSrc}\nreturn tryDemo;`);
const signupFn = new Function('h', 't', 'tServer', 'EMAIL_RE', 'ApiError', 'read', 'showErrors', 'formError', 'data', 'submit', 'post',
  'saveSetup', 'sessionStorage', 'state', 'refreshUser', 'm', 'afterLogin', `return ${signupSrc};`);

const noop = () => {};

// The same shape as the ApiError in public/js/api.js (the browser module cannot load under node's require).
class ApiError extends Error {
  constructor(message, { status = 0, code, fields } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields || {};
  }
}

// A page with one focused element. Setting disabled on the focused control drops focus to the page, as a browser does.
function page() {
  const body = { tagName: 'BODY' };
  const p = { body, activeElement: body };
  p.button = (label) => {
    const attrs = {};
    let off = false;
    return {
      tagName: 'BUTTON',
      textContent: label,
      get disabled() { return off; },
      set disabled(v) { off = Boolean(v); if (off && p.activeElement === this) p.activeElement = body; },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; },
      focus() { if (!off) p.activeElement = this; },
    };
  };
  return p;
}

// Requests stay pending until the test answers them.
function requests() {
  const calls = [];
  const post = (path, body) => new Promise((resolve, reject) => { calls.push({ path, body, resolve, reject }); });
  return { calls, post };
}

function demoRig(req) {
  const toasts = [];
  const navs = [];
  let refreshed = 0;
  const demo = tryDemoFn(req.post, async () => { refreshed++; }, (to, opts) => navs.push([to, opts]), () => '#/home',
    (msg, kind) => toasts.push([msg, kind]), (s) => s);
  return { demo, toasts, navs, refreshed: () => refreshed };
}

// The sign-up sheet's submit handler, with the answers the form would have read into data.
function signupRig(p, req, answers) {
  const submit = p.button('Start my free trial');
  const shown = [];
  let closed = 0;
  let after = 0;
  const handler = signupFn(
    (tag, attrs, ...kids) => ({ tag, attrs, kids }),
    (s) => s,
    (s) => s,
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    ApiError,
    noop,
    (fields) => shown.push(fields),
    { replaceChildren: noop },
    answers,
    submit,
    req.post,
    noop,
    { setItem: noop },
    {},
    async () => {},
    { close: () => { closed++; } },
    () => { after++; },
  );
  return { submit, handler, shown, closed: () => closed, after: () => after };
}

const answers = (extra = {}) => ({
  first_name: 'QA', last_name: 'r38 landing', email: 'qa-r38-landing-a@example.com', password: 'QA r38 password', accept_privacy: true,
  ...extra,
});

test('Try the live demo: the pressed button keeps focus while its request runs, and a second press sends nothing', async () => {
  const p = page();
  const req = requests();
  const rig = demoRig(req);
  const btn = p.button('Try the live demo');
  p.activeElement = btn;
  const first = rig.demo({ currentTarget: btn });
  assert.equal(btn.getAttribute('aria-disabled'), 'true', 'busy while the request is pending');
  assert.notEqual(btn.disabled, true, 'not natively disabled');
  assert.equal(p.activeElement, btn, 'focus stays on the button');
  assert.equal(btn.textContent, 'Opening demo…');
  await rig.demo({ currentTarget: btn });
  assert.deepEqual(req.calls.map((c) => c.path), ['/auth/demo'], 'the second press sent no second request');
  req.calls[0].resolve({});
  await first;
  assert.equal(rig.refreshed(), 1);
  assert.deepEqual(rig.navs, [['#/home', { replace: true }]], 'a successful demo goes home');
});

test('Try the live demo: a refused demo shows the message and gives the button back', async () => {
  const p = page();
  const req = requests();
  const rig = demoRig(req);
  const btn = p.button('Try the live demo');
  p.activeElement = btn;
  const first = rig.demo({ currentTarget: btn });
  req.calls[0].reject(new ApiError('The demo is busy. Try again in a minute.', { status: 503 }));
  await first;
  assert.deepEqual(rig.toasts, [['The demo is busy. Try again in a minute.', 'error']]);
  assert.equal(btn.getAttribute('aria-disabled'), null, 'no longer busy');
  assert.notEqual(btn.disabled, true, 'not natively disabled');
  assert.equal(p.activeElement, btn, 'focus is still on the button');
  assert.equal(btn.textContent, 'Try the live demo');
});

test('Start my free trial: the pressed submit keeps focus while the sign-up runs, and a second submit sends nothing', async () => {
  const p = page();
  const req = requests();
  const rig = signupRig(p, req, answers());
  p.activeElement = rig.submit;
  const first = rig.handler({ preventDefault: noop });
  assert.equal(rig.submit.getAttribute('aria-disabled'), 'true', 'busy while the request is pending');
  assert.notEqual(rig.submit.disabled, true, 'not natively disabled');
  assert.equal(p.activeElement, rig.submit, 'focus stays on the submit button');
  assert.equal(rig.submit.textContent, 'Creating your account…');
  await rig.handler({ preventDefault: noop });
  assert.deepEqual(req.calls.map((c) => c.path), ['/auth/signup'], 'the second submit sent no second request');
  assert.equal(req.calls[0].body.email, 'qa-r38-landing-a@example.com');
  req.calls[0].resolve({ user: { id: 1 } });
  await first;
  assert.equal(rig.after(), 1, 'a successful sign-up goes on to the setup');
  assert.equal(rig.closed(), 1, 'the sheet closes');
});

test('Start my free trial: a 409 refusal shows the email message at its field and gives the button back', async () => {
  const p = page();
  const req = requests();
  const rig = signupRig(p, req, answers());
  p.activeElement = rig.submit;
  const first = rig.handler({ preventDefault: noop });
  req.calls[0].reject(new ApiError('This email is already registered.', { status: 409, code: 'EMAIL_TAKEN' }));
  await first;
  assert.deepEqual(rig.shown.at(-1), { email: 'This email is already registered. Log in or reset your password instead.' });
  assert.equal(rig.submit.getAttribute('aria-disabled'), null, 'no longer busy');
  assert.notEqual(rig.submit.disabled, true, 'not natively disabled');
  assert.equal(rig.submit.textContent, 'Start my free trial');
  assert.equal(rig.closed(), 0, 'the sheet stays open for a corrected email');
});

test('Start my free trial: a failed field check sends nothing and leaves the button ready', async () => {
  const p = page();
  const req = requests();
  const rig = signupRig(p, req, answers({ email: 'not-an-email' }));
  p.activeElement = rig.submit;
  await rig.handler({ preventDefault: noop });
  assert.equal(req.calls.length, 0, 'no request');
  assert.equal(rig.submit.getAttribute('aria-disabled'), null, 'the checks run before the button is marked busy');
  assert.notEqual(rig.submit.disabled, true);
  assert.equal(rig.submit.textContent, 'Start my free trial');
  assert.ok(rig.shown.at(-1).email, 'the email field carries its message');
});

test('the two handlers never set native disabled on their own button', () => {
  assert.doesNotMatch(tryDemoSrc, /\.disabled = /, 'tryDemo uses aria-disabled');
  assert.doesNotMatch(signupSrc, /\.disabled = /, 'the sign-up submit uses aria-disabled');
});
