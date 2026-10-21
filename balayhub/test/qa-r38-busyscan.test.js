'use strict';
require('./helpers');
// QA round 38, BUSYSCAN (class guard for D-120). A control that is pressed and then waits for a request is marked
// `aria-disabled`, never `disabled`: a disabled control drops focus to the page while it waits (D-97, D-105, D-120).
// Rule: every `<expr>.disabled = true` under public/js whose innermost async function has an `await` after the statement
// (in that function's own code) is flagged. Only an async function can wait, so the innermost async function is the handler;
// a sync callback inside it counts against the handler (pay.js's forEach shape).
// Allow-list: the two entries in STRATEGY section 2 only. A new entry needs a reason line and the orchestrator's approval.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DISABLED_ALLOWLIST = [
  { file: 'views/book.js', text: 'submit.disabled = true;', reason: 'Continue waits for a fresh quote; focus is in the date or guest box, D-118' },
  { file: 'views/pay.js', text: "form.querySelectorAll('[name]').forEach((el) => { el.disabled = true; });", reason: 'the detail fields lock after the details are saved; focus is on Send' },
];

const ID = /[\w$]/;
const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]/;
const REGEX_KW = /(?:^|[^\w$.])(?:return|typeof|case|do|else|in|of|void|delete|throw|new|yield|await)$/;

// Blank out comments, strings, template text and regex literals (keeping newlines, so offsets and lines match).
// Code inside `${ ... }` of a template literal is kept: an await or a disabled assignment there is real code.
function mask(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const stack = []; // 'brace' | 'tpl' (a `${` waiting for its `}`)
  let i = 0, prev = ''; // prev = last significant (non-space) code char
  const prevWordEnd = (at) => src.slice(Math.max(0, at - 12), at).trimEnd();
  function template() { // i is just after the opening backtick; returns when the closing backtick is reached or a `${` begins
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { blank(start, i); i++; prev = '`'; return false; }
      if (c === '$' && src[i + 1] === '{') { blank(start, i + 2); i += 2; stack.push('tpl'); prev = '{'; return true; }
      i++;
    }
    blank(start, i); return false;
  }
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      const s = i; i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++; blank(s, i); prev = c; continue;
    }
    if (c === '`') { i++; template(); continue; }
    if (c === '/') {
      const before = prevWordEnd(i);
      const isRegex = prev === '' || REGEX_PREV.test(prev) || REGEX_KW.test(before);
      if (isRegex) {
        const s = i; i++; let cls = false;
        while (i < src.length && src[i] !== '\n') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
          else if (src[i] === '/' && !cls) break;
          i++;
        }
        i++; while (i < src.length && ID.test(src[i])) i++; // flags
        blank(s, i); prev = '/'; continue;
      }
    }
    if (c === '{') { stack.push('brace'); prev = c; i++; continue; }
    if (c === '}') {
      const top = stack.pop();
      if (top === 'tpl') { blank(i, i + 1); i++; template(); continue; }
      prev = c; i++; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

function matchClose(m, i, open, close) { // m = masked text; i at `open`
  let d = 0;
  for (let k = i; k < m.length; k++) {
    if (m[k] === open) d++;
    else if (m[k] === close) { d--; if (d === 0) return k; }
  }
  return m.length;
}

function lineOf(src, at) { return src.slice(0, at).split('\n').length; }

// Every async function, method or arrow: { param, bodyStart, bodyEnd, at } (same finder as qa-r37-awaitscan).
function asyncFunctions(m) {
  const found = [];
  const re = /\basync\b/g;
  let hit;
  while ((hit = re.exec(m))) {
    if (m[hit.index - 1] === '.' || ID.test(m[hit.index - 1] || ' ')) continue;
    let i = hit.index + 5;
    const ws = () => { while (/\s/.test(m[i] || '')) i++; };
    ws();
    let param = null, paramsOpen = -1, paramsClose = -1;
    const fn = /^function\b/.exec(m.slice(i, i + 9));
    if (fn) { i += 8; ws(); if (m[i] === '*') { i++; ws(); } while (ID.test(m[i] || ' ')) i++; ws(); }
    else if (m[i] === '*') { i++; ws(); while (ID.test(m[i] || ' ')) i++; ws(); } // async *gen(e)
    if (m[i] === '(') { paramsOpen = i; paramsClose = matchClose(m, i, '(', ')'); }
    else if (ID.test(m[i] || ' ')) {
      const s = i; while (ID.test(m[i] || ' ')) i++;
      const word = m.slice(s, i); ws();
      if (m.slice(i, i + 2) === '=>') { param = word; paramsOpen = s - 1; paramsClose = s + word.length; } // async e => ...
      else if (m[i] === '(') { paramsOpen = i; paramsClose = matchClose(m, i, '(', ')'); } // async name(e) { ... } method
      else continue;
    } else continue;
    if (param === null) {
      const inner = m.slice(paramsOpen + 1, paramsClose);
      const first = /^\s*([A-Za-z_$][\w$]*)\s*(?:[,=)]|$)/.exec(inner + ')');
      param = first ? first[1] : null;
    }
    let j = paramsClose + 1;
    while (/\s/.test(m[j] || '')) j++;
    if (m.slice(j, j + 2) === '=>') { j += 2; while (/\s/.test(m[j] || '')) j++; }
    let bodyStart, bodyEnd;
    if (m[j] === '{') { bodyStart = j; bodyEnd = matchClose(m, j, '{', '}'); }
    else { // expression-bodied arrow: runs to the first depth-0 , ) ] } ;
      bodyStart = j; let d = 0, k = j;
      for (; k < m.length; k++) {
        const c = m[k];
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) { if (d === 0) break; d--; }
        else if ((c === ',' || c === ';') && d === 0) break;
      }
      bodyEnd = k;
    }
    found.push({ param, bodyStart, bodyEnd, at: hit.index });
  }
  return found;
}

