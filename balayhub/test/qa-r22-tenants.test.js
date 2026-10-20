'use strict';

// QA r22 TENANTS (PHN-1): the top bar's ?new=1 must open the Add tenant dialog AFTER the page is drawn. Opened synchronously,
// the dialog is closed (Escape) before the heading exists, so focus falls to the page body. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/tenants.js'), 'utf8');

test('?new=1 opens the tenant dialog in a setTimeout guarded by el.isConnected', () => {
  const m = src.match(/if \(query\?\.new && canManage\) \{[^\n]*\}/);
  assert.ok(m, 'the ?new=1 line exists');
  assert.match(m[0], /delete query\.new/);
  assert.match(m[0], /setTimeout\(\(\) => \{ if \(el\.isConnected\) newTenantModal\(\{ onSaved: \(\) => load\(\) \}\); \}, 0\)/);
  assert.doesNotMatch(m[0].replace(/setTimeout\([\s\S]*$/, ''), /newTenantModal/, 'not opened synchronously');
});
