// Light / Dark / Match device switch (saved on this device).

import { h } from './ui.js';

const KEY = 'bh-theme';
export const currentTheme = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };

export function setTheme(t) {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

const OPTIONS = [['light', '☀︎', 'Light'], ['dark', '☾', 'Dark'], ['system', '◐', 'Match device']];

// Segmented control; `compact` shows icons only (for menus and headers).
export function themeSwitch({ compact = false, onChange } = {}) {
  const wrap = h('div', { class: `themeswitch${compact ? ' themeswitch--compact' : ''}`, role: 'radiogroup', 'aria-label': 'Colour theme' });
  const draw = () => {
    const cur = currentTheme();
    wrap.replaceChildren(...OPTIONS.map(([k, ic, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(cur === k), title: label, 'aria-label': label,
      onclick: () => { setTheme(k); draw(); onChange?.(k); },
    }, h('span', { 'aria-hidden': 'true' }, ic), !compact && h('span', null, label))));
  };
  draw();
  return wrap;
}