// Returns [{ line, text, handlerLine }] for each `<expr>.disabled = true` whose innermost async function has an await after it.
function scanDisabledSource(src) {
  const m = mask(src);
  const fns = asyncFunctions(m);
  const innermost = (pos) => {
    let best = null;
    for (const f of fns) if (f.bodyStart < pos && pos < f.bodyEnd && (!best || f.bodyStart > best.bodyStart)) best = f;
    return best;
  };
  const awaits = [...m.matchAll(/(?<![\w$.])await\b/g)].map((a) => a.index);
  const hits = [];
  for (const d of m.matchAll(/\.\s*disabled\s*=\s*true\b/g)) {
    const at = d.index;
    const fn = innermost(at);
    if (!fn) continue;
    if (!awaits.some((q) => q > at && innermost(q) === fn)) continue;
    const line = lineOf(src, at);
    hits.push({ line, text: src.split('\n')[line - 1].trim(), handlerLine: lineOf(src, fn.at) });
  }
  return hits;
}

function walk(dir) {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(p));
    else if (e.name.endsWith('.js')) files.push(p);
  }
  return files.sort();
}

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');

// Fixtures: each runs the scanner on a snippet. They pin the rule itself, so the tree scan below cannot pass by accident.
test('scanner flags a disabled = true that is followed by an await in the same handler (the PHN-2 composer shape)', () => {
  const src = [
    'const composer = { onsubmit: async (e) => {',
    '  e.preventDefault();',
    '  if (busy) return;',
    '  busy = true;',
    '  sendBtn.disabled = true;',
    '  try {',
    '    const r = await post(`/inbox/${id}/messages`, payload);',
    '  } catch (ex) { err.textContent = ex.message; }',
    '  finally { busy = false; sendBtn.disabled = false; }',
    '} };',
  ].join('\n');
  const hits = scanDisabledSource(src);
  assert.strictEqual(hits.length, 1, JSON.stringify(hits));
  assert.strictEqual(hits[0].line, 5);
  assert.strictEqual(hits[0].text, 'sendBtn.disabled = true;');
});

test('scanner flags the minimal shape: btn.disabled = true, then await', () => {
  assert.strictEqual(scanDisabledSource('async () => { btn.disabled = true; await post(\'/x\'); }').length, 1);
});

