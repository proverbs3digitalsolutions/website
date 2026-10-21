'use strict';
require('./helpers');

// QA round 38, HOUSEKEEPING (audit rows 9 and 10; D-120). While its own save runs, the assignment select and the
// checklist box are busy: they are marked aria-disabled, never disabled, so they keep focus, and a second change or
// click during the wait sends nothing. Frontend only. The handlers are taken out of the source by brace matching and
// run against a stand-in page that drops focus the way the browser does, with a request this test settles itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');

// Index just past the "}" that closes the block whose "{" is at `open`. Quoted text, template literals and // comments do not count.
function blockEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"') { i = quoteEnd(text, i) - 1; continue; }
    if (c === '`') { i = templateEnd(text, i) - 1; continue; }
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i) - 1; continue; }
    if (c === '{') depth += 1;
    if (c === '}') { depth -= 1; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced block');
}
function quoteEnd(text, i) {
  let j = i + 1;
  while (text[j] !== text[i]) j += text[j] === '\\' ? 2 : 1;
  return j + 1;
}
function templateEnd(text, i) {
  let j = i + 1;
  while (text[j] !== '`') {
    if (text[j] === '\\') j += 2;
    else if (text[j] === '$' && text[j + 1] === '{') j = blockEnd(text, j + 1);
    else j += 1;
  }
  return j + 1;
}

