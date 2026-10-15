'use strict';

// Route guard, QA round 15 (RA): cleaners are refused GET /api/supplies, so #/supplies must not open for them. Pure logic, no database.

const test = require('node:test');
const assert = require('node:assert/strict');

const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/js/routeaccess.js'), 'utf8');
const load = () => import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const u = (role, business_type) => ({ role, business_type });

test('cleaners cannot open /supplies, whatever the workspace type', async () => {
  const { routeAllowed } = await load();
  for (const type of ['short_term', 'long_term', 'both']) {
    for (const p of ['/supplies', '/supplies/x']) assert.equal(routeAllowed(p, u('cleaner', type)), false, `${type} ${p}`);
    assert.equal(routeAllowed('/housekeeping', u('cleaner', type)), true, `${type} housekeeping`);
    assert.equal(routeAllowed('/my-pay', u('cleaner', type)), true, `${type} my-pay`);
  }
});

test('owners, managers and staff still open /supplies', async () => {
  const { routeAllowed } = await load();
  for (const role of ['owner', 'manager', 'staff']) assert.equal(routeAllowed('/supplies', u(role, 'short_term')), true, role);
});
