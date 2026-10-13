'use strict';

// Encrypts secrets stored in the database (such as a host's PayMongo key) with
// AES-256-GCM. The key comes from DATA_ENCRYPTION_KEY, or is generated once and
// kept in the private storage folder (included in the uploads backup).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

let key = null;
function readKeyFile(file) {
  const k = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  if (k.length !== 32) throw new Error(`The data encryption key file ${file} is damaged. Restore it from a backup, or set DATA_ENCRYPTION_KEY.`);
  return k;
}
function getKey() {
  if (key) return key;
  if (config.dataEncryptionKey) {
    key = crypto.createHash('sha256').update(config.dataEncryptionKey).digest();
    return key;
  }
  const file = path.resolve(config.storageDir, '.data-key');
  let k;
  try {
    k = readKeyFile(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // damaged or unreadable: never replace it silently
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      // Write to a temp file, then link into place, so a crash can't leave a half-written key.
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
      try { fs.linkSync(tmp, file); } finally { fs.unlinkSync(tmp); }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e; // another process created it first
    }
    k = readKeyFile(file);
  }
  key = k; // cache only a validated key
  return key;
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

function decrypt(box) {
  const [v, iv, tag, data] = String(box || '').split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

module.exports = { encrypt, decrypt };
