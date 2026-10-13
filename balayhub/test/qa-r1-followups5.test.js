// QA round 1, lane F5 (keyboard-and-dates): clickable rows open on Enter and Space, the calendar
// sync message keeps the server's sentence, and the admin trial date is the Manila day.
// Frontend-only: a source scan of the views this lane owns, plus a pure check of the admin trial date helper; no database needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', f), 'utf8');
const IMPORTS_MANILA_DAY = /import \{[^}]*\bmanilaDay\b[^}]*\} from '\.\.\/ui\.js';/;

test('keyboard: a clickable row opens on Enter and on Space, and Space does not scroll the page', () => {
  for (const f of ['reservations.js', 'help.js', 'groups.js']) {
    const rows = read(f).split('\n').filter((line) => line.includes("class: 'row-link', tabindex: 0"));
    assert.ok(rows.length > 0, `${f} has no keyboard row to check`);
    for (const line of rows) {
      const shown = line.trim().slice(0, 100);
      assert.match(line, /e\.key === 'Enter'/, `${f} row does not open on Enter: ${shown}`);
      assert.match(line, /e\.key === ' '/, `${f} row does not open on Space: ${shown}`);
      assert.match(line, /preventDefault\(\)/, `${f} row lets Space scroll the page: ${shown}`);
    }
  }
});

test('calendar sync: a failing calendar names the unit and the channel, then the server sentence as it is', () => {
  const src = read('home.js');
  // With a channel: "Unit (Channel): sentence". Without one: "Unit: sentence" (no "(undefined)").
  assert.match(src, /failing: \(p\) => \(p\.channel \? `\$\{p\.unit_name\} \(\$\{label\(p\.channel\)\}\): \$\{p\.message\}` : `\$\{p\.unit_name\}: \$\{p\.message\}`\),/);
  assert.doesNotMatch(src, /\(\$\{p\.message\}\)/, 'the message is still wrapped in brackets with extra copy');
});

test('admin: the trial end date is the last Manila day from the shared manilaDay in ui.js, not a UTC slice', () => {
  const src = read('admin.js');
  assert.match(src, IMPORTS_MANILA_DAY);
  assert.match(src, /name: 'trial_ends_at'.*value: trialDay/);
  assert.match(src, /const trialDay = trialLastDay\(w\.trial_ends_at\);/);
  assert.doesNotMatch(src, /new Date\(w\.trial_ends_at\)\.toISOString\(\)/);
});

test('admin: trial_ends_at is sent only when the admin changed the date, so an unchanged save moves nothing', () => {
  const src = read('admin.js');
  assert.match(src, /\.\.\.\(d\.trial_ends_at && d\.trial_ends_at !== trialDay \? \{ trial_ends_at: d\.trial_ends_at \} : \{\}\),/);
});

test('admin: trialLastDay gives the day the admin entered, one millisecond before the stored end', async () => {
  // admin.js imports app.js and filters.js, which only drive the page; stub them in a temp copy.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-admin-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {};\n');
  fs.writeFileSync(path.join(dir, 'filters.js'), 'export const initFilters = () => ({}); export const filterBar = () => null; export const changed = () => ({});\n');
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'admin.js'), path.join(dir, 'views', 'admin.js'));
  globalThis.Element = class { };
  const admin = await import(pathToFileURL(path.join(dir, 'views', 'admin.js')));

  // Stored "2026-10-21 00:00 Manila" is 2026-10-20T16:00:00Z, and the admin entered 2026-10-20.
  assert.equal(admin.trialLastDay('2026-10-20T16:00:00.000Z'), '2026-10-20');
  // The server stores (entered day + 1) at 00:00 Manila; reading that back gives the entered day, month and year edges included.
  for (const day of ['2026-02-28', '2026-10-20', '2026-12-31']) {
    const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    assert.equal(admin.trialLastDay(`${next}T00:00:00+08:00`), day, `stored end for ${day}`);
  }
  assert.equal(admin.trialLastDay(null), '');
});
