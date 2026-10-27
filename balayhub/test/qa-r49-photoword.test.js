'use strict';
require('./helpers');

// QA round 49, PHOTOWORD (GST49-1, D-131). A photo-only box (check-in ID, cleaning photos, listing photos)
// names only JPG, PNG or WEBP when it refuses a renamed file; the boxes that take PDF keep the PDF sentence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PDF_S = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const PHOTO_S = "This file isn't a real JPG, PNG or WEBP. Choose the file again.";
const PHOTO_TL = 'Hindi totoong JPG, PNG o WEBP ang file na ito. Piliin ulit ang file.';
const src = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
let api;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-photoword49-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, '../public/js/api.js'), path.join(dir, 'api.js'));
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
});

test('a renamed text file: the default sentence names PDF, PHOTO_KINDS names only the photo kinds', async () => {
  const f = new File(['just words'], 'a.png', { type: 'image/png' });
  assert.equal(await api.fileContentError(f), PDF_S);
  assert.equal(api.PHOTO_KINDS, 'JPG, PNG or WEBP');
  assert.equal(await api.fileContentError(f, api.PHOTO_KINDS), PHOTO_S);
});

test('check-in ID box passes PHOTO_KINDS and has the Taglish line', () => {
  const s = src('views/checkin.js');
  assert.match(s, /import \{[^}]*\bPHOTO_KINDS\b[^}]*\} from '\.\.\/api\.js'/);
  assert.ok(s.includes('fileContentError(f, PHOTO_KINDS)'));
  assert.ok(s.includes(`"${PHOTO_S}": '${PHOTO_TL}'`));
  assert.ok(!s.includes(PDF_S));
});

test('housekeeping photoCheck and the upload mapping say the photo sentence', () => {
  const s = src('views/housekeeping.js');
  assert.match(s, /import \{[^}]*\bPHOTO_KINDS\b[^}]*\} from '\.\.\/api\.js'/);
  assert.ok(s.includes('fileContentError(file, PHOTO_KINDS)'));
  assert.ok(s.includes(`"${PHOTO_S}": '${PHOTO_TL}'`));
  assert.ok(s.includes(`T("${PHOTO_S}")`));
  assert.ok(!s.includes(PDF_S));
});

test('listing photo upload passes PHOTO_KINDS', () => {
  const s = src('views/listings.js');
  assert.match(s, /import \{[^}]*\bPHOTO_KINDS\b[^}]*\} from '\.\.\/api\.js'/);
  assert.ok(s.includes('fileContentError(f, PHOTO_KINDS)'));
});

test('boxes that take PDF keep the default', () => {
  for (const f of ['views/pay.js', 'views/rent.js', 'views/help.js', 'views/maintenance.js', 'views/tenants.js']) {
    if (fs.existsSync(path.join(__dirname, '../public/js', f))) assert.ok(!src(f).includes('PHOTO_KINDS'), f);
  }
});
