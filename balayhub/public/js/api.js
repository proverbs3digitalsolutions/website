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

export async function uploadFile(recordType, recordId, file) {
  if (file.size > 10 * 1024 * 1024) throw new ApiError('Files must be 10 MB or smaller.', { status: 413 });
  return api('POST', `/files${qs({ record_type: recordType, record_id: recordId })}`, undefined, {
    rawBody: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });
}
