'use strict';
// Production compose must pass the card-on-file settings to the app container.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'docker-compose.prod.yml'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');

// Lines of the app service's environment block only.
function appEnvNames() {
  const lines = compose.split('\n');
  const start = lines.findIndex((l) => /^  app:\s*$/.test(l));
  const envAt = lines.findIndex((l, i) => i > start && /^    environment:\s*$/.test(l));
  const names = [];
  for (let i = envAt + 1; i < lines.length; i++) {
    const m = /^      ([A-Z][A-Z0-9_]*):/.exec(lines[i]);
    if (m) names.push(m[1]); else if (!/^\s*$/.test(lines[i])) break;
  }
  return names;
}

test('config.js reads the card-on-file variables', () => {
  for (const n of ['PAYMONGO_PUBLIC_KEY', 'CARD_CHECK', 'PAYMONGO_SUBSCRIPTIONS']) {
    assert.ok(new RegExp(`env\\.${n}\\b`).test(config), `${n} not read in config.js`);
  }
});

test('docker-compose.prod.yml passes the card-on-file variables to the app', () => {
  const names = appEnvNames();
  assert.ok(names.length > 10, 'app environment block not parsed');
  for (const n of ['PAYMONGO_PUBLIC_KEY', 'CARD_CHECK', 'PAYMONGO_SUBSCRIPTIONS']) {
    assert.ok(names.includes(n), `${n} missing from app environment`);
  }
});

test('docker-compose.prod.yml does not pass the test-only PAYMONGO_BROWSER_API', () => {
  assert.ok(!appEnvNames().includes('PAYMONGO_BROWSER_API'));
  assert.ok(!/PAYMONGO_BROWSER_API/.test(compose));
});
