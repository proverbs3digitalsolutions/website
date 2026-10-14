'use strict';

// Private file storage outside the web root. Files are served only by
// routes/files.js after a permission check.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { one } = require('../db');

// The first bytes alone are not enough for an image: a signature-only or cut-short file must be refused.
const MIN_IMAGE_BYTES = 64;
function imageIsComplete(mime, body) {
  if (body.length < MIN_IMAGE_BYTES) return false;
  if (mime === 'image/png') return body.subarray(12, 16).toString('latin1') === 'IHDR' && body.subarray(-8, -4).toString('latin1') === 'IEND';
  // Trailing data after the end marker is allowed: phone motion photos append a video.
  if (mime === 'image/jpeg') return body[3] >= 0xc0 && body[3] <= 0xfe && body.includes(Buffer.from([0xff, 0xd9]), 4);
  return body.readUInt32LE(4) === body.length - 8 && ['VP8 ', 'VP8L', 'VP8X'].includes(body.subarray(12, 16).toString('latin1'));
}

const ALLOWED = {
  'application/pdf': { ext: 'pdf', magic: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && imageIsComplete('image/jpeg', b) },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && imageIsComplete('image/png', b) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' && imageIsComplete('image/webp', b) },
};

// Returns the spec for a valid upload, or null.
function checkUpload(mime, body, { imagesOnly = false } = {}) {
  const spec = ALLOWED[mime];
  if (!spec || (imagesOnly && !mime.startsWith('image/')) || !Buffer.isBuffer(body) || !body.length || !spec.magic(body)) return null;
  return spec;
}

async function saveFile({ organizationId, recordType, recordId, body, mime, fileName, uploadedBy, db }) {
  const spec = ALLOWED[mime];
  const name = String(fileName || '').replace(/[^\w.\- ()]/g, '_').slice(0, 150) || `upload.${spec.ext}`;
  const key = path.join(organizationId, `${crypto.randomUUID()}.${spec.ext}`);
  const full = path.resolve(config.storageDir, key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, body, { mode: 0o600 });
  try {
    const sql = `INSERT INTO files (organization_id, related_record_type, related_record_id, storage_key, file_name, mime_type, size_bytes, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING file_id, file_name, mime_type, size_bytes, uploaded_at`;
    const params = [organizationId, recordType, recordId, key, name, mime, body.length, uploadedBy || null];
    return db ? (await db.query(sql, params)).rows[0] : await one(sql, params);
  } catch (err) {
    await fs.promises.unlink(full).catch(() => {}); // don't leave an orphan file
    throw err;
  }
}

// Remove a stored file from disk (its database row is handled by the caller).
async function removeStoredFile(file) {
  const full = path.resolve(config.storageDir, file.storage_key);
  if (full.startsWith(path.resolve(config.storageDir) + path.sep)) await fs.promises.unlink(full).catch(() => {});
}

// Permanently delete a stored file and its record.
async function deleteFile(file) {
  await removeStoredFile(file);
  await one('DELETE FROM files WHERE file_id = $1 RETURNING file_id', [file.file_id]);
}

module.exports = { ALLOWED, checkUpload, saveFile, deleteFile, removeStoredFile };
