'use strict';

// QA round 11, lane C13: chart value axis (#24), the chart "Show as table" toggle clear of the Ask button (#25),
// and the sidebar nav scroll cue with a thin scrollbar while more links are below (#26). Frontend-only: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chartsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'charts.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

// charts.js imports ui.js, which a data: URL cannot resolve. Its axis helper is pure, so the import line is dropped
// and the module loads from a data URL (the same way qa-r1-route-access loads routeaccess.js).
const loadCharts = () => import(`data:text/javascript;base64,${Buffer.from(chartsSrc.replace(/^import .*$/m, '')).toString('base64')}`);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The declarations of each rule whose whole selector is `sel` and that starts its own line in app.css.
const rulesFor = (sel) => [...css.matchAll(new RegExp(`^\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]);

// Whole-percent formatter, as home.js uses for occupancy. Like that caller, it ignores the axis flag.
const pct = (v) => `${Math.round(Number(v))}%`;

test('#24 an empty chart (scale 0) keeps only the 0 label', async () => {
  const { axisLabels } = await loadCharts();
  assert.deepEqual(axisLabels(0, pct), [{ v: 0, text: '0%' }]);
  assert.deepEqual(axisLabels(0, String), [{ v: 0, text: '0' }]);
});

test('#24 a 0 to 1 scale in whole percent never prints two equal labels next to each other', async () => {
  const { axisLabels } = await loadCharts();
  const labels = axisLabels(1, pct);
  assert.deepEqual(labels, [{ v: 0, text: '0%' }, { v: 0.5, text: '1%' }]);
  for (let i = 1; i < labels.length; i += 1) assert.notEqual(labels[i].text, labels[i - 1].text);
});

test('#24 a scale whose labels all differ keeps every one of them', async () => {
  const { axisLabels } = await loadCharts();
  assert.deepEqual(axisLabels(4, String).map((l) => l.text), ['0', '1', '2', '3', '4']);
  assert.deepEqual(axisLabels(100, pct).map((l) => l.text), ['0%', '25%', '50%', '75%', '100%']);
});

test('#24 the chart asks axisLabels for its labels, with no data meaning the 0 scale', () => {
  assert.match(chartsSrc, /axisLabels\(raw > 0 \? max : 0, fmt\)/);
  assert.doesNotMatch(chartsSrc, /svg\('text'[^;]*fmt\(v, true\)/, 'no label is printed for every gridline');
});

test('#25 the chart foot lays its toggle out from the left edge, clear of the Ask button on the right', () => {
  const [foot] = rulesFor('.chart-foot');
  assert.ok(foot, '.chart-foot rule exists');
  assert.match(foot, /display:\s*flex/, 'justify-content only moves items in a flex line');
  assert.match(foot, /justify-content:\s*flex-start/);
  assert.doesNotMatch(foot, /text-align:\s*right/);
});

test('#26 the sidebar nav has a bottom fade over a local cover, and a thin scrollbar', () => {
  const [nav] = rulesFor('.sidebar nav');
  assert.ok(nav, '.sidebar nav rule exists');
  assert.match(nav, /background-attachment:\s*local,\s*scroll/, 'the cover moves with the links; the fade stays at the box edge');
  assert.equal((nav.match(/linear-gradient\(/g) || []).length, 2, 'two background layers');
  assert.match(nav, /scrollbar-width:\s*thin/);
});

test('#26 the scroll cue uses colour tokens only', () => {
  const [nav] = rulesFor('.sidebar nav');
  assert.match(nav, /var\(--surface\)/, 'the cover is the sidebar surface');
  assert.match(nav, /var\(--line\)/, 'the fade is a token line colour');
  assert.doesNotMatch(nav, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(nav, /\b(rgb|rgba|hsl|hsla)\(/);
});
