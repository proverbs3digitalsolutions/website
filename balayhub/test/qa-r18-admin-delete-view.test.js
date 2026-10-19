'use strict';

// Platform admin "Delete workspace" section in the workspace dialog. Scans the view source (the view imports the app shell,
// which Node cannot load) and runs the pure helpers read out of it.
// node --test --test-concurrency=1 test/qa-r18-admin-delete-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', f), 'utf8');
const src = read('admin.js');
function helpers() {
  const a = src.indexOf('// ---- helpers');
  const b = src.indexOf('// ---- end helpers');
  assert.ok(a !== -1 && b > a, 'helpers block is missing');
  return new Function(`${src.slice(a, b).replace(/export /g, '')}\nreturn { nameMatches, DELETE_LATER, DELETE_NOW };`)();
}

test('section is hidden for the demo workspace and the admin own workspace', () => {
  assert.match(src, /!w\.is_demo && w\.organization_id !== state\.user\.organization_id/);
  assert.match(src, /const dangerZone = canDelete \?/);
  assert.match(src, /dangerZone \? h\('div', null, form, dangerZone\) : form/);
});

test('buttons stay disabled until the typed name matches exactly', () => {
  const { nameMatches } = helpers();
  assert.equal(nameMatches('Casa Lumen', 'Casa Lumen'), true);
  assert.equal(nameMatches('casa lumen', 'Casa Lumen'), false);
  assert.equal(nameMatches('', 'Casa Lumen'), false);
  assert.match(src, /disabled: true, onclick: \(\) => runDelete\(mode\)/);
  assert.match(src, /b\.disabled = !nameMatches\(nameBox\.value, w\.name\)/);
  assert.match(src, /`Type \$\{w\.name\} to confirm`/);
});

test('the typed name is trimmed on both sides before matching, as the server does; case still counts', () => {
  const { nameMatches } = helpers();
  assert.equal(nameMatches('  Casa Lumen  ', 'Casa Lumen'), true);
  assert.equal(nameMatches('Casa Lumen ', ' Casa Lumen'), true);
  assert.equal(nameMatches('  casa lumen  ', 'Casa Lumen'), false);
  assert.equal(nameMatches('   ', 'Casa Lumen'), false);
});

test('copy for both choices', () => {
  const { DELETE_LATER, DELETE_NOW } = helpers();
  assert.equal(DELETE_LATER, 'The owner and team are locked out now. You can cancel this for 14 days, then everything is deleted.');
  assert.equal(DELETE_NOW, 'Everything is deleted right away: bookings, guests, files, and their PayMongo card and plan. This cannot be undone.');
  assert.match(src, /'Delete in 14 days', 'btn--danger'/);
  assert.match(src, /'Delete now', 'btn--danger'/);
});

test('both modes post the right body; toasts and focus follow the copy', () => {
  assert.match(src, /post\(`\/admin\/workspaces\/\$\{w\.organization_id\}\/delete`, \{ mode, confirm_name: nameBox\.value \}\)/);
  assert.match(src, /delBtn\('schedule'/);
  assert.match(src, /delBtn\('now'/);
  assert.match(src, /toast\(`Deletion scheduled for \$\{fmtDate\(r\.deletion_scheduled_at\)\}\.`\)/);
  assert.match(src, /toast\(`\$\{w\.name\} was deleted\.`\)[\s\S]*?modal\.close\(\);[\s\S]*?await rerender\(\);[\s\S]*?focusHeading\(\)/);
});

test('restore posts and a scheduled workspace shows the notice', () => {
  assert.match(src, /post\(`\/admin\/workspaces\/\$\{w\.organization_id\}\/restore`, \{\}\)/);
  assert.match(src, /toast\('Deletion cancelled\.'\)/);
  assert.match(src, /`Scheduled for deletion on \$\{fmtDate\(w\.deletion_scheduled_at\)\}\.`/);
  assert.match(src, /'Cancel deletion'/);
  assert.match(src, /w\.admin_status === 'deleting'\) return badge\('overdue', 'Deleting'\)/);
});

test('server message is shown in a focused alert and the field error under the box', () => {
  assert.match(src, /err\.fields\?\.confirm_name/);
  assert.match(src, /delErr\.textContent = err\.message; delErr\.hidden = false; delErr\.focus\(\)/);
  assert.match(src, /role: 'alert', tabindex: '-1'/);
  assert.match(src, /'aria-describedby': 'delete-name-err'/);
});

test('audit labels exist in settings', () => {
  const s = read('settings.js');
  assert.match(s, /'platform\.workspace_deletion_scheduled': 'Workspace deletion scheduled by BalayHub'/);
  assert.match(s, /'platform\.workspace_deletion_cancelled': 'Workspace deletion cancelled by BalayHub'/);
});
