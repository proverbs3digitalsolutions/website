'use strict';
require('./helpers');
// QA round 39, BUSYSCAN2 (class guard for D-121: the second shape of D-120's class). A press that starts a request waits for
// it with its own mark: the control is marked aria-disabled (dimmed, still focused) and a second press does nothing (D-97,
// D-105, D-120). BUSYSCAN (round 38) only looked for `.disabled = true`, so it could not see two shapes: a handler that drops
// the promise of its request (no await, no return), and a control whose handler is not an onclick on a button (select, check
// box, input, submit, drop), which the press guard in ui.js h() cannot reach.
// Rules (STRATEGY round 39, section 2, lane 12):
//   U   a write (post, patch, uploadFile, api with a write verb, or a same-file async function that awaits or returns one)
//       called as a statement, so nothing awaits or returns its promise.
//   U2  a statement call to a same-file async helper that is passed a write (the inbox Snooze shape), unless the helper
//       marks its control aria-disabled itself before it waits (the help.js act(e, ...) shape).
//   B   a handler on onchange, oninput, onsubmit, ondrop, onkeydown (any lowercase on* prop but onclick) or addEventListener,
//       or a named same-file write function wired to one, that waits for a write before it marks aria-disabled (or calls busy()).
//   A2  an onclick async handler that waits for a write on an h() call whose tag is not 'button' (the guard covers buttons).
//   G   ui.js keeps the guard: h() routes a button onclick through pressGuard, and confirmDialog marks its confirm button
//       aria-disabled, never aria-busy.
// Allow-list: rule U only, exact entries. A new entry needs a reason line and the orchestrator's approval.
// The scan root is public/js. R39_BUSYSCAN2_ROOT overrides it for the proof runs only (a scratch copy of public/js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

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


// The round 38 helpers above are copied unchanged from test/qa-r38-busyscan.test.js (lines 19-136). Round 39 adds the rules.
const PUBLIC_JS = process.env.R39_BUSYSCAN2_ROOT || path.join(__dirname, '..', 'public', 'js');

// Rule U allow-list (exact). Each entry: the file, the callee, a text the flagged line must contain, and why it is not a press.
const ALLOWLIST = [
  { file: 'app.js', callee: 'logout', contains: 'sheet.close(); logout();', reason: 'the More sheet closes first, then the page leaves' },
  { file: 'views/calendar.js', callee: 'moveBar', contains: 'if (ok()) moveBar(', reason: 'a drag-move drop, not a press; D-120 ruled drag focus' },
  { file: 'views/cardcheck.js', callee: 'waitForBank', contains: 'waitForBank(query.check);', reason: 'the bank wait starts on page load, not on a press' },
  { file: 'topnotify.js', callee: 'post', contains: '/account/notifications/read', reason: 'marks a notification read while its link opens a page' },
  { file: 'views/book.js', callee: 'post', contains: '/public/book/cancel/', reason: 'releases held dates on return from the payment page' },
];

