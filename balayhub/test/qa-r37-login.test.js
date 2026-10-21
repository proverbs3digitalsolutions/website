'use strict';
require('./helpers');

// QA round 37, LOGIN (LOG-L). A read-only workspace (scheduled for deletion, trial ended, payment overdue) can't save Launchpad
// steps, so afterLogin sends its owner to the home page, not the Launchpad (D-117, D-119). Runs afterLogin extracted from the source.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');

function extractFn(head) {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `${head} is in app.js`);
  let i = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced braces');
}
const afterLoginSrc = extractFn('export async function afterLogin()').replace('export ', '');
const homeRouteSrc = src.match(/export const homeRoute = .*;/)[0].replace('export ', '');

async function run(user, onboarding = { complete: false, dismissed: false }) {
  const calls = { get: [], nav: [] };
  const fn = new Function('state', 'get', 'navigate', 'setupRedirect', 'sessionStorage',
    `${homeRouteSrc}\n${afterLoginSrc}\nreturn afterLogin;`)(
    { user },
    async (p) => { calls.get.push(p); return onboarding; },
    (to) => { calls.nav.push(to); },
    () => null,
    { getItem: () => null, removeItem() {} });
  await fn();
  return calls;
}

const owner = (extra) => ({ role: 'owner', business_type: 'short_term', ...extra });

test('a workspace scheduled for deletion lands on home and never asks for the Launchpad', async () => {
  const c = await run(owner({ plan: { read_only: true, reason: 'deleting' } }));
  assert.deepEqual(c.nav, ['#/home']);
  assert.ok(!c.get.includes('/onboarding'));
});

test('a trial that ended lands on home', async () => {
  const c = await run(owner({ plan: { read_only: true, reason: 'trial_ended' } }));
  assert.deepEqual(c.nav, ['#/home']);
});

test('a writable workspace with an unfinished Launchpad still lands on the Launchpad', async () => {
  const c = await run(owner({ plan: { read_only: false } }));
  assert.deepEqual(c.nav, ['#/launchpad']);
});

test('a read-only long-term owner lands on the dashboard', async () => {
  const c = await run({ role: 'owner', business_type: 'long_term', plan: { read_only: true, reason: 'deleting' } });
  assert.deepEqual(c.nav, ['#/dashboard']);
});

test('a due card check still lands on Confirm your card', async () => {
  const c = await run(owner({ plan: { card_check_due: true, read_only: true, reason: 'card_check' } }));
  assert.deepEqual(c.nav, ['#/confirm-card']);
});
