const assert = require('node:assert/strict');
module.exports = async function parallelData(browser, base) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  let releaseSlow, releaseFailed;
  const failureGate = new Promise(resolve => { releaseFailed = resolve; });
  let shared = 0;
  const errors = [];
  const requested = [];
  page.on('request', request => requested.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await context.route(base + 'parallel-data/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'index.html') return route.fulfill({ contentType: 'text/html', body: `
      <script>window.rows = [{label:'First', slow:true}, {label:'Second', slow:false}]; window.order = [];</script>
      <script defer src="${base}cfjs.js"></script>
      <cf-data id="result" source="rows" name="rows"><template>
        <cf-loop items="rows" as="row"><template><article>
          <cf-if test="row.slow"><template><cf-include src="./slow.html"></cf-include></template>
          <template data-state="else"><cf-include src="./fast.html"></cf-include></template></cf-if>
          <cf-include src="./shared.html"></cf-include>
          <template><cf-include src="./unused.html"></cf-include></template>
        </article></template></cf-loop>
      </template><template data-state="loading"><p id="loading">Waiting</p></template></cf-data>` });
    if (name === 'slow.html') {
      await new Promise(resolve => { releaseSlow = resolve; });
      return route.fulfill({ body: '<b cf-text="row.label"></b><script>window.order.push("first"); window.childSource = {label:"Provider ready"};</script><style>b {color:rgb(200,0,0)}</style>' });
    }
    if (name === 'fast.html') return route.fulfill({ body: '<b cf-text="row.label"></b><script>window.order.push("second");</script><style>b {color:rgb(0,0,200)}</style><cf-data source="childSource" name="child"><template><em cf-text="child.label"></em></template></cf-data>' });
    if (name === 'shared.html') { shared++; return route.fulfill({ body: '<small cf-text="row.label"></small>' }); }
    if (name === 'held.html') { await failureGate; return route.fulfill({ body: '<script>window.failedScriptRan = true;</script>' }); }
    return route.fulfill({ status: 503, body: 'Unavailable' });
  });
  try {
    const slow = page.waitForRequest(base + 'parallel-data/slow.html');
    const fast = page.waitForRequest(base + 'parallel-data/fast.html');
    const sharedRequest = page.waitForRequest(base + 'parallel-data/shared.html');
    let unused = false;
    page.on('request', request => { if (request.url().endsWith('/unused.html')) unused = true; });
    await page.goto(base + 'parallel-data/index.html');
    await slow;
    assert(!requested.includes(base + 'parallel-data/fast.html'), 'Later rows wait');
    assert(!requested.includes(base + 'parallel-data/shared.html'), 'Later siblings wait');
    assert(await page.locator('#loading').isVisible());
    assert.deepEqual(await page.evaluate(() => window.order), []);
    releaseSlow();
    await Promise.all([fast, sharedRequest]);
    await page.locator('em').waitFor();
    assert.deepEqual(await page.locator('article b').allTextContents(), ['First', 'Second']);
    assert.deepEqual(await page.locator('article small').allTextContents(), ['First', 'Second']);
    assert.deepEqual(await page.evaluate(() => window.order), ['first', 'second']);
    assert.equal(await page.locator('em').textContent(), 'Provider ready');
    assert.equal(await page.locator('b').first().evaluate(node => getComputedStyle(node).color), 'rgb(0, 0, 200)');
    assert.equal(shared, 1);
    assert.equal(unused, false);
    const held = page.waitForRequest(base + 'parallel-data/held.html');
    await page.evaluate(() => {
      const data = document.createElement('cf-data');
      data.id = 'failed'; data.setAttribute('source', 'rows'); data.setAttribute('name', 'rows');
      data.innerHTML = '<template><cf-include src="./held.html"></cf-include><cf-include src="./missing.html"></cf-include></template><template data-state="error"><p>Failed</p></template>';
      document.body.append(data);
    });
    await held;
    const response = page.waitForResponse(base + 'parallel-data/held.html');
    releaseFailed(); await response;
    await page.locator('#failed[data-cf-error]').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.locator('#failed').textContent(), 'Failed');
    assert.equal(await page.evaluate(() => window.failedScriptRan), undefined);
    assert.deepEqual(errors, []);
  } finally { releaseSlow?.(); releaseFailed?.(); await context.close(); }
  console.log('PASS: sequential data siblings/rows, ordered bindings/scripts/styles, nested providers, inert templates, deduplication, atomic failure');
};
