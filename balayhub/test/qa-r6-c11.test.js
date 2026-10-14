'use strict';

// Amount filters in the shared filter bar (public/js/filters.js), loaded from a temp copy as ES modules with a small
// stand-in for the DOM. Frontend-only: no database, no server.
// Bug #15: an amount range from 5000 to 1000 showed "No results found" with no reason. It now says so, and is off.
// Bug #14: "Amount due at least" took -5 or an 11-digit number, which the server ignores, while its chip still showed.
// It now flags the value at the field, applies nothing and shows no chip.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RANGE_MSG = 'The highest amount is below the lowest. This amount filter is off until you fix it.';
const AMOUNT_MSG = 'Enter an amount of 0 or more (up to 10 digits).';
const SAVED_KEY = 'bh-filters:1:rent-payments';
const RANGE_DEFAULTS = { min_amount: '', max_amount: '' };

// Just enough DOM for h(), ui.js and filters.js: elements, text, attributes, listeners.
class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
class Element extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '' });
  }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, type }); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = { createElement: (tag) => new Element(tag), createTextNode: (data) => new Text(data) };

const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));
const walk = (node, pred, out = []) => {
  if (node instanceof Element) {
    if (pred(node)) out.push(node);
    node.children.forEach((c) => walk(c, pred, out));
  }
  return out;
};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

let dir; let filters;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c11-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); });

// The shapes rent.js passes: payments and expenses share one amount range; the rent roll has a single "at least" box.
const AMOUNT_RANGE = { name: 'amount', label: 'Amount (₱)', type: 'amountrange', keys: ['min_amount', 'max_amount'] };
const AMOUNT_DUE = { name: 'min_amount', label: 'Amount due at least (₱)', type: 'number', min: 0, step: '0.01', pattern: /^\d{1,10}(\.\d{1,2})?$/, patternText: AMOUNT_MSG };
const NIGHTS = { name: 'min_nights', label: 'Nights (at least)', type: 'number', min: 1 };

// Builds a filter bar with the given fields under "More filters" and returns handles to its parts.
function build(values, more, defaults = RANGE_DEFAULTS) {
  const calls = { n: 0 };
  const bar = filters.filterBar({ key: 'rent-payments', values, defaults, more, onChange: () => { calls.n += 1; } });
  return {
    bar,
    calls,
    values,
    from: walk(bar, (el) => el.tagName === 'input' && el.getAttribute('aria-label') === 'Amount (₱), from')[0],
    to: walk(bar, (el) => el.tagName === 'input' && el.getAttribute('aria-label') === 'Amount (₱), to')[0],
    number: walk(bar, (el) => el.tagName === 'input' && el.getAttribute('type') === 'number')[0],
    alert: () => walk(bar, (el) => el.getAttribute('role') === 'alert')[0],
    panel: () => walk(bar, (el) => el.className.split(' ').includes('flt__panel'))[0],
    chips: () => walk(bar, (el) => el.className === 'flt__chip').map((el) => el.getAttribute('aria-label')),
    chipButton: (label) => walk(bar, (el) => el.className === 'flt__chip' && el.getAttribute('aria-label') === label)[0],
    button: (label) => walk(bar, (el) => el.tagName === 'button' && textOf(el) === label)[0],
  };
}

// ---------------------------------------------------------------- the rule itself
test('amountRangeCheck: a backwards range applies nothing and says so', () => {
  const r = filters.amountRangeCheck('5000', '1000');
  assert.equal(r.message, RANGE_MSG);
  assert.equal(r.lo, '');
  assert.equal(r.hi, '');
  assert.deepEqual(r.flags, { lo: true, hi: true });
});

test('amountRangeCheck: amounts compare as numbers, so 9 to 10 is fine and 10 to 9 is backwards', () => {
  assert.equal(filters.amountRangeCheck('9', '10').message, '');
  assert.equal(filters.amountRangeCheck('10', '9').message, RANGE_MSG);
  assert.equal(filters.amountRangeCheck('1000', '1000').message, '', 'the same amount at both ends is a valid range');
});

test('amountRangeCheck: an amount the server would ignore is flagged on its own side, and the other side still applies', () => {
  assert.deepEqual(filters.amountRangeCheck('-5', '1000'), { message: AMOUNT_MSG, lo: '', hi: '1000', flags: { lo: true, hi: false } });
  assert.deepEqual(filters.amountRangeCheck('', '99999999999'), { message: AMOUNT_MSG, lo: '', hi: '', flags: { lo: false, hi: true } });
  assert.equal(filters.amountRangeCheck('1.505', '').message, AMOUNT_MSG, 'three decimals are not an amount');
});

