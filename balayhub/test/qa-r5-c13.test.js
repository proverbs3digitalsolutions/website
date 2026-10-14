'use strict';

// QA round 5, lane C13 (notification settings).
// O-c (#51): PATCH /api/push/settings accepted any alert type, including ones the caller can't receive
// (a long-term owner's stay types, a cleaner's guest messages). It now refuses them with 400 on `types`,
// the same message /api/account/notify-prefs gives, and saves nothing.
// O-b and N5 (App & notifications card, Settings): a long-term workspace shows only the monthly-rentals
// note, and a switch whose save fails goes back to where it was. The card is loaded from a temp copy with
// stub api.js and ui.js modules, as qa-r4-c19 does.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r5-c13.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, client, sql, ownerAccount } = require('./helpers');

const REFUSED = 'Choose on or off for each notification you can receive.';
const MONTHLY = 'Alerts for monthly rentals aren’t available yet.';
const STAY_INTRO = 'Get a notification on this device for new bookings, guest messages and payments, even when BalayHub is closed.';
const ON = 'Notifications are on for this device.';
const ENDPOINT = 'https://push.example/device-c13';

// ---------------------------------------------------------------- server: the allow-list on PATCH /api/push/settings
let srv; let shortOwner; let longOwner; let cleaner;
const prefsOf = async (email) => (await sql('SELECT notify_prefs FROM users WHERE email = $1', [email]))[0].notify_prefs;

test.before(async () => {
  srv = await startServer();
  shortOwner = await ownerAccount(srv.base, 'c13-short@example.com', 'Short C13');
  longOwner = await ownerAccount(srv.base, 'c13-long@example.com', 'Long C13');
  await longOwner.patch('/api/workspace', { business_type: 'long_term' });
  const prop = (await shortOwner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const inv = await shortOwner.post('/api/team/invitations', { email: 'c13-cleaner@example.com', role: 'cleaner', property_ids: [prop.property_id] });
  cleaner = client(srv.base);
  const s = await cleaner.post('/api/auth/signup', {
    full_name: 'Nene Cleaner', email: 'c13-cleaner@example.com', password: 'longenough1', confirm_password: 'longenough1',
    accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
});
test.after(async () => { await srv.close(); });

test('a long-term owner cannot switch on a stay type from the device settings', async () => {
  const before = await prefsOf('c13-long@example.com');
  const r = await longOwner.patch('/api/push/settings', { new_booking: true });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.types, REFUSED);
  assert.deepEqual(await prefsOf('c13-long@example.com'), before, 'nothing is saved');
});

test('a cleaner cannot change a type they cannot receive, and a mixed request saves nothing', async () => {
  const before = await prefsOf('c13-cleaner@example.com');
  const guest = await cleaner.patch('/api/push/settings', { guest_message: false });
  assert.equal(guest.status, 400);
  assert.equal(guest.data.fields.types, REFUSED);
  const mixed = await cleaner.patch('/api/push/settings', { cleaning: false, guest_message: false });
  assert.equal(mixed.status, 400);
  assert.deepEqual(await prefsOf('c13-cleaner@example.com'), before, 'the allowed key in a refused request is not saved either');

  assert.equal((await cleaner.patch('/api/push/settings', { cleaning: false })).status, 200, 'a cleaner can still change cleaning alerts');
  assert.equal((await prefsOf('c13-cleaner@example.com')).cleaning, false);
  await cleaner.patch('/api/push/settings', { cleaning: true });
});

test('a short-term owner still changes every type their role receives', async () => {
  assert.equal((await shortOwner.patch('/api/push/settings', { new_booking: false })).status, 200);
  assert.equal((await prefsOf('c13-short@example.com')).new_booking, false);
  const device = (await shortOwner.get('/api/push/settings')).data.types.find((t) => t.key === 'new_booking');
  assert.equal(device.on, false);
  await shortOwner.patch('/api/push/settings', { new_booking: true });
});

// ---------------------------------------------------------------- frontend: App & notifications card
let card; let api; let ui; let dir;

async function loadCard() {
  if (card) return card;
  const STUB_API = `export const state = { settings: null, subscribed: false, permission: 'default', calls: [], failPatch: false };
export async function get() { return state.settings; }
export async function post(path, body) { state.calls.push(['post', path, body]); return {}; }
export async function patch(path, body) {
  state.calls.push(['patch', path, body]);
  if (state.failPatch) throw Object.assign(new Error('Could not save that. Try again.'), { status: 500 });
  return {};
}
`;
  const STUB_UI = `export const toasts = [];
export function h(tag, props, ...children) {
  return { tag, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true) };
}
export function toast(message, kind) { toasts.push([message, kind]); }
`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c13-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, '../public/js/notifications.js'), path.join(dir, 'notifications.js'));
  fs.writeFileSync(path.join(dir, 'api.js'), STUB_API);
  fs.writeFileSync(path.join(dir, 'ui.js'), STUB_UI);
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));

  const subscription = { endpoint: ENDPOINT, unsubscribe: async () => true };
  const registration = { pushManager: { getSubscription: async () => (api.state.subscribed ? subscription : null) } };
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0', platform: 'Linux x86_64', maxTouchPoints: 0,
      serviceWorker: { getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) },
    },
    configurable: true,
    writable: true,
  });
  globalThis.Notification = { get permission() { return api.state.permission; }, requestPermission: async () => 'granted' };
  globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false }), PushManager: class {}, Notification: globalThis.Notification };
  card = await import(pathToFileURL(path.join(dir, 'notifications.js')));
  return card;
}
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const render = async (types, { on = false } = {}) => {
  await loadCard();
  api.state.settings = { public_key: 'BEtest', devices: [], types };
  api.state.subscribed = on;
  api.state.permission = on ? 'granted' : 'default';
  api.state.calls.length = 0;
  api.state.failPatch = false;
  ui.toasts.length = 0;
  return card.notificationsCard(() => {});
};
const nodes = (node) => (typeof node === 'string' ? [node] : [node, ...node.children.flatMap(nodes)]);
const texts = (root) => nodes(root).filter((n) => typeof n === 'string');
const elements = (root, tag) => nodes(root).filter((n) => typeof n !== 'string' && n.tag === tag);
const button = (root, label) => elements(root, 'button').find((b) => b.children.includes(label));

