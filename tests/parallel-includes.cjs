const assert = require('node:assert/strict');

module.exports = async function parallelIncludes(browser, base) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  let releaseFirst;
  let releaseFailure;
  const failureGate = new Promise(resolve => { releaseFailure = resolve; });
  let sharedRequests = 0;
  const errors = [];
  const requested = [];
  page.on('request', request => requested.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await context.route(base + 'parallel/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'entry.html') return route.fulfill({ contentType: 'text/html', body: `
      <script defer src="${base}cfjs.js"></script>
      <div id="host"><cf-include src="./tree.html"><p id="fallback">Loading panels</p></cf-include></div>` });
    if (name === 'tree.html') return route.fulfill({ body: `
      <cf-include src="./first.html"></cf-include>
      <cf-include src="./second.html"></cf-include>` });
    if (name === 'first.html') {
      await new Promise(resolve => { releaseFirst = resolve; });
      return route.fulfill({ body: `
        <section id="first" class="parallel-probe">First<cf-include src="./shared.html"></cf-include></section>
        <script>window.parallelOrder = ['first']; window.parallelRows = () => [{ label: 'Provider ready' }];</script>
        <style>.parallel-probe { color: rgb(200, 0, 0); }</style>` });
    }
    if (name === 'second.html') return route.fulfill({ body: `
      <section id="second" class="parallel-probe">Second<cf-include src="./shared.html"></cf-include></section>
      <cf-data source="parallelRows" name="rows"><template><cf-loop items="rows" as="row"><template><p id="provider-result" cf-text="row.label"></p></template></cf-loop></template></cf-data>
      <script>window.parallelOrder.push('second');</script>
      <script type="module">window.parallelModule = window.parallelOrder.join(',');</script>
      <style>.parallel-probe { color: rgb(0, 0, 200); }</style>` });
    if (name === 'shared.html') { sharedRequests++; return route.fulfill({ body: '<small>Shared</small>' }); }
    if (name === 'failure-tree.html') return route.fulfill({ body: `
      <cf-include src="./held.html"></cf-include>
      <cf-include src="./missing.html"></cf-include>` });
    if (name === 'held.html') {
      await failureGate;
      return route.fulfill({ body: '<script>window.failedTreeRan = true;</script>' });
    }
    return route.fulfill({ status: 503, body: 'Unavailable' });
  });
  try {
    const firstRequested = page.waitForRequest(base + 'parallel/first.html');
    const secondRequested = page.waitForRequest(base + 'parallel/second.html');
    await page.goto(base + 'parallel/entry.html');
    await firstRequested;
    assert(!requested.includes(base + 'parallel/second.html'), 'Later nested branches wait for earlier preparation');
    assert(await page.locator('#fallback').isVisible(), 'The whole tree stays in fallback until all branches succeed');
    assert.equal(await page.locator('#first, #second').count(), 0);
    assert.equal(await page.evaluate(() => window.parallelOrder), undefined, 'No branch activates early');
    releaseFirst();
    await secondRequested;
    await page.locator('#provider-result').waitFor();
    await page.waitForFunction(() => window.parallelModule === 'first,second');
    assert.deepEqual(await page.locator('#host > section').allTextContents(), ['FirstShared', 'SecondShared']);
    assert.deepEqual(await page.evaluate(() => window.parallelOrder), ['first', 'second']);
    assert.equal(await page.locator('#provider-result').textContent(), 'Provider ready');
    assert.equal(await page.locator('#first').evaluate(node => getComputedStyle(node).color), 'rgb(0, 0, 200)', 'Styles retain document precedence');
    assert.equal(sharedRequests, 1, 'Repeated branches share the HTML request cache');

    const held = page.waitForRequest(base + 'parallel/held.html');
    await page.evaluate(() => {
      const include = document.createElement('cf-include');
      include.id = 'failed-tree';
      include.setAttribute('src', './failure-tree.html');
      include.textContent = 'Original failure fallback';
      document.body.append(include);
    });
    await held;
    const completed = page.waitForResponse(base + 'parallel/held.html');
    releaseFailure();
    await completed;
    await page.locator('#failed-tree[data-cf-error]').waitFor();
    assert.equal(await page.locator('#failed-tree').textContent(), 'Original failure fallback');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.evaluate(() => window.failedTreeRan), undefined, 'A late branch cannot activate a failed tree');
    assert.deepEqual(errors, []);
  } finally {
    releaseFirst?.();
    releaseFailure?.();
    await context.close();
  }
  console.log('PASS: sequential nested requests, atomic success/failure, ordered scripts/styles/modules/providers, and shared request caching');
};
