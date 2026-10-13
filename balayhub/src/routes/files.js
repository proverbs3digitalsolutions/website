'use strict';

// Private file storage for lease documents, receipts and maintenance photos.
// Files live outside the web root and are only served after a permission check.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { query, one } = require('../db');
const { HttpError, ah, notFound, forbidden } = require('../lib/http');
const { uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { loadLease } = require('../lib/access');
const { loadPayment, loadExpense } = require('./money');

const router = express.Router();

const { ALLOWED } = require('../lib/storage');

// Confirm the user may attach to / read files of this record.
async function checkRecord(user, type, id) {
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
    case 'cleaning': {
      const { propertyScope } = require('../lib/access');
      const params = [id];
      const row = await one(`SELECT t.task_id FROM cleaning_tasks t JOIN units u ON u.unit_id = t.unit_id JOIN properties p ON p.property_id = u.property_id
                              WHERE t.task_id = $1 AND ${propertyScope(user, params)}`, params);
      if (!row) throw notFound();
      return row;
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
    default:
      throw new HttpError(400, 'Unsupported attachment type.', { code: 'BAD_REQUEST' });
  }
}

router.post('/files',
  express.raw({ type: Object.keys(ALLOWED), limit: config.maxUploadBytes }),
  ah(async (req, res) => {
    const type = String(req.query.record_type || '');
    // Guest ID photos come only from the guest's own check-in form.
    if (type === 'registration') throw new HttpError(400, 'Unsupported attachment type.', { code: 'BAD_REQUEST' });
    const recordId = uuidParam(req.query.record_id);
    await checkRecord(req.user, type, recordId);
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
    const file = await one(
      `INSERT INTO files (organization_id, related_record_type, related_record_id, storage_key, file_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING file_id, file_name, mime_type, size_bytes, uploaded_at`,
      [req.user.organization_id, type, recordId, key, fileName, mime, req.body.length, req.user.user_id]);
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
  if (['lease', 'registration'].includes(file.related_record_type)) await audit(null, req.user, 'file.downloaded', file.related_record_type, file.related_record_id, { file_id: id });
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${file.file_name.replace(/"/g, '')}"`);
  fs.createReadStream(full).on('error', () => res.status(404).end()).pipe(res);
}));

module.exports = router;
