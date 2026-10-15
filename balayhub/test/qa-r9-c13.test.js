'use strict';

// QA round 9, lane C13 (shell-nav): the menu in groups (#35, #51),
// the router's blank-segment rule (K6) and the trial banner (K17). Frontend-only: no database.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const fnSrc = (name) => {
  const start = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let k = src.indexOf('{', src.indexOf(')', start)); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(start, k + 1).replace(/^export /, '');
  }
  throw new Error(`${name} has no closing brace`);
};

// restoreTabFocus (focus for a rebuilt tablist) was replaced by the single focus guard (QA r13 F01): see qa-r13-f01.test.js and qa-r10-c01.test.js (h).

// ---- menu groups
const navSrc = src.slice(src.indexOf('const NAV_SHORT'), src.indexOf('// Trial / read-only'));
const build = new Function('state', `${navSrc.replace(/export /g, '')}; return { navFor, navGroups };`);
const users = [];
for (const business_type of ['short_term', 'both', 'long_term'])
  for (const role of ['owner', 'manager', 'staff']) users.push({ role, business_type, is_platform_admin: role === 'owner' });
users.push({ role: 'owner', business_type: 'short_term', is_platform_admin: false }, { role: 'cleaner', business_type: 'short_term' });

test('every menu entry is in exactly one group, none dropped, for every role and workspace type', () => {
  for (const user of users) {
    const { navFor, navGroups } = build({ user });
    const all = navFor(user).map((n) => n[0]);
    const grouped = navGroups(user).flatMap((g) => g.items.map((n) => n[0]));
    assert.deepEqual([...grouped].sort(), [...all].sort(), `${user.role}/${user.business_type}`);
    assert.equal(new Set(grouped).size, grouped.length, 'no entry twice');
  }
});

test('short-term owner gets the four groups; long-term and cleaner stay flat', () => {
  const { navGroups } = build({ user: null });
  const owner = navGroups({ role: 'owner', business_type: 'short_term' });
  assert.deepEqual(owner.map((g) => g.title), ['Every day', 'Money', 'More tools', 'Setup']);
  assert.ok(owner[0].items.some((n) => n[0] === '/home') && owner[2].items.some((n) => n[0] === '/daily-close'));
  for (const u of [{ role: 'owner', business_type: 'long_term' }, { role: 'cleaner' }]) {
    const g = navGroups(u);
    assert.equal(g.length, 1); assert.equal(g[0].title, null);
  }
  const sheet = navGroups({ role: 'owner', business_type: 'short_term' }, [['/maintenance', 'Maintenance', 'wrench'], ['/new-thing', 'New', 'file']]);
  assert.deepEqual(sheet.map((g) => g.id), ['more'], 'an unlisted path lands in More tools');
});

test('sidebar and More sheet render the groups', () => {
  assert.match(src, /class: 'nav__group nav__group--more'/);
  assert.match(src, /class: 'nav__group-title'/);
  assert.match(src, /'h2', \{ class: 'nav__group-title' \}/);
  assert.match(src, /'h2', \{ class: 'morenav__group-title' \}/);
  assert.match(src, /h\('nav', \{ 'aria-label': 'Main' \}, navGroups\(u, NAV\)/);
});

// ---- router
class ApiError extends Error { constructor(m, { status = 0 } = {}) { super(m); this.status = status; } }
const mk = (routes) => new Function('routes', 'ApiError', `${fnSrc('match')}\nreturn match;`)(routes, ApiError);

test('only a blank last segment is an incomplete link; a blank middle one is no route', async () => {
  const view = async () => 'ok';
  const match = mk([['/owners/:id/statement', view, 'app'], ['/payments/:id', view, 'app'], ['/pay/:token', view, 'open']]);
  assert.equal(match('/owners/%20/statement'), null);
  assert.equal(match('/owners/abc/statement').view, view);
  const last = match('/payments/%20');
  await assert.rejects(() => last.view({}, {}), (e) => e.status === 404 && /incomplete/.test(e.message));
  assert.equal(match('/pay/%20').params.token, '-');
});

// ---- trial banner
test('the trial reminder shows at 3 days left and not at 4', () => {
  const banner = (days) => {
    const state = { user: { role: 'owner', plan: { plan: 'trial', trial_days_left: days } } };
    const h = (...a) => a;
    const planBanner = new Function('state', 'h', 'post', 'forgetSetupAnswers', 'navigate', 'toast', 'refreshUser', 'render', `${fnSrc('planBanner')}; return planBanner;`)(state, h);
    return planBanner();
  };
  assert.ok(banner(3));
  assert.equal(banner(4), null);
});
