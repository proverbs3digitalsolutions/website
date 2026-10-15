'use strict';

// QA round 14, lane OB1 (onboarding-home). Frontend only: no database. node --test --test-concurrency=1 test/qa-r14-ob1.test.js
// #46 Home draws its cards once, when their data is in, so nothing moves while it loads.
// #36 "Connect calendar" opens the first listing's Channels dialog (Listings reads ?channels=<unit id>).
// #37 Listings shows no filter bar with no listings, only the search box for 1 to 3, everything from 4.
// #33 Launchpad Skip for now / Show again carry one focus key per step.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const views = path.join(__dirname, '..', 'public', 'js', 'views');
const read = (f) => fs.readFileSync(path.join(views, f), 'utf8');
const home = read('home.js');
const listings = read('listings.js');
const launchpad = read('launchpad.js');

// A one-line `export const name = ...;` taken out of a browser module, so the pure helper runs without a DOM.
function pure(src, name) {
  const m = src.match(new RegExp(`^export const ${name} = (.*);$`, 'm'));
  assert.ok(m, `${name} is exported as a one-line const`);
  return new Function(`return ${m[1]};`)();
}
// The text of one function, from its header up to the first line that is just "}".
const fn = (src, header) => {
  const i = src.indexOf(header);
  assert.notEqual(i, -1, `found: ${header}`);
  return src.slice(i, src.indexOf('\n}\n', i));
};

test('channelsLink points at the first listing\'s Channels dialog, and at Listings with none', () => {
  const channelsLink = pure(home, 'channelsLink');
  assert.equal(channelsLink([{ unit_id: 'u1' }, { unit_id: 'u2' }]), '#/listings?channels=u1');
  assert.equal(channelsLink([]), '#/listings');
  assert.equal(channelsLink(undefined), '#/listings');
});

test('firstRunCard takes the listings and links with channelsLink', () => {
  assert.match(home, /export function firstRunCard\(\{ reservations, listings \}\)/);
  assert.match(fn(home, 'export function firstRunCard'), /href: channelsLink\(listings\)/);
  assert.match(home, /firstRunCard\(\{ reservations: seen, listings \}\)/);
});

test('Listings opens the Channels dialog for ?channels=<id> after drawing, only for a listed listing', () => {
  const view = fn(listings, 'export async function listingsView');
  assert.match(view, /filters\.channels\)/, 'reads the id from the channels param');
  assert.match(view, /filters\.channels = ''/, 'the id never reaches the Channels filter');
  const tail = view.slice(view.lastIndexOf('el.replaceChildren('));
  assert.match(tail, /shownListings\.find\(\(l\) => l\.unit_id === channelsFor\)/, 'only a listed id');
  assert.match(tail, /channelsFor && canManage/, 'only a role that manages channels');
  assert.match(tail, /channelsModal\(wanted, load\)/);
});

test('listingFilterMode: none for 0, compact for 1 to 3, full from 4', () => {
  const mode = pure(listings, 'listingFilterMode');
  assert.equal(mode(0), 'none');
  assert.equal(mode(1), 'compact');
  assert.equal(mode(3), 'compact');
  assert.equal(mode(4), 'full');
  assert.equal(mode(40), 'full');
});

test('Listings: no bar with none, quick filters folded into More filters when compact', () => {
  const view = fn(listings, 'export async function listingsView');
  assert.match(view, /bar\.hidden = mode === 'none'/);
  assert.match(view, /quick: m === 'compact' \? \[\] : quick, more: m === 'compact' \? \[\.\.\.quick, \.\.\.more\] : more/);
  assert.match(view, /ensureBar\(listings\.length\)/);
});

test('Launchpad Skip for now and Show again both carry lp-step-<key>', () => {
  assert.equal((launchpad.match(/'data-focus-key': `lp-step-\$\{st\.key\}`/g) || []).length, 2);
});

test('Home: every card waits for its first load, and homeView draws them in one go', () => {
  for (const [header, name] of [['async function overviewCard()', 'overview'], ['async function trendsCard()', 'trends'], ['async function revenueSection()', 'revenue']]) {
    const body = fn(home, header);
    assert.match(body, /\n  await load\(\)\.catch\(/, `${name} awaits its first load`);
    assert.doesNotMatch(body, /\n  load\(\)\.catch\(/, `${name} does not fire its first load and return empty`);
  }
  const view = fn(home, 'export async function homeView');
  const gather = view.indexOf('await Promise.all([overviewCard()');
  assert.ok(gather > -1, 'overview is awaited with the charts');
  assert.ok(gather < view.lastIndexOf('el.replaceChildren('), 'the cards are ready before the final draw');
  assert.match(view, /Promise\.all\(\[trendsCard\(\), revenueSection\(\)\]\)/, 'trends and revenue are awaited when not folded');
  assert.doesNotMatch(view, /onboard, overviewCard\(\)/, 'no empty card is placed in the stack');
});
