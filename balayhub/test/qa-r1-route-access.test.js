'use strict';

// Route guard matrix (QA round 1: #28, #29, #75, #84). Pure logic, no database.

const test = require('node:test');
const assert = require('node:assert/strict');

// public/js is browser ESM inside a CommonJS package, so load the source as a module from a data: URL.
const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/js/routeaccess.js'), 'utf8');
const load = () => import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const u = (role, business_type, extra = {}) => ({ role, business_type, ...extra });

test('long-term workspaces cannot open stay pages', async () => {
  const { routeAllowed } = await load();
  for (const p of ['/home', '/calendar', '/reservations', '/reservations/5', '/listings', '/guests/3', '/pricing', '/pnl']) {
    assert.equal(routeAllowed(p, u('owner', 'long_term')), false, p);
  }
  for (const p of ['/dashboard', '/properties', '/tenants', '/rent', '/reports', '/maintenance', '/settings', '/account', '/help']) {
    assert.equal(routeAllowed(p, u('owner', 'long_term')), true, p);
  }
});

test('short-term workspaces cannot open the long-term dashboard but keep /rent', async () => {
  const { routeAllowed } = await load();
  assert.equal(routeAllowed('/dashboard', u('owner', 'short_term')), false);
  assert.equal(routeAllowed('/rent', u('owner', 'short_term')), true);
  assert.equal(routeAllowed('/home', u('owner', 'short_term')), true);
});

test('combined workspaces see everything the role allows', async () => {
  const { routeAllowed } = await load();
  for (const p of ['/dashboard', '/home', '/pnl', '/owners', '/launchpad']) assert.equal(routeAllowed(p, u('owner', 'both')), true, p);
});

test('staff are blocked from owner and manager pages but keep pricing', async () => {
  const { routeAllowed } = await load();
  for (const p of ['/quotes', '/quotes/2', '/pnl', '/stay-reports', '/lost-found', '/inbox', '/owners', '/daily-close']) {
    assert.equal(routeAllowed(p, u('staff', 'both')), false, p);
  }
  for (const p of ['/pricing', '/reservations', '/calendar', '/housekeeping', '/rent', '/dashboard', '/reviews']) {
    assert.equal(routeAllowed(p, u('staff', 'both')), true, p);
  }
});

test('managers cannot open owner-only pages; admin needs platform admin', async () => {
  const { routeAllowed } = await load();
  assert.equal(routeAllowed('/owners', u('manager', 'both')), false);
  assert.equal(routeAllowed('/quotes', u('manager', 'both')), true);
  assert.equal(routeAllowed('/admin', u('owner', 'both')), false);
  assert.equal(routeAllowed('/admin/support/4', u('owner', 'both', { is_platform_admin: true })), true);
});
