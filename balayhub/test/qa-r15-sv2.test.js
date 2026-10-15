'use strict';

// QA round 15, lane SV2 (money server). A percentage fee with too many decimals gets the percent sentence,
// not the peso example (bug #21). A season whose name differs only in inner spaces is a duplicate (bug #22).

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../src/lib/validate');
const { startServer, ownerAccount, sql } = require('./helpers');

const FEE_SENTENCE = 'Management fee (%) can have up to two decimals (e.g. 20 or 12.5).';
const SAVED_BEFORE = 'You already saved this season.';
let srv; let owner; let orgId;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'sv2-money@example.com', 'SV2 Money');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'SV2 Money'`))[0].organization_id;
});
test.after(async () => { await srv.close(); });

const percent = { fee: { type: 'percent', label: 'Management fee (%)' } };

test('a percent field takes up to two decimals and refuses more with the percent example', () => {
  assert.deepEqual(validate({ fee: '20' }, percent), { fee: '20.00' });
  assert.deepEqual(validate({ fee: '12.5' }, percent), { fee: '12.50' });
  for (const bad of ['20.555', 'abc', '1,5']) {
    assert.throws(() => validate({ fee: bad }, percent), (err) => err.extra.fields.fee === FEE_SENTENCE, bad);
  }
});

test('an owner fee with three decimals is refused with the percent sentence, on add and on edit', async () => {
  const bad = await owner.post('/api/unit-owners', { full_name: 'Fee Check', management_fee_pct: '20.555' });
  assert.equal(bad.status, 400, JSON.stringify(bad.data));
  assert.equal(bad.data.fields.management_fee_pct, FEE_SENTENCE);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM unit_owners WHERE full_name = 'Fee Check'`))[0].n, 0);

  const ok = await owner.post('/api/unit-owners', { full_name: 'Fee Check', management_fee_pct: '12.5' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const edit = await owner.patch(`/api/unit-owners/${ok.data.owner_id}`, { management_fee_pct: '20.555' });
  assert.equal(edit.status, 400, JSON.stringify(edit.data));
  assert.equal(edit.data.fields.management_fee_pct, FEE_SENTENCE);
});

test('a season whose name differs only in inner spaces or a tab is a duplicate, and nothing is saved twice', async () => {
  const body = { name: 'QA Dup', start_date: '2031-03-01', end_date: '2031-03-05', nightly_rate: '2500' };
  const first = await owner.post('/api/pricing/seasons', body);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  for (const name of ['qa  dup ', 'QA   Dup', 'qa\tdup']) {
    const again = await owner.post('/api/pricing/seasons', { ...body, name });
    assert.equal(again.status, 409, `${JSON.stringify(name)} ${JSON.stringify(again.data)}`);
    assert.equal(again.data.code, 'DUPLICATE');
    assert.equal(again.data.error, SAVED_BEFORE);
  }
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM seasons WHERE organization_id = $1', [orgId]))[0].n, 1);

  const other = await owner.post('/api/pricing/seasons', { ...body, name: 'QA Dup Two' });
  assert.equal(other.status, 201, JSON.stringify(other.data));
});
