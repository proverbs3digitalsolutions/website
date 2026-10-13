'use strict';

// Philippine holidays used for holiday rates. Fixed-date and Easter-based
// holidays are computed; dates that move each year by proclamation (Chinese New
// Year, Eid) come from a table and may be off by a day — hosts can always set
// a price for a specific night on the calendar, which wins over everything.

const FIXED = [
  ['01-01', "New Year's Day"], ['04-09', 'Araw ng Kagitingan'], ['05-01', 'Labor Day'], ['06-12', 'Independence Day'],
  ['08-21', 'Ninoy Aquino Day'], ['11-01', "All Saints' Day"], ['11-02', "All Souls' Day"], ['11-30', 'Bonifacio Day'],
  ['12-08', 'Immaculate Conception'], ['12-24', 'Christmas Eve'], ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'],
  ['12-31', "New Year's Eve"],
];
const MOVABLE = {
  2026: [['02-17', 'Chinese New Year'], ['03-20', "Eid'l Fitr"], ['05-27', "Eid'l Adha"]],
  2027: [['02-06', 'Chinese New Year'], ['03-10', "Eid'l Fitr"], ['05-17', "Eid'l Adha"]],
  2028: [['01-26', 'Chinese New Year'], ['02-27', "Eid'l Fitr"], ['05-05', "Eid'l Adha"]],
  2029: [['02-13', 'Chinese New Year'], ['02-15', "Eid'l Fitr"], ['04-24', "Eid'l Adha"]],
  2030: [['02-03', 'Chinese New Year'], ['02-05', "Eid'l Fitr"], ['04-14', "Eid'l Adha"]],
};

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (date, n) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000));
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat

// Western Easter Sunday (anonymous Gregorian algorithm).
function easter(y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(Date.UTC(y, month - 1, day)));
}

const cache = new Map();
function holidaysOf(year) {
  if (cache.has(year)) return cache.get(year);
  const map = new Map();
  for (const [md, name] of [...FIXED, ...(MOVABLE[year] || [])]) map.set(`${year}-${md}`, name);
  const e = easter(year);
  map.set(addDays(e, -3), 'Maundy Thursday');
  map.set(addDays(e, -2), 'Good Friday');
  map.set(addDays(e, -1), 'Black Saturday');
  // National Heroes Day: last Monday of August.
  let d = `${year}-08-31`;
  while (weekday(d) !== 1) d = addDays(d, -1);
  map.set(d, 'National Heroes Day');
  cache.set(year, map);
  return map;
}

const holidayName = (date) => holidaysOf(Number(date.slice(0, 4))).get(date) || null;
const isOff = (date) => Boolean(holidayName(date)) || [0, 6].includes(weekday(date));

// The holiday a night belongs to, or null. A night is a holiday night when the
// next day is part of a run of days off (weekends and holidays) that contains a
// holiday: e.g. for Holy Week, the nights of Wednesday through Saturday.
function holidayNight(night) {
  const next = addDays(night, 1);
  if (!isOff(next)) return null;
  // Name it after the nearest holiday in that run (looking back first).
  for (let d = next; isOff(d); d = addDays(d, -1)) if (holidayName(d)) return holidayName(d);
  for (let d = addDays(next, 1); isOff(d); d = addDays(d, 1)) if (holidayName(d)) return holidayName(d);
  return null;
}

// Holidays from `from` for `days` days, for showing hosts what's coming.
function upcoming(from, days = 366) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const d = addDays(from, i);
    const name = holidayName(d);
    if (name) out.push({ date: d, name });
  }
  return out;
}

module.exports = { holidayName, holidayNight, upcoming, easter, addDays, weekday };
