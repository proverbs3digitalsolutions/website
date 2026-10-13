'use strict';

const express = require('express');
const path = require('path');
const config = require('./config');
const { HttpError } = require('./lib/http');
const { loadSession, requireWorkspace, planGuard } = require('./lib/auth');

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
  api.use(planGuard);
  // For uptime monitors: also checks the database.
  api.get('/health', async (req, res) => {
    try { await require('./db').query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false, error: 'database unavailable' }); }
  });
  api.use(require('./routes/auth'));
  api.use(require('./routes/google'));
  api.use(require('./routes/admin'));
  api.use(require('./routes/account').router);
  api.use(require('./routes/checkin').publicRouter);
  api.use(requireWorkspace);
  api.use(require('./routes/team'));
  api.use(require('./routes/properties'));
  api.use(require('./routes/tenants'));
  api.use(require('./routes/money'));
  api.use(require('./routes/maintenance'));
  api.use(require('./routes/reports'));
  api.use(require('./routes/files'));
  api.use(require('./routes/stays'));
  api.use(require('./routes/inbox'));
  api.use(require('./routes/housekeeping'));
  api.use(require('./routes/onboarding'));
  api.use(require('./routes/checkin').router);
  api.use(require('./routes/billing').router);
  api.use(require('./routes/account').workspaceRouter);
  api.use((req, res, next) => next(new HttpError(404, 'Not found.', { code: 'NOT_FOUND' })));
  // PayMongo webhook: raw body (for its signature), no session or CSRF header.
  app.post('/api/public/paymongo/webhook', express.raw({ type: '*/*', limit: '200kb' }),
    (req, res, next) => require('./routes/billing').webhook(req, res).catch(next));
  app.use('/api', api);
  // Private-by-token calendar feeds that Airbnb, Booking.com and Agoda poll.
  app.use(require('./routes/stays').publicRouter);

  // App code (html/js/css) is revalidated on every load (cheap 304s via ETag) so
  // updates reach users immediately; fonts and images may be cached for a day.
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    index: 'index.html',
    setHeaders(res, filePath) {
      res.set('Cache-Control', /\.(html|js|css)$/.test(filePath) ? 'no-cache' : 'public, max-age=86400');
    },
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') err = new HttpError(413, 'That file or request is too large (max 10 MB).', { code: 'TOO_LARGE' });
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Malformed request.', { code: 'BAD_REQUEST' });
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    console.error(err);
    require('./lib/alerts').alert('server-error', 'A server error happened',
      `${req.method} ${req.originalUrl.split('?')[0]}\n${String(err.stack || err.message).split('\n').slice(0, 6).join('\n')}`).catch(() => {});
    res.status(500).json({ error: 'Something went wrong on our side. Your data was not changed. Please try again.', code: 'SERVER_ERROR' });
  });
  return app;
}

module.exports = { createApp };
