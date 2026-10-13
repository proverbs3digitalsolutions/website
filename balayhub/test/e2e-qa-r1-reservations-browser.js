// QA round 1, reservations view (fix lane L11). Needs a running server seeded with `npm run seed` and Playwright.
// Run: BASE_URL=http://localhost:3000 node test/e2e-qa-r1-reservations-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const step = async (name, fn) => {
    try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); errors.push(name); }
  };

  await step('login stays demo', async () => {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill('stays@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: /Welcome back, Bea/ }).waitFor();
  });

  await step('export CSV on the default view is one valid query and downloads', async () => {
    await page.goto(BASE + '/#/reservations');
    const href = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
    if (!href.startsWith('/api/reservations/export?')) throw new Error(`bad href ${href}`);
    if ((href.match(/view=/g) || []).length !== 1) throw new Error(`view repeated: ${href}`);
    const res = await page.request.get(BASE + href);
    if (res.status() !== 200) throw new Error(`export status ${res.status()}`);
    if (!/text\/csv/.test(res.headers()['content-type'] || '')) throw new Error('export is not CSV');
  });

  await step('confirmed reservation still shows You keep', async () => {
    await page.goto(BASE + '/#/reservations?view=upcoming');
    const rows = page.locator('table.table tbody tr');
    await rows.first().waitFor();
    await rows.first().click();
    await page.locator('#payment-card').waitFor();
    const keep = await page.locator('.keep-line').count();
    if (keep !== 1) throw new Error(`expected one You keep line, found ${keep}`);
  });

  await step('cancelled reservation shows no You keep and no overpaid alert', async () => {
    await page.goto(BASE + '/#/reservations?view=cancelled');
    const rows = page.locator('table.table tbody tr');
    await rows.first().waitFor();
    await rows.first().click();
    await page.locator('#payment-card').waitFor();
    const keep = await page.locator('.keep-line').count();
    if (keep) throw new Error(`cancelled booking shows You keep (${keep})`);
    const overpaid = await page.getByText('Guest overpaid by').count();
    if (overpaid) throw new Error('cancelled booking shows the overpaid alert');
  });

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
})();
