// Landing page, live demo, plan banner and admin page. Needs a running server seeded with `npm run seed`
// and started with PLATFORM_ADMIN_EMAILS=stays@balayhub.test.
// Run: BASE_URL=http://localhost:3000 node test/e2e-selling-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let failed = 0;
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|400|403|409/.test(m.text())) errors.push(`console: ${m.text()}`); });
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed += 1; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: SHOTS + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };

  await step('landing page with pricing', async () => {
    await page.goto(BASE + '/#/');
    await page.getByRole('heading', { name: /Run all your units/ }).waitFor();
    await page.getByText('Most popular').waitFor();
    await page.getByText('₱999').waitFor();
    await page.screenshot({ path: SHOTS + 's-landing.png', fullPage: true });
  });
  await step('try the demo (read-only)', async () => {
    await page.getByRole('button', { name: 'Try the live demo' }).first().click();
    await page.getByText("You're exploring the demo").waitFor();
    await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
    await page.goto(BASE + '/#/inbox');
    await page.locator('.inbox__item').first().click();
    await page.locator('.msg').first().waitFor();
    await page.locator('.composer textarea').fill('test');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText(/demo workspace/).first().waitFor();
    await page.screenshot({ path: SHOTS + 's-demo-inbox.png' });
  });
  await step('demo → start trial goes to sign-up', async () => {
    await page.getByRole('button', { name: 'Start your free trial' }).click();
    await page.getByRole('heading', { name: /Create your account|Sign up|Create/ }).first().waitFor();
  });
  await step('mobile landing has no horizontal scroll', async () => {
    const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await m.goto(BASE + '/#/');
    await m.getByRole('heading', { name: /Run all your units/ }).waitFor();
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await m.screenshot({ path: SHOTS + 's-landing-mobile.png', fullPage: true });
    await m.close();
    if (overflow) throw new Error('horizontal overflow');
  });
  await step('owner sees plan card; platform admin page', async () => {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill('stays@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log In' }).click();
    await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
    await page.goto(BASE + '/#/settings');
    await page.getByRole('heading', { name: 'Plan & billing' }).waitFor();
    await page.locator('.sidebar').getByRole('link', { name: 'Admin' }).click();
    await page.getByRole('heading', { name: 'Platform admin' }).waitFor();
    await page.locator('tr.row-link').first().click();
    await page.locator('dialog [name=plan]').waitFor();
    await page.screenshot({ path: SHOTS + 's-admin.png' });
    await page.locator('dialog').getByRole('button', { name: 'Cancel' }).click();
  });
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})();
