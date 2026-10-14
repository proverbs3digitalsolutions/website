// QA round 8, lane C34: CSS fixes in public/css/app.css.
// #39 the second owner card in a grid sits 16px lower; #10 the pending-proofs heading sits tight under
// its text; #27 a field shows its hint and its error at once (the refund cap said twice).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
const pay = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'pay.js'), 'utf8');

// The declarations of a rule whose selector is exactly `sel` (escaped, so `>` `+` `.` are literal).
const blocksFor = (sel) => {
  const re = new RegExp(`(?:^|[\\s},])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]);
};

test('#39 a card that follows another card inside a .grid takes no top margin (covers every grid variant)', () => {
  const rule = blocksFor('.grid > .card + .card');
  assert.ok(rule.length > 0, '.grid > .card + .card rule exists');
  assert.ok(rule.some((b) => /margin-top:\s*0\b/.test(b)), 'margin-top is 0');
  // The owner cards use `grid grid--2`, so the selector must reach that element (class grid).
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'owners.js'), 'utf8'), /class: 'grid grid--2'/);
});

test('#39 the 16px card rule still applies outside grids (no regression to stacked cards)', () => {
  assert.ok(blocksFor('.card + .card, .stack > * + *').some((b) => /margin-top:\s*16px/.test(b)));
});

test('#10 the pending-proofs heading has a top margin, matching the guest card headings', () => {
  assert.match(pay, /class: 'gc__pending'/, 'pay.js still renders .gc__pending');
  const rule = blocksFor('.gc__pending h3');
  assert.ok(rule.length > 0, '.gc__pending h3 rule exists');
  const m = rule.join('\n').match(/margin-top:\s*(\d+)px/);
  assert.ok(m && Number(m[1]) > 0, 'margin-top is a positive px value');
  assert.ok(blocksFor('.gc .form h2').some((b) => /margin-top:\s*6px/.test(b)), 'same 6px as the guest card heading');
});

test('inbox composer mode buttons (aria-pressed in a .tabs group) look selected like the other tabs', () => {
  // The inbox switch is a .tabs group of toggle buttons with aria-pressed (inbox.js), not role=tab.
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8'),
    /class: 'tabs tabs--compact'[\s\S]*?'aria-pressed': String\(k === mode\)/);
  // The selected-state rule for .tabs must also cover aria-pressed="true", with the same forest fill.
  assert.match(css, /\.tabs \[aria-current="true"\], \.tabs \[aria-selected="true"\], \.tabs \[aria-pressed="true"\] \{ background: var\(--forest\);/);
});

test('#27 a field hides its hint while its error stands, so the problem is said once', () => {
  // The hint must be a direct child of the .field wrapper that showErrors() marks field--invalid.
  assert.match(ui, /h\('div', \{ class: 'field', dataset: \{ field: f\.name \} \},[\s\S]*?f\.hint && h\('div', \{ class: 'hint' \}, f\.hint\)/);
  assert.match(ui, /wrap\.classList\.add\('field--invalid'\)/);
  const rule = blocksFor('.field--invalid > .hint');
  assert.ok(rule.length > 0, '.field--invalid > .hint rule exists');
  assert.ok(rule.some((b) => /display:\s*none/.test(b)), 'the hint is hidden');
});
