// Thin fetch wrapper for the BalayHub API.

export class ApiError extends Error {
  constructor(message, { status = 0, code, fields, data, offline = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields || {};
    this.data = data || {};
    this.offline = offline;
  }
}

const listeners = new Set();
export const onAuthLost = (fn) => listeners.add(fn);

export function newIdempotencyKey() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
}

// How many api() calls have not settled yet (the scroll keeper in ui.js waits for them before it lets go).
let pending = 0;
export const inFlight = () => pending;

export async function api(method, url, body, opts) {
  pending += 1;
  try { return await request(method, url, body, opts); } finally { pending -= 1; }
}

async function request(method, url, body, { idempotencyKey, rawBody, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'BalayHub',
        ...(body !== undefined && !rawBody ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...headers,
      },
      body: rawBody || (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    throw new ApiError("You're offline or the server can't be reached.", { offline: true });
  }
  let data = {};
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) {
    const err = new ApiError(data.error || `Request failed (${res.status}).`, { status: res.status, code: data.code, fields: data.fields, data });
    // The generic "check the highlighted fields" text hides the reason when the field isn't on screen:
    // lead with the server's own field messages and keep the generic text as err.summary.
    if (data.code === 'VALIDATION' && err.fields && Object.keys(err.fields).length) {
      err.summary = err.message;
      err.message = [...new Set(Object.values(err.fields).map(String))].join(' ');
    }
    // Owner-portal 401s (OWNER_SIGNED_OUT) are handled by the portal screens, not the team login.
    if (res.status === 401 && !url.startsWith('/auth/') && !url.startsWith('/owner-portal/')) listeners.forEach((fn) => fn(err));
    if (res.status === 403 && ['EMAIL_UNVERIFIED', 'NO_WORKSPACE'].includes(data.code)) listeners.forEach((fn) => fn(err));
    throw err;
  }
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body = {}, opts) => api('POST', url, body, opts);
export const patch = (url, body, opts) => api('PATCH', url, body, opts);

export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// The first bytes the server checks for each upload type (src/lib/storage.js). Read on the device so a renamed
// file is refused before anything is sent or saved (D-112). The server still checks the whole file.
// The server's whole-file check for images (src/lib/storage.js imageIsComplete), mirrored byte for byte, so a file the server would
// refuse is refused here, in the same press as the form's other problems, before any record is saved (D-112, D-119). Pure.
const MIN_IMAGE_BYTES = 64;
const ascii = (b, from, to) => String.fromCharCode(...b.slice(from, to));
export function imageIsComplete(type, b) {
  if (b.length < MIN_IMAGE_BYTES) return false;
  if (type === 'image/png') return ascii(b, 12, 16) === 'IHDR' && ascii(b, b.length - 8, b.length - 4) === 'IEND';
  // Trailing data after the end marker is allowed: phone motion photos append a video (as on the server).
  if (type === 'image/jpeg') {
    if (!(b[3] >= 0xc0 && b[3] <= 0xfe)) return false;
    for (let i = 4; i < b.length - 1; i += 1) if (b[i] === 0xff && b[i + 1] === 0xd9) return true;
    return false;
  }
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true) === b.length - 8 && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(b, 12, 16));
}

const SIGNATURES = {
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  'application/pdf': (b) => String.fromCharCode(...b.slice(0, 4)) === '%PDF',
};
// The kinds a photo-only box takes (check-in ID, cleaning photos, listing photos): its refusal names only these (D-131).
export const PHOTO_KINDS = 'JPG, PNG or WEBP';
// null for no file, an empty file (the empty-file sentence says that) or another type (each control's type sentence says that).
// `kinds` is what the box takes, as the refusal names it.
export async function fileContentError(file, kinds = 'PDF, JPG, PNG or WEBP') {
  if (!file || !file.size || !SIGNATURES[file.type]) return null;
  const bad = `This file isn't a real ${kinds}. Choose the file again.`;
  if (!SIGNATURES[file.type](new Uint8Array(await file.slice(0, 12).arrayBuffer()))) return bad;
  // An image up to 10 MB is read whole, as the server reads it; a bigger one gets its size sentence anyway, so it is not read (D-119).
  if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) return null;
  return imageIsComplete(file.type, new Uint8Array(await file.arrayBuffer())) ? null : bad;
}

// `kinds` is what the box takes, for the renamed-file sentence (a photo-only box passes PHOTO_KINDS, D-132).
export async function uploadFile(recordType, recordId, file, kinds) {
  // An empty file, a file over 10 MB and a file whose first bytes are not its type are refused before any request, on every control that uploads (D-110, D-112); the server says the same (files.js).
  if (!file || !file.size) throw new ApiError('This file is empty. Choose the file again.', { status: 400, code: 'EMPTY_FILE' });
  if (file.size > 10 * 1024 * 1024) throw new ApiError('Files must be 10 MB or smaller.', { status: 413 });
  const bad = await fileContentError(file, kinds);
  if (bad) throw new ApiError(bad, { status: 415, code: 'BAD_FILE_CONTENT' });
  return api('POST', `/files${qs({ record_type: recordType, record_id: recordId })}`, undefined, {
    rawBody: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });
}
