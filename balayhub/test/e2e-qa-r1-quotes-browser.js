// Quote form, host side: the add-on quantity limit and the "Valid for (hours)" box.
// Listings, add-ons, the price preview and the quote save are mocked, so only the login needs seed data.
// Needs a running server with the stays@balayhub.test login.
// Run: BASE_URL=http://localhost:3000 node test/e2e-qa-r1-quotes-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ISO = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.setDefaultTimeout(8000);
  const posts = [];
  let failed = 0;
  const step = async (name, fn) => {
    try { await fn(); console.log('ok  ', name); } catch (e) {
      failed += 1;
      console.log('FAIL', name, e.message.split('\n')[0]);
      await page.screenshot({ path: SHOTS + 'fail-' + name.replace(/\W+/g, '_') + '.png' });
    }
  };
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route((u) => u.pathname === '/api/listings', (r) => r.fulfill(json({ listings: [{ unit_id: 'u1', unit_name: 'Unit 1' }] })));
  await page.route((u) => u.pathname === '/api/addons', (r) => r.fulfill(json({ addons: [
    { addon_id: 'ad1', name: 'Airport pickup', price: 1500, pricing: 'per_stay', max_quantity: 1, unit_ids: [], active: true },
  ] })));
  await page.route((u) => /^\/api\/units\/[^/]+\/price-preview$/.test(u.pathname), (r) => r.fulfill(json({ accommodation_total: 5000, cleaning_fee: 0, available: true })));
  // The save is mocked: record what the form sent, then answer like the server does for an add-on over its limit.
  await page.route((u) => u.pathname === '/api/quotes', (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    posts.push(r.request().postDataJSON());
    return r.fulfill(json({ error: 'Please check the highlighted fields.', code: 'VALIDATION', fields: { addons: 'You can add up to 1 of Airport pickup.' } }, 400));
  });

  await step('log in and open New quote', async () => {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill('stays@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
    await page.goto(BASE + '/#/quotes');
    await page.getByRole('button', { name: 'New quote' }).click();
    await page.getByRole('dialog', { name: 'New quote' }).waitFor();
  });

  const dlg = page.getByRole('dialog', { name: 'New quote' });
  const save = () => dlg.getByRole('button', { name: 'Create quote' });

  await step('fill the quote and wait for the price', async () => {
    await dlg.getByLabel('Guest name').fill('Test guest');
    await dlg.getByLabel('Check-in').fill(ISO(30));
    await dlg.getByLabel('Check-out').fill(ISO(32));
    await dlg.getByText('Price from your rates').waitFor();
  });

  const qty = dlg.getByRole('spinbutton', { name: 'Airport pickup quantity' });
  await step('add-on quantity has max 1 and clamps when typed over it', async () => {
    if ((await qty.getAttribute('max')) !== '1') throw new Error('max attribute is not 1');
    await qty.fill('2');
    const shown = await qty.inputValue();
    if (shown !== '1') throw new Error(`typed 2, box shows ${shown}`);
  });

  await step('an over-limit add-on shows the server message in the add-ons section', async () => {
    await qty.evaluate((el) => { el.value = '2'; }); // a value that skipped the clamp, so the server has to refuse it
    await save().click();
    await dlg.locator('[data-field="addons"] .error').filter({ hasText: 'You can add up to 1 of Airport pickup.' }).waitFor();
  });

  const hours = dlg.getByLabel('Valid for (hours)');
  await step('0 hours is refused with a message and nothing is sent', async () => {
    const before = posts.length;
    await hours.fill('0');
    await save().click();
    await dlg.locator('[data-field="expires_in_hours"] .error').filter({ hasText: 'Valid for at least 1 hour.' }).waitFor();
    if (posts.length !== before) throw new Error('a quote was sent with 0 hours');
  });

  await step('an empty Valid-for box sends the 48-hour default', async () => {
    await hours.fill('');
    const sent = page.waitForResponse((r) => r.url().includes('/api/quotes') && r.request().method() === 'POST');
    await save().click();
    await sent;
    const last = posts.at(-1);
    if (!last || last.expires_in_hours !== 48) throw new Error(`sent ${last && last.expires_in_hours} hours`);
  });

  await browser.close();
  console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
  process.exit(failed ? 1 : 0);
})();
