'use strict';

// Route guard, QA round 2 (rbac#3, longterm#1). Pure logic, no database.

const test = require('node:test');
const assert = require('node:assert/strict');

const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/js/routeaccess.js'), 'utf8');
const load = () => import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const u = (role, business_type) => ({ role, business_type });

test('staff may open groups and supplies (BACKEND-SCHEMA 6.1, D-70)', async () => {
  const { routeAllowed } = await load();
  for (const p of ['/groups', '/groups/x', '/supplies']) assert.equal(routeAllowed(p, u('staff', 'short_term')), true, p);
  for (const p of ['/cleaner-pay', '/lost-found']) assert.equal(routeAllowed(p, u('staff', 'short_term')), false, p);
});

test('long-term-only workspaces are refused housekeeping, except for cleaners', async () => {
  const { routeAllowed } = await load();
  for (const p of ['/housekeeping', '/housekeeping/x']) {
    assert.equal(routeAllowed(p, u('owner', 'long_term')), false, p);
    assert.equal(routeAllowed(p, u('owner', 'both')), true, p);
    assert.equal(routeAllowed(p, u('cleaner', 'long_term')), true, p);
  }
});

test('staff menu lists Supplies and Group bookings', () => {
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(app, /STAFF_OPS_NAV = OPS_NAV\.filter/);
  assert.doesNotMatch(app, /\['\/quotes', '\/addons', '\/groups'/);
});
