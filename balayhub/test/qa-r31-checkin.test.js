'use strict';
require('./helpers');

// Round 31 (CHECKIN, GST-1, D-113): the guest ID photo is checked by its first bytes in the form's one pass, and a photo the
// server still refuses after the answers were saved is said on the ID photo box, not in the banner.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/checkin.js'), 'utf8');
const submit = src.slice(src.indexOf("form.addEventListener('submit'"), src.indexOf('// ---------------------------------------------------------------- host: card'));

test('imports fileContentError and fileRefused', () => {
  assert.match(src, /import \{[^}]*fileContentError[^}]*\} from '\.\.\/api\.js'/);
  assert.match(src, /import \{[^}]*fileRefused[^}]*\} from '\.\.\/ui\.js'/);
});

test('the content check runs after the type check, before anything is posted, into problems.id_photos', () => {
  const empty = submit.indexOf('f.size === 0');
  const type = submit.indexOf('ID_PHOTO_TYPE.test');
  const content = submit.indexOf('await fileContentError(f, PHOTO_KINDS)');
  assert.ok(empty > -1 && type > empty && content > type, 'empty, then type, then content');
  assert.ok(content < submit.indexOf('await post('), 'content check precedes the save');
  assert.match(submit, /const bad = await fileContentError\(f, PHOTO_KINDS\); if \(bad\) \{ problems\.id_photos = t\(bad\); break; \}/);
  assert.ok(submit.indexOf('f.size === 0') < submit.indexOf('shrinkImage(f)'), 'empty check before shrinkImage');
});

test('a refused photo after the draft was saved goes on the ID box with no error banner', () => {
  assert.match(submit, /const photoRefused = savedDraft && fileRefused\(err\);/);
  const branch = submit.slice(submit.indexOf('if (photoRefused)'));
  const body = branch.slice(0, branch.indexOf('return;'));
  assert.match(body, /formError\.replaceChildren\(h\('div', \{ class: 'alert alert--warn' \}, draftNote\)\)/);
  assert.match(body, /showErrors\(form, \{ id_photos: tServer\(err\.message\) \}\)/);
  assert.doesNotMatch(body, /alert--error/);
  assert.ok(submit.indexOf('if (photoRefused)') < submit.indexOf('formError.append('), 'branch precedes the banner');
});

test('the two Taglish lines exist', () => {
  assert.ok(src.includes(`"This file isn't a real JPG, PNG or WEBP. Choose the file again.": 'Hindi totoong JPG, PNG o WEBP ang file na ito. Piliin ulit ang file.',`));
  assert.ok(src.includes(`'Upload a photo (JPG, PNG or WEBP) up to 10 MB.': 'Mag-upload ng litrato (JPG, PNG o WEBP) na hanggang 10 MB.',`));
});
