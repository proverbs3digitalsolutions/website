'use strict';

// Private file storage for lease documents, receipts and maintenance photos.
// Files live outside the web root and are only served after a permission check.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { one, tx } = require('../db');
const { HttpError, ah, notFound, forbidden } = require('../lib/http');
const { uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { loadLease, propertyScope } = require('../lib/access');
const { isCleaner } = require('../lib/cleaner');
const { loadPayment, loadExpense } = require('./money');

const router = express.Router();

const { ALLOWED } = require('../lib/storage');

// Cleaners only ever attach or read files on these record types.
const CLEANER_RECORD_TYPES = ['cleaning', 'damage', 'lost_found'];
function requireCleanerRecord(user, type) {
  if (isCleaner(user) && !CLEANER_RECORD_TYPES.includes(type)) {
    throw forbidden('Cleaners can only use files on cleaning, damage and lost-and-found records.');
  }
}

// Anyone but an owner or manager may use a damage or lost-and-found record only if they filed it themselves
// (BACKEND-SCHEMA 6.1). A cleaner must also have filed it on a task they can see (assigned to them or to nobody);
// staff may also have filed it on a stay, where there is no task.
function ownRecordSql(user, params, alias, byColumn) {
  params.push(user.user_id);
  const i = params.length;
  let sql = ` AND ${alias}.${byColumn} = $${i}`;
  if (isCleaner(user)) {
    sql += ` AND ${alias}.task_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM cleaning_tasks t WHERE t.task_id = ${alias}.task_id
                 AND (t.assigned_to = $${i} OR (t.assigned_to IS NULL AND t.assignee_name IS NULL)))`;
  }
  return sql;
}

// Confirm the user may attach to / read files of this record.
async function checkRecord(user, type, id) {
  requireCleanerRecord(user, type);
  switch (type) {
    case 'lease':
      if (user.role === 'staff') throw forbidden('Lease documents are limited to owners and property managers.');
      return loadLease(user, id);
    case 'payment': return loadPayment(user, id);
    case 'expense': return loadExpense(user, id);
    case 'maintenance': {
      const { propertyScope } = require('../lib/access');
      const params = [id];
      const row = await one(`SELECT m.request_id FROM maintenance_requests m JOIN properties p ON p.property_id = m.property_id
                              WHERE m.request_id = $1 AND ${propertyScope(user, params)}`, params);
      if (!row) throw notFound();
      return row;
    }
    case 'listing': {
      const { loadUnit } = require('../lib/access');
      return loadUnit(user, id);
    }
    case 'cleaning': {
      // A cleaner only sees tasks assigned to them or to nobody (the same rule as the task list).
      const params = [id];
      let sql = `SELECT t.task_id FROM cleaning_tasks t JOIN units u ON u.unit_id = t.unit_id JOIN properties p ON p.property_id = u.property_id
                  WHERE t.task_id = $1 AND ${propertyScope(user, params)}`;
      if (isCleaner(user)) {
        params.push(user.user_id);
        sql += ` AND (t.assigned_to = $${params.length} OR (t.assigned_to IS NULL AND t.assignee_name IS NULL))`;
      }
      const row = await one(sql, params);
      if (!row) throw notFound();
      return row;
    }
    case 'deposit': {
      const { propertyScope } = require('../lib/access');
      const params = [id];
      const row = await one(`SELECT d.deposit_id FROM stay_deposits d JOIN bookings b USING (booking_id)
                               JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
                              WHERE d.deposit_id = $1 AND ${propertyScope(user, params)}`, params);
      if (!row) throw notFound();
      return row;
    }
    case 'support': {
      // Ticket attachments: whoever can see the ticket.
      const { loadTicket } = require('./support');
      return loadTicket(user, id);
    }
    case 'registration': {
      // Guest IDs: owners and managers only.
      if (user.role === 'staff') throw forbidden('Guest IDs are limited to owners and property managers.');
      const { propertyScope } = require('../lib/access');
      const params = [id];
      const row = await one(`SELECT r.registration_id FROM guest_registrations r JOIN bookings b USING (booking_id)
                               JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
                              WHERE r.registration_id = $1 AND ${propertyScope(user, params)}`, params);
      if (!row) throw notFound();
      return row;
    }
    case 'damage': {
      // Owners and managers see every report on a unit they can see. Staff and cleaners only see a report they filed.
      const params = [id];
      let sql = `SELECT r.report_id FROM damage_reports r JOIN units u ON u.unit_id = r.unit_id JOIN properties p ON p.property_id = u.property_id
                  WHERE r.report_id = $1 AND ${propertyScope(user, params)}`;
      if (!['owner', 'manager'].includes(user.role)) sql += ownRecordSql(user, params, 'r', 'reported_by');
      const row = await one(sql, params);
      if (!row) throw notFound();
      return row;
    }
    case 'lost_found': {
      // Owners and managers see every item on a unit they can see. Staff and cleaners only see an item they logged.
      const params = [id];
      let sql = `SELECT li.item_id FROM lost_found_items li JOIN units u ON u.unit_id = li.unit_id JOIN properties p ON p.property_id = u.property_id
                  WHERE li.item_id = $1 AND ${propertyScope(user, params)}`;
      if (!['owner', 'manager'].includes(user.role)) sql += ownRecordSql(user, params, 'li', 'found_by');
      const row = await one(sql, params);
      if (!row) throw notFound();
      return row;
    }
    case 'inspection': {
      // Inspection photos: owners and managers only.
      if (!['owner', 'manager'].includes(user.role)) throw forbidden('Inspection photos are limited to owners and property managers.');
      const params = [id];
      const row = await one(
        `SELECT i.inspection_id FROM cleaning_inspections i JOIN cleaning_tasks t ON t.task_id = i.task_id
           JOIN units u ON u.unit_id = t.unit_id JOIN properties p ON p.property_id = u.property_id
          WHERE i.inspection_id = $1 AND ${propertyScope(user, params)}`, params);
      if (!row) throw notFound();
      return row;
    }
    case 'payment_proof': {
      // Guest payment screenshots: owners and managers only, never staff.
      if (user.role === 'staff') throw forbidden('Payment proofs are limited to owners and property managers.');
      const { propertyScope } = require('../lib/access');
      const params = [id];
      const row = await one(`SELECT pp.proof_id FROM payment_proofs pp JOIN bookings b ON b.booking_id = pp.booking_id
                               JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
                              WHERE pp.proof_id = $1 AND ${propertyScope(user, params)}`, params);
      if (!row) throw notFound();
      return row;
    }
    case 'booking_payment': {
      // Receipts and files on a recorded payment: owners and managers only.
      if (user.role === 'staff') throw forbidden('Payment files are limited to owners and property managers.');
      const { propertyScope } = require('../lib/access');
      const params = [id];
      const row = await one(`SELECT bp.payment_id FROM booking_payments bp JOIN bookings b ON b.booking_id = bp.booking_id
                               JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
                              WHERE bp.payment_id = $1 AND ${propertyScope(user, params)}`, params);
      if (!row) throw notFound();
      return row;
    }
    default:
      throw new HttpError(400, 'Unsupported attachment type.', { code: 'BAD_REQUEST' });
  }
}

router.post('/files',
  express.raw({ type: Object.keys(ALLOWED), limit: config.maxUploadBytes }),
  ah(async (req, res) => {
    const type = String(req.query.record_type || '');
    requireCleanerRecord(req.user, type);
    // Guest ID photos come only from the guest's own check-in form.
    if (type === 'registration' || type === 'listing') throw new HttpError(400, 'Unsupported attachment type.', { code: 'BAD_REQUEST' });
    const recordId = uuidParam(req.query.record_id);
    await checkRecord(req.user, type, recordId);
    // An empty file is said as empty, not as a wrong type (D-110). Checked after the access checks, so it never
    // confirms a record the person can't reach.
    if (req.get('Content-Length') === '0' || (Buffer.isBuffer(req.body) && !req.body.length)) throw new HttpError(400, 'This file is empty. Choose the file again.', { code: 'EMPTY_FILE' });
    const mime = String(req.get('Content-Type') || '').split(';')[0].trim();
    const spec = ALLOWED[mime];
    if (!spec || !Buffer.isBuffer(req.body) || !req.body.length) {
      throw new HttpError(415, 'Upload a PDF, JPG, PNG or WEBP file up to 10 MB.', { code: 'UNSUPPORTED_FILE' });
    }
    if (!spec.magic(req.body)) throw new HttpError(415, "The file content doesn't match its type.", { code: 'UNSUPPORTED_FILE' });
    const rawName = decodeURIComponent(String(req.get('X-File-Name') || `upload.${spec.ext}`));
    const fileName = rawName.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || `upload.${spec.ext}`;
    const key = path.join(req.user.organization_id, `${crypto.randomUUID()}.${spec.ext}`);
    const full = path.resolve(config.storageDir, key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, req.body, { mode: 0o600 });
    // The file row and the expense link save together, or neither does.
    const file = await tx(async (db) => {
      const { rows: [f] } = await db.query(
        `INSERT INTO files (organization_id, related_record_type, related_record_id, storage_key, file_name, mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING file_id, file_name, mime_type, size_bytes, uploaded_at`,
        [req.user.organization_id, type, recordId, key, fileName, mime, req.body.length, req.user.user_id]);
      // The newest receipt is the one owner statements and the owner portal link to. Staff only link an expense that
      // has no receipt yet, so they never replace one. A voided expense is never linked.
      if (type === 'expense') {
        await db.query(`UPDATE expenses SET receipt_file_id = $1
                         WHERE expense_id = $2 AND organization_id = $3 AND voided_at IS NULL
                           AND ($4::boolean OR receipt_file_id IS NULL)`,
          [f.file_id, recordId, req.user.organization_id, ['owner', 'manager'].includes(req.user.role)]);
      }
      return f;
    });
    await audit(null, req.user, 'file.uploaded', type, recordId, { file_id: file.file_id, name: fileName });
    res.status(201).json({ file });
  }));

router.get('/files/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const file = await one('SELECT * FROM files WHERE file_id = $1 AND organization_id = $2', [id, req.user.organization_id]);
  if (!file) throw notFound();
  await checkRecord(req.user, file.related_record_type, file.related_record_id);
  const full = path.resolve(config.storageDir, file.storage_key);
  if (!full.startsWith(path.resolve(config.storageDir))) throw notFound();
  if (['lease', 'registration', 'payment_proof', 'booking_payment'].includes(file.related_record_type)) await audit(null, req.user, 'file.downloaded', file.related_record_type, file.related_record_id, { file_id: id });
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, no-store');
  // filename is an ASCII fallback (headers can't carry other characters). filename* is the real name, UTF-8
  // encoded (RFC 6266). encodeURIComponent leaves ' ( ) * alone, and RFC 5987 doesn't allow those, so escape them too.
  const ascii = file.file_name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const utf8 = encodeURIComponent(file.file_name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${utf8}`);
  fs.createReadStream(full).on('error', () => res.status(404).end()).pipe(res);
}));

module.exports = router;