test('amountRangeCheck: readable amounts (0, two decimals, ten digits) are applied as typed', () => {
  assert.deepEqual(filters.amountRangeCheck('0', ''), { message: '', lo: '0', hi: '', flags: { lo: false, hi: false } });
  assert.equal(filters.amountRangeCheck('', '9999999999').hi, '9999999999');
  assert.equal(filters.amountRangeCheck('1500.50', '').lo, '1500.50');
  assert.deepEqual(filters.amountRangeCheck('', ''), { message: '', lo: '', hi: '', flags: { lo: false, hi: false } });
});

// ---------------------------------------------------------------- amount range in the bar (payments, expenses)
test('a backwards amount range typed into the bar is flagged inline and not applied', () => {
  const values = { min_amount: '', max_amount: '' };
  const b = build(values, [AMOUNT_RANGE]);
  b.from.value = '5000'; b.from.dispatch('change');
  assert.equal(b.calls.n, 1, 'a lower amount on its own is applied');
  assert.equal(values.min_amount, '5000');
  b.to.value = '1000'; b.to.dispatch('change');
  assert.equal(b.calls.n, 2, 'the list reloads without the backwards range');
  assert.equal(values.min_amount, '', 'the amount that was applied is dropped too');
  assert.equal(values.max_amount, '');
  assert.equal(JSON.parse(store.get(SAVED_KEY)).min_amount, '', 'nothing from the backwards range is remembered');
  assert.equal(b.alert().hidden, false);
  assert.equal(textOf(b.alert()), RANGE_MSG);
  assert.equal(b.from.getAttribute('aria-invalid'), 'true');
  assert.equal(b.to.getAttribute('aria-invalid'), 'true');
  assert.equal(b.to.getAttribute('aria-describedby'), b.alert().getAttribute('id'), 'the message is tied to the amount inputs');
  assert.deepEqual(b.chips(), [], 'no chip for a range that is off');
});

test('correcting the pair clears the message and applies the range as one chip', () => {
  const values = { min_amount: '', max_amount: '' };
  const b = build(values, [AMOUNT_RANGE]);
  b.from.value = '5000'; b.from.dispatch('change');
  b.to.value = '1000'; b.to.dispatch('change');
  b.from.value = '500'; b.from.dispatch('change');
  assert.equal(values.min_amount, '500');
  assert.equal(values.max_amount, '1000');
  assert.equal(b.alert().hidden, true);
  assert.equal(b.from.getAttribute('aria-invalid'), null);
  assert.equal(b.to.getAttribute('aria-invalid'), null);
  assert.deepEqual(b.chips(), ['Remove filter Amount (₱): 500 – 1000']);
});

test('an amount the server would ignore is flagged at its own field, and the other side still applies', () => {
  const values = { min_amount: '', max_amount: '' };
  const b = build(values, [AMOUNT_RANGE]);
  b.from.value = '-5'; b.from.dispatch('change');
  assert.equal(values.min_amount, '');
  assert.equal(b.calls.n, 1);
  assert.equal(textOf(b.alert()), AMOUNT_MSG);
  assert.equal(b.from.getAttribute('aria-invalid'), 'true');
  assert.equal(b.to.getAttribute('aria-invalid'), null, 'only the bad side is marked');
  b.to.value = '1000'; b.to.dispatch('change');
  assert.equal(values.max_amount, '1000', 'a valid amount on the other side is applied');
  assert.equal(values.min_amount, '');
  assert.equal(textOf(b.alert()), AMOUNT_MSG, 'the message stays while the from amount is still wrong');
  assert.deepEqual(b.chips(), ['Remove filter Amount (₱): … – 1000']);
});

test('a backwards amount range from a shared link is not applied, and is flagged when the bar opens', () => {
  const values = { min_amount: '5000', max_amount: '1000' };
  const b = build(values, [AMOUNT_RANGE]);
  assert.equal(values.min_amount, '', 'the list is not filtered by the backwards range');
  assert.equal(values.max_amount, '');
  assert.equal(b.from.value, '5000', 'the typed amounts stay visible so they can be fixed');
  assert.equal(b.to.value, '1000');
  assert.equal(textOf(b.alert()), RANGE_MSG);
  assert.equal(b.panel().hidden, false, 'the panel opens so the message can be seen');
  assert.deepEqual(b.chips(), []);
  assert.equal(b.calls.n, 0);
});

test('an applied amount range has one chip, and removing it clears both amounts', () => {
  const values = { min_amount: '500', max_amount: '9000' };
  const b = build(values, [AMOUNT_RANGE]);
  assert.deepEqual(b.chips(), ['Remove filter Amount (₱): 500 – 9000']);
  b.chipButton('Remove filter Amount (₱): 500 – 9000').dispatch('click');
  assert.equal(values.min_amount, '');
  assert.equal(values.max_amount, '');
  assert.equal(b.from.value, '', 'the inputs are cleared too');
  assert.equal(b.to.value, '');
  assert.deepEqual(b.chips(), []);
  assert.equal(b.calls.n, 1);
});

