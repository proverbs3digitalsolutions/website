'use strict';

// QA round 2, lane B25 (proofs).
// C2: a manual-payment settings save that changes nothing writes no audit row.
// guest#7: a pending payment proof with no screenshot says "No screenshot yet" to the host.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_12 node --test --test-concurrency=1 test/qa-r2-proofs.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount, sql } = require('./helpers');

const INSTR = 'GCash 0917 123 4567 (Maria Santos)';

let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Proof Audit B25');
});
test.after(async () => { await srv.close(); });

const saveRaw = (body) => owner.patch('/api/workspace/manual-payments', body);
const savedAudits = async () => (await sql(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'workspace.manual_payments_updated'`))[0].n;

test('a manual-payment save that changes nothing writes no audit row (C2)', async () => {
  const start = await savedAudits();
  assert.equal((await saveRaw({ enabled: true, instructions: INSTR })).status, 200);
  assert.equal(await savedAudits(), start + 1, 'a real change is audited');

  // The same values again, an empty save, and each field sent alone with the value it already has.
  const same = await saveRaw({ enabled: true, instructions: INSTR });
  assert.equal(same.status, 200, JSON.stringify(same.data));
  const empty = await saveRaw({});
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data, { enabled: true, instructions: INSTR });
  assert.equal((await saveRaw({ enabled: true })).status, 200);
  assert.equal((await saveRaw({ instructions: INSTR })).status, 200);
  assert.equal(await savedAudits(), start + 1, 'saves that change nothing write no audit row');

  // A real change after those is still audited, and so is turning it off.
  assert.equal((await saveRaw({ enabled: false })).status, 200);
  assert.equal(await savedAudits(), start + 2);
  assert.deepEqual((await owner.get('/api/workspace/manual-payments')).data, { enabled: false, instructions: INSTR });
});

// ---------------------------------------------------------------- guest#7: the host's proof card (view code, no browser)

// The view imports api.js and ui.js. Stubs stand in for them, in a temp copy of the view, so the
// real view code builds its card, which the test then reads.
const API_STUB = 'export const get = async () => globalThis.__b25Proofs; export const post = async () => ({});';
const UI_STUB = `
const node = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter((c) => c !== false && c !== null && c !== undefined && c !== '') });
export const h = node;
export const field = (spec) => ({ tag: 'field', ...spec });
export const formModal = () => {};
export const toast = () => {};
export const badge = (kind, text) => node('span', { class: kind }, text);
export const fmtDateTime = (v) => String(v);
`;

// Visit every element in a built tree, and collect the text it shows.
function textsIn(node, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => textsIn(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  (node.children || []).forEach((c) => (typeof c === 'string' ? out.push(c) : textsIn(c, out)));
  return out;
}

test('a pending proof with no screenshot says "No screenshot yet" to the host (guest#7)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b25-proofs-'));
  try {
    fs.mkdirSync(path.join(dir, 'views'));
    fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'proofs.js'), path.join(dir, 'views', 'proofs.js'));
    fs.writeFileSync(path.join(dir, 'api.js'), API_STUB);
    fs.writeFileSync(path.join(dir, 'ui.js'), UI_STUB);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    const view = await import(pathToFileURL(path.join(dir, 'views', 'proofs.js')).href);
    const base = { amount: '500.00', method: 'gcash', booking_status: 'confirmed', submitted_at: '2026-10-13T06:00:00Z' };
    globalThis.__b25Proofs = {
      proofs: [
        { ...base, proof_id: 'waiting-no-shot', status: 'pending', files: [] },
        { ...base, proof_id: 'waiting-with-shot', status: 'pending', files: [{ file_id: 'f1', file_name: 'payment-proof.png', mime_type: 'image/png' }] },
        { ...base, proof_id: 'rejected-no-shot', status: 'rejected', reject_reason: 'Not received.', files: [] },
      ],
    };
    const texts = textsIn(await view.proofsCard({ booking_id: 'booking-1', guest_email: null }, () => {}));

    assert.equal(texts.filter((t) => t === 'No screenshot yet.').length, 1, 'only the pending proof with no screenshot is labelled as still to come');
    assert.equal(texts.filter((t) => t === 'No screenshot was attached.').length, 1, 'a closed proof with no screenshot keeps the final wording');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
