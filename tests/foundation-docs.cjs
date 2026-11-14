const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async (browser, origin) => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const files = await fs.readdir(path.join(__dirname, '../docs'));
  for (const file of files.filter(file => file.endsWith('.html'))) {
    await page.goto(origin + '/docs/' + file);
    await page.locator('main h1').waitFor();
    await page.waitForFunction(() => !document.querySelector('cf-include, cf-data[aria-busy]'));
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), file + ' fits ' + width);
    }
    for (const href of await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.href))) {
      if (href.startsWith(origin)) assert((await page.request.get(href)).ok(), href);
    }
  }
  await page.goto(origin + '/docs/examples/composition.html');
  await page.getByText('Composed with CFJS', { exact: true }).waitFor();
  assert.equal(await page.locator('slot, cf-include').count(), 0);
  await page.route('**/slot-fixture.html', route => route.fulfill({ body: '<section><slot name="title">Default title</slot><slot name="title">Second fallback</slot><slot>Default body</slot></section>' }));
  await page.evaluate(() => {
    const include = document.createElement('cf-include');
    include.setAttribute('src', '/slot-fixture.html');
    include.innerHTML = '<h2 slot="title">Assigned title</h2><p>Assigned body</p><b slot="unused">Discarded</b>';
    document.body.append(include);
  });
  await page.getByText('Assigned title', { exact: true }).waitFor();
  assert.equal(await page.getByText('Assigned title', { exact: true }).count(), 1);
  assert(await page.getByText('Second fallback', { exact: false }).count());
  assert.equal(await page.getByText('Discarded', { exact: true }).count(), 0);
  await page.goto(origin + '/docs/examples/scripts.html');
  await page.locator('section[data-external="ready"]').waitFor();
  assert.equal(await page.locator('.status').textContent(), 'Inline script ran after mounting.');
  assert.deepEqual(errors, []);
  await page.close();
  console.log('PASS: directly served documentation, local links, three layouts, runnable composition and slot assignment');
};
