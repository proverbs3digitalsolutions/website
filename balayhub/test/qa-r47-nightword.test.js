'use strict';
require('./helpers');
// QA round 47, NIGHTWORD (D-129, copy rule C4): a count of one reads "1 night", never "1 nights". Two places: Profit and loss's
// Gross line (public/js/views/pnl.js) and the emailed owner statement (statementText in src/lib/statements.js). No database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { statementText } = require('../src/lib/statements');

// pnl.js is a browser module with imports, so pull the Gross stat's sub-line template out of the source and run it.
const pnlSrc = fs.readFileSync(path.join(__dirname, '../public/js/views/pnl.js'), 'utf8');
const grossSub = new Function('t', `return ${pnlSrc.match(/stat\('Gross', peso\(t\.gross\), (`[^`]*`)\)/)[1]};`);

test('Profit and loss Gross line: one night reads "1 night", more nights read "nights"', () => {
  assert.equal(grossSub({ stays: 1, nights: 1 }), '1 stay · 1 night');
  assert.equal(grossSub({ stays: 2, nights: 3 }), '2 stays · 3 nights');
  assert.equal(grossSub({ stays: 0, nights: 0 }), '0 stays · 0 nights');
});

test('Profit and loss Gross line is the view\'s own line', () => {
  assert.match(pnlSrc, /stat\('Gross', peso\(t\.gross\), `\$\{t\.stays\} stay\$\{t\.stays === 1 \? '' : 's'\} · \$\{t\.nights\} night\$\{t\.nights === 1 \? '' : 's'\}`\),/);
});

// A published snapshot with the fields statementText reads.
const snapshot = (nights) => ({
  owner: { full_name: 'Ana Cruz', cleaning_to_manager: false },
  workspace: 'Test Workspace',
  units: [{ unit_name: '1201' }],
  totals: { stays: 1, nights, occupancy_pct: '3.3', gross: '2500.00', channel_fees: '0.00', cleaning_fees: '0.00', net_rental: '2500.00', management_fee: '0.00', expenses: '0.00', payout: '2500.00' },
  refunded: '0.00',
  fee_label: 'Management fee',
  reserve: { topup: '0' },
  stays: [],
  expenses: [],
});

test('emailed statement: one night reads "1 night", more nights read "nights"', () => {
  assert.match(statementText(snapshot(1), 'October 2026'), /^Stays checked out this month: 1 \(1 night, 3\.3% occupancy\)$/m);
  assert.match(statementText(snapshot(2), 'October 2026'), /^Stays checked out this month: 1 \(2 nights, 3\.3% occupancy\)$/m);
  assert.doesNotMatch(statementText(snapshot(1), 'October 2026'), /1 nights/);
});
