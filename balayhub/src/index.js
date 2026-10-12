'use strict';

const config = require('./config');
const { migrate } = require('../scripts/migrate');
const { createApp } = require('./server');

migrate()
  .then(() => {
    createApp().listen(config.port, () => console.log(`BalayHub running at ${config.appUrl}`));
    // Pull Airbnb / Booking.com / Agoda calendars every 30 minutes.
    const { syncAllFeeds } = require('./lib/ical');
    setInterval(() => { syncAllFeeds().catch((err) => console.error('[ical]', err.message)); }, 30 * 60 * 1000).unref();
    setTimeout(() => { syncAllFeeds().catch(() => {}); }, 60 * 1000).unref();
  })
  .catch((err) => { console.error('Failed to start:', err); process.exit(1); });
