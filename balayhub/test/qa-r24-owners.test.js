// R24 OWNERS: BKG-3 class (c). Payout and withdrawal Void buttons get different names when rows share amount and date.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/owners.js'), 'utf8');

function load() {
  const m = src.match(/\/\/ R24 BKG-3 BEGIN\n([\s\S]*?)\/\/ R24 BKG-3 END/);
  assert.ok(m, 'helper block missing');
  const code = m[1].replace(/export /g, '');
  return new Function('peso', 'fmtDate', `${code}; return { twinName };`)((n) => `P${Number(n).toFixed(2)}`, (d) => `D${d}`);
}

test('twinName: single row keeps today\'s name, twins get (n of m), voided twins do not count', () => {
  const { twinName } = load();
  const a = { amount: '3000', paid_on: '2026-10-20' };
  const b = { amount: '3000.00', paid_on: '2026-10-20' };
  const c = { amount: '1500', paid_on: '2026-10-20' };
  const v = { amount: '3000', paid_on: '2026-10-20', voided: true };
  const rows = [a, b, c, v];
  const f = (r) => twinName('payout', rows, r, 'paid_on');
  assert.equal(f(a), 'Void payout of P3000.00 on D2026-10-20 (1 of 2)');
  assert.equal(f(b), 'Void payout of P3000.00 on D2026-10-20 (2 of 2)');
  assert.equal(f(c), 'Void payout of P1500.00 on D2026-10-20');
  assert.notEqual(f(a), f(b));
});

test('withdrawals count only active withdrawals, not top-ups', () => {
  const { twinName } = load();
  const w1 = { kind: 'withdrawal', amount: '500', entry_date: '2026-10-20' };
  const w2 = { kind: 'withdrawal', amount: '500', entry_date: '2026-10-20' };
  const dep = { kind: 'deposit', amount: '500', entry_date: '2026-10-20' };
  const rows = [w1, dep, w2];
  assert.equal(twinName('withdrawal', rows, w1, 'entry_date', (x) => x.kind === 'withdrawal'), 'Void withdrawal of P500.00 on D2026-10-20 (1 of 2)');
  assert.equal(twinName('withdrawal', rows, w2, 'entry_date', (x) => x.kind === 'withdrawal'), 'Void withdrawal of P500.00 on D2026-10-20 (2 of 2)');
  const solo = [w1, dep];
  assert.equal(twinName('withdrawal', solo, w1, 'entry_date', (x) => x.kind === 'withdrawal'), 'Void withdrawal of P500.00 on D2026-10-20');
});

test('both buttons use twinName', () => {
  assert.match(src, /'aria-label': twinName\('payout', payouts, p, 'paid_on'\)/);
  assert.match(src, /'aria-label': twinName\('withdrawal', entries, e, 'entry_date'/);
  assert.doesNotMatch(src, /aria-label': `Void (payout|withdrawal) of/);
});
