'use strict';

const config = require('./config');
const { migrate } = require('../scripts/migrate');
const { createApp } = require('./server');

migrate()
  .then(() => {
    createApp().listen(config.port, () => console.log(`BalayHub running at ${config.appUrl}`));
    require('./lib/scheduler').startScheduler();
  })
  .catch((err) => { console.error('Failed to start:', err); process.exit(1); });
