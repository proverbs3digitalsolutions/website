'use strict';
require('./helpers');

// QA round 45 (D-127, RULELABEL): the Days box on a pricing rule is named by a label, not a sentence with a blank. The old
// labels "Stay starts within (days)" and "Gap is up to (nights)" read like an unfilled template, and the shared form copies the
// label into every message ("Stay starts more than (days) away is required."). The labels are names now, and the Days box says
// "Days" in its messages (msgLabel, which ui.js labelOf reads first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/pricing.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');

// pricing.js imports browser modules, so lift the RULE_KINDS object literal out of the source and evaluate it.
const kindsText = src.match(/^const RULE_KINDS = (\{[\s\S]*?\n\});/m);
const RULE_KINDS = kindsText ? new Function(`return ${kindsText[1]}`)() : null;

test('each rule kind has a days label that names the box, with no bracket to fill in', () => {
  assert.ok(RULE_KINDS, 'found the RULE_KINDS literal');
  assert.equal(RULE_KINDS.last_minute.daysLabel, 'Stay starts within this many days');
  assert.equal(RULE_KINDS.far_out.daysLabel, 'Stay starts more than this many days away');
  assert.equal(RULE_KINDS.gap_night.daysLabel, 'Gap is up to this many nights');
  for (const k of Object.values(RULE_KINDS)) assert.ok(!k.daysLabel.includes('('), `no bracket in "${k.daysLabel}"`);
});

test('the Days box carries msgLabel "Days", so its messages say Days and not the label sentence', () => {
  const line = src.split('\n').find((l) => l.includes('const daysField = field('));
  assert.ok(line, 'found the Days box');
  assert.match(line, /label: 'Days', msgLabel: 'Days', type: 'number'/);
});

test('the shared form words the Days messages from msgLabel, using the same labelOf expression as ui.js', () => {
  const labelLine = uiSrc.match(/^\s*const labelOf = \(el\) => .*;$/m);
  assert.ok(labelLine, 'found labelOf in ui.js');
  // A stand-in form whose Days label is the Far-out sentence: labelOf must not use it when the box has msgLabel.
  const form = { querySelector: () => ({ firstChild: { textContent: RULE_KINDS.far_out.daysLabel } }) };
  const labelOf = new Function('form', 'CSS', `${labelLine[0].trim()} return labelOf;`)(form, { escape: (x) => x });
  const box = { id: 'f-days-r45', dataset: { msgLabel: 'Days' } };
  assert.equal(`${labelOf(box)} is required.`, 'Days is required.');
  assert.equal(`${labelOf(box)} must be a whole number.`, 'Days must be a whole number.');
});
