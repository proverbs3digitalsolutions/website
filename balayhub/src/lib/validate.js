'use strict';

const { HttpError } = require('./http');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONEY_RE = /^-?\d{1,10}(\.\d{1,2})?$/;

function isValidDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
    && +m[1] >= 1900 && +m[1] <= 2200;
}

// Normalise user-entered money ("₱1,250.5") to a fixed 2-decimal string, or null.
function parseMoney(raw) {
  if (typeof raw === 'number') raw = String(raw);
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[₱,\s]/g, '').replace(/^PHP/i, '');
  if (!MONEY_RE.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return `${whole}.${frac.padEnd(2, '0')}`.replace(/^(-?)0+(\d)/, '$1$2');
}

/**
 * Validate `body` against `spec`. Each field:
 *   { type: 'string'|'text'|'email'|'money'|'date'|'enum'|'uuid'|'int'|'bool'|'uuids',
 *     required, max, min, values, positive, label }
 * Returns cleaned values (only keys present in spec; absent optionals -> null,
 * unless `partial` is set, in which case absent keys are omitted).
 */
function validate(body, spec, { partial = false } = {}) {
  body = body && typeof body === 'object' ? body : {};
  const out = {};
  const fields = {};
  for (const [key, rule] of Object.entries(spec)) {
    const label = rule.label || key;
    let v = body[key];
    const absent = v === undefined;
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (partial && absent) continue;
      if (rule.required) { fields[key] = `${label} is required.`; continue; }
      out[key] = rule.type === 'bool' ? false : (rule.type === 'uuids' ? [] : null);
      continue;
    }
    switch (rule.type) {
      case 'string':
      case 'text': {
        if (typeof v !== 'string') { fields[key] = `${label} must be text.`; break; }
        const max = rule.max || (rule.type === 'text' ? 2000 : 200);
        if (v.length > max) { fields[key] = `${label} must be at most ${max} characters.`; break; }
        if (rule.min && v.length < rule.min) { fields[key] = `${label} must be at least ${rule.min} characters.`; break; }
        out[key] = v;
        break;
      }
      case 'password': {
        if (typeof body[key] !== 'string') { fields[key] = `${label} must be text.`; break; }
        const p = body[key];
        if (p.length < 8) { fields[key] = `${label} must be at least 8 characters.`; break; }
        if (p.length > 200) { fields[key] = `${label} is too long.`; break; }
        out[key] = p;
        break;
      }
      case 'email':
        if (typeof v !== 'string' || v.length > 254 || !EMAIL_RE.test(v)) { fields[key] = `Enter a valid email address.`; break; }
        out[key] = v.toLowerCase();
        break;
      case 'phone':
        if (typeof v !== 'string' || !/^[+\d][\d\s()-]{6,19}$/.test(v)) { fields[key] = `Enter a valid phone number.`; break; }
        out[key] = v;
        break;
      case 'money': {
        const m = parseMoney(v);
        if (m === null) { fields[key] = `${label} must be a valid amount (e.g. 8500 or 8500.50).`; break; }
        if (m.startsWith('-')) { fields[key] = `${label} cannot be negative.`; break; }
        if (rule.positive && Number(m) <= 0) { fields[key] = `${label} must be greater than zero.`; break; }
        if (Number(m) > 99999999.99) { fields[key] = `${label} is too large.`; break; }
        out[key] = m;
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !isValidDate(v)) { fields[key] = `${label} must be a valid date.`; break; }
        out[key] = v;
        break;
      case 'time':
        if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) { fields[key] = `${label} must be a time like 14:00.`; break; }
        out[key] = v;
        break;
      case 'enum':
        if (!rule.values.includes(v)) { fields[key] = `${label} has an invalid value.`; break; }
        out[key] = v;
        break;
      case 'uuid':
        if (typeof v !== 'string' || !UUID_RE.test(v)) { fields[key] = `${label} is invalid.`; break; }
        out[key] = v.toLowerCase();
        break;
      case 'uuids':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !UUID_RE.test(x)) || v.length > 500) { fields[key] = `${label} is invalid.`; break; }
        out[key] = [...new Set(v.map((x) => x.toLowerCase()))];
        break;
      case 'int': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isInteger(n)) { fields[key] = `${label} must be a whole number.`; break; }
        if (rule.min !== undefined && n < rule.min) { fields[key] = `${label} must be at least ${rule.min}.`; break; }
        if (rule.max !== undefined && n > rule.max) { fields[key] = `${label} must be at most ${rule.max}.`; break; }
        out[key] = n;
        break;
      }
      case 'bool':
        out[key] = v === true || v === 'true' || v === 'on' || v === 1;
        break;
      default:
        throw new Error(`unknown rule type ${rule.type}`);
    }
  }
  if (Object.keys(fields).length) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
  }
  return out;
}

function uuidParam(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new HttpError(404, "This record doesn't exist or you don't have permission to view it.", { code: 'NOT_FOUND' });
  }
  return value.toLowerCase();
}

module.exports = { validate, parseMoney, isValidDate, uuidParam, UUID_RE };
