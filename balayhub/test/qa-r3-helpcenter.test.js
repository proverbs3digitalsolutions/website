'use strict';
require('./helpers');

// QA round 3, help center (lane C16): a long-term workspace must not see guides that describe
// stay-only pages (Airbnb calendars, cleaning jobs, supplies, profit and loss, unit owners).
// Pure test: no server or database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ARTICLES, articlesFor } = require('../src/lib/helpcenter');

// Guides whose steps sit on a page in STAY_ONLY (public/js/routeaccess.js) or on the Unit owners
// page, which the long-term menu does not show. Owners and managers can't open those pages on a
// long-term workspace, so the guides must carry module 'stay'.
const STAY_GUIDES = [
  'housekeeping', 'damage-reports-resolve', 'damage-report-field', 'lost-and-found', 'work-orders',
  'supplies', 'profit-loss', 'cleaner-role', 'owner-statements', 'owner-portal', 'owner-fee-types', 'owner-payouts-reserve',
];
const bySlug = (slug) => ARTICLES.find((a) => a.slug === slug);

test('guides that describe stay-only pages are tagged stay', () => {
  for (const slug of STAY_GUIDES) {
    assert.ok(bySlug(slug), `${slug} exists`);
    assert.equal(bySlug(slug).module, 'stay', `${slug} is tagged stay`);
  }
});

test('a long-term workspace hides those guides from owners, managers and staff', () => {
  for (const role of ['owner', 'manager', 'staff']) {
    const shown = articlesFor(role, 'long_term').map((a) => a.slug);
    for (const slug of STAY_GUIDES) assert.ok(!shown.includes(slug), `${slug} hidden for ${role} on long_term`);
    assert.ok(shown.includes('rent-payments'), `the rent guides still show for ${role}`);
  }
});

test('a short-term workspace still shows those guides', () => {
  const shown = articlesFor('owner', 'short_term').map((a) => a.slug);
  for (const slug of STAY_GUIDES) assert.ok(shown.includes(slug), `${slug} shows on short_term`);
});

test('the shared What’s new guide names no stay-only guide and no Launchpad step', () => {
  const shared = bySlug('whats-new').body.join('\n');
  for (const a of ARTICLES.filter((x) => x.module === 'stay')) {
    assert.ok(!shared.includes(a.title), `the shared What’s new guide quotes a stay-only guide: ${a.title}`);
  }
  assert.ok(!/Launchpad/.test(shared), 'Launchpad is a short-term page, so the shared What’s new guide does not mention it');
});
