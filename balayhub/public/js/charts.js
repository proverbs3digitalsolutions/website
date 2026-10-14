// Small SVG charts (grouped bars, lines) with hover tooltips, a legend and a
// table view. Colors follow a validated categorical order: blue, orange, aqua.

import { h } from './ui.js';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
};

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// Value-axis labels for a 0 to `max` scale in four equal steps, as { v, text } pairs. A label is left out when it
// reads the same as the one below it (a 0 to 1 scale in whole percent would print 0%, 0%, 1%, 1%, 1%). A `max` of 0
// (no data) keeps only the 0 label.
export function axisLabels(max, fmt) {
  const ticks = max > 0 ? [0, 1, 2, 3, 4].map((i) => (max / 4) * i) : [0];
  let below = null;
  return ticks.flatMap((v) => {
    const text = fmt(v, true);
    const same = text === below;
    below = text;
    return same ? [] : [{ v, text }];
  });
}

function legend(series) {
  if (series.length < 2) return null;
  return h('div', { class: 'chart-legend' }, series.map((s, i) => h('span', { class: 'chart-legend__item' },
    h('span', { class: `chart-swatch${s.dashed ? ' chart-swatch--dashed' : ''}`, style: { background: s.dashed ? 'transparent' : (s.color || SERIES[i]), borderColor: s.color || SERIES[i] } }),
    s.name)));
}

function tableView(labels, series, fmt) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, ''), series.map((s) => h('th', { class: 'num' }, s.name)))),
    h('tbody', null, labels.map((l, i) => h('tr', null, h('td', null, l), series.map((s) => h('td', { class: 'num' }, fmt(s.values[i]))))))));
}

function frame({ labels, series, fmt, height = 220, draw, ariaLabel, integer = false }) {
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip', role: 'status', hidden: true });
  const plot = h('div', { class: 'chart-plot' });
  const table = tableView(labels, series, fmt);
  table.hidden = true;
  const toggle = h('button', { class: 'link-btn small', type: 'button', onclick: () => {
    table.hidden = !table.hidden; plot.hidden = !table.hidden;
    toggle.textContent = table.hidden ? 'Show as table' : 'Show as chart';
  } }, 'Show as table');
  wrap.append(legend(series) || '', plot, table, tip, h('div', { class: 'chart-foot' }, toggle));

  const render = () => {
    const width = Math.max(plot.clientWidth || 600, 280);
    const m = { t: 10, r: 8, b: 34, l: 52 };
    const w = width - m.l - m.r; const hgt = height - m.t - m.b;
    const raw = Math.max(0, ...series.flatMap((s) => s.values.map(Number)));
    // Counts get whole-number gridlines (4 equal steps).
    const max = integer ? Math.max(4, Math.ceil(raw / 4) * 4) : niceMax(raw);
    const y = (v) => m.t + hgt - (Number(v) / max) * hgt;
    const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': ariaLabel });
    for (let i = 0; i <= 4; i += 1) {
      const v = (max / 4) * i;
      root.append(svg('line', { x1: m.l, x2: width - m.r, y1: y(v), y2: y(v), stroke: '#e2e7ee', 'stroke-width': 1, class: 'chart-grid' }));
    }
    // With no data (raw 0) only the 0 label is drawn; the gridlines are unchanged.
    for (const { v, text } of axisLabels(raw > 0 ? max : 0, fmt)) {
      root.append(svg('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#5b6878', class: 'chart-axis' }, text));
    }
    const step = w / labels.length;
    const every = Math.ceil(labels.length / Math.max(1, Math.floor(w / 64)));
    labels.forEach((l, i) => {
      if (i % every) return;
      root.append(svg('text', { x: m.l + step * i + step / 2, y: height - 12, 'text-anchor': 'middle', 'font-size': 11, fill: '#5b6878', class: 'chart-axis' }, l));
    });
    draw({ root, m, w, hgt, y, step, width, height });
    // Hover bands: one per category, wider than the marks.
    labels.forEach((l, i) => {
      const band = svg('rect', { x: m.l + step * i, y: m.t, width: step, height: hgt, class: 'chart-band' });
      const show = (evt) => {
        tip.replaceChildren(h('strong', null, l), ...series.map((s, si) => h('div', { class: 'chart-tip__row' },
          h('span', { class: 'chart-swatch', style: { background: s.color || SERIES[si] } }), `${s.name}: ${fmt(s.values[i])}`)));
        tip.hidden = false;
        const rect = plot.getBoundingClientRect();
        const x = (evt.clientX ?? rect.left + ((m.l + step * i) / width) * rect.width) - rect.left;
        tip.style.left = `${Math.min(Math.max(x + 12, 0), rect.width - 180)}px`;
        tip.style.top = '8px';
        band.classList.add('chart-band--on');
      };
      band.addEventListener('mousemove', show);
      band.addEventListener('click', show);
      band.addEventListener('mouseleave', () => { tip.hidden = true; band.classList.remove('chart-band--on'); });
      root.append(band);
    });
    plot.replaceChildren(root);
  };
  requestAnimationFrame(render);
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (wrap.isConnected) render(); }, 150); });
  return wrap;
}

export function barChart({ labels, series, fmt = String, height, ariaLabel, integer }) {
  return frame({ labels, series, fmt, height, ariaLabel, integer, draw: ({ root, m, y, step }) => {
    const n = series.length;
    const gap = 2;
    const bw = Math.max(3, Math.min(18, (step * 0.7 - gap * (n - 1)) / n));
    const groupW = bw * n + gap * (n - 1);
    labels.forEach((_, i) => {
      series.forEach((s, si) => {
        const v = Number(s.values[i]);
        if (!v) return;
        const x = m.l + step * i + (step - groupW) / 2 + si * (bw + gap);
        const top = y(v); const base = y(0);
        const r = Math.min(4, bw / 2, base - top);
        // Rounded data-end, square baseline.
        const d = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`;
        root.append(svg('path', { d, fill: s.color || SERIES[si] }));
      });
    });
  } });
}

export function lineChart({ labels, series, fmt = String, height, ariaLabel }) {
  return frame({ labels, series, fmt, height, ariaLabel, draw: ({ root, m, y, step }) => {
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [m.l + step * i + step / 2, y(v)]));
      let d = '';
      pts.forEach((p, i) => { if (p) d += `${d && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)} `; });
      root.append(svg('path', { d, fill: 'none', stroke: s.color || SERIES[si], 'stroke-width': 2, 'stroke-dasharray': s.dashed ? '5 4' : null, 'stroke-linejoin': 'round' }));
    });
  } });
}
