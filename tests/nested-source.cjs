const assert = require('node:assert/strict');
module.exports = async (browser, base) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(base + 'nested-source.html', route => route.fulfill({ contentType: 'text/html', body: `
    <script>
      window.row = { details: () => new Promise(resolve => { window.finishSlow = resolve; }) };
      window.fastDetails = { text: 'Fast details' };
      window.failedDetails = () => Promise.reject(new Error('Unavailable'));
      window.independent = [{ title: 'First', onlyLocal: {}, details: {text:'Wrong local'} }];
    </script>
    <script defer src="${base}cfjs.js"></script>
    <cf-data id="parent" source="independent" name="rows"><template>
      <cf-loop items="rows" as="row"><template><article>
        <h2 cf-text="row.title"></h2>
        <cf-data class="slow" source="row.details" name="details"><template><p cf-text="details.text"></p><i cf-text="row.title"></i></template><template data-state="loading"><span role="status">Loading</span></template></cf-data>
        <cf-data class="fast" source="fastDetails" name="details"><template><p cf-text="details.text"></p></template></cf-data>
        <cf-data class="failed" source="failedDetails" name="details"><template></template><template data-state="error"><b>Unavailable</b></template></cf-data>
        <cf-data class="missing" source="onlyLocal" name="details"><template></template><template data-state="error"><b>Missing global</b></template></cf-data>
      </article></template></cf-loop>
    </template></cf-data>` }));
  try {
    await page.goto(base + 'nested-source.html');
    await page.locator('article .fast p').first().waitFor();
    assert.deepEqual(await page.locator('h2').allTextContents(), ['First']);
    assert.equal(await page.locator('#parent').getAttribute('aria-busy'), null, 'Parent completes while a nested source waits');
    assert.equal(await page.locator('article').first().locator('[role=status]').textContent(), 'Loading');
    assert.equal(await page.locator('article .fast p').first().textContent(), 'Fast details');
    await page.locator('article .failed b').first().waitFor();
    await page.locator('article .missing b').first().waitFor();
    await page.evaluate(() => finishSlow({ text: 'Slow details' }));
    await page.locator('article .slow p').waitFor();
    assert.equal(await page.locator('article .slow p').textContent(), 'Slow details');
    assert.equal(await page.locator('article .slow i').textContent(), '', 'Result has only its own alias');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log('PASS: nested global sources, independent completion/failure, global precedence, isolated result aliases');
};
