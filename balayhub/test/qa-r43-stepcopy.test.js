'use strict';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');
const { searchArticles } = require('../src/lib/helpcenter');

// QA round 43, lane STEPCOPY (ONB43-1, D-125): the Launchpad's first-listing step and the "Add a listing" help article
// name what the Add listing form asks for on a first listing: the building with its street address, city and province.
const LAUNCHPAD_HOW = 'Enter the listing name (for example Tower 1 - 1201) and the nightly rate, then choose the building, or add it with its street address, city and province (guests see only the city and province).';
const HELP_HOW = 'Choose the building. An owner can add a new one right there with "+ Add a new building / property": its name, street address, city and province (guests see only the city and province); a manager asks the owner to add it. Then enter the listing name (e.g. Tower 1 - 1201), type, base nightly rate and cleaning fee.';

let srv; let owner;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'stepcopy-owner@example.com', 'QA r43 stepcopy');
});
test.after(async () => { await srv.close(); });

test('the Launchpad first-listing step names the listing name, the rate, and the building with its street address, city and province', async () => {
  const res = await owner.get('/api/onboarding');
  assert.equal(res.status, 200);
  const step = res.data.steps.find((x) => x.key === 'listings');
  assert.ok(step, 'the listings step is served');
  assert.equal(step.how[1], LAUNCHPAD_HOW);
  for (const word of ['street address', 'city', 'province']) assert.match(step.how[1], new RegExp(word), `names ${word}`);
  assert.ok(!step.how[1].includes('the cleaning fee and the building'), 'the old wording is gone');
});

test('the Add a listing help article says an owner adds a new building with its street address, city and province', () => {
  const hit = searchArticles('how do I add a listing', 'owner')[0];
  assert.equal(hit.slug, 'add-listing', 'the question still finds the article first');
  assert.equal(hit.body[1], HELP_HOW);
  assert.ok(!hit.body.join(' ').includes('If it is not listed, an owner adds it first'), 'the old sentence is gone');
});
