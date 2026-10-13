'use strict';

// QA round 1, lane L16 (proofs).
// #74: saving the manual-payment settings changes only the fields that were sent.
// #39: the confirm-payment dialog offers the receipt box only when the guest has an email.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_l16 node --test --test-concurrency=1 test/qa-r1-manual-payments.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount } = require('./helpers');

const INSTR = 'GCash 0917 123 4567 (Maria Santos)';
const NEW_INSTR = 'Maya 0998 765 4321 (Juan Dela Cruz)';

let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Manual Pay L16');
});
test.after(async () => { await srv.close(); });

const saveRaw = (body) => owner.patch('/api/workspace/manual-payments', body);
const settings = async () => (await owner.get('/api/workspace/manual-payments')).data;

test('a save with an empty body changes nothing (#74)', async () => {
  assert.equal((await saveRaw({ enabled: true, instructions: INSTR })).status, 200);
  const r = await saveRaw({});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(await settings(), { enabled: true, instructions: INSTR });
  assert.deepEqual(r.data, { enabled: true, instructions: INSTR }, 'the reply shows what is now saved');
});

test('a save changes only the fields it sends (#74)', async () => {
  // Turning off keeps the details.
  assert.deepEqual((await saveRaw({ enabled: false })).data, { enabled: false, instructions: INSTR });
  assert.deepEqual(await settings(), { enabled: false, instructions: INSTR });
  // New details keep the on/off switch as it was.
  assert.deepEqual((await saveRaw({ instructions: NEW_INSTR })).data, { enabled: false, instructions: NEW_INSTR });
  // Turning on uses the saved details, so they need not be sent again.
  assert.deepEqual((await saveRaw({ enabled: true })).data, { enabled: true, instructions: NEW_INSTR });
  assert.deepEqual(await settings(), { enabled: true, instructions: NEW_INSTR });
});

test('enabling still needs payment details, saved or sent in the same save (#74)', async () => {
  // Clearing the details while manual payments stay on would leave guests with nothing to pay to.
  const clear = await saveRaw({ instructions: '' });
  assert.equal(clear.status, 400, JSON.stringify(clear.data));
  assert.ok(clear.data.fields.instructions, 'asks for the payment details');
  assert.deepEqual(await settings(), { enabled: true, instructions: NEW_INSTR }, 'a refused save changes nothing');

  // Off with no details: turning on alone is refused.
  assert.equal((await saveRaw({ enabled: false, instructions: '' })).status, 200);
  assert.deepEqual(await settings(), { enabled: false, instructions: null });
  const on = await saveRaw({ enabled: true });
  assert.equal(on.status, 400, JSON.stringify(on.data));
  assert.ok(on.data.fields.instructions);
  assert.deepEqual(await settings(), { enabled: false, instructions: null });

  // Sending the details with the switch in the same save works.
  assert.equal((await saveRaw({ enabled: true, instructions: INSTR })).status, 200);
  assert.deepEqual(await settings(), { enabled: true, instructions: INSTR });
});

// ---------------------------------------------------------------- #39: the confirm dialog (view code, no browser)

// The view imports api.js and ui.js. Stubs stand in for them, in a temp copy of the view, so the
// real view code builds its card and dialog fields, which the test then reads.
const API_STUB = 'export const get = async () => globalThis.__l16Proofs; export const post = async () => ({});';
const UI_STUB = `
const node = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter((c) => c !== false && c !== null && c !== undefined && c !== '') });
export const h = node;
export const field = (spec) => ({ tag: 'field', ...spec });
export const formModal = (spec) => { globalThis.__l16Modal = spec; };
export const toast = () => {};
export const badge = (kind, text) => node('span', { class: kind }, text);
export const fmtDateTime = (v) => String(v);
`;

// Visit every element in a built tree.
function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== 'object') return;
  fn(node);
  (node.children || []).forEach((c) => walk(c, fn));
}

test('confirm payment offers the receipt box only when the guest has an email (#39)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l16-proofs-'));
  try {
    fs.mkdirSync(path.join(dir, 'views'));
    fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'proofs.js'), path.join(dir, 'views', 'proofs.js'));
    fs.writeFileSync(path.join(dir, 'api.js'), API_STUB);
    fs.writeFileSync(path.join(dir, 'ui.js'), UI_STUB);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    const view = await import(pathToFileURL(path.join(dir, 'views', 'proofs.js')).href);
    globalThis.__l16Proofs = {
      proofs: [{ proof_id: 'proof-1', amount: '1000.00', method: 'gcash', status: 'pending', booking_status: 'confirmed', submitted_at: '2026-10-13T06:00:00Z', files: [] }],
    };

    // Build the card for a reservation, press Confirm payment, and list the dialog's field names.
    const dialogFields = async (guestEmail) => {
      const card = await view.proofsCard({ booking_id: 'booking-1', guest_email: guestEmail }, () => {});
      let confirm = null;
      walk(card, (n) => { if (n.tag === 'button' && n.children.includes('Confirm payment')) confirm = n; });
      assert.ok(confirm, 'a pending proof has a Confirm payment button');
      globalThis.__l16Modal = null;
      confirm.props.onclick();
      return globalThis.__l16Modal.fields.filter((f) => f && f.name).map((f) => f.name);
    };

    assert.equal((await dialogFields(null)).includes('send_receipt'), false, 'no guest email, so no receipt box');
    assert.equal((await dialogFields('')).includes('send_receipt'), false, 'an empty guest email gets no receipt box');
    assert.equal((await dialogFields('ana@example.com')).includes('send_receipt'), true, 'a guest with an email gets the receipt box');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
