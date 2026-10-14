// QA round 8, lane C33 (checkin-view): a server field error sits at its field once. The banner names only
// the messages that have no field on the form, or the generic sentence. Each guest's Remove button names
// its guest. Frontend source scan only (the test runner has no DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'checkin.js'), 'utf8');

// The catch block of the submit handler: the first one after the registration POST.
const catchBlock = () => {
  const post = src.indexOf('await post(`/public/checkin/');
  const start = src.indexOf('} catch (err) {', post);
  return src.slice(start, src.indexOf('} finally {', start));
};

test('a server field error sits at its field, and the banner names only the messages with no field', () => {
  const block = catchBlock();
  // showErrors places each message at its field and returns the ones with no field on the form.
  assert.match(block, /const unplaced = err\.fields \? showErrors\(form, tFields\(err\.fields\)\) : \[\];/);
  // The banner: the unplaced messages only; else the generic sentence when fields exist; else the server sentence.
  assert.match(block, /unplaced\.length \? unplaced\.join\(' '\)/);
  assert.match(block, /Object\.keys\(err\.fields \|\| \{\}\)\.length \? t\('Please check the highlighted fields\.'\)/);
  // The old code showed the joined field messages in the banner and placed them at their fields again.
  assert.doesNotMatch(block, /if \(err\.fields\) showErrors/);
});

test('offline, plain-error and server-only messages keep their banner', () => {
  const block = catchBlock();
  assert.match(block, /err\.offline \?/);
  assert.match(block, /err\.message \|\| t\('Something went wrong\. Please try again\.'\)/);
  assert.match(block, /: tServer\(err\.message\)/);
});

test('every guest Remove button names its guest, and renumbering renames it with its input', () => {
  assert.doesNotMatch(src, /'aria-label': t\('Remove'\)/);
  assert.match(src, /'aria-label': t\('Remove guest \{n\}', \{ n: others\.children\.length \+ 2 \}\)/);
  assert.match(src, /setAttribute\('aria-label', t\('Remove guest \{n\}', \{ n: i \+ 2 \}\)\)/);
});

test('the new Remove wording has a Taglish entry on the page', () => {
  assert.match(src, /'Remove guest \{n\}': 'Alisin ang guest \{n\}'/);
});