test('scanner accepts the fixed shape: aria-disabled while the request is pending', () => {
  assert.deepStrictEqual(scanDisabledSource("async () => { btn.setAttribute('aria-disabled', 'true'); await post('/x'); }"), []);
});

test('scanner accepts a disabled assignment of anything other than true (state, e.g. cleaner pager)', () => {
  assert.deepStrictEqual(scanDisabledSource('() => { next.disabled = month >= thisMonth; }'), []);
  assert.deepStrictEqual(scanDisabledSource("async () => { btn.disabled = false; await post('/x'); }"), []);
  assert.deepStrictEqual(scanDisabledSource('async () => { if (btn.disabled == true) return; await post(\'/x\'); }'), []);
});

test('scanner accepts disabled = true with no await after it in its own function', () => {
  assert.deepStrictEqual(scanDisabledSource("async () => { await a(); btn.disabled = true; }"), []);
});

test('scanner ignores disabled = true inside a comment or a template literal', () => {
  const src = [
    'async () => {',
    '  // btn.disabled = true;',
    '  /* other.disabled = true; */',
    '  const s = `text.disabled = true`;',
    "  const q = 'quoted.disabled = true';",
    "  await post('/x');",
    '}',
  ].join('\n');
  assert.deepStrictEqual(scanDisabledSource(src), []);
});

test('scanner ignores disabled true inside an object literal property', () => {
  assert.deepStrictEqual(scanDisabledSource("async () => { const o = { disabled: true }; await post('/x'); }"), []);
});

test('scanner counts a sync callback inside an async handler against the handler (the pay.js forEach shape)', () => {
  const hits = scanDisabledSource('async () => { items.forEach((el) => { el.disabled = true; }); await post(\'/x\'); }');
  assert.strictEqual(hits.length, 1);
});

test('scanner judges an async callback by its own awaits, not the outer function (no await in the callback, so no flag)', () => {
  assert.deepStrictEqual(scanDisabledSource('async function f() { items.forEach(async (el) => { el.disabled = true; }); await b(); }'), []);
});

test('allow-list is exactly the two STRATEGY section 2 entries, each with a reason', () => {
  assert.deepStrictEqual(DISABLED_ALLOWLIST.map((a) => `${a.file} | ${a.text}`), [
    "views/book.js | submit.disabled = true;",
    "views/pay.js | form.querySelectorAll('[name]').forEach((el) => { el.disabled = true; });",
  ]);
  for (const a of DISABLED_ALLOWLIST) assert.ok(a.reason && a.reason.length > 10, `reason missing for ${a.file}`);
});

test('no control under public/js is disabled while its own request waits (busy controls use aria-disabled)', () => {
  assert.ok(walk(PUBLIC_JS).length > 20, 'expected the whole public/js tree');
  const bad = [];
  for (const f of walk(PUBLIC_JS)) {
    const rel = path.relative(PUBLIC_JS, f).split(path.sep).join('/');
    for (const h of scanDisabledSource(fs.readFileSync(f, 'utf8'))) {
      const allowed = DISABLED_ALLOWLIST.some((a) => a.file === rel && a.text === h.text);
      if (!allowed) bad.push(`${rel}:${h.line} ${h.text} (waits after it in the handler at line ${h.handlerLine})`);
    }
  }
  assert.deepStrictEqual(bad, [], `a pressed control must keep focus while it waits: set aria-disabled, not disabled (D-120). Sites:\n${bad.join('\n')}`);
});

test('the scan sees the async handlers in the tree (not vacuous)', () => {
  let withAwait = 0;
  for (const f of walk(PUBLIC_JS)) {
    const m = mask(fs.readFileSync(f, 'utf8'));
    for (const fn of asyncFunctions(m)) {
      if (/\bawait\b/.test(m.slice(fn.bodyStart, fn.bodyEnd))) withAwait++;
    }
  }
  assert.ok(withAwait >= 50, `only ${withAwait} async functions with an await found`);
});