const STAY_TYPES = [
  { key: 'new_booking', label: 'New bookings', on: true },
  { key: 'guest_message', label: 'Guest messages', on: false },
];

test('long-term workspace, device off: only the monthly-rentals note, no turn-on or test button', async () => {
  const root = await render([], { on: false });
  assert.ok(texts(root).includes(MONTHLY));
  assert.equal(elements(root, 'fieldset').length, 0);
  assert.ok(!texts(root).includes(STAY_INTRO));
  assert.equal(button(root, 'Turn on notifications'), undefined, 'nothing to turn on');
  assert.equal(button(root, 'Send a test'), undefined, 'nothing to test');
});

test('long-term workspace, device already on: keeps the on line and an off button so the device can be stopped', async () => {
  const root = await render([], { on: true });
  assert.ok(texts(root).includes(ON));
  assert.ok(texts(root).includes(MONTHLY));
  assert.equal(button(root, 'Send a test'), undefined, 'nothing to test');
  assert.ok(button(root, 'Turn off on this device'), 'a subscribed device can still be turned off here');
  await button(root, 'Turn off on this device').props.onclick();
  assert.deepEqual(api.state.calls[0], ['post', '/push/unsubscribe', { endpoint: ENDPOINT }]);
});

test('workspace with alert types keeps the list, the stay-only sentence and no monthly note', async () => {
  const root = await render(STAY_TYPES, { on: false });
  const fieldsets = elements(root, 'fieldset');
  assert.equal(fieldsets.length, 1);
  assert.deepEqual(elements(fieldsets[0], 'span').map((s) => s.children[0]), ['New bookings', 'Guest messages']);
  assert.ok(texts(root).includes(STAY_INTRO));
  assert.ok(!texts(root).includes(MONTHLY));
  assert.ok(button(root, 'Turn on notifications'));
});

test('a switch whose save fails goes back to its old position and says why', async () => {
  const root = await render(STAY_TYPES, { on: true });
  api.state.failPatch = true;
  const target = { checked: false };
  await elements(root, 'input')[0].props.onchange({ target });
  assert.equal(target.checked, true, 'the box is put back');
  assert.deepEqual(ui.toasts.at(-1), ['Could not save that. Try again.', 'error']);
});

test('a switch that saves keeps its new position and says Saved', async () => {
  const root = await render(STAY_TYPES, { on: true });
  const target = { checked: false };
  await elements(root, 'input')[0].props.onchange({ target });
  assert.equal(target.checked, false);
  assert.deepEqual(api.state.calls[0], ['patch', '/push/settings', { new_booking: false }]);
  assert.deepEqual(ui.toasts.at(-1), ['Saved.', undefined]);
});
