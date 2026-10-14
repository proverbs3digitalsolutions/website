'use strict';

// QA round 9, C06 (guest pages: pay and book). Frontend only, so these are source checks on the two views (no database).
// #8: an add-on's row box reads "Select" and is named "Select <add-on>"; the button reads "Add selected to my bill".
// #9: once both dates are picked, the booking card shows this stay's average night with no "from"; before that, unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pay = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
const book = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');

// The add-on rows of the pay page, from their builder up to the button that adds them.
const addonRows = () => pay.slice(pay.indexOf('const rows = list.map'), pay.indexOf('const btn = ', pay.indexOf('const rows = list.map')));
// The pay page's own Taglish dictionary (its extendTranslations block).
const payDict = () => pay.slice(pay.indexOf('extendTranslations({'), pay.indexOf('});', pay.indexOf('extendTranslations({')));

// The quote refresh: updateQuote() from its start up to the cancellation policy block that follows it.
const quoteFn = () => book.slice(book.indexOf('async function updateQuote() {'), book.indexOf('// The cancellation policy'));
// The branch that runs when a date is missing, and the success branch that follows the quote request.
const noDatesBranch = () => { const body = quoteFn(); return body.slice(body.indexOf('if (!checkIn || !checkOut) {'), body.indexOf('// A count below 1')); };
const quoteSuccess = () => { const body = quoteFn(); return body.slice(body.indexOf('current = q;'), body.indexOf('} catch (err) {')); };
// The price-line helper, from its definition to the line that first draws it.
const showPriceFn = () => book.slice(book.indexOf('const showPrice = '), book.indexOf('showPrice(null);', book.indexOf('const showPrice = ')) + 'showPrice(null);'.length);

test('#8: the add-on row box reads "Select" and is named for its add-on', () => {
  const rows = addonRows();
  assert.ok(rows.includes("'aria-label': t('Select {name}', { name })"), 'the row box is named "Select <add-on>"');
  assert.ok(rows.includes("h('span', null, t('Select'))"), 'the row box text reads "Select"');
  assert.ok(!rows.includes("t('Add to my bill')"), 'the row box no longer says "Add to my bill"');
});

test('#8: the button reads "Add selected to my bill", before and after it is pressed', () => {
  assert.ok(pay.includes("type: 'button' }, t('Add selected to my bill'));"), 'the button label');
  assert.ok(pay.includes("btn.textContent = t('Add selected to my bill');"), 'the label put back after a failed add');
  assert.ok(!pay.includes("t('Add to my bill')"), 'no "Add to my bill" left on the page');
});

test('#8: the pay page has Taglish entries for the new wording', () => {
  const dict = payDict();
  assert.match(dict, /'Select': 'Piliin',/);
  assert.match(dict, /'Select \{name\}': 'Piliin ang \{name\}',/);
  assert.match(dict, /'Add selected to my bill': 'Idagdag ang napili sa bill ko',/);
});

test('#9: the booking card keeps one price box, and the aside draws that box', () => {
  assert.match(book, /const priceBox = h\('div', \{ class: 'bk-book__price' \}\);/);
  assert.match(book, /h\('aside', \{ class: 'card bk-book' \}, priceBox,/);
  assert.ok(!book.includes("h('div', { class: 'bk-book__price' }, fromPrice"), 'the old inline price line is gone');
});

test('#9: "from" and the lowest open night are shown only before both dates are picked', () => {
  const helper = showPriceFn();
  assert.ok(helper.includes('avgNight === null'), 'the helper switches on whether an average is passed');
  assert.ok(helper.includes("t('from ')"), 'the "from" wording lives in the helper');
  assert.ok(helper.includes("peso(avgNight ?? fromPrice)"), 'the helper shows the average when given, else the lowest open night');
  assert.equal(book.match(/t\('from '\)/g).length, 1, '"from" appears once on the page');
  assert.ok(noDatesBranch().includes('showPrice(null);'), 'a missing date puts the lowest open night back');
});

test('#9: a priced stay shows its average night: the summary nights total over the nights', () => {
  const ok = quoteSuccess();
  assert.ok(ok.includes('const stayTotal = q.discount_label || q.promo_code ? q.subtotal : q.accommodation_total;'), 'same figure as the first summary line');
  assert.ok(ok.includes('showPrice(Number(stayTotal) / q.nights);'), 'the average night is drawn after the quote arrives');
  assert.ok(!ok.includes('showPrice(null)'), 'a priced stay never falls back to "from"');
});

test('#9: the price box and its helper are set up before the card is drawn', () => {
  assert.ok(book.indexOf('const priceBox') < book.indexOf('const showPrice = '), 'the box exists before the helper uses it');
  assert.ok(book.indexOf('const showPrice = ') < book.indexOf('h(\'aside\', { class: \'card bk-book\' }, priceBox,'), 'the helper is defined before the aside');
});
