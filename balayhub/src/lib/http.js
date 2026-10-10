'use strict';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const NOT_FOUND_MSG = "This record doesn't exist or you don't have permission to view it.";

const notFound = (msg = NOT_FOUND_MSG) => new HttpError(404, msg, { code: 'NOT_FOUND' });
const forbidden = (msg = "You don't have permission to do that.") => new HttpError(403, msg, { code: 'FORBIDDEN' });

// Wrap async route handlers so rejections reach the error middleware.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, notFound, forbidden, ah, NOT_FOUND_MSG };
