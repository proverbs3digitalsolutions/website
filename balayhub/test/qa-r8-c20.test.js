'use strict';

// QA round 8, lane C20 (router-titles). Frontend-only: no database.
// - #5/K16: a blank last segment (#/pay/, #/book/x/done/, #/help/tickets/) no longer falls to the marketing home.
// - #52/K4: a title a guest page set itself is kept; pages titled from the heading are marked and re-titled after a language switch.
// - #49 (part): log out and the trial-end button delete the saved Get started answers (bh-setup).
// app.js imports every view, so it is read as text; match() is run from its own source with stub routes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const appJs = read('public', 'js', 'app.js');
const i18nJs = read('public', 'js', 'i18n.js');

const matchSrc = (() => {
  const start = appJs.indexOf('function match(path) {');
  assert.ok(start > 0, 'app.js has match()');
  let depth = 0;
  for (let k = appJs.indexOf('{', start); k < appJs.length; k++) {
    if (appJs[k] === '{') depth++;
    else if (appJs[k] === '}' && --depth === 0) return appJs.slice(start, k + 1);
  }
  throw new Error('match() has no closing brace');
})();
class ApiError extends Error {
  constructor(message, { status = 0 } = {}) { super(message); this.status = status; }
}
const guest = async () => 'guest';
const app = async () => 'app';
const routes = [
  ['/pay/:token', guest, 'open'], ['/book/:slug', guest, 'open'], ['/book/:slug/done/:token', guest, 'open'], ['/book/:slug/:unitId', guest, 'open'],
  ['/help', app, 'app'], ['/help/tickets/:id', app, 'app'], ['/dashboard', app, 'app'],
];
const match = new Function('routes', 'ApiError', `${matchSrc}\nreturn match;`)(routes, ApiError);

test('a guest route with a blank last segment runs its view with a token that cannot exist (#5)', () => {
  for (const p of ['/pay/', '/book/x/done/']) {
    const r = match(p);
    assert.ok(r, `${p} matches`);
    assert.equal(r.access, 'open');
    assert.equal(r.view, guest, `${p} runs the guest view`);
    assert.ok(Object.values(r.params).every((v) => v.trim()), 'no blank param reaches the view');
  }
  assert.equal(match('/pay/').params.token, '-');
  assert.equal(match('/book/x/done/').params.slug, 'x');
});

test('an app route with a blank last segment gets the incomplete state, never the home page (#5, K16)', async () => {
  const r = match('/help/tickets/');
  assert.ok(r, '/help/tickets/ matches');
  assert.equal(r.access, 'app');
  assert.notEqual(r.view, app);
  await assert.rejects(() => r.view({}, {}), (err) => err.status === 404 && /incomplete/.test(err.message));
});

test('real paths and unknown paths behave as before', () => {
  assert.equal(match('/pay/abc').params.token, 'abc');
  assert.equal(match('/pay/abc').view, guest);
  assert.equal(match('/dashboard/'), null, 'a literal route with a trailing slash is still unknown');
  assert.equal(match('/nope/'), null);
  assert.equal(match('/'), null);
});

test('app.js keeps a title the view set, and marks pages it titled from the heading (#52, K4)', () => {
  assert.match(appJs, /import \{ h1Title \} from '\.\/i18n\.js';/);
  assert.match(appJs, /document\.title = RESET_TITLE;/);
  assert.match(appJs, /title && document\.title === RESET_TITLE\)/, 'the h1 title is applied only while the title is still the reset value');
  assert.match(appJs, /dataset\.h1title = '1'/);
  assert.match(appJs, /delete document\.documentElement\.dataset\.h1title/);
});

test('a language switch re-takes the title from the heading only on marked pages (#52)', () => {
  assert.match(i18nJs, /if \(!document\.documentElement\.dataset\.h1title\) return;/);
  assert.match(i18nJs, /Promise\.resolve\(onChange\(\)\)\.then\(retitle/);
  assert.match(i18nJs, /'Book direct':/);
  assert.match(i18nJs, /"This place isn't taking online bookings right now\.":/);
  assert.match(i18nJs, /'Enter the number of guests to see the total\.':/);
});

test('log out and the trial-end button delete the saved Get started answers (#49)', () => {
  assert.match(appJs, /function forgetSetupAnswers\(\) \{ try \{ localStorage\.removeItem\('bh-setup'\)/);
  const logout = appJs.slice(appJs.indexOf('export async function logout()'));
  assert.ok(logout.slice(0, logout.indexOf('\n}\n')).includes('forgetSetupAnswers();'), 'logout() forgets them');
  assert.match(appJs, /forgetSetupAnswers\(\); navigate\('#\/signup'/, 'the trial-end button forgets them');
});