test('Reset filters clears a flagged amount and its message', () => {
  const values = { min_amount: '', max_amount: '' };
  const b = build(values, [AMOUNT_RANGE]);
  b.from.value = '-5'; b.from.dispatch('change');
  assert.equal(b.alert().hidden, false);
  b.button('Reset filters').dispatch('click');
  assert.equal(b.alert().hidden, true);
  assert.equal(b.from.value, '');
  assert.equal(b.from.getAttribute('aria-invalid'), null);
});

// ---------------------------------------------------------------- number filter with a pattern (rent roll)
test('a number filter with a pattern flags a value the server would ignore and applies nothing', () => {
  const values = { min_amount: '' };
  const b = build(values, [AMOUNT_DUE], { min_amount: '' });
  b.number.value = '-5'; b.number.dispatch('change');
  assert.equal(values.min_amount, '', 'not applied');
  assert.equal(b.calls.n, 1);
  assert.equal(textOf(b.alert()), AMOUNT_MSG);
  assert.equal(b.alert().hidden, false);
  assert.equal(b.number.getAttribute('aria-invalid'), 'true');
  assert.deepEqual(b.chips(), [], 'no chip');
  b.number.value = '99999999999'; b.number.dispatch('change');
  assert.equal(values.min_amount, '');
  assert.equal(textOf(b.alert()), AMOUNT_MSG);
  b.number.value = '1500.5'; b.number.dispatch('change');
  assert.equal(values.min_amount, '1500.5');
  assert.equal(b.alert().hidden, true);
  assert.equal(b.number.getAttribute('aria-invalid'), null);
  assert.deepEqual(b.chips(), ['Remove filter Amount due at least (₱): 1500.5']);
  b.number.value = ''; b.number.dispatch('change');
  assert.equal(values.min_amount, '', 'an empty box is no filter, not an error');
  assert.equal(b.alert().hidden, true);
  assert.deepEqual(b.chips(), []);
});

test('a bad number amount in a shared link is not applied, shows what was typed, and is flagged when the panel opens', () => {
  const values = { min_amount: '-5' };
  const b = build(values, [AMOUNT_DUE], { min_amount: '' });
  assert.equal(values.min_amount, '');
  assert.equal(b.number.value, '-5');
  assert.equal(textOf(b.alert()), AMOUNT_MSG);
  assert.equal(b.panel().hidden, false);
  assert.deepEqual(b.chips(), []);
  assert.equal(b.calls.n, 0);
});

test('a number filter without a pattern is unchanged: the value it holds is applied', () => {
  const values = { min_nights: '' };
  const b = build(values, [NIGHTS], { min_nights: '' });
  b.number.value = '-5'; b.number.dispatch('change');
  assert.equal(values.min_nights, '-5');
  assert.equal(b.calls.n, 1);
  assert.deepEqual(b.chips(), ['Remove filter Nights (at least): -5']);
});

// ---------------------------------------------------------------- the screen and the rule it shares with the server
test('rent.js: payments and expenses use one amount range, and the rent roll "at least" box has the pattern', () => {
  const rent = fs.readFileSync(path.join(__dirname, '../public/js/views/rent.js'), 'utf8');
  assert.doesNotMatch(rent, /Amount from \(₱\)|Amount up to \(₱\)/, 'the two separate amount boxes are gone');
  assert.equal((rent.match(/\bamountRange,/g) || []).length, 2, 'payments and expenses both list the range');
  assert.match(rent, /type: 'amountrange', keys: \['min_amount', 'max_amount'\]/);
  assert.match(rent, /label: 'Amount due at least \(₱\)', type: 'number', min: 0, step: '0\.01', pattern: AMOUNT_PATTERN, patternText: 'Enter an amount of 0 or more \(up to 10 digits\)\.'/);
  // qa-r5-c15 loads rent.js with a stub filters.js that exports only these four names, so rent.js must not import more.
  assert.match(rent, /import \{ initFilters, filterBar, rememberFilters, changed \} from '\.\.\/filters\.js';/);
});

test('the amount rule is the server rule: money.js, filters.js and rent.js use the same pattern', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const ruleOf = (src) => src.match(/const AMOUNT_(?:RE|PATTERN) = (\/.+\/);/)[1];
  const serverRule = ruleOf(read('src/routes/money.js'));
  assert.equal(serverRule, '/^\\d{1,10}(\\.\\d{1,2})?$/');
  assert.equal(ruleOf(read('public/js/filters.js')), serverRule);
  assert.equal(ruleOf(read('public/js/views/rent.js')), serverRule);
});
