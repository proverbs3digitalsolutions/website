'use strict';
require('./helpers');

// QA r39 lane NOTIFY (D-121, contract C2.4): a notification switch that saves on change waits for its own save. While the save is
// pending the switch is aria-disabled (dimmed, still focused, not disabled), a second click or change sends no second save, and the
// mark goes when the answer comes. A refused save puts the tick back. Frontend-only: notifications.js is copied to a temp folder with
// stub api.js and ui.js (h and toast), so the real notificationsCard runs against them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const tick = () => new Promise((r) => setImmediate(r));

// Stand-in element: attributes are attributes, checked and disabled are properties, handlers stay in props.
class El {
  constructor(tag, props) {
    this.tag = String(tag).toUpperCase();
    this.props = props || {};
    this.attrs = {};
    this.children = [];
    this.checked = Boolean(this.props.checked);
    this.disabled = Boolean(this.props.disabled);
    for (const [k, v] of Object.entries(this.props)) {
      if (typeof v === 'function' || (v !== null && typeof v === 'object') || k === 'checked' || k === 'disabled') continue;
      this.attrs[k] = String(v);
    }
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
}

const STUBS = {
  'api.js': `
export const get = (...a) => globalThis.__r39.get(...a);
export const post = (...a) => globalThis.__r39.post(...a);
export const patch = (...a) => globalThis.__r39.patch(...a);
`,
  'ui.js': `
export const h = (...a) => globalThis.__r39.h(...a);
export const toast = (...a) => globalThis.__r39.toast(...a);
`,
};

const sent = [];   // every save the card sends: [method, url, body]
const toasts = []; // every toast the card shows
let answer = null; // resolves or rejects the save that is waiting

const settings = () => ({
  public_key: 'QA-R39-TEST-KEY',
  devices: [],
  types: [{ key: 'booking', label: 'New bookings', on: true }],
});

let notify;
let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r39notify-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [f, src] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, f), src);
  fs.copyFileSync(path.join(JS, 'notifications.js'), path.join(dir, 'notifications.js'));
  globalThis.window = { addEventListener() { }, matchMedia: () => ({ matches: false }) };
  globalThis.__r39 = {
    get: async () => settings(),
    post: async () => ({}),
    patch: (url, body) => { sent.push(['PATCH', url, body]); return new Promise((res, rej) => { answer = { res, rej }; }); },
    h: (tag, props, ...children) => {
      const el = new El(tag, props);
      for (const c of children.flat(Infinity)) if (c && typeof c === 'object') el.children.push(c);
      return el;
    },
    toast: (msg, kind) => { toasts.push({ msg, kind }); },
  };
  notify = await import(pathToFileURL(path.join(dir, 'notifications.js')));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

async function mountCard() {
  sent.length = 0;
  toasts.length = 0;
  answer = null;
  const card = await notify.notificationsCard(() => { });
  const [box] = inputs(card);
  assert.ok(box && box.tag === 'INPUT', 'the card shows a check box for each notification type');
  return box;
}

function inputs(node, out = []) {
  if (node.tag === 'INPUT') out.push(node);
  for (const c of node.children) inputs(c, out);
  return out;
}

// A real click on a check box: the browser flips it, the click handler may cancel that, and the change handler runs only when the
// click was not cancelled. Returns whether the click was cancelled and the change handler's promise (null when cancelled).
function click(box) {
  const before = box.checked;
  box.checked = !box.checked;
  const ev = { target: box, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  box.props.onclick?.(ev);
  if (ev.defaultPrevented) { box.checked = before; return { prevented: true, done: null }; }
  return { prevented: false, done: box.props.onchange({ target: box }) };
}

// Reports whether a promise has settled, without awaiting it.
function settledFlag(p) {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  return () => settled;
}

test('a switch is dimmed while its save waits, and a second click sends no second save (D-121)', async () => {
  const box = await mountCard();
  assert.equal(box.checked, true);

  const first = click(box);
  assert.equal(first.prevented, false);
  assert.equal(box.checked, false);
  assert.deepEqual(sent, [['PATCH', '/push/settings', { booking: false }]]);
  const isDone = settledFlag(first.done);
  await tick();
  assert.equal(isDone(), false, 'the change handler waits for the save');
  assert.equal(box.getAttribute('aria-disabled'), 'true', 'the switch is dimmed while its save waits');
  assert.notEqual(box.disabled, true, 'the switch is aria-disabled, not disabled, so it keeps focus');

  const second = click(box);
  assert.equal(second.prevented, true, 'a second click during the save is cancelled');
  assert.equal(box.checked, false, 'the switch keeps the value being saved');
  assert.equal(sent.length, 1, 'a second click sends no second save');

  answer.res({ ok: true });
  await first.done;
  assert.equal(isDone(), true);
  assert.equal(box.getAttribute('aria-disabled'), null, 'the mark goes when the answer comes');
  assert.equal(box.checked, false);
  assert.deepEqual(toasts, [{ msg: 'Saved.', kind: undefined }]);
});

test('a change event during a waiting save sends nothing (C2.4 first line)', async () => {
  const box = await mountCard();
  const first = click(box);
  box.props.onchange({ target: box });
  assert.equal(sent.length, 1, 'a change while the save waits sends no second save');
  answer.res({ ok: true });
  await first.done;
});

test('a refused save puts the tick back, shows the refusal and clears the dim (D-121)', async () => {
  const box = await mountCard();
  const { done } = click(box);
  assert.equal(box.getAttribute('aria-disabled'), 'true');
  answer.rej(Object.assign(new Error('QA r39 refused.'), { status: 409 }));
  await done;
  assert.equal(box.checked, true, 'the tick goes back to where it was');
  assert.equal(box.getAttribute('aria-disabled'), null, 'the mark goes after a refusal');
  assert.notEqual(box.disabled, true);
  assert.deepEqual(toasts, [{ msg: 'QA r39 refused.', kind: 'error' }]);
});

test('after a saved answer the switch takes the next change', async () => {
  const box = await mountCard();
  const first = click(box);
  answer.res({ ok: true });
  await first.done;

  const second = click(box);
  assert.equal(second.prevented, false, 'the switch is free again once the save answered');
  assert.equal(box.checked, true);
  assert.deepEqual(sent.map((s) => s[2]), [{ booking: false }, { booking: true }]);
  answer.res({ ok: true });
  await second.done;
  assert.equal(box.getAttribute('aria-disabled'), null);
});
