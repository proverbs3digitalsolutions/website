// QA round 1, lane F8: the clipboard fallback never uses a browser prompt() box. It opens the in-app
// dialog instead (copyText in public/js/views/quotes.js, used by the host pages). Frontend source scan only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jsRoot = path.join(__dirname, '..', 'public', 'js');
const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []
));
const read = (rel) => fs.readFileSync(path.join(jsRoot, rel), 'utf8');

test('no window.prompt or bare prompt() call is left in public/js', () => {
  // "e.prompt()" on the install event in notifications.js is a method call on the event, not a dialog, so it is not matched.
  const dialog = /\b(?:window|globalThis|self)\.prompt\b|(?<![\w$.])prompt\s*\(/;
  const hits = [];
  for (const f of jsFiles(jsRoot)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (dialog.test(line)) hits.push(`${path.relative(jsRoot, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('the clipboard fallback is the in-app dialog, and every copy site uses it', () => {
  const quotes = read('views/quotes.js');
  assert.match(quotes, /export async function copyText\(/);
  assert.match(quotes, /readonly: true/);
  assert.match(quotes, /Press Ctrl\+C \(Cmd\+C on a Mac\) to copy it\./);
  for (const f of ['views/quotes.js', 'views/checkin.js', 'views/reservations.js', 'views/listings.js', 'views/charges.js']) {
    assert.match(read(f), /\bcopyText\(/, `${f} should copy through copyText`);
  }
});
