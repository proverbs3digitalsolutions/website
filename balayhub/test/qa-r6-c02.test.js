'use strict';
// QA round 6, lane C02 (housekeeping view). Render and wording fixes on the cleaning job and the board:
// #37 the board line reads "Passed · date" for a cleaner, who is sent no score; Passed, Failed and the
//     Inspections heading go through T(), so cleaners get Taglish.
// #18 "Copy for cleaner" is not offered on a cancelled job.
// N1  "Inspect" is not offered on a paid clean, the same rule as Reopen (the server refuses it, PAID 409).
// N2  the photo file input is named "Choose a photo", not the same name as the Upload photo button.
// #19 the Photos card says "No photos yet." itself, and a photo refused for type or size says what to send, in Taglish.
// The view imports browser modules, so its helpers are run from their own source, as in qa-r5-c11.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/housekeeping.js'), 'utf8');

function pureHelpers(names) {
  const code = names.map((n) => {
    const m = src.match(new RegExp(`export function ${n}\\([\\s\\S]*?\\n}\\n`));
    assert.ok(m, `${n} is an exported helper of the view`);
    return m[0].replace('export ', '');
  }).join('\n');
  return new Function(`${code}\nreturn { ${names.join(', ')} };`)();
}

// The view's own Taglish table: the extendTranslations block at the top of the file.
const dictSrc = src.match(/extendTranslations\((\{[\s\S]*?\n\})\);/);
assert.ok(dictSrc, 'the view has its own Taglish table');
const dict = new Function(`return ${dictSrc[1]};`)();

// i18n.js run from its own source with its browser import stubbed, so t() is the real lookup a cleaner gets.
function loadI18n() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public/js/i18n.js'), 'utf8')
    .replace(/^import .*$/m, '').replace(/export /g, '');
  return new Function('h', 'manilaDay', 'document', 'localStorage', `${code}\nreturn { t, initGuestLang, extendTranslations };`)(
    () => null, () => '', { documentElement: {} }, { getItem: () => null, setItem() {} });
}

