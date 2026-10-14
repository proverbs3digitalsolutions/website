'use strict';

// Decides which sent fields really differ from the stored row, so an edit writes an activity row only when
// something changed. Returns field names only, never values:
//   await audit(db, user, action, type, id, { fields, ...identity }) only when fields.length > 0

// Plain decimal numbers only ("4200", "4200.00", "-1.5", "1e3"). Number() alone would read "0x1F" as 31.
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

// Arrays and objects, but not Dates (a Date is a value, not a nested record).
function isNested(v) {
  return Array.isArray(v) || (v !== null && typeof v === 'object' && !(v instanceof Date));
}

// Copy with object keys sorted at every depth, so { a, b } and { b, a } compare equal. Array order is kept.
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isNested(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
}

// Turns one stored or sent value into a comparable one: null for empty, an ISO string for a Date, a trimmed
// string (with "14:00:00" read as "14:00"), anything else as is.
function normalise(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '') return null;
  return s.replace(/^(\d{1,2}:\d{2}):00$/, '$1');
}

// Text and a real number/boolean are the same value only when the text is that value's plain decimal / true|false
// form. Two strings are never coerced ("0123" vs "123", "1234" vs "1234.0", "true" vs "True" all differ), so a
// changed door code or Wi-Fi password is never hidden. Numbers beyond MAX_SAFE_INTEGER are never compared numerically.
function sameTyped(n, str) {
  if (typeof n === 'boolean') return str === String(n);
  if (typeof n !== 'number' || typeof str !== 'string' || !NUMBER_RE.test(str)) return false;
  const m = Number(str);
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER
    && Math.abs(m) <= Number.MAX_SAFE_INTEGER && m === n;
}

function same(before, after) {
  if (isNested(before) || isNested(after)) {
    return isNested(before) && isNested(after)
      && JSON.stringify(sortKeys(before)) === JSON.stringify(sortKeys(after));
  }
  const a = normalise(before);
  const b = normalise(after);
  return a === b || sameTyped(a, b) || sameTyped(b, a);
}

// Keys of `after` whose value differs from before[key], in the order of `after`. Keys missing from `after`
// are not reported. `before` may be null (a new row), in which case every non-empty key counts as changed.
function changedKeys(before, after) {
  const current = before || {};
  return Object.keys(after).filter((key) => !same(current[key], after[key]));
}

module.exports = { changedKeys };
