const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async (browser, origin) => {
  const base = origin + '/docs/';
  const topics = JSON.parse(await fs.readFile(path.join(__dirname, '../docs/data/topics.json')));
  const legacy = JSON.parse(await fs.readFile(path.join(__dirname, '../docs/data/legacy-links.json')));
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, '../docs/data/examples.json')));
  assert.deepEqual(await fs.readFile(path.join(__dirname, '../docs/vendor/cfjs.js')), await fs.readFile(path.join(__dirname, '../cfjs.js')));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], failedIncludes = [], failedRequests = [], redirectExampleRequests = [];
  page.on('request', request => {
    if (request.resourceType() !== 'fetch' || !request.url().startsWith(base + 'examples/')) return;
    const url = new URL(request.frame().url());
    if (['/docs/', '/docs/index.html'].includes(url.pathname) && Object.hasOwn(legacy, url.hash.slice(1))) {
      redirectExampleRequests.push(request.url());
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failedRequests.push(response.url()); });
  await page.addInitScript(() => {
    window.docsFailures = [];
    document.addEventListener('cf:error', event => {
      if (event.target.tagName === 'CF-INCLUDE') window.docsFailures.push(event.detail.error.message);
    });
  });
  // Finish composition before the next navigation; unloading active fetches can
  // produce native access-control errors in WebKit. Keep real page errors fatal.
  async function settled() {
    await page.waitForFunction(() => document.body.dataset.docsReady === 'true' && !document.querySelector('cf-include, cf-data[aria-busy]'));
  }
  async function ready(slug) {
    await page.goto(base + slug + '.html');
    await settled();
    assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-nav-topic'), slug);
    failedIncludes.push(...await page.evaluate(() => window.docsFailures));
  }
  // Hold requests open to inspect the first paint, including a real link navigation.
  const paintPage = await browser.newPage();
  async function holdRequest(file) {
    let release, arrived, finished;
    const gate = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { arrived = resolve; });
    const handled = new Promise(resolve => { finished = resolve; });
    const handler = async route => {
      arrived();
      await gate;
      await route.continue();
      finished();
    };
    await paintPage.route(base + file, handler);
    return { requested, release: async () => {
      release();
      await handled;
      await paintPage.unroute(base + file, handler);
    } };
  }
  const runtime = await holdRequest('vendor/cfjs.js');
  const shell = await holdRequest('components/shell.html');
  await paintPage.goto(base + 'index.html', { waitUntil: 'commit' });
  await runtime.requested;
  await paintPage.locator('h1').waitFor({ state: 'attached' });
  await paintPage.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith('/styles/docs.css')));
  assert.equal(await paintPage.locator('h1').isVisible(), false, 'No raw topic before runtime registration');
  await runtime.release();
  await shell.requested;
  assert.equal(await paintPage.locator('h1').isVisible(), false, 'No raw topic while shell loads');
  await shell.release();
  await paintPage.waitForFunction(() => document.body.dataset.docsReady === 'true' && document.querySelector('aside nav a'));
  assert(await paintPage.locator('main h1').isVisible());
  const nested = await holdRequest('components/footer.html');
  await paintPage.locator('aside a[href="./quickstart.html"]').click({ noWaitAfter: true });
  await nested.requested;
  assert.equal(await paintPage.locator('h1').isVisible(), false, 'Navigation waits for nested shell fragments');
  await nested.release();
  await paintPage.waitForFunction(() => document.body.dataset.docsReady === 'true');
  assert(await paintPage.locator('main h1').isVisible());
  await paintPage.route(base + 'components/shell.html', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await paintPage.goto(base + 'index.html');
  await paintPage.locator('body > cf-include[data-cf-error]').waitFor();
  assert(await paintPage.locator('h1').isVisible(), 'Failed shell leaves readable topic content');
  await paintPage.close();
  const noScriptPage = await browser.newPage({ javaScriptEnabled: false });
  await noScriptPage.goto(base + 'index.html');
  assert(await noScriptPage.locator('noscript').isVisible(), 'JavaScript requirement stays visible');
  await noScriptPage.close();
  // Crawl the rendered site, including client-rendered chrome. Check every local fragment.
  const links = new Set();
  const targets = new Map();
  for (const topic of topics) {
    const source = await fs.readFile(path.join(__dirname, '../docs', topic.slug + '.html'), 'utf8');
    assert(source.includes('<cf-include'), 'Docs retain browser includes');
    await ready(topic.slug);
    assert.equal(await page.title(), topic.title + ' · CFJS');
    assert.equal(await page.locator('aside nav a').count(), topics.length);
    const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
    assert.equal(ids.length, new Set(ids).size, 'Unique ids in ' + topic.slug);
    targets.set(topic.slug + '.html', new Set(ids));
    for (const href of await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.href))) links.add(href);
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${topic.slug} fits ${width}px`);
      for (const row of await page.locator('.reference-row:has(.examples)').all()) {
        const text = await row.locator('.explanation').boundingBox();
        const example = await row.locator('.examples').boundingBox();
        if (width >= 1200) assert(example.x > text.x + text.width - 1 && Math.abs(example.y - text.y) < 2, 'Desktop examples align with explanations');
        else assert(example.y >= text.y + text.height - 1 && example.y - text.y - text.height < 30, 'Examples immediately follow explanations');
      }
    }
  }
  for (const href of links) {
    const url = new URL(href);
    if (url.origin !== origin) continue;
    assert(url.pathname.startsWith('/docs/'), 'Link remains under subdirectory: ' + href);
    const relative = decodeURIComponent(url.pathname.slice('/docs/'.length));
    if (url.hash && targets.has(relative)) assert(targets.get(relative).has(decodeURIComponent(url.hash.slice(1))), 'Existing anchor: ' + href);
    assert((await page.request.get(url.href.split('#')[0])).ok(), 'Resolvable link: ' + href);
  }
  // Compatibility mappings are browser redirects, not hidden duplicate sections.
  for (const [anchor, target] of Object.entries(legacy)) {
    await page.goto(base + '#' + anchor);
    await page.waitForURL(base + target);
    await settled();
    const url = new URL(page.url());
    assert(targets.get(url.pathname.split('/').at(-1)).has(url.hash.slice(1)), anchor);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready('cf-data');
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.docsReady === 'true' && !document.querySelector('cf-include, cf-data[aria-busy]'));
  await page.locator('aside a[href="./cf-loop.html"]').click();
  await page.waitForURL(base + 'cf-loop.html');
  await settled();
  await page.goBack();
  await settled();
  assert.equal(new URL(page.url()).pathname, '/docs/cf-data.html');
  await page.goForward();
  await settled();
  assert.equal(new URL(page.url()).pathname, '/docs/cf-loop.html');
  // Heading-level search, prose, no-results, keyboard activation, and focus return.
  await ready('cf-data');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.search-trigger').click();
  await page.locator('#search-input').fill('cf-data');
  await page.locator('#search-results a').first().waitFor();
  assert.match(await page.locator('#search-results').innerText(), /cf-data/);
  await page.locator('#search-input').fill('cf-if');
  await page.waitForFunction(() => [...document.querySelectorAll('#search-results a')].some(a => a.getAttribute('href') === './cf-if.html#cf-if'));
  await page.locator('#search-input').fill('receiver');
  await page.waitForFunction(() => document.querySelector('#search-results').textContent.includes('receiver'));
  assert((await page.locator('#search-results a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))).includes('./cf-data.html#source'));
  await page.locator('#search-input').fill('nothing-matches-this-123456');
  await page.getByText('No results. Try a feature name such as cf-data.').waitFor();
  assert.equal(await page.locator('#search-results a').count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#search-dialog').open);
  assert(await page.locator('.search-trigger').evaluate(node => node === document.activeElement));
  await page.keyboard.press('/');
  assert(await page.locator('#search-input').evaluate(node => node === document.activeElement));
  await page.locator('#search-input').fill('cf-data');
  await page.locator('#search-results a').first().waitFor();
  await page.keyboard.press('ArrowDown');
  assert(await page.locator('#search-results a').first().evaluate(node => node === document.activeElement));
  await page.keyboard.press('Enter');
  await page.waitForURL(/cf-data.html#cf-data$/);
  await settled();
  assert(!await page.locator('#search-dialog').evaluate(node => node.open));
  // File tab semantics, exact source, copy success and failure feedback.
  await ready('compose');
  const example = page.locator('[data-example="composition"]');
  const tabs = example.getByRole('tab');
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
  assert(await tabs.nth(1).evaluate(node => node === document.activeElement));
  assert.equal(await example.locator('[role="tabpanel"]:visible').count(), 1);
  await page.keyboard.press('Home');
  assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');
  for (const [i, file] of manifest.composition.files.entries()) {
    assert.equal(await example.locator('[role="tabpanel"] code').nth(i).textContent(), await fs.readFile(path.join(__dirname, '../docs/examples', file), 'utf8'));
  }
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copied = value; } } }));
  await example.locator('[role="tabpanel"]:visible .copy-button').click();
  assert.equal(await page.locator('#copy-status').textContent(), 'Example source copied.');
  assert.equal(await page.evaluate(() => window.copied), await fs.readFile(path.join(__dirname, '../docs/examples/composition.html'), 'utf8'));
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } }));
  await example.locator('[role="tabpanel"]:visible .copy-button').click();
  await page.getByRole('status').filter({ hasText: 'Copy failed.' }).waitFor();
  // Mobile drawer traps focus, closes on Escape, restores focus, and navigates.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.menu-button').click();
  assert.equal(await page.locator('.menu-button').getAttribute('aria-expanded'), 'true');
  assert(await page.locator('.close-navigation').evaluate(node => node === document.activeElement));
  await page.keyboard.press('Shift+Tab');
  assert(await page.locator('aside nav a').last().evaluate(node => node === document.activeElement));
  await page.keyboard.press('Tab');
  assert(await page.locator('.close-navigation').evaluate(node => node === document.activeElement));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.menu-button').getAttribute('aria-expanded'), 'false');
  assert(await page.locator('.menu-button').evaluate(node => node === document.activeElement));
  assert(await page.locator('aside').evaluate(node => node.inert));
  await page.locator('.menu-button').click();
  await page.locator('aside a[href="./slots.html"]').click();
  await page.waitForURL(base + 'slots.html');
  await settled();
  assert(!await page.locator('body').evaluate(node => node.classList.contains('navigation-open')));
  // Every displayed source panel matches its executed file, across all topics.
  for (const topic of topics) {
    const source = await fs.readFile(path.join(__dirname, '../docs', topic.slug + '.html'), 'utf8');
    assert(source.includes('<cf-include'), 'Docs retain browser includes');
    await ready(topic.slug);
    for (const block of await page.locator('[data-example]').all()) {
      assert(await block.locator('[role="tabpanel"]').count() > 0, 'Example panels render in the browser');
      const entry = manifest[await block.getAttribute('data-example')];
      for (const [index, file] of entry.files.entries()) assert.equal(await block.locator('code').nth(index).textContent(), await fs.readFile(path.join(__dirname, '../docs/examples', file), 'utf8'));
    }
  }
  // Standalone examples are the same files used by read-only live iframes.
  for (const [key, entry] of Object.entries(manifest)) {
    await page.goto(base + 'examples/' + entry.files[0]);
    if (key === 'states') {
      await page.getByText('Loading projects…', { exact: true }).waitFor();
      await page.getByText('No projects yet.', { exact: true }).waitFor();
      assert.equal(await page.locator('[role="alert"]').count(), 1);
      assert.equal(await page.locator('[data-cf-error]').count(), 1);
    } else {
      await page.waitForFunction(() => !document.querySelector('cf-include, cf-data[aria-busy]'));
      assert.equal(await page.locator('[data-cf-error]').count(), 0);
      if (key === 'performance') { assert.equal(await page.locator('h1').textContent(), 'Content available immediately'); assert.deepEqual(await page.locator('.results p').allTextContents(), ['First result', 'Second result']); assert(await page.locator('.results').evaluate(node => node.getBoundingClientRect().height >= 160)); }
      if (key === 'composition') assert.equal(await page.locator('.card h2').textContent(), 'Composed with CFJS');
      if (key === 'progressive') { assert.equal(await page.locator('h2').textContent(), 'Parent is ready'); assert.equal(await page.locator('#progressive-example-child').textContent(), 'Child is ready with its parent.'); }
      if (key === 'nested') { assert.equal(await page.locator('.project').count(), 2); assert.deepEqual(await page.locator('li').allTextContents(), ['HTML', 'CSS', 'JavaScript']); }
      if (key === 'conditional') { assert.equal(await page.locator('a').textContent(), 'Live project'); assert.equal(await page.locator('strong').textContent(), 'Featured'); assert.equal(await page.locator('span').textContent(), 'Local project'); assert.equal(await page.locator('cf-if').count(), 0); }
      if (key === 'json') assert.equal(await page.locator('h2').textContent(), 'Selected projects');
      if (key === 'independent') { assert.equal(await page.locator('h2').textContent(), 'Available immediately'); await page.getByText('Optional details arrived independently.', { exact: true }).waitFor(); }
      if (key === 'global') assert.equal(await page.locator('h2').textContent(), 'A global value');
      if (key === 'bindings') { await page.waitForFunction(() => document.querySelector('img').naturalWidth > 0);  assert.equal(await page.locator('img').nth(0).getAttribute('src'), '../assets/project-mark.svg'); assert.equal(await page.locator('img').nth(0).getAttribute('alt'), 'CFJS project mark'); for (const index of [1, 2]) { assert.equal(await page.locator('img').nth(index).getAttribute('src'), null); assert.equal(await page.locator('img').nth(index).getAttribute('alt'), ''); }  assert.equal(await page.locator('a').getAttribute('data-kind'), 'demo'); assert.equal(await page.locator('p').textContent(), ''); }
      if (key === 'scripts') assert.match(await page.locator('.status').textContent(), /ran after mounting/);
      if (key === 'events') assert.match(await page.locator('output').textContent(), /target: body/);
    }
  }
  // Lazy search indexes complete topic documents; a failed fetch can be retried.
  const sourcePage = await browser.newPage();
  let indexedPages = 0;
  sourcePage.on('request', request => {
    if (topics.some(topic => request.url() === base + topic.slug + '.html')) indexedPages++;
  });
  await sourcePage.goto(base + 'quickstart.html');
  await sourcePage.waitForFunction(() => document.body.dataset.docsReady === 'true');
  assert.equal(indexedPages, 1, 'Only the active topic document loads before search');
  await sourcePage.route(base + 'bindings.html', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await sourcePage.locator('.search-trigger').click();
  await sourcePage.getByText('Search could not load. Try again or browse the topic navigation.').waitFor();
  await sourcePage.unroute(base + 'bindings.html');
  await sourcePage.locator('#search-input').fill('cf-src');
  await sourcePage.locator('#search-results a').first().waitFor();
  await sourcePage.keyboard.press('Escape');
  // A broken example keeps the topic readable and offers its standalone link.
  await sourcePage.route('**/examples/card.html', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await sourcePage.goto(base + 'compose.html');
  await sourcePage.locator('[data-example="composition"]').getByText(/Example could not load/).waitFor();
  assert.equal(await sourcePage.locator('h1').textContent(), 'Compose reusable fragments#');
  assert.equal(await sourcePage.locator('[data-example="composition"] a').getAttribute('href'), './examples/composition.html');
  await sourcePage.close();
  // Representative screenshots are local QA artifacts, not deployment output.
  const screenshots = process.env.DOCS_SCREENSHOTS;
  if (screenshots) {
    await fs.mkdir(screenshots, { recursive: true });
    for (const slug of ['cf-data', 'compose']) for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await ready(slug);
      // Load offscreen previews before reviewing full-page screenshots.
      for (const iframe of await page.locator('iframe').all()) {
        await iframe.scrollIntoViewIfNeeded();
        const frame = await (await iframe.elementHandle()).contentFrame();
        await frame.waitForURL(/\/examples\//);
        await frame.waitForLoadState('load');
        await frame.waitForFunction(() => !document.querySelector('cf-include, cf-data[aria-busy]'));
        assert.equal(await frame.locator('body').textContent().then(text => text.trim().length > 0), true);
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(screenshots, `${slug}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failedIncludes, []);
  assert.deepEqual(failedRequests, []);
  assert.deepEqual(redirectExampleRequests, [], 'Legacy redirects do not start examples on the outgoing page');
  await page.close();
  console.log('PASS: all docs topics, all links and legacy anchors, subdirectory history, search, copy, tabs, mobile focus, exact example source, live results, three layouts');
};
