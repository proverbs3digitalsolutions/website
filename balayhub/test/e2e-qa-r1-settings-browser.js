// QA r1 settings checks: #80 (manual payments reason on Payment details), #85 (audit labels and ellipsis),
// #88 (booking page address reported as saved). Needs a running server seeded with `npm run seed` and Playwright.
// The manual payments save is refused by the server, so nothing changes there. The booking address is put back at the end.
// Run: BASE_URL=http://localhost:3000 node test/e2e-qa-r1-settings-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const REASON = 'Add the GCash number, bank name or account name guests should pay to.';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.setDefaultTimeout(8000);
  const failures = [];
  const check = (name, ok) => { console.log(ok ? 'ok  ' : 'FAIL', name); if (!ok) failures.push(name); };
  const settled = (p) => p.then(() => true, () => false);
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  const card = (title) => page.locator('.card', { has: page.getByRole('heading', { name: title, exact: true }) });
  const dialogOpen = () => page.locator('dialog[open]');
  let originalSlug = null;
  let slugChanged = false;
  try {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill('stays@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: 'Trends overview' }).waitFor();

    // #80: manual payments ticked with no details. The server's reason goes on Payment details and the box is highlighted.
    await page.goto(BASE + '/#/settings');
    const mp = card('Manual payments');
    await mp.getByRole('heading', { name: 'Manual payments', exact: true }).waitFor();
    await mp.getByLabel('Accept manual payments on the payment page').check();
    await mp.getByLabel('Payment details for guests').fill('');
    await mp.getByRole('button', { name: 'Save', exact: true }).click();
    const box = mp.locator('[data-field="instructions"]');
    check('manual payments: reason shown on Payment details', await settled(box.locator('.error', { hasText: REASON }).waitFor()));
    check('manual payments: Payment details box highlighted', ((await box.getAttribute('class')) || '').includes('field--invalid'));
    check('manual payments: textarea marked invalid', (await mp.getByLabel('Payment details for guests').getAttribute('aria-invalid')) === 'true');

    // #85: audit history uses the plain labels and cuts long details with an ellipsis.
    await page.reload();
    const audit = card('Audit history');
    await audit.getByRole('heading', { name: 'Audit history', exact: true }).waitFor();
    const rows = audit.locator('tbody tr');
    if (await rows.count() === 0) {
      console.log('skip audit checks: no audit rows in this workspace');
    } else {
      const actions = await audit.locator('tbody tr td:nth-child(3)').allTextContents();
      check('audit: every action has a plain label (no raw codes)', actions.every((t) => /^[A-Z]/.test(t.trim())));
      const details = await audit.locator('tbody tr td:nth-child(4)').allTextContents();
      check('audit: details capped at 160 characters', details.every((t) => t.length <= 160));
      check('audit: cut details end with an ellipsis', details.every((t) => t.length < 160 || t.endsWith('…')));
    }

    // #88: a typed address is saved in cleaned form, and the owner is told what it became.
    await page.reload();
    const bk = card('Direct booking page');
    await bk.getByRole('heading', { name: 'Direct booking page', exact: true }).waitFor();
    await bk.getByRole('button', { name: 'Page settings' }).click();
    const slug = dialogOpen().locator('input[name=slug]');
    originalSlug = await slug.inputValue();
    await slug.fill('Bad Slug!');
    slugChanged = true;
    await dialogOpen().getByRole('button', { name: 'Save', exact: true }).click();
    check('booking address: toast says what it was saved as', await settled(page.locator('.toast', { hasText: 'Saved as bad-slug.' }).waitFor()));
  } catch (e) {
    failures.push(e.message.split('\n')[0]);
    await page.screenshot({ path: (process.env.SHOTS_DIR || require('os').tmpdir()) + '/fail-settings-r1.png' });
  } finally {
    // Put the booking address back, whatever happened above.
    if (slugChanged && originalSlug !== null) {
      try {
        await page.reload();
        await card('Direct booking page').getByRole('button', { name: 'Page settings' }).click();
        await dialogOpen().locator('input[name=slug]').fill(originalSlug);
        await dialogOpen().getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('dialog[open]'));
        console.log(`restored booking address to ${originalSlug}`);
      } catch (e) {
        failures.push(`could not restore booking address to ${originalSlug}: ${e.message.split('\n')[0]}`);
      }
    }
    await browser.close();
  }
  console.log(failures.length ? `FAILED: ${failures.join(' | ')}` : 'all settings checks passed');
  process.exitCode = failures.length ? 1 : 0;
})();
