'use strict';

// QA round 12, lane C10 (housekeeping and supplies). K19: the owner's own finished clean reads "Done by you, no pay"
// on the task page, because the task says whether the viewer finished it (`done_by_viewer`, for every role);
// `completed_by` is still never sent. #34: a count in pcs reads "1 pc" at one. #35: a finished or cancelled clean has
// no "Copy for cleaner", and the copied text gives the due date. #36: a supply row keeps Add stock and Record use,
// and the rest sit under "More for <supply>". K4b: a job's supply quantity below 1 says "Enter a quantity of at least 1.".
// Runs on its own database: TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_04 node --test --test-concurrency=1 test/qa-r12-c10.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const hk = read('public/js/views/housekeeping.js');
const sup = read('public/js/views/supplies.js');
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};

let srv; let owner; let prop; let unit; let cleaner; let staff; let dir; let qtyLabel; let unitWord;

// A team member who signed up through a real invitation.
async function teamMember(role, email, name) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
  assert.ok(inv.data.inviteLink, JSON.stringify(inv.data));
  const c = client(srv.base);
  ok(await c.post('/api/auth/signup', {
    full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  }), 201);
  const [{ user_id: id }] = await sql('SELECT user_id FROM users WHERE email = $1', [email]);
  return { c, id };
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r12-c10@example.com', 'R12 C10 Co');
  prop = ok(await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' }), 201).property;
  unit = ok(await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' }), 201).unit;
  cleaner = await teamMember('cleaner', 'cleaner-r12-c10@example.com', 'Nene Cleaner');
  staff = await teamMember('staff', 'staff-r12-c10@example.com', 'Sam Staff');
  // The pure helpers come from a copy of public/js, with a stub for the app's state (as qa-r8-c31 does).
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r12-c10-'));
  fs.cpSync(path.join(ROOT, 'public/js'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\n");
  globalThis.Element = class { };
  ({ qtyLabel, unitWord } = await import(pathToFileURL(path.join(dir, 'views/supplies.js')).href));
});
test.after(async () => { fs.rmSync(dir, { recursive: true, force: true }); await srv.close(); });

const task = (body) => owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), ...body });
const readTask = async (c, id) => ok(await c.get(`/api/cleaning-tasks/${id}`)).task;
const finish = async (c, id) => ok(await c.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' }));
// True when any object key in the response is `key`, at any depth.
const hasKey = (v, key) => (v && typeof v === 'object') && (Object.keys(v).includes(key) || Object.values(v).some((x) => hasKey(x, key)));

// ---------------------------------------------------------------- K19: whose clean it was

test('K19: the task says whether the viewer finished it, for every role, and never sends completed_by', async () => {
  const mine = ok(await task({}), 201).task;
  await finish(owner, mine.task_id);
  const own = await readTask(owner, mine.task_id);
  assert.equal(own.done_by_viewer, true, 'the owner finished it');
  assert.equal(hasKey(own, 'completed_by'), false, 'the internal id is never sent');

  const theirs = ok(await task({ assigned_to: cleaner.id }), 201).task;
  await finish(owner, theirs.task_id);
  assert.equal((await readTask(owner, theirs.task_id)).done_by_viewer, true, 'the owner finished this one too');
  assert.equal((await readTask(cleaner.c, theirs.task_id)).done_by_viewer, false, 'the cleaner did not finish a clean the owner finished');

  const cleans = ok(await task({ assigned_to: cleaner.id }), 201).task;
  await finish(cleaner.c, cleans.task_id);
  const seen = await readTask(cleaner.c, cleans.task_id);
  assert.equal(seen.done_by_viewer, true, 'the cleaner finished it');
  assert.equal(hasKey(seen, 'completed_by'), false);
  assert.equal((await readTask(owner, cleans.task_id)).done_by_viewer, false, 'the owner did not finish the cleaner\'s clean');
  const staffSees = await readTask(staff.c, cleans.task_id);
  assert.equal(staffSees.done_by_viewer, false, 'staff did not finish it');
  const [{ user_id: ownerId }] = await sql('SELECT user_id FROM users WHERE email = $1', ['owner-r12-c10@example.com']);
  assert.equal(JSON.stringify(staffSees).includes(ownerId), false, 'no other member\'s id reaches staff');
});

test('K19: the task list carries the same flag on every row, and no row sends completed_by', async () => {
  const ownersClean = ok(await task({}), 201).task;
  await finish(owner, ownersClean.task_id);
  const cleanersClean = ok(await task({ assigned_to: cleaner.id }), 201).task;
  await finish(cleaner.c, cleanersClean.task_id);
  const { tasks } = ok(await owner.get('/api/cleaning-tasks?view=done'));
  assert.ok(tasks.length >= 2, 'both finished cleans are listed');
  for (const t of tasks) {
    assert.equal(typeof t.done_by_viewer, 'boolean', t.task_id);
    assert.equal(hasKey(t, 'completed_by'), false, t.task_id);
  }
  const listed = (rows, id) => rows.find((t) => t.task_id === id);
  assert.equal(listed(tasks, ownersClean.task_id).done_by_viewer, true);
  assert.equal(listed(tasks, cleanersClean.task_id).done_by_viewer, false);
  const { tasks: cleanerRows } = ok(await cleaner.c.get('/api/cleaning-tasks?view=done'));
  assert.equal(listed(cleanerRows, cleanersClean.task_id).done_by_viewer, true, 'the cleaner sees their own finished clean as theirs');
  for (const t of cleanerRows) assert.equal(hasKey(t, 'completed_by'), false, t.task_id);
});

test('K19: payText reads the viewer\'s own flag, and only the owner gets the self wording', () => {
  const grab = (name) => hk.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
  const { payText } = new Function(`${grab('payText')}\nreturn { payText };`)();
  const owner = { role: 'owner', user_id: 'u-owner' };
  const own = { status: 'done', done_by_viewer: true, pay_amount: null };
  assert.equal(payText(own, owner), 'Done by you, no pay');
  assert.equal(payText({ ...own, done_by_viewer: false }, owner), 'Pay not set. Use Set pay.', 'someone else\'s clean is still unpriced');
  assert.equal(payText({ ...own, status: 'in_progress' }, owner), 'Pay not set. Use Set pay.', 'an unfinished clean is still unpriced');
  assert.equal(payText(own, { role: 'manager', user_id: 'u-owner' }), 'Pay not set. Use Set pay.', 'only the owner gets the self wording');
  assert.match(hk, /const own = viewer\?\.role === 'owner' && t\.status === 'done' && t\.done_by_viewer;/);
});

// ---------------------------------------------------------------- K4b: the job's quantity floor

test('K4b: a job quantity below 1 says "Enter a quantity of at least 1.", for a cleaner and for the owner, and nothing is used', async () => {
  const soap = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Soap', unit_label: 'bars', par_level: 1, on_hand: 5 }), 201).supply;
  const job = ok(await task({ assigned_to: cleaner.id }), 201).task;
  for (const c of [cleaner.c, owner]) {
    const r = await c.post(`/api/cleaning-tasks/${job.task_id}/supplies`, { items: [{ supply_id: soap.supply_id, kind: 'used', quantity: 0 }] });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.fields.quantity, 'Enter a quantity of at least 1.');
  }
  const [{ on_hand: left }] = await sql('SELECT on_hand FROM supplies WHERE supply_id = $1', [soap.supply_id]);
  assert.equal(Number(left), 5, 'a refused job line changes nothing');
});

