'use strict';

// A tiny fake page for the focus guard tests (QA r13 F01). Not a test file: npm test only runs *.test.js.
// The guard only asks for tags ('dialog', 'h1') or for the long focusable selector (every descendant; it filters itself).
function world() {
  const w = { activeElement: null, focusCalls: [] };
  const make = (tag, attrs = {}, text = '') => {
    const n = {
      tagName: tag.toUpperCase(), isConnected: true, hidden: false, open: false, disabled: false, children: [], parentElement: null, textContent: text,
      attrs: { ...attrs }, classSet: new Set(),
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      focus(opts) { if (!this.disabled && this.isConnected) { w.activeElement = this; w.focusCalls.push({ el: this, opts }); } },
      add(x) { x.parentElement = this; this.children.push(x); return x; },
      querySelectorAll(sel) { const out = []; const tagOnly = /^\w+$/.test(sel); const walk = (p) => p.children.forEach((x) => { if (!tagOnly || x.tagName.toLowerCase() === sel) out.push(x); walk(x); }); walk(this); return out; },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    };
    n.classList = { contains: (k) => n.classSet.has(k) };
    return n;
  };
  w.make = make;
  w.body = make('body');
  w.app = w.body.add(make('div', { id: 'app' }));
  w.main = w.app.add(make('main', { id: 'main' }));
  w.h1 = w.main.add(make('h1', {}, 'Page'));
  w.querySelectorAll = (sel) => w.body.querySelectorAll(sel);
  w.querySelector = (sel) => w.body.querySelector(sel);
  w.getElementById = (id) => [w.body, ...w.body.querySelectorAll('*')].find((x) => x.attrs.id === id) || null;
  const gone = (n) => { n.isConnected = false; n.children.forEach(gone); };
  w.remove = (n) => { gone(n); n.parentElement.children.splice(n.parentElement.children.indexOf(n), 1); if (w.activeElement && !w.activeElement.isConnected) w.activeElement = w.body; };
  w.dialog = () => { const d = w.body.add(make('dialog')); d.classSet.add('modal'); d.open = true; return d; };
  w.activeElement = w.body;
  globalThis.document = w;
  globalThis.location = { hash: '#/reservations/1' };
  return w;
}
const btn = (w, parent, label, extra = {}) => parent.add(w.make('button', extra, label));

module.exports = { world, btn };
