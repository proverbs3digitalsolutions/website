'use strict';

// QA r27 MAINTENANCE (OPS-1): Add cost asks "Check the amount" above 50,000 like Add expense. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/maintenance.js'), 'utf8');
const RENT = fs.readFileSync(path.join(__dirname, '../public/js/views/rent.js'), 'utf8');
const start = SRC.indexOf('const addCost = ');
const addCostText = SRC.slice(start, SRC.indexOf('const upload = ', start));
const onSubmitText = addCostText.slice(addCostText.indexOf('onSubmit: ') + 'onSubmit: '.length, addCostText.lastIndexOf('});')).trim().replace(/,$/, '');

test('source: maintenance.js imports the one expense rule from rent.js and parseAmount from ui.js', () => {
  assert.match(SRC, /import \{ expenseNeedsAsk \} from '\.\/rent\.js';/);
  assert.match(SRC, /parseAmount/);
  assert.doesNotMatch(RENT, /maintenance\.js/, 'no import cycle');
});

test('source: addCost asks before the post and "Change it" returns false', () => {
  assert.match(onSubmitText, /expenseNeedsAsk\(data\.amount\)/);
  assert.match(onSubmitText, /title: 'Check the amount'/);
  assert.match(onSubmitText, /confirmText: 'Save anyway', cancelText: 'Change it'/);
  assert.match(onSubmitText, /form\.elements\.amount\.focus\(\); return false;/);
  assert.ok(onSubmitText.indexOf('expenseNeedsAsk') < onSubmitText.indexOf('post('));
});

// Run the real onSubmit against stand-ins.
async function run(amount, answer) {
  const seen = { posts: 0, asked: null, focused: 0, toasts: [], rerenders: 0 };
  const parseAmount = (t) => Number(String(t).replace(/,/g, ''));
  const expenseNeedsAsk = (a) => parseAmount(a) > 50000;
  const confirmDialog = async (o) => { seen.asked = o; return answer; };
  const post = async () => { seen.posts += 1; };
  const toast = (t) => seen.toasts.push(t);
  const rerender = () => { seen.rerenders += 1; };
  const peso = (n) => `₱${n}`;
  const m = { request_id: 'r1' };
  const fn = new Function('expenseNeedsAsk', 'confirmDialog', 'post', 'toast', 'rerender', 'peso', 'parseAmount', 'm', `return (${onSubmitText});`)(expenseNeedsAsk, confirmDialog, post, toast, rerender, peso, parseAmount, m);
  const form = { elements: { amount: { focus: () => { seen.focused += 1; } } } };
  seen.result = await fn({ amount }, { idempotencyKey: 'k', form });
  return seen;
}

test('60000 + "Change it": no post, focus in the amount box, dialog stays (false)', async () => {
  const s = await run('60000', false);
  assert.equal(s.posts, 0); assert.equal(s.focused, 1); assert.equal(s.result, false);
  assert.equal(s.asked.title, 'Check the amount');
  assert.match(s.asked.text, /This expense is .*60000.*Save anyway\?/);
});

test('60000 + "Save anyway": one post and the toast', async () => {
  const s = await run('60000', true);
  assert.equal(s.posts, 1); assert.deepEqual(s.toasts, ['Cost recorded.']);
});

test('50000: no question, one post', async () => {
  const s = await run('50000', false);
  assert.equal(s.asked, null); assert.equal(s.posts, 1);
});