// ---------------------------------------------------------------- #34: pcs

test('#34: a count in pcs reads "1 pc" at one; other counts and units are unchanged', () => {
  assert.equal(qtyLabel(1, 'pcs'), '1 pc');
  assert.equal(qtyLabel(1, 'Pcs'), '1 pc', 'a capital letter reads the same');
  assert.equal(qtyLabel(5, 'pcs'), '5 pcs');
  assert.equal(qtyLabel(0, 'pcs'), '0 pcs');
  assert.equal(unitWord(1, 'pcs'), 'pc');
  assert.equal(qtyLabel(1, 'rolls'), '1 roll');
  assert.equal(qtyLabel(2, 'rolls'), '2 rolls');
});

// ---------------------------------------------------------------- #35: Copy for cleaner

test('#35: "Copy for cleaner" is offered only on an open clean, and the copied text gives the due date', () => {
  assert.match(hk, /isManager && open && h\('button', \{ class: 'btn btn--secondary', onclick: \(\) => copyText\(taskText\(t\)\) \}, 'Copy for cleaner'\)/);
  assert.match(hk, /`When: \$\{fmtDate\(t\.due_date\)\}`/);
  assert.doesNotMatch(hk, /`When: \$\{dueText\(t\)\}`/);
});

// ---------------------------------------------------------------- #36: the supply row

test('#36: a supply row keeps Add stock and Record use, and Count, History, Edit and Archive sit under "More for <supply>"', () => {
  const start = sup.search(/canManage && h\('div', \{ class: 'ops-supply__actions' \}/);
  assert.ok(start > 0, 'the row actions');
  const row = sup.slice(start, sup.lastIndexOf("'Archive'") + "'Archive'".length);
  const at = (s) => { const i = row.indexOf(s); assert.ok(i >= 0, `${s} is in the row`); return i; };
  assert.ok(at("'Add stock'") < at("'Record use'") && at("'Record use'") < at("h('details'"), 'Add stock and Record use come first, outside the disclosure');
  assert.ok(at("h('details'") < at("'Count'") && at("'Count'") < at("'History'") && at("'History'") < at("'Edit'") && at("'Edit'") < at("'Archive'"), 'the other four are inside it, in their old order');
  assert.match(row, /h\('summary', \{[^}]*'aria-label': `More for \$\{s\.name\}`[^}]*\}, 'More'\)/, 'the disclosure is named for its supply');
});

// ---------------------------------------------------------------- list defaults: the job list uses apiFilters

test('the job list sends its filters with apiFilters, and only address lines use changed()', () => {
  assert.match(hk, /import \{[^}]*\bapiFilters\b[^}]*\} from '\.\.\/filters\.js';/);
  assert.match(hk, /get\(`\/cleaning-tasks\$\{qs\(apiFilters\(filters\)\)\}`\)/);
  for (const [name, src] of [['housekeeping.js', hk], ['supplies.js', sup]]) {
    for (const line of src.split('\n').filter((l) => l.includes('changed('))) {
      assert.ok(line.includes('#/') || line.includes('Object.keys(changed('), `${name} keeps changed() for addresses only: ${line.trim()}`);
    }
  }
});
