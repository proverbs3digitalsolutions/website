'use strict';

const express = require('express');
const path = require('path');
const config = require('./config');
const { HttpError } = require('./lib/http');
const { loadSession, requireWorkspace } = require('./lib/auth');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    });
    if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // CSRF defence: state-changing API calls must carry a header that cross-site
  // forms cannot set (and CORS is not enabled).
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'BalayHub') {
      return next(new HttpError(403, 'Request blocked.', { code: 'CSRF' }));
    }
    next();
  });
  api.use(loadSession);
  api.get('/health', (req, res) => res.json({ ok: true }));
  api.use(require('./routes/auth'));
  api.use(requireWorkspace);
  api.use(require('./routes/team'));
  api.use(require('./routes/properties'));
  api.use(require('./routes/tenants'));
  api.use(require('./routes/money'));
  api.use(require('./routes/maintenance'));
  api.use(require('./routes/reports'));
  api.use(require('./routes/files'));
  api.use((req, res, next) => next(new HttpError(404, 'Not found.', { code: 'NOT_FOUND' })));
  app.use('/api', api);

  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') err = new HttpError(413, 'That file or request is too large (max 10 MB).', { code: 'TOO_LARGE' });
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Malformed request.', { code: 'BAD_REQUEST' });
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Your data was not changed. Please try again.', code: 'SERVER_ERROR' });
  });
  return app;
}

module.exports = { createApp };