const WRITE_NAMES = ['post', 'patch', 'uploadFile'];
const API_WRITE = /^api\s*\(\s*'(POST|PATCH|PUT|DELETE)'/; // the verb is a string: read from the raw source
const ON_PROP = /(?<![\w$.])on(?!click\b)[a-z]+\s*:\s*$/; // h() props other than onclick (makeForm's onSubmit is camel case and is marked by ui.js)
const ADD_LISTENER = /addEventListener\([^()]*,\s*$/;

const escapeName = (n) => n.replace(/\$/g, '\\$');
const callsOf = (m, names) => (names.length ? [...m.matchAll(new RegExp(`(?<![\\w$.])(${names.map(escapeName).join('|')})\\s*\\(`, 'g'))] : []);

// A call is a write when it is post(), patch() or uploadFile(), or api() with a write verb.
function isWriteAt(src, name, at) {
  if (WRITE_NAMES.includes(name)) return true;
  return name === 'api' && API_WRITE.test(src.slice(at, at + 30));
}

// True when the call at `at` is a statement of its own, so its promise is dropped: the code before it does not await, return or
// use it (an arrow's expression body returns it).
function isStatementCall(m, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(m[k])) k--;
  const pc = m[k] || '';
  const back = m.slice(Math.max(0, k - 8), k + 1);
  if (/(await|return)$/.test(back)) return false;
  if (pc === '>' && m[k - 1] === '=') return false;
  return pc === ';' || pc === '{' || pc === '}' || pc === ')' || /(else|void)$/.test(back);
}

// Does the code in [from, to) mark its control busy before it waits: setAttribute('aria-disabled', ...) or the busy() helper?
function marksBefore(m, src, from, to) {
  for (const s of m.slice(from, to).matchAll(/\bsetAttribute\s*\(/g)) {
    if (/^setAttribute\s*\(\s*'aria-disabled'/.test(src.slice(from + s.index, from + s.index + 60))) return true;
  }
  return /(?<![\w$.])busy\s*\(\s*\)/.test(m.slice(from, to));
}

// Does the argument text [from, to) contain a write call (post, patch, uploadFile, or api with a write verb)?
function hasWriteIn(m, src, from, to) {
  for (const w of m.slice(from, to).matchAll(/(?<![\w$.])(post|patch|uploadFile|api)\s*\(/g)) {
    if (isWriteAt(src, w[1], from + w.index)) return true;
  }
  return false;
}

// The tag of the nearest h( call that encloses `at` ('?' when it is not a literal string).
function enclosingHTag(m, src, at) {
  for (let q = at; q > 0; q--) {
    if (m[q - 1] === '(' && m[q - 2] === 'h' && !/[\w$.]/.test(m[q - 3] || ' ')) {
      if (matchClose(m, q - 1, '(', ')') > at) return (/^'([\w-]+)'/.exec(src.slice(q, q + 20)) || [, '?'])[1];
    }
  }
  return '?';
}

// Scans one file. Returns findings { rule, file, line, callee, text }.
function scanSource(rel, src) {
  const m = mask(src);
  const fns = asyncFunctions(m);
  const found = [];
  const add = (rule, at, callee) => {
    const line = lineOf(src, at);
    found.push({ rule, file: rel, line, callee, text: src.split('\n')[line - 1].trim() });
  };
  const inner = (pos) => {
    let b = null;
    for (const fn of fns) if (fn.bodyStart < pos && pos < fn.bodyEnd && (!b || fn.bodyStart > b.bodyStart)) b = fn;
    return b;
  };
  const nameOf = (fn) => {
    const a = /(?:const|let)\s+([\w$]+)\s*=\s*$/.exec(m.slice(Math.max(0, fn.at - 80), fn.at));
    if (a) return a[1];
    const b = /^async\s+function\s+([\w$]+)/.exec(m.slice(fn.at, fn.at + 80));
    return b ? b[1] : null;
  };
  // The write sits in fn's own code and its promise is awaited or returned (or it is fn's whole expression body).
  const owned = (fn, at) => {
    if (at === fn.bodyStart) return true;
    if (inner(at) !== fn) return false;
    let k = at - 1;
    while (k >= 0 && /\s/.test(m[k])) k--;
    return /(await|return)$/.test(m.slice(Math.max(0, k - 6), k + 1));
  };

  const direct = callsOf(m, ['post', 'patch', 'uploadFile', 'api']).filter((c) => isWriteAt(src, c[1], c.index));
  const writeFns = new Map(); // name -> the same-file async function that awaits or returns a write
  let grew = true;
  while (grew) { // transitive: an async function that awaits a write function is a write function too
    grew = false;
    const calls = callsOf(m, [...writeFns.keys()]);
    for (const fn of fns) {
      const n = nameOf(fn);
      if (!n || writeFns.has(n)) continue;
      if (direct.some((c) => owned(fn, c.index)) || calls.some((c) => owned(fn, c.index))) {
        writeFns.set(n, fn);
        grew = true;
      }
    }
  }
  const isWrite = (name, at) => writeFns.has(name) || isWriteAt(src, name, at);
  const writeCalls = callsOf(m, ['post', 'patch', 'uploadFile', 'api', ...writeFns.keys()]).filter((c) => isWrite(c[1], c.index));

  // A helper that marks its control aria-disabled (or busy()) before its first await is self-marking.
  const selfMark = new Set();
  for (const fn of fns) {
    const n = nameOf(fn);
    if (!n) continue;
    const a = m.slice(fn.bodyStart, fn.bodyEnd).search(/(?<![\w$.])await\b/);
    if (marksBefore(m, src, fn.bodyStart, a < 0 ? fn.bodyEnd : fn.bodyStart + a)) selfMark.add(n);
  }

  // Rule U: a write called as a statement.
  for (const c of callsOf(m, ['post', 'patch', 'uploadFile', 'api', ...writeFns.keys()])) {
    if (!isWrite(c[1], c.index) || selfMark.has(c[1])) continue;
    if (isStatementCall(m, c.index)) add('U', c.index, c[1]);
  }

  // Rule U2: a statement call to a same-file async helper that is passed a write.
  const asyncNames = [...new Set(fns.map(nameOf).filter(Boolean))];
  for (const c of callsOf(m, asyncNames)) {
    const name = c[1];
    if (writeFns.has(name) || selfMark.has(name) || !isStatementCall(m, c.index)) continue;
    const from = c.index + c[0].length;
    if (hasWriteIn(m, src, from, matchClose(m, from - 1, '(', ')'))) add('U2', c.index, name);
  }

  // Rule B (named): a same-file write function wired to onchange, oninput, etc. by name or by an expression arrow.
  for (const c of m.matchAll(/(?<![\w$.])on(?!click\b)[a-z]+\s*:\s*(?:\(?\s*[\w$]*\s*\)?\s*=>\s*)?([\w$]+)\s*[(,}]/g)) {
    const name = c[1];
    if (!writeFns.has(name)) continue;
    const fn = writeFns.get(name);
    const own = writeCalls.filter((w) => inner(w.index) === fn);
    if (own.length && !marksBefore(m, src, fn.bodyStart, Math.min(...own.map((w) => w.index)))) add('B', c.index, name);
  }

  // Rule B (inline) and rule A2: every async function, judged by where it is attached.
  for (const fn of fns) {
    const before = src.slice(Math.max(0, fn.at - 80), fn.at);
    if (ON_PROP.test(before) || ADD_LISTENER.test(before)) {
      const own = writeCalls.filter((w) => inner(w.index) === fn);
      if (own.length && !marksBefore(m, src, fn.bodyStart, Math.min(...own.map((w) => w.index)))) add('B', fn.at, nameOf(fn) || '(inline)');
    }
    if (/\bonclick\s*:\s*$/.test(src.slice(Math.max(0, fn.at - 30), fn.at))) {
      const waits = writeCalls.some((w) => owned(fn, w.index));
      const tag = enclosingHTag(m, src, fn.at);
      if (waits && tag !== 'button') add('A2', fn.at, tag);
    }
  }
  // Rule A2 (named): an onclick wired to a same-file write function on an h() call whose tag is not 'button'.
  for (const c of m.matchAll(/(?<![\w$.])onclick\s*:\s*([\w$]+)\s*[,}]/g)) {
    if (writeFns.has(c[1]) && enclosingHTag(m, src, c.index) !== 'button') add('A2', c.index, c[1]);
  }
  return found;
}

// Rule G: the press guard in ui.js. Returns the problems (empty when the guard is intact).
function guardProblems(ui) {
  const m = mask(ui);
  const bodyOf = (name) => {
    const at = m.search(new RegExp(`export function ${name}\\(`));
    if (at < 0) return null;
    const params = matchClose(m, m.indexOf('(', at), '(', ')'); // the body's brace comes after the parameter list
    return ui.slice(at, matchClose(m, m.indexOf('{', params), '{', '}') + 1);
  };
  const problems = [];
  const h = bodyOf('h');
  if (!h || !/k === 'onclick' && tag === 'button'/.test(h) || !/pressGuard\(\s*el\s*,\s*v\s*\)/.test(h)) {
    problems.push('h() in ui.js does not route a button onclick through pressGuard (C2.1, D-121)');
  }
  if (!/function pressGuard\(/.test(ui)) problems.push('ui.js has no pressGuard function (C2.1, D-121)');
  const cd = bodyOf('confirmDialog');
  if (!cd || !/confirmBtn\.setAttribute\('aria-disabled', 'true'\)/.test(cd)) {
    problems.push('confirmDialog does not mark its confirm button aria-disabled (C2.3, D-121)');
  }
  if (cd && /aria-busy/.test(cd)) problems.push('confirmDialog still marks its confirm button aria-busy (C2.3, D-121)');
  return problems;
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

// Scans every file under the root. api.js is the fetch wrapper itself (its write verbs are the API, not a press).
function scanTree(root) {
  const out = [];
  for (const f of walk(root)) {
    if (path.basename(f) === 'api.js') continue;
    out.push(...scanSource(path.relative(root, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')));
  }
  return out;
}

// Removes the rule U findings the allow-list covers; also returns the allow-list entries that matched nothing (stale).
function applyAllowList(findings) {
  const used = new Set();
  const left = findings.filter((f) => {
    if (f.rule !== 'U') return true;
    const i = ALLOWLIST.findIndex((e) => e.file === f.file && e.callee === f.callee && f.text.includes(e.contains));
    if (i < 0) return true;
    used.add(i);
    return false;
  });
  return { left, stale: ALLOWLIST.filter((_, i) => !used.has(i)) };
}

const siteText = (f) => `${f.file}:${f.line} ${f.rule} ${f.callee}( | ${f.text.slice(0, 110)}`;
const ruleCallee = (findings) => findings.map((f) => `${f.rule} ${f.callee}`);

// Fixtures: each runs the scanner on a snippet. They pin the rules themselves, so the tree scan below cannot pass by accident.
test('BUSYSCAN2 fixture: a write function called as a statement, not awaited, is flagged (the act(); shape)', () => {
  const f = scanSource('fixture.js', "const act = async () => { await post('/x'); }; const pub = async () => { if (!await ask()) return; act(); };");
  assert.deepStrictEqual(ruleCallee(f), ['U act']);
});

test('BUSYSCAN2 fixture: the same write function awaited, returned, or as an arrow body is not flagged', () => {
  const pre = "const act = async () => { await post('/x'); }; ";
  for (const body of [
    'const pub = async () => { if (!await ask()) return; await act(); };',
    'const pub = () => { return act(); };',
    'const pub = () => act();',
  ]) assert.deepStrictEqual(scanSource('fixture.js', pre + body), [], body);
});

test('BUSYSCAN2 fixture: an async function declaration called without await is flagged', () => {
  const f = scanSource('fixture.js', "async function g() { await patch('/x'); } const f = () => { g(); };");
  assert.deepStrictEqual(ruleCallee(f), ['U g']);
});

test('BUSYSCAN2 fixture: a GET through api() is a read; a PATCH through api() dropped as a statement is a write', () => {
  assert.deepStrictEqual(scanSource('fixture.js', "async () => { api('GET', '/x'); }"), []);
  assert.deepStrictEqual(ruleCallee(scanSource('fixture.js', "async () => { api('PATCH', '/x'); }")), ['U api']);
});

test('BUSYSCAN2 fixture: an async helper called without await with a write passed in is flagged (rule U2, the inbox Snooze shape)', () => {
  const f = scanSource('fixture.js', "const act = async (fn) => { await fn(); }; const x = () => { m.close(); act(() => patch('/x')); };");
  assert.deepStrictEqual(ruleCallee(f), ['U2 act']);
});

test('BUSYSCAN2 fixture: a helper that marks its control aria-disabled before it waits is accepted (the help.js act(e, ...) shape)', () => {
  const src = "const act = async (e, fn) => { e.currentTarget.setAttribute('aria-disabled', 'true'); await fn(); }; const y = (e) => { act(e, () => post('/x')); };";
  assert.deepStrictEqual(scanSource('fixture.js', src), []);
});

test('BUSYSCAN2 fixture: a helper that calls busy() before it waits is accepted by name (listings.js Connect calendar)', () => {
  const src = "const busy = () => {}; const act = async () => { busy(); await post('/x'); }; const y = () => { act(); };";
  assert.deepStrictEqual(scanSource('fixture.js', src), []);
});

test('BUSYSCAN2 fixture: an onchange handler that awaits a write without marking itself is flagged (rule B); with the mark it is not', () => {
  const bad = scanSource('fixture.js', "h('select', { onchange: async (e) => { await patch('/x', {}); } });");
  assert.deepStrictEqual(bad.map((x) => x.rule), ['B']);
  assert.deepStrictEqual(scanSource('fixture.js', "h('select', { onchange: async (e) => { e.target.setAttribute('aria-disabled', 'true'); await patch('/x', {}); } });"), []);
});

test('BUSYSCAN2 fixture: an input handler that names a same-file write function is flagged (rule B, named)', () => {
  const f = scanSource('fixture.js', "const t = async (i) => { await patch('/x'); }; h('input', { onchange: (e) => t(e.target) });");
  assert.deepStrictEqual(f.map((x) => x.rule), ['B']);
  assert.strictEqual(f[0].callee, 't');
});

test('BUSYSCAN2 fixture: an onclick handler that awaits a write on a div is flagged (rule A2); on a button it is not', () => {
  assert.deepStrictEqual(scanSource('fixture.js', "h('div', { onclick: async () => { await post('/x'); } });").map((x) => x.rule), ['A2']);
  assert.deepStrictEqual(scanSource('fixture.js', "h('button', { onclick: async () => { await post('/x'); } });"), []);
  const named = "const save = async () => { await post('/x'); }; ";
  assert.deepStrictEqual(scanSource('fixture.js', named + "h('a', { href: '#x', onclick: save }, 'Save');").map((x) => x.rule), ['A2']);
  assert.deepStrictEqual(scanSource('fixture.js', named + "h('button', { onclick: save }, 'Save');"), []);
});

test('BUSYSCAN2 fixture: a write named in a comment or a string is not a call', () => {
  assert.deepStrictEqual(scanSource('fixture.js', "async () => { // post('/x');\n  const s = \"patch('/x');\"; /* act(); */ }"), []);
});

test('BUSYSCAN2 fixture: rule G fails when h() loses its press guard or confirmDialog marks aria-busy', () => {
  const good = [
    "export function h(tag, props) { if (k === 'onclick' && tag === 'button' && typeof v === 'function') el.addEventListener('click', pressGuard(el, v)); }",
    'function pressGuard(el, fn) { return fn; }',
    "export function confirmDialog({ title }) { confirmBtn.setAttribute('aria-disabled', 'true'); }",
  ].join('\n');
  assert.deepStrictEqual(guardProblems(good), []);
  assert.ok(guardProblems(good.replace('pressGuard(el, v)', 'v')).length >= 1, 'h() without pressGuard must fail');
  assert.ok(guardProblems(good.replace("confirmBtn.setAttribute('aria-disabled', 'true')", "confirmBtn.setAttribute('aria-busy', 'true')")).length >= 1, 'aria-busy must fail');
});

test('BUSYSCAN2 allow-list is exactly the five STRATEGY round 39 rule U entries, each with a reason', () => {
  assert.deepStrictEqual(ALLOWLIST.map((a) => `${a.file} | ${a.callee} | ${a.contains}`), [
    'app.js | logout | sheet.close(); logout();',
    'views/calendar.js | moveBar | if (ok()) moveBar(',
    'views/cardcheck.js | waitForBank | waitForBank(query.check);',
    'topnotify.js | post | /account/notifications/read',
    'views/book.js | post | /public/book/cancel/',
  ]);
  for (const a of ALLOWLIST) assert.ok(a.reason && a.reason.length > 10, `reason missing for ${a.file}`);
});

test('BUSYSCAN2: no press in public/js starts a request without waiting for it with its own mark (rules U, U2, B, A2)', () => {
  assert.ok(walk(PUBLIC_JS).length > 20, 'expected the whole public/js tree');
  const { left } = applyAllowList(scanTree(PUBLIC_JS));
  assert.strictEqual(left.length, 0, `a press must mark its control aria-disabled while its request waits, and a request must not be dropped (D-121). Sites:\n${left.map(siteText).join('\n')}`);
});

test('BUSYSCAN2: every allow-list entry still matches a real site (no stale entry)', () => {
  const { stale } = applyAllowList(scanTree(PUBLIC_JS));
  assert.deepStrictEqual(stale.map((a) => `${a.file} | ${a.callee} | ${a.contains}`), []);
});

test('BUSYSCAN2 rule G: ui.js keeps the press guard in h() and confirmDialog marks its confirm button aria-disabled', () => {
  const ui = fs.readFileSync(path.join(PUBLIC_JS, 'ui.js'), 'utf8');
  assert.deepStrictEqual(guardProblems(ui), []);
});

test('BUSYSCAN2: the scan sees the writes in the tree (not vacuous)', () => {
  let writes = 0;
  for (const f of walk(PUBLIC_JS)) {
    if (path.basename(f) === 'api.js') continue;
    const src = fs.readFileSync(f, 'utf8');
    const m = mask(src);
    writes += callsOf(m, ['post', 'patch', 'uploadFile', 'api']).filter((c) => isWriteAt(src, c[1], c.index)).length;
  }
  assert.ok(writes >= 150, `only ${writes} write calls found`);
});
