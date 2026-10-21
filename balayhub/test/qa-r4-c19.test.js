'use strict';

// QA round 4, lane C19 (Settings "App & notifications" card). A long-term workspace has no alert types,
// so the card must not show an empty "Notify me about" list or the stay-only sentence; it says
// "Alerts for monthly rentals aren’t available yet." instead, as My account does. The device on/off
// controls keep working. Frontend only: notifications.js is loaded from a temp copy with stub api.js and
// ui.js modules (h() builds a plain tree) and a stub browser environment.
// node --test --test-concurrency=1 test/qa-r4-c19.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MONTHLY = 'Alerts for monthly rentals aren’t available yet.';
const STAY_INTRO = 'Get a notification on this device for new bookings, guest messages and payments, even when BalayHub is closed.';
const ON = 'Notifications are on for this device.';
const ENDPOINT = 'https://push.example/device-1';

const STUB_API = `export const state = { settings: null, subscribed: false, permission: 'default', calls: [] };
export async function get() { return state.settings; }
export async function post(path, body) { state.calls.push(['post', path, body]); return {}; }
export async function patch(path, body) { state.calls.push(['patch', path, body]); return {}; }
`;
const STUB_UI = `export function h(tag, props, ...children) {
  return { tag, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true) };
}
export function toast() {}
`;

let card; let api; let dir; let rerenders = 0;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c19-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, '../public/js/notifications.js'), path.join(dir, 'notifications.js'));
  fs.writeFileSync(path.join(dir, 'api.js'), STUB_API);
  fs.writeFileSync(path.join(dir, 'ui.js'), STUB_UI);
  api = await import(pathToFileURL(path.join(dir, 'api.js')));

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
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const render = async (types, { on = false } = {}) => {
  api.state.settings = { public_key: 'BEtest', devices: [], types };
  api.state.subscribed = on;
  api.state.permission = on ? 'granted' : 'default';
  api.state.calls.length = 0;
  rerenders = 0;
  return card.notificationsCard(() => { rerenders += 1; });
};
const nodes = (node) => (typeof node === 'string' ? [node] : [node, ...node.children.flatMap(nodes)]);
const texts = (root) => nodes(root).filter((n) => typeof n === 'string');
const elements = (root, tag) => nodes(root).filter((n) => typeof n !== 'string' && n.tag === tag);
const button = (root, label) => elements(root, 'button').find((b) => b.children.includes(label));

const LONG_TERM = [];
const STAY_TYPES = [
  { key: 'new_booking', label: 'New bookings', on: true },
  { key: 'guest_message', label: 'Guest messages', on: false },
];

test('long-term workspace, device off: monthly note replaces the list and the stay-only sentence', async () => {
  const root = await render(LONG_TERM, { on: false });
  assert.ok(texts(root).includes(MONTHLY));
  assert.equal(elements(root, 'fieldset').length, 0);
  assert.ok(!texts(root).includes(STAY_INTRO));
  assert.equal(button(root, 'Turn on notifications'), undefined, 'nothing to turn on in a monthly-rental workspace');
});

test('long-term workspace, device on: device line and controls still work, no list', async () => {
  const root = await render(LONG_TERM, { on: true });
  assert.ok(texts(root).includes(ON));
  assert.ok(texts(root).includes(MONTHLY));
  assert.equal(elements(root, 'fieldset').length, 0);
  assert.equal(button(root, 'Send a test'), undefined, 'nothing to test in a monthly-rental workspace');
  await button(root, 'Turn off on this device').props.onclick();
  assert.equal(rerenders, 1);
  assert.deepEqual(api.state.calls[0], ['post', '/push/unsubscribe', { endpoint: ENDPOINT }]);
});

test('workspace with alert types keeps the list, the stay-only sentence and no monthly note', async () => {
  const root = await render(STAY_TYPES, { on: false });
  const fieldsets = elements(root, 'fieldset');
  assert.equal(fieldsets.length, 1);
  assert.deepEqual(elements(fieldsets[0], 'span').map((s) => s.children[0]), ['New bookings', 'Guest messages']);
  assert.ok(texts(root).includes(STAY_INTRO));
  assert.ok(!texts(root).includes(MONTHLY));
});

test('toggling an alert type on a workspace with types still saves it', async () => {
  const root = await render(STAY_TYPES, { on: true });
  const input = elements(root, 'input')[0];
  await input.props.onchange({ target: { checked: false, attrs: {}, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } } });
  assert.deepEqual(api.state.calls[0], ['patch', '/push/settings', { new_booking: false }]);
});