// The source of `function name(...) {...}`.
function fnSource(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} is a function in housekeeping.js`);
  return src.slice(start, blockEnd(src, src.indexOf('{', start)));
}

// The checklist box's <input> props, from its type to the label text after them.
function checklistInputSource() {
  const a = src.indexOf("type: 'checkbox', checked: c.done");
  assert.ok(a > -1, 'the checklist box is in housekeeping.js');
  return src.slice(a, src.indexOf("h('span', null, c.text)", a));
}

// The arrow function that is the value of `key:` in those props, or null when the box has no such handler.
function handlerSource(props, key) {
  const at = props.indexOf(`${key}: `);
  if (at === -1) return null;
  const start = at + key.length + 2;
  return props.slice(start, blockEnd(props, props.indexOf('{', start)));
}

// The stand-in page. Focus sits on one element. Switching the focused control off with `disabled` drops focus to the body,
// as the browser does, and a control that is off cannot take focus.
const page = { active: null, body: { tag: 'BODY' } };
function fakeEl(tag) {
  return {
    tag, attrs: {}, checked: false, value: '', textContent: '', _disabled: false,
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() { if (!this._disabled) page.active = this; },
    get disabled() { return this._disabled; },
    set disabled(v) { this._disabled = Boolean(v); if (this._disabled && page.active === this) page.active = page.body; },
  };
}
// h() from ui.js, reduced to what these handlers read: properties for handlers and control state, attributes for the rest.
function stubH(tag, props) {
  const el = fakeEl(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'disabled') el.disabled = v;
    else if (k.startsWith('on') || k === 'value' || k === 'checked') el[k] = v;
    else el.attrs[k] = String(v);
  }
  return el;
}
// T() from housekeeping.js for English: fills {n}-style slots.
const T = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);

// The assignment select of one cleaning task, built by the real reassignSelect, with its save held by the test.
function selectHarness() {
  page.active = page.body;
  const calls = [];
  const toasts = [];
  const loads = [];
  const people = [{ user_id: 'u1', full_name: 'Nena Cruz' }, { user_id: 'u2', full_name: 'Mara Lim' }];
  const x = { task_id: 'task-1', unit_name: 'QA r38 housekeeping Unit', property_id: 'p1', assigned_to: 'u1', assignee_name: null };
  const reassignSelect = new Function('h', 'eligibleFor', 'people', 'fmtDate', 'patch', 'toast', 'load',
    `${fnSource('reassignSelect')}\nreturn reassignSelect;`)(
    stubH,
    (list) => list,
    people,
    (d) => d,
    (url, body) => new Promise((resolve, reject) => calls.push({ url, body, resolve, reject })),
    (msg, kind) => toasts.push({ msg, kind }),
    async () => { loads.push('load'); },
  );
  const sel = reassignSelect(x, '2026-10-21');
  sel.value = 'u1';
  return { sel, calls, toasts, loads };
}

// The checklist box of one task, built from the real onchange and onclick handlers, with its save held by the test.
function checklistHarness() {
  page.active = page.body;
  const posts = [];
  const toasts = [];
  const progress = fakeEl('span');
  progress.textContent = '0 of 2 done';
  const t = { task_id: 'task-1', status: 'in_progress', checklist: [], done_count: 0, item_count: 2 };
  const props = checklistInputSource();
  const onchangeSrc = handlerSource(props, 'onchange');
  assert.ok(onchangeSrc, 'the checklist box has an onchange handler');
  const onclickSrc = handlerSource(props, 'onclick');
  const make = new Function('post', 't', 'i', 'progress', 'statusSlot', 'statusBadge', 'startBtn', 'toast', 'T',
    `return { onchange: ${onchangeSrc}, onclick: ${onclickSrc || 'null'} };`);
  const handlers = make(
    (url, body) => new Promise((resolve, reject) => posts.push({ url, body, resolve, reject })),
    t, 0, progress, { replaceChildren() {} }, () => null, null,
    (msg, kind) => toasts.push({ msg, kind }),
    T,
  );
  const box = fakeEl('input');
  box.checked = false;
  return { box, posts, toasts, progress, ...handlers };
}

test('the assignment select is busy with aria-disabled, not disabled, while its save runs (D-120)', async () => {
  const h = selectHarness();
  h.sel.focus();
  h.sel.value = '';
  const first = h.sel.onchange({ target: h.sel });
  assert.equal(h.calls.length, 1, 'the pick is sent');
  assert.equal(h.sel.getAttribute('aria-disabled'), 'true', 'the select says it is busy');
  assert.equal(h.sel.disabled, false, 'the select is not switched off');
  assert.equal(page.active, h.sel, 'the select keeps focus during the save');
  h.sel.value = 'u2';
  h.sel.onchange({ target: h.sel });
  assert.equal(h.calls.length, 1, 'a second pick during the save sends nothing');
  assert.equal(h.sel.value, '', 'the select goes back to the value being saved');
  h.calls[0].resolve({});
  await first;
  assert.equal(h.sel.getAttribute('aria-disabled'), null, 'the busy mark goes when the save ends');
  assert.equal(page.active, h.sel, 'focus is still on the select after the save');
  assert.deepEqual(h.toasts.map((x) => x.msg), ['Assignment saved.']);
});

test('a refused assignment puts the stored person back, clears the busy mark, and the next pick is sent (D-120)', async () => {
  const h = selectHarness();
  h.sel.focus();
  h.sel.value = 'u2';
  const first = h.sel.onchange({ target: h.sel });
  h.calls[0].reject(new Error('QA r38 refused.'));
  await first;
  assert.equal(h.sel.value, 'u1', 'the select shows the stored person again');
  assert.equal(h.toasts.at(-1).kind, 'error');
  assert.equal(h.sel.getAttribute('aria-disabled'), null, 'the busy mark is gone after a refusal');
  assert.equal(page.active, h.sel, 'focus stays on the select after a refusal');
  h.sel.value = 'u2';
  const second = h.sel.onchange({ target: h.sel });
  assert.equal(h.calls.length, 2, 'a pick after the refusal is sent');
  h.calls[1].resolve({});
  await second;
});

test('the checklist box keeps focus while its save runs; a second click is refused and a second change sends nothing (D-120)', async () => {
  const h = checklistHarness();
  h.box.checked = true;
  h.box.focus();
  const first = h.onchange({ target: h.box });
  assert.equal(h.posts.length, 1, 'the tick is sent');
  assert.equal(h.box.getAttribute('aria-disabled'), 'true', 'the box says it is busy');
  assert.equal(h.box.disabled, false, 'the box is not switched off');
  assert.equal(page.active, h.box, 'the box keeps focus during the save');
  assert.ok(h.onclick, 'the box refuses a click while it is busy');
  const click = { target: h.box, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  h.onclick(click);
  assert.equal(click.defaultPrevented, true, 'a click during the save is stopped');
  h.onchange({ target: h.box });
  assert.equal(h.posts.length, 1, 'a second change during the save sends nothing');
  h.posts[0].resolve({ task: { done_count: 1, item_count: 2 } });
  await first;
  assert.equal(h.box.getAttribute('aria-disabled'), null, 'the busy mark goes when the save ends');
  assert.equal(h.box.checked, true, 'the saved tick stays');
  assert.equal(h.progress.textContent, '1 of 2 done');
  assert.equal(page.active, h.box, 'focus is still on the box after the save');
});

test('a refused checklist tick is undone, clears the busy mark, and the next tick is sent (D-120)', async () => {
  const h = checklistHarness();
  h.box.checked = true;
  h.box.focus();
  const first = h.onchange({ target: h.box });
  h.posts[0].reject(new Error('QA r38 refused.'));
  await first;
  assert.equal(h.box.checked, false, 'the tick is undone');
  assert.equal(h.toasts.at(-1).kind, 'error');
  assert.equal(h.box.getAttribute('aria-disabled'), null, 'the busy mark is gone after a refusal');
  assert.equal(page.active, h.box, 'focus stays on the box after a refusal');
  h.box.checked = true;
  const second = h.onchange({ target: h.box });
  assert.equal(h.posts.length, 2, 'a tick after the refusal is sent');
  h.posts[1].resolve({ task: { done_count: 1, item_count: 2 } });
  await second;
});

test('neither control is switched off with disabled while its save runs', () => {
  assert.doesNotMatch(fnSource('reassignSelect'), /\bsel\.disabled\s*=/);
  assert.doesNotMatch(checklistInputSource(), /\bbox\.disabled\s*=/);
});
