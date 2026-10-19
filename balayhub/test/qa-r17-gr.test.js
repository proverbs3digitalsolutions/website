'use strict';
// QA round 17, lane GR (groups view). Frontend only. Runs on a temp copy of groups.js with stub imports (the real one needs the app shell).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const src = fs.readFileSync(path.join(SRC, 'views', 'groups.js'), 'utf8');

let dir; let g; let ApiError;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-groups-r17-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(SRC, 'api.js'), path.join(dir, 'api.js'));
  const stub = (names) => names.map((n) => `export const ${n} = () => {};`).join('\n');
  fs.writeFileSync(path.join(dir, 'ui.js'), stub(['h', 'icon', 'peso', 'fmtDate', 'field', 'formModal', 'openModal', 'makeForm', 'confirmDialog', 'emptyState', 'toast', 'todayManila']));
  fs.writeFileSync(path.join(dir, 'filters.js'), stub(['initFilters', 'filterBar', 'changed']));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export const navigate = () => {};\n');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), stub(['addDays', 'boxValue', 'guestsProblem']));
  fs.writeFileSync(path.join(dir, 'views', 'groups.js'), src);
  g = await import(pathToFileURL(path.join(dir, 'views', 'groups.js')));
  ({ ApiError } = await import(pathToFileURL(path.join(dir, 'api.js'))));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const row = (uid) => ({ fieldKey: (n) => ({ num_guests: `num_guests-${uid}`, unit_id: `unit_id-${uid}` })[n] ?? null });

test('mapRoomError moves a room error onto the failing row', () => {
  const err = new ApiError('x', { status: 400, fields: { num_guests: 'This listing allows up to 4 guests.' }, data: { room_index: 1 } });
  const out = g.mapRoomError(err, [row('a'), row('b')]);
  assert.deepEqual(out.fields, { 'num_guests-b': 'This listing allows up to 4 guests.' });
  assert.equal(out.message, 'Please check the highlighted fields.');
});

test('mapRoomError keeps a key with no box, and passes other errors on unchanged', () => {
  const err = new ApiError('x', { status: 400, fields: { notes: 'Bad.' }, data: { room_index: 0 } });
  assert.deepEqual(g.mapRoomError(err, [row('a')]).fields, { notes: 'Bad.' });
  const plain = new ApiError('x', { status: 400, fields: { num_guests: 'm' } });
  assert.equal(g.mapRoomError(plain, [row('a')]), plain);
  const e409 = new ApiError('x', { status: 409 });
  assert.equal(g.mapRoomError(e409, [row('a')]), e409);
});

test('cancel copy says "The 1 room" for one room and "All N rooms" otherwise', () => {
  assert.match(src, /active\.length === 1 \? 'The 1 room' : `All \$\{active\.length\} rooms`\} will be cancelled/);
  assert.doesNotMatch(src, /All \$\{active\.length\} room\$\{/);
});

test('a flagged lead guest gets the Heads up toast', () => {
  assert.match(src, /if \(res\.guest_do_not_rebook\) toast\(`Heads up: \$\{res\.guest_name \|\| 'this guest'\} is marked "Do not rebook" in Guests\.`, 'error'\)/);
});
