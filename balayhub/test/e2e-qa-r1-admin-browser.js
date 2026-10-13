// QA r1 admin check (#78, #87): workspace names open the editor with Enter and Space, and a past "Paid until" asks before saving.
// Needs a running server seeded with `npm run seed`, a platform admin account (its email in PLATFORM_ADMIN_EMAILS), and Playwright.
// It saves a paid-until date on the first workspace it opens, so run it on a dev snapshot only.
// Run: BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/e2e-qa-r1-admin-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PAST = '2020-01-01';
const WARN = 'This date is in the past; the workspace may become view-only. Save anyway?';
(async () => {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.log('Set ADMIN_EMAIL and ADMIN_PASSWORD to a platform admin account.');
    process.exitCode = 1;
    return;
  }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.setDefaultTimeout(8000);
  const failures = [];
  const check = (name, ok) => { console.log(ok ? 'ok  ' : 'FAIL', name); if (!ok) failures.push(name); };
  const settled = (p) => p.then(() => true, () => false);
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  const patches = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/admin/workspaces/')) patches.push(r.url()); });
  const openDialogs = page.locator('dialog[open]');
  const row = page.locator('tbody tr.row-link').first();
  const nameBtn = row.locator('button').first();
  try {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill(process.env.ADMIN_EMAIL);
    await page.locator('[name=password]').fill(process.env.ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.goto(BASE + '/#/admin');
    await row.waitFor();

    // #78: the workspace name is a real button, and Enter and Space each open the editor.
    check('workspace name is a button', (await nameBtn.count()) === 1);
    for (const key of ['Enter', ' ']) {
      await nameBtn.focus();
      await page.keyboard.press(key);
      check(`${key === ' ' ? 'Space' : 'Enter'} opens the workspace editor`, await settled(openDialogs.first().waitFor()));
      await page.keyboard.press('Escape');
      check('Escape closes the editor', await settled(openDialogs.first().waitFor({ state: 'detached' })));
    }

    // #87: a past paid-until date asks first. Cancel keeps the editor open and sends nothing.
    await row.locator('td').nth(3).click();
    const editor = openDialogs.first();
    await editor.waitFor();
    await editor.locator('input[name=paid_until]').fill(PAST);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    check('past paid-until asks before saving', await settled(page.getByText(WARN).waitFor()));
    await openDialogs.nth(1).getByRole('button', { name: 'Cancel' }).click();
    check('cancel keeps the editor open', (await openDialogs.count()) === 1);
    check('cancel sends no update', patches.length === 0);

    // Save anyway goes through, once.
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await openDialogs.nth(1).getByRole('button', { name: 'Save anyway' }).click();
    check('Save anyway saves the workspace', await settled(page.getByText('Workspace updated.').waitFor()));
    check('Save anyway sends exactly one update', patches.length === 1);
  } catch (e) {
    failures.push(e.message.split('\n')[0]);
    await page.screenshot({ path: (process.env.SHOTS_DIR || require('os').tmpdir()) + '/fail-admin-workspaces.png' });
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `FAILED: ${failures.join(' | ')}` : 'all admin workspace checks passed');
  process.exitCode = failures.length ? 1 : 0;
})();
