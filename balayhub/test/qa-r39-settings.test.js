'use strict';
require('./helpers');

// QA round 39, SETTINGS (D-121; audit row 37 and finding LT-1). "Turn on" on the booking page returns its request, so the press
// guard in ui.js holds the button busy until the server answers. With no listing on the page it does nothing (D-117). The invitation
// link box has a name for screen readers. Frontend-only: bookingCard() and showInviteLink() are cut from settings.js and run with stubs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');
const MARK = 'marker';

function between(from, to) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `${from} is in settings.js`);
  return src.slice(start, end);
}

// A stand-in for h(): it keeps the tag, the props and the children, and nothing else.
function stubH(tag, props, ...kids) {
  return { tag, props: props || {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) };
}
function findNode(tree, pred) {
  let found = null;
  const walk = (node) => {
    if (found || !node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    if (pred(node)) { found = node; return; }
    node.kids.forEach(walk);
  };
  walk(tree);
  return found;
}
const turnOnButton = (card) => findNode(card, (n) => n.tag === 'button' && n.kids.includes('Turn on'));

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

// bookingCard() as settings.js has it, run with stubs for every name the module imports.
async function mountBookingCard(page, patchImpl) {
  const body = between('async function bookingCard(', '// Guest experience: public review links');
  const patches = [];
  const toasts = [];
  const stubs = {
    h: stubH,
    get: async () => page,
    patch: (url, data) => { patches.push([url, data]); return patchImpl(); },
    post: async () => ({}),
    api: async () => ({}),
    toast: (msg, kind) => { toasts.push([msg, kind]); },
    confirmDialog: async () => true,
    formModal: () => null,
    field: () => null,
    openModal: () => null,
    icon: () => null,
    label: (x) => String(x),
    emptyState: () => null,
    pageHead: () => null,
    peso: () => '',
    fmtDate: () => '',
    fmtMonth: () => '',
    fmtDateTime: () => '',
    clearErrors: () => null,
    showErrors: () => [],
    ApiError: Error,
  };
  const names = Object.keys(stubs);
  const bookingCard = new Function(...names, `${body}\nreturn bookingCard;`)(...names.map((n) => stubs[n]));
  return { card: await bookingCard(() => {}), patches, toasts };
}

// A booking page that is off, with PayMongo connected; `listed` says whether a listing is ticked for the page.
const page = (listed) => ({
  enabled: false,
  paymongo_connected: true,
  paymongo_checked: true,
  paymongo_key_hint: 'sk_test_…',
  slug: 'qa-r39-settings',
  url: 'https://balayhub.test/#/book/qa-r39-settings',
  intro: '',
  listings: [{ name: 'QA r39 settings listing', bookable_online: listed, photo_count: 1 }],
});

test('Turn on returns its request, so the button waits for it until the server answers (D-121)', async () => {
  const held = gate();
  const { card, patches, toasts } = await mountBookingCard(page(true), () => held.promise);
  const press = turnOnButton(card).props.onclick();
  assert.equal(typeof press?.then, 'function', 'a press returns its request, so the press guard can hold the button');
  assert.equal(patches.length, 1, 'one request is sent');
  assert.equal(await Promise.race([press, Promise.resolve(MARK)]), MARK, 'the press is still waiting while the request is pending');
  held.open({});
  await press;
  assert.equal(toasts[0][0], 'Your booking page is live!');
});

test('Turn on: a refused request settles the press and the refusal is said as an error toast (D-121)', async () => {
  const { card, toasts } = await mountBookingCard(page(true), async () => {
    throw Object.assign(new Error('QA r39 refused.'), { status: 409 });
  });
  const press = turnOnButton(card).props.onclick();
  assert.equal(typeof press?.then, 'function', 'a press returns its request');
  await press;
  assert.deepEqual(toasts[0], ['QA r39 refused.', 'error']);
});

test('Turn on with no listing on the page is dimmed and does nothing (D-117)', async () => {
  const { card, patches } = await mountBookingCard(page(false), async () => ({}));
  const btn = turnOnButton(card);
  assert.equal(btn.props['aria-disabled'], 'true', 'Turn on is dimmed while no listing is ticked');
  assert.equal(btn.props.onclick(), undefined, 'a press returns nothing');
  assert.equal(patches.length, 0, 'no request is sent');
});

test('the invitation link box has a name for screen readers (LT-1)', () => {
  let modal = null;
  const showInviteLink = new Function('h', 'openModal', 'toast',
    `${between('    const showInviteLink = (res) => {', '    const editMember = ')}\nreturn showInviteLink;`)(
    stubH, (m) => { modal = m; }, () => null);
  showInviteLink({ emailed: false, inviteLink: 'https://balayhub.test/invite?x=1', invitation: { email: 'guest@example.test' } });
  assert.equal(modal.title, 'Invitation created');
  const input = findNode(modal.body, (n) => n.tag === 'input');
  assert.ok(input, 'the link box is in the dialog');
  assert.equal(input.props['aria-label'], 'Invitation link');
  assert.equal(input.props.readonly, true);
  assert.equal(input.props.value, 'https://balayhub.test/invite?x=1');
});
