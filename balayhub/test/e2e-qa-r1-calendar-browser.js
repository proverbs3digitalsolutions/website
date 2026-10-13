// QA r1 calendar check (#5): a malformed ?start= shows a note and moves the grid to today. Read-only.
// Needs a running server seeded with `npm run seed` and Playwright.
// Run: BASE_URL=http://localhost:3000 node test/e2e-qa-r1-calendar-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const NOTE = "That date wasn't valid, so we're showing today.";
const DATE_INPUT = 'input[aria-label="Go to date"]';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.setDefaultTimeout(8000);
  const failures = [];
  const check = (name, ok) => { console.log(ok ? 'ok  ' : 'FAIL', name); if (!ok) failures.push(name); };
  const settled = (p) => p.then(() => true, () => false);
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  const note = page.locator('.toast', { hasText: NOTE });
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Manila date
  try {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill('stays@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: 'Trends overview' }).waitFor();

    // A real date: the grid opens on it and no note appears.
    await page.goto(BASE + '/#/calendar?start=2026-10-20');
    check('valid start: grid opens on that date', await settled(page.waitForFunction((sel) => document.querySelector(sel)?.value === '2026-10-20', DATE_INPUT)));
    check('valid start: no "not valid" note', (await note.count()) === 0);

    // A date that does not exist: the note appears and the grid moves to today.
    await page.goto(BASE + '/#/calendar?start=2026-02-30');
    check('invalid start: grid moves to today', await settled(page.waitForFunction((args) => document.querySelector(args.sel)?.value === args.today, { sel: DATE_INPUT, today })));
    check('invalid start: note shown', await settled(note.waitFor()));
    check('invalid start: address bar moves to today', page.url().includes(`start=${today}`));
  } catch (e) {
    failures.push(e.message.split('\n')[0]);
    await page.screenshot({ path: (process.env.SHOTS_DIR || require('os').tmpdir()) + '/fail-calendar-start.png' });
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `FAILED: ${failures.join(' | ')}` : 'all calendar start checks passed');
  process.exitCode = failures.length ? 1 : 0;
})();
