// Light / Dark / Match device switch (saved on this device).

import { h } from './ui.js';

const KEY = 'bh-theme';
export const currentTheme = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };

export function setTheme(t) {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

// Three icons drawn in the same 18px box so none looks smaller than the others.
const SVG = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  light: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  dark: ['M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z'],
  system: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 3v18'],
};
function themeIcon(k) {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [a, v] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(a, v);
  for (const d of ICON_PATHS[k]) { const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}

const OPTIONS = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device']];

// Segmented control; `compact` shows icons only (for menus and headers).
export function themeSwitch({ compact = false, onChange } = {}) {
  const wrap = h('div', { class: `themeswitch${compact ? ' themeswitch--compact' : ''}`, role: 'radiogroup', 'aria-label': 'Colour theme' });
  const draw = () => {
    const cur = currentTheme();
    wrap.replaceChildren(...OPTIONS.map(([k, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(cur === k), title: label, 'aria-label': label,
      onclick: () => { setTheme(k); draw(); onChange?.(k); },
    }, h('span', { 'aria-hidden': 'true' }, themeIcon(k)), !compact && h('span', null, label))));
  };
  draw();
  return wrap;
}
