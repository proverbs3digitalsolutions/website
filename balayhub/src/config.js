'use strict';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const config = {
  isProd,
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://balayhub:balayhub@localhost:5432/balayhub',
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  storageDir: env.STORAGE_DIR || require('path').join(__dirname, '..', 'storage'),
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'BalayHub <no-reply@balayhub.local>',
  // When true, users must click the emailed link before using the app.
  requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION !== 'false',
  // Dev convenience: return verification/reset links in API responses.
  // Never enabled in production.
  exposeDevLinks: !isProd && env.EXPOSE_DEV_LINKS !== 'false',
  sessionTtlHours: Number(env.SESSION_TTL_HOURS || 24 * 7),
  sessionIdleHours: Number(env.SESSION_IDLE_HOURS || 12),
  maxUploadBytes: 10 * 1024 * 1024,
  // Number of reverse-proxy hops to trust for client IPs (0 = none). Set to 1 behind a single HTTPS proxy.
  trustProxy: Number(env.TRUST_PROXY || 0),
  // Sign in with Google (OAuth). Both must be set for the button to appear.
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
  // Inbox: guest replies go to INBOUND_ADDRESS with a "+bh-<token>" tag (defaults to the
  // MAIL_FROM address; Gmail and most providers support plus-addressing). IMAP_URL lets
  // BalayHub read those replies, e.g. imaps://you%40domain.com:APP_PASSWORD@imap.gmail.com:993
  inboundAddress: env.INBOUND_ADDRESS || ((/<([^>]+)>/.exec(env.MAIL_FROM || '') || [])[1] || ''),
  imapUrl: env.IMAP_URL || '',
  // AI reply drafts (optional).
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  aiModel: env.AI_MODEL || 'claude-haiku-5-5',
  // Comma-separated emails allowed to open the platform admin page (plans/trials).
  platformAdmins: (env.PLATFORM_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  trialDays: Number(env.TRIAL_DAYS || 14),
  salesContactEmail: env.SALES_CONTACT_EMAIL || '',
  vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: env.VAPID_PRIVATE_KEY || '',
  dataEncryptionKey: env.DATA_ENCRYPTION_KEY || '',
  paymongoSecretKey: env.PAYMONGO_SECRET_KEY || '',
  paymongoWebhookSecret: env.PAYMONGO_WEBHOOK_SECRET || '',
  paymongoMethods: (env.PAYMONGO_METHODS || 'gcash,paymaya,card,grab_pay').split(',').map((x) => x.trim()).filter(Boolean),
  guestIdRetentionDays: Number(env.GUEST_ID_RETENTION_DAYS || 30),
  privacyPolicyVersion: '2026-10-01',
  termsVersion: '2026-10-13',
  timezone: 'Asia/Manila',
};

if (isProd && !config.smtpUrl && config.requireEmailVerification) {
  console.warn('[balayhub] SMTP_URL is not set: verification and reset emails cannot be delivered.');
}

module.exports = config;
