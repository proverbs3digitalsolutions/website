'use strict';
// QA round 7, lane C16 (deposits view, frontend only, no database).
// #28: a deduction above the deposit is one the server refuses (src/routes/deposits.js, settle). The return preview under the
//      deduction box used to clamp it and show "Return to guest: ₱0.00". Now it shows no return figure, and the field under the box says the limit (QA round 14, K1).
// returnLine(typedText, deposit) is pure. The view's own peso and parseAmount are loaded from ui.js the way the other
// frontend tests do, so the figures are formatted exactly as the page shows them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const depSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/deposits.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/ui.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src/routes/deposits.js'), 'utf8');

// The views import browser modules, so pull the pure pieces out of the source and evaluate them.
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const line = (src, re) => {
  const m = src.match(re);
  assert.ok(m, `ui.js line not found: ${re}`);
  return m[0];
};

// peso: the same Intl formatter ui.js uses.
const peso = new Function(`${line(uiSrc, /const pesoFmt = [^\n]*\n/)}${line(uiSrc, /export const peso = [^\n]*\n/).replace('export ', '')}\nreturn peso;`)();
// parseAmount: the same money reader ui.js uses (its two patterns sit above it in that file).
const parseAmount = new Function(`${['MONEY_RE', 'MONEY_COMMA_RE'].map((n) => line(uiSrc, new RegExp(`const ${n} = [^\\n]*;\\n`))).join('')}${grab(uiSrc, 'parseAmount')}\nreturn parseAmount;`)();
const returnLine = new Function('peso', 'parseAmount', `${grab(depSrc, 'returnLine')}\nreturn returnLine;`)(peso, parseAmount);

const dep = { amount: '1000.00' };

test('#28 a deduction above the deposit shows no return figure, and no copy of the limit sentence (the field says it, K1)', () => {
  const out = returnLine('1500', dep);
  assert.equal(out, '', 'the field under the box already says the limit');
  assert.doesNotMatch(out, /Return to guest/, 'no return figure for a deduction the server refuses');
  assert.ok(!out.includes('₱0.00'), 'never ₱0.00');
});

test('#28 the limit sentence is the one the server sends (src/routes/deposits.js)', () => {
  assert.ok(serverSrc.includes("`The deduction can't be more than the deposit (${peso(d.amount)}).`"), 'server wording changed; keep the preview in step');
});

test('#28 a deduction within the deposit shows what goes back to the guest', () => {
  assert.equal(returnLine('400', dep), 'Return to guest: ₱600.00');
  assert.equal(returnLine('1000', dep), 'Return to guest: ₱0.00', 'a deduction equal to the deposit is allowed by the server');
});

test('#28 a blank deduction box returns the whole deposit', () => {
  assert.equal(returnLine('', dep), 'Return to guest: ₱1,000.00');
  assert.equal(returnLine('   ', dep), 'Return to guest: ₱1,000.00');
});

test('#28 an amount that cannot be read shows no figure and no limit sentence', () => {
  assert.equal(returnLine('abc', dep), '');
  assert.equal(returnLine('1,5', dep), '', '"1,5" is refused everywhere (D-79), so it is not 15');
});

test('#28 a negative deduction shows nothing', () => {
  assert.equal(returnLine('-5', dep), '');
});

test('#28 the deduction box update calls returnLine and no longer clamps the typed amount', () => {
  assert.match(depSrc, /refundLine\.textContent = returnLine\(dedInput\.querySelector\('input'\)\.value, dep\);/);
  assert.doesNotMatch(depSrc, /Math\.min\(typed/, 'the old clamp hid the refused figure');
});
