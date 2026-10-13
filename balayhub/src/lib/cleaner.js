'use strict';

// Cleaner role guard (D-48). A cleaner may reach only the routes below. Every
// other API route answers 403 CLEANER_FORBIDDEN, including routes that don't
// exist yet, so a new route stays closed to cleaners until it is listed here.
// Matching follows Express: case-insensitive, one trailing slash is optional,
// and ":id" is exactly one non-empty path segment. Paths are relative to /api.

const { HttpError } = require('./http');

const isCleaner = (user) => user?.role === 'cleaner';

// Whole sections a cleaner may use with any method: their own account,
// notifications, support and help.
const OPEN_SECTIONS = ['account', 'push', 'support', 'help'];

const ALLOWED = [
  ['GET', '/auth/me'],
  ['POST', '/auth/logout'],
  ['GET', '/cleaning-tasks'],
  ['GET', '/cleaning-tasks/:id'],
  ['POST', '/cleaning-tasks/:id/checklist'],
  ['POST', '/cleaning-tasks/:id/status'],
  ['GET', '/cleaning-calendar'],
  ['GET', '/cleaning-board'],
  // Which record types a cleaner may attach to or read is checked in files.js.
  ['POST', '/files'],
  ['GET', '/files/:id'],
  ['POST', '/cleaning-tasks/:id/damage'],
  ['POST', '/cleaning-tasks/:id/lost-found'],
  ['POST', '/cleaning-tasks/:id/supplies'],
  ['POST', '/cleaning-tasks/:id/work-order'],
  ['GET', '/supplies'],
  ['GET', '/my-pay'],
];

// Same number of segments, same words (ignoring case), and a non-empty segment where ":id" stands.
function matches(pattern, path) {
  const want = pattern.split('/');
  const got = path.replace(/\/$/, '').split('/');
  return want.length === got.length
    && want.every((part, i) => (part === ':id' ? got[i] !== '' : part.toLowerCase() === got[i].toLowerCase()));
}

function permitted(req) {
  if (OPEN_SECTIONS.includes((req.path.split('/')[1] || '').toLowerCase())) return true;
  const route = ALLOWED.find(([method, pattern]) => method === req.method && matches(pattern, req.path));
  if (!route) return false;
  // A cleaner can set a task to in progress or done, but not cancel it.
  return !(route[1] === '/cleaning-tasks/:id/status' && req.body?.status === 'cancelled');
}

function cleanerGuard(req, res, next) {
  if (!isCleaner(req.user) || permitted(req)) return next();
  next(new HttpError(403, "Cleaner accounts can't use this. Ask the owner if you need access.", { code: 'CLEANER_FORBIDDEN' }));
}

module.exports = { cleanerGuard, isCleaner };
