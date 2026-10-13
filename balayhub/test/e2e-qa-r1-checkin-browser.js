// QA r1 guest check-in checks (#7 PDF as ID photo, #8 all errors in one pass, #11 consent not pre-ticked).
// Read-only: every check stops before the form is sent, so nothing is saved. Needs a running server and a
// check-in link token from a stay in the database, plus Playwright.
// Run: BASE_URL=http://localhost:3000 CHECKIN_TOKEN=<token> node test/e2e-qa-r1-checkin-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.CHECKIN_TOKEN;
const PHOTO_MSG = 'Your ID must be a JPG, PNG or WEBP photo.';
(async () => {
  if (!TOKEN) {
    console.log('Set CHECKIN_TOKEN to a check-in link token.');
    process.exitCode = 2;
    return;
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => { try { localStorage.setItem('bh-guest-lang', 'en'); } catch { /* private window */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const failures = [];
  const check = (name, ok, extra = '') => { console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : extra); if (!ok) failures.push(name); };
  const errText = (name) => page.locator(`[data-field="${name}"] .error`).textContent();
  const sent = [];
  page.on('request', (req) => { if (req.method() === 'POST' && req.url().includes('/api/public/checkin/')) sent.push(req.url()); });
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`${BASE}/#/checkin/${TOKEN}`);
    const submit = page.getByRole('button', { name: /Submit registration|Save changes/ });
    await submit.waitFor();
    const hasRules = (await page.locator('[name=accept_rules]').count()) > 0;

    // #8: an empty form flags every missing field and box on the first submit.
    await page.locator('[name=lead_name]').fill('');
    await page.locator('[name=phone]').fill('');
    if (hasRules) await page.locator('[name=accept_rules]').uncheck();
    await page.locator('[name=consent]').uncheck();
    await submit.click();
    check('empty form: name flagged at once', (await errText('lead_name')) !== '', await errText('lead_name'));
    check('empty form: mobile flagged at once', (await errText('phone')) !== '', await errText('phone'));
    check('empty form: consent flagged at once', (await errText('consent')) !== '', await errText('consent'));
    if (hasRules) check('empty form: house rules flagged at once', (await errText('accept_rules')) !== '', await errText('accept_rules'));

    // #7: a PDF is refused before anything is saved, with the photo message beside the picker.
    await page.reload();
    await submit.waitFor();
    await page.locator('[name=lead_name]').fill('QA Test Guest');
    await page.locator('[name=phone]').fill('0917 000 0000');
    await page.locator('input[type=file]').setInputFiles({ name: 'id.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 qa') });
    if (hasRules) await page.locator('[name=accept_rules]').check();
    await page.locator('[name=consent]').check();
    await submit.click();
    check('pdf: wrong-type message beside the photo picker', (await errText('id_photos')) === PHOTO_MSG, await errText('id_photos'));
    check('pdf: no save was sent', sent.length === 0, `sent=${sent.length}`);

    // #11: a saved form reopens with the consent box unticked.
    await page.reload();
    await submit.waitFor();
    if ((await submit.textContent()) === 'Save changes') {
      check('reopen: consent box not pre-ticked', !(await page.locator('[name=consent]').isChecked()));
    } else {
      console.log('skip reopen: this link has no saved form yet');
    }
    check('read-only run: no save was sent at all', sent.length === 0, `sent=${sent.length}`);
  } catch (e) {
    failures.push(e.message.split('\n')[0]);
    await page.screenshot({ path: (process.env.SHOTS_DIR || require('os').tmpdir()) + '/fail-checkin-r1.png' });
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `FAILED: ${failures.join(' | ')}` : 'all check-in r1 checks passed');
  process.exitCode = failures.length ? 1 : 0;
})();
