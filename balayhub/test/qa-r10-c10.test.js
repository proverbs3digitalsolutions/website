'use strict';

// QA round 10, lane C10 (longterm-help): three long-term fixes.
// #14 the rent payment's Print receipt printed the app screen; it now prints an acknowledgement block
//     (class print-only, shown only in print by C14's CSS) and the screen cards are hidden with no-print.
// #15 a long-term owner saw the short-term reports guide; that guide is tagged stay, a monthly-rent
//     reports guide replaces it for long-term, and the cleaning category gets a monthly-rent name.
// #17 the Rent roll caption read like an instruction; it now describes the number.
// Pure helpers and a source scan only: the views import the app shell, which does not load in Node.
// node --test --test-concurrency=1 test/qa-r10-c10.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ARTICLES, CATEGORIES, articlesFor } = require('../src/lib/helpcenter');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', ...p), 'utf8');
const bySlug = (slug) => ARTICLES.find((a) => a.slug === slug);
const slugsFor = (role, type) => articlesFor(role, type).map((a) => a.slug);

test('#15: the short-term reports guide is tagged stay, so a long-term workspace no longer sees it', () => {
  assert.equal(bySlug('reports').module, 'stay');
  for (const role of ['owner', 'manager']) {
    assert.ok(!slugsFor(role, 'long_term').includes('reports'), `reports hidden for ${role} on long_term`);
    assert.ok(slugsFor(role, 'short_term').includes('reports'), `reports still shows for ${role} on short_term`);
  }
});

test('#15: a monthly-rent reports guide shows to a long-term workspace and not to a short-term one', () => {
  const guide = bySlug('rent-reports');
  assert.ok(guide, 'rent-reports exists');
  assert.equal(guide.module, 'rent');
  for (const role of ['owner', 'manager']) {
    assert.ok(slugsFor(role, 'long_term').includes('rent-reports'), `rent-reports shows for ${role} on long_term`);
    assert.ok(!slugsFor(role, 'short_term').includes('rent-reports'), `rent-reports hidden for ${role} on short_term`);
  }
});

test('#15: the monthly-rent reports guide names the long-term Reports page parts, not the short-term ones', () => {
  const text = bySlug('rent-reports').body.join('\n');
  for (const name of ['Export (Excel / CSV)', 'By property', 'Outstanding balances']) {
    assert.ok(text.includes(name), `the guide names ${name}`);
  }
  assert.ok(!/RevPAR|nightly rate|channel/i.test(text), 'no short-term figure in the monthly-rent guide');
});

test('#15: the cleaning category is titled for monthly rentals too', () => {
  const name = new Map(CATEGORIES).get('operations');
  assert.equal(name, 'Cleaning, upkeep & deposits');
});

test('#17: the Rent roll caption describes the number', () => {
  const src = read('properties.js');
  assert.ok(src.includes("'Monthly rent from current leases'"), 'the new caption is in the property detail (round 11: lease rent)');
  assert.ok(!src.includes('list rent of occupied units'), 'the instruction-style caption is gone');
});

const rentSrc = read('rent.js');
const detail = rentSrc.slice(rentSrc.indexOf('export async function paymentDetailView'), rentSrc.indexOf('export async function expenseDetailView'));

test('#14: the payment detail page has a print-only acknowledgement block with the workspace name and the BIR wording', () => {
  const at = detail.indexOf("class: 'card print-only'");
  assert.ok(at > -1, 'a print-only block exists');
  const block = detail.slice(at);
  assert.match(block, /Acknowledgement receipt \(not a BIR official receipt\)/);
  assert.match(block, /state\.user\.organization_name/);
  for (const field of ['p.tenant_name', 'p.amount_paid', 'p.payment_date', 'p.payment_method', 'p.reference_number', 'p.recorded_by_name']) {
    assert.ok(block.includes(field), `the acknowledgement shows ${field}`);
  }
});

test('#14: the payment details card is hidden when printing, and the page header is too', () => {
  const at = detail.indexOf("'Payment details'");
  assert.ok(at > -1, 'the payment details card exists');
  assert.match(detail.slice(Math.max(0, at - 200), at), /class: 'card no-print'/);
  assert.match(detail, /head\.classList\.add\('no-print'\)/, 'the page header carries no-print');
});