// #37: the board line is "88% · Failed · date" for an owner and "Passed · date" for a cleaner, who is sent no score.
test('the board line leaves out the score when the server sends none, and never prints undefined%', () => {
  const { metaLine } = pureHelpers(['metaLine']);
  assert.equal(metaLine(false, 'Passed', 'Oct 14, 2026'), 'Passed · Oct 14, 2026');
  assert.equal(metaLine('88%', 'Failed', 'Oct 14, 2026'), '88% · Failed · Oct 14, 2026');
  assert.doesNotMatch(src, /\$\{u\.last_inspection\.score\}% · /, 'the old line printed the score with no check, so a cleaner saw "undefined%"');
  assert.match(src, /u\.last_inspection && \[h\('dt', null, T\('Last inspection'\)\),/, 'no line at all when there is no inspection');
  assert.match(src, /metaLine\(u\.last_inspection\.score != null && `\$\{u\.last_inspection\.score\}%`, T\(u\.last_inspection\.passed \? 'Passed' : 'Failed'\), fmtDate\(manilaDay\(u\.last_inspection\.at\)\)\)/);
});

// #37: Passed, Failed and the Inspections heading are read through T(), so a cleaner sees them in her language.
test('the board line, the inspection badge and the Inspections heading go through T()', () => {
  assert.match(src, /T\(u\.last_inspection\.passed \? 'Passed' : 'Failed'\)/);
  assert.match(src, /badge\(i\.passed \? 'paid' : 'overdue', T\(i\.passed \? 'Passed' : 'Failed'\)\)/);
  assert.match(src, /h\('h2', null, T\('Inspections'\)\)/);
});

// #18: Copy for cleaner hands over a clean that is still to do, so it is offered only on an open clean (QA round 12, #35: not on a finished or cancelled one).
test('Copy for cleaner is offered only on an open clean', () => {
  assert.match(src, /isManager && open && h\('button', \{ class: 'btn btn--secondary', onclick: \(\) => copyText\(taskText\(t\)\) \}, 'Copy for cleaner'\)/);
});

// N1: Inspect is not offered on a paid clean, the same rule as Reopen (canReopen reads isPaidClean too).
test('Inspect is not offered on a paid clean, the same rule as Reopen', () => {
  assert.match(src, /isManager && t\.status === 'done' && t\.checklist\.length > 0 && !isPaidClean\(t\) && h\('button', \{ class: 'btn btn--primary', onclick: \(\) => inspectModal\(t, rerender\) \}, 'Inspect'\)/);
  const { isPaidClean } = pureHelpers(['isPaidClean']);
  assert.equal(isPaidClean({ is_paid: true, pay_status: null }), true);
  assert.equal(isPaidClean({ pay_status: 'paid' }), true, 'an older response is read through pay_status');
  assert.equal(isPaidClean({ is_paid: false, pay_status: null }), false);
});

// N2 (R16 #36): picking a photo uploads it at once, so the input is named "Add photo" and there is no Upload photo button.
test('the photo file input is named Add photo and uploads on change; no Upload photo button', () => {
  assert.match(src, /const upload = h\('input', \{\s*type: 'file'[^\n]*'aria-label': T\('Add photo'\)/);
  assert.doesNotMatch(src, /T\('Upload photo'\)/);
});

// #19: the shared filesList() prints "No attachments yet."; the Photos card words its own empty state instead.
test('the Photos card says No photos yet. itself when it is empty', () => {
  assert.match(src, /files\?\.length \? filesList\(files\) : h\('p', \{ class: 'muted small' \}, T\('No photos yet\.'\)\)/);
});

// #19: a photo refused for type (UNSUPPORTED_FILE) or size (413, the client's 10 MB check) says what to send.
test('a photo refused for type or size says what to send, in the workspace language', () => {
  assert.match(src, /const msg = err\.code === 'EMPTY_FILE' \? T\('This file is empty\. Choose the file again\.'\) : err\.code === 'BAD_FILE_CONTENT' \|\| err\.message === "The file content doesn't match its type\." \? T\("This file isn't a real PDF, JPG, PNG or WEBP\. Choose the file again\."\) : err\.code === 'UNSUPPORTED_FILE' \|\| err\.status === 413 \? T\('Upload a JPG, PNG or WEBP photo up to 10 MB\.'\) : err\.message; if \(fileRefused\(err\) \|\| err\.message === "The file content doesn't match its type\."\) up\.show\(msg\); else toast\(err\.message, 'error'\)/);
});

// #37, #19 and N2: the new and reused strings are Taglish for cleaners, and t() returns that wording.
test('the new cleaner-facing strings have Taglish wording, and t() returns it for a cleaner', () => {
  const i18n = loadI18n();
  i18n.extendTranslations(dict);
  i18n.initGuestLang('tl');
  const expected = {
    Passed: 'Pasado',
    Failed: 'Hindi pasado',
    Inspections: 'Mga inspection',
    'Choose a photo': 'Pumili ng litrato',
    'No photos yet.': 'Wala pang litrato.',
    'Upload a JPG, PNG or WEBP photo up to 10 MB.': 'Mag-upload ng JPG, PNG o WEBP na litrato, hanggang 10 MB.',
    'Photo uploaded.': 'Na-upload na ang litrato.',
    'Add photo': 'Magdagdag ng litrato',
  };
  for (const [en, tl] of Object.entries(expected)) assert.equal(i18n.t(en), tl, en);
});

// Every T() string in the view has a Taglish entry in the view's own table, so no cleaner-facing text falls back to English.
test('every T() string in the housekeeping view has a Taglish entry', () => {
  const literals = [...src.matchAll(/\bT\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
  const missing = [...new Set(literals)].filter((k) => !(k in dict));
  assert.deepEqual(missing, []);
});
