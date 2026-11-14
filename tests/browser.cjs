// A real HTTP server exercises redirects, failures, and browser script loading.
const assert = require('node:assert/strict');
const browsers = require(require.resolve('playwright', {
  paths: [process.cwd(), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)
}));

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixtures = new Map();
const hits = new Map();
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  hits.set(pathname, (hits.get(pathname) || 0) + 1);
  if (fixtures.has(pathname)) {
    const fixture = fixtures.get(pathname);
    if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay));
    res.writeHead(fixture.status || 200, {
      'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
      ...fixture.headers
    });
    res.end(fixture.body || '');
    return;
  }
  try {
    const file = path.resolve(__dirname, '..', '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(path.resolve(__dirname, '..') + path.sep)) throw new Error('Invalid path');
    const body = await fs.readFile(file);
    res.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browsers[process.env.BROWSER || 'chromium'].launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const composition = {
      '/composition/index.html': `<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><title>Composition fixture</title>
        <style>button { background-color: rgb(38, 63, 48); }</style>
        <script defer src="/cfjs.js"></script></head><body>
        <cf-include src="./header.html"></cf-include>
        <cf-include src="./counter.html"></cf-include>
        <cf-include src="./counter.html"></cf-include>
        <cf-include src="./footer.html"></cf-include>
        </body></html>`,
      '/composition/header.html': '<header><a href="./index.html">Home</a></header>',
      '/composition/footer.html': '<footer><cf-include src="./note.html"></cf-include></footer>',
      '/composition/note.html': '<p>A nested include.</p>',
      '/composition/counter.html': `<section class="counter">
        <button type="button">Clicked <span>0</span> times</button>
        <script>(() => {
          const button = document.currentScript.parentElement.querySelector('button');
          let count = 0;
          button.addEventListener('click', () => { button.querySelector('span').textContent = ++count; });
        })();</script>
      </section>`
    };
    for (const [url, body] of Object.entries(composition)) fixtures.set(url, { body });
    let counterRequests = 0;
    page.on('request', request => {
      if (request.url().endsWith('/composition/counter.html')) counterRequests++;
    });
    await page.goto(origin + '/composition/index.html');
    await page.waitForFunction(() => !document.querySelector('cf-include'));
    assert.equal(await page.locator('.counter').count(), 2);
    await page.locator('button').nth(0).click();
    assert.deepEqual(await page.locator('.counter button span').allTextContents(), ['1', '0']);
    assert.equal(counterRequests, 1);
    assert.match(await page.locator('footer').innerText(), /nested include/);
    assert.equal(await page.locator('header a').getAttribute('href'), './index.html');
    assert.equal(await page.locator('button').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(38, 63, 48)');
    console.log('PASS: composition, nested includes, relative links, page CSS, repeated script instances, fetch caching');

    const markup = {
      '/fixtures/external.html': '<div class="external">External</div><script src="/fixtures/external.js"></script><script type="module" src="/fixtures/module.js"></script>',
      '/fixtures/external.js': 'window.externalRuns = (window.externalRuns || 0) + 1;',
      '/fixtures/module.js': 'window.moduleRuns = (window.moduleRuns || 0) + 1;',
      '/fixtures/cycle.html': '<cf-include src="/fixtures/cycle.html"></cf-include>',
      '/fixtures/template.html': '<template id="inert"><script>window.shouldNotRun = true;</script></template>',
      '/fixtures/atomic.html': '<script>window.shouldNotRun = true;</script><cf-include src="/fixtures/missing.html"></cf-include>'
    };
    for (const [url, body] of Object.entries(markup)) fixtures.set(url, { body });
    const add = src => page.evaluate(src => {
      const el = document.createElement('cf-include');
      if (src !== null) el.setAttribute('src', src);
      el.textContent = 'Fallback';
      document.body.append(el);
    }, src);
    await add('/fixtures/external.html');
    await page.waitForFunction(() => window.externalRuns === 1 && window.moduleRuns === 1);
    await add('/fixtures/external.html');
    await page.waitForFunction(() => window.externalRuns === 2);
    assert.equal(await page.evaluate(() => window.moduleRuns), 1);
    await add('/fixtures/template.html');
    await page.waitForSelector('#inert', { state: 'attached' });
    assert.equal(await page.evaluate(() => window.shouldNotRun), undefined);
    console.log('PASS: dynamic includes, relative external scripts, module-once behavior, inert nested templates');
    for (const source of ['/fixtures/cycle.html', '/fixtures/missing.html', null, '/fixtures/atomic.html']) {
      await add(source);
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-cf-error]').length === 4);
    assert.equal(await page.evaluate(() => window.shouldNotRun), undefined);
    assert.deepEqual(await page.locator('[data-cf-error]').allTextContents(), Array(4).fill('Fallback'));
    assert.deepEqual(errors, []);
    console.log('PASS: cycle detection, HTTP failures, missing src, fallback preservation, failed trees stay inert');

    await page.evaluate(() => {
      window.loads = [];
      window.failures = [];
      document.addEventListener('cf:load', event => window.loads.push(event.detail.src));
      document.addEventListener('cf:error', event => window.failures.push(event.detail.error.message));
    });
    const fixture = (url, body, extra = {}) => fixtures.set(url, { body, ...extra });
    fixture('/atomic-tree.html', '<h1 id="atomic-parent">Parent</h1><cf-include src="/atomic-child.html"></cf-include>');
    const atomicPage = await browser.newPage();
    let releaseChild;
    const childGate = new Promise(resolve => { releaseChild = resolve; });
    await atomicPage.route('**/atomic-child.html', async route => {
      await childGate;
      await route.fulfill({ body: '<p id="atomic-child">Child</p>' });
    });
    fixture('/atomic-entry.html', '<script defer src="/cfjs.js"></script><cf-include progressive src="/atomic-tree.html"><b id="atomic-fallback">Waiting</b></cf-include>');
    const childRequested = atomicPage.waitForRequest(origin + '/atomic-child.html');
    await atomicPage.goto(origin + '/atomic-entry.html');
    await childRequested;
    assert.equal(await atomicPage.locator('#atomic-parent').count(), 0);
    assert(await atomicPage.locator('#atomic-fallback').isVisible());
    releaseChild();
    await atomicPage.locator('#atomic-child').waitFor();
    assert.equal(await atomicPage.locator('#atomic-parent').textContent(), 'Parent');
    await atomicPage.close();
    console.log('PASS: legacy progressive attribute preserves atomic tree mounting');
    fixture('/redirect', '', { status: 302, headers: { Location: '/parts/deep/parent.html' } });
    fixture('/parts/deep/parent.html', `<section id="redirected">
      <a href="../home.html">Home</a><a href="#local">Local</a>
      <img src="./pixel.svg"><form action="../submit"><button formaction="../other">Go</button></form>
      <video poster="./poster.png"></video><object data="./data.txt"></object>
      <cf-include src="../child.html"><cf-include src="/never-fetch"></cf-include></cf-include>
      <template><cf-include src="./inert.html"></cf-include><img src="./inert.png"></template>
    </section>`);
    fixture('/child.html', '<b id="child">Nested</b><script>window.nestedRuns = (window.nestedRuns || 0) + 1</script>');
    await add('/redirect');
    await page.waitForSelector('#child');
    assert.equal(await page.locator('#redirected a').first().getAttribute('href'), '../home.html');
    assert.equal(await page.locator('#redirected a').nth(1).getAttribute('href'), '#local');
    for (const [selector, attribute, expected] of [
      ['img', 'src', './pixel.svg'], ['form', 'action', '../submit'],
      ['button', 'formaction', '../other'], ['video', 'poster', './poster.png'],
      ['object', 'data', './data.txt']
    ]) assert.equal(await page.locator('#redirected ' + selector).getAttribute(attribute), expected);
    assert.equal(await page.locator('#redirected template').evaluate(el => el.content.querySelector('img').getAttribute('src')), './inert.png');
    assert.equal(hits.get('/never-fetch'), undefined);
    assert.equal(await page.evaluate(() => window.nestedRuns), 1);
    assert.deepEqual(await page.evaluate(() => window.loads), ['/redirect']);

    fixture('/alias-cycle', '', { status: 302, headers: { Location: '/cycle-final' } });
    fixture('/cycle-final', '<cf-include src="/other-alias"></cf-include>');
    fixture('/other-alias', '', { status: 302, headers: { Location: '/cycle-final' } });
    fixture('/base.html', '<base href="/changed/"><p>Disallowed</p>');
    for (let i = 0; i < 33; i++) fixture('/depth/' + i, `<cf-include src="/depth/${i + 1}"></cf-include>`);
    for (const src of ['/alias-cycle', '/base.html', '/depth/0', 'data:text/html,no', 'http://[']) await add(src);
    await page.waitForFunction(() => window.failures.length === 5);
    const failures = await page.evaluate(() => window.failures);
    assert(failures.some(message => /Circular include after redirect:.*cycle-final/.test(message)));
    assert(failures.some(message => /depth limit \(32\)/.test(message)));
    assert(failures.some(message => /<base>/.test(message)));
    assert.equal(hits.get('/depth/32'), undefined);

    // Existing fallback nodes, state, and listeners survive a failed branch.
    fixture('/fallback.html', '<cf-include src="/missing-nested"></cf-include>');
    await page.evaluate(() => {
      const outer = document.createElement('cf-include');
      outer.src = ''; // Only the HTML src attribute is the API.
      outer.setAttribute('src', '/fallback.html');
      outer.innerHTML = '<button id="fallback-button">Keep me</button><cf-include src="/never-fetch">Nested fallback</cf-include>';
      window.fallbackButton = outer.firstChild;
      window.fallbackButton.addEventListener('click', () => window.fallbackClicked = true);
      document.body.append(outer);
    });
    await page.waitForSelector('cf-include[src="/fallback.html"][data-cf-error]');
    await page.locator('#fallback-button').click();
    assert(await page.evaluate(() => window.fallbackClicked && window.fallbackButton === document.querySelector('#fallback-button')));
    assert.equal(hits.get('/never-fetch'), undefined);
    fixture('/retry.html', 'Unavailable', { status: 503 });
    await add('/retry.html');
    await page.waitForSelector('cf-include[src="/retry.html"][data-cf-error]');
    fixture('/retry.html', '<p id="retried">Recovered</p>');
    await add('/retry.html');
    await page.waitForSelector('#retried');
    assert.equal(hits.get('/retry.html'), 2);
    console.log('PASS: document-relative paths after redirects, unchanged URL attributes, inert fallback includes, redirect cycles, depth limit, invalid sources, preserved fallback listeners, retry');

    fixture('/scripts.html', `<section class="script-order">
      <script>window.order.push('inline-first'); window.wholeTreePresent = !!document.querySelector('#after-scripts')</script>
      <script src="/slow-first.js" defer></script><script src="/fast-second.js"></script>
      <script async src="/async.js"></script>
      <script>window.order.push('inline-last')</script>
      <script type="module" src="/external-module.js"></script>
      <script type="module">window.inlineModules = (window.inlineModules || 0) + 1</script>
      <script type="application/json" id="json-data">{"ok":true}</script>
      <p id="after-scripts">All markup is present</p>
    </section>`);
    fixture('/slow-first.js', "window.order.push('external-first')", { delay: 250 });
    fixture('/fast-second.js', "window.order.push('external-second')");
    fixture('/async.js', "window.order.push('async')");
    fixture('/external-module.js', "import './dependency.js'; window.externalModules = (window.externalModules || 0) + 1", { delay: 300 });
    fixture('/dependency.js', 'window.moduleDependency = true');
    await page.evaluate(() => {
      window.order = [];
      document.addEventListener('cf:load', event => {
        if (event.detail.src === '/scripts.html') window.atLoad = { order: [...window.order], module: window.externalModules || 0 };
      });
    });
    await add('/scripts.html');
    await page.waitForFunction(() => window.atLoad);
    assert.deepEqual(await page.evaluate(() => window.atLoad), { order: ['inline-first', 'inline-last'], module: 0 });
    await page.waitForFunction(() => window.externalModules === 1 && window.order.length === 5 && window.inlineModules === 1);
    const order = await page.evaluate(() => window.order);
    assert(order.indexOf('external-first') < order.indexOf('external-second'));
    assert(order.indexOf('async') < order.indexOf('external-first'));
    assert(await page.evaluate(() => window.wholeTreePresent && window.moduleDependency));
    assert.deepEqual(JSON.parse(await page.locator('#json-data').textContent()), { ok: true });
    await add('/scripts.html');
    await page.waitForFunction(() => window.inlineModules === 2 && window.order.length === 10);
    assert.equal(await page.evaluate(() => window.externalModules), 1);
    assert.equal(hits.get('/scripts.html'), 1);
    console.log('PASS: inline activation order, complete DOM at execution, ordered external classics, async/defer behavior, cf:load boundary, repeated inline modules, cached external modules and native imports');

    fixture('/removed.html', '<p id="removed-result">Do not insert</p><script>window.removedRan = true</script>', { delay: 100 });
    await page.evaluate(() => {
      const el = document.createElement('cf-include');
      el.setAttribute('src', '/removed.html'); document.body.append(el); el.remove();
    });
    // Await a later response on the same server to cover the removal race.
    fixture('/wait', '', { delay: 200 });
    await page.evaluate(() => fetch('/wait'));
    assert.equal(await page.locator('#removed-result').count(), 0);
    assert.equal(await page.evaluate(() => window.removedRan), undefined);

    // Both entry modes, before and after registration, including duplicate runtime loads.
    for (const mode of ['', 'type="module"']) {
      fixture('/entry.html', `<!doctype html><cf-include src="/entry-fragment.html"></cf-include>
        <script ${mode} src="/cfjs.js"></script><script ${mode} src="/cfjs.js"></script>
        <cf-include src="/entry-fragment.html"></cf-include>`);
      fixture('/entry-fragment.html', '<span class="entry">Entry</span><script>window.entryRuns = (window.entryRuns || 0) + 1</script>');
      const entry = await browser.newPage();
      entry.on('pageerror', error => errors.push(error.message));
      await entry.goto(origin + '/entry.html');
      await entry.waitForFunction(() => window.entryRuns === 2);
      assert.equal(await entry.locator('cf-include').count(), 0);
      await entry.close();
    }
    fixture('/csp.html', `<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-cfjs-test'; object-src 'none'">
      <script nonce="cfjs-test" src="/cfjs.js"></script><cf-include src="/csp-fragment.html"></cf-include>`);
    fixture('/csp-fragment.html', '<p id="csp-result">CSP</p><script nonce="cfjs-test">window.nonceRan = true</script><script nonce="cfjs-test" src="/nonce.js"></script>');
    fixture('/nonce.js', 'window.externalNonceRan = true');
    const csp = await browser.newPage();
    csp.on('pageerror', error => errors.push(error.message));
    await csp.goto(origin + '/csp.html');
    await csp.waitForFunction(() => window.nonceRan && window.externalNonceRan);
    await csp.close();

    // Newly inserted instances reuse requests but keep independent script state.
    await add('/composition/counter.html');
    await page.waitForFunction(() => document.querySelectorAll('.counter').length === 3);
    await page.locator('.counter button').last().click();
    assert.deepEqual(await page.locator('.counter button span').allTextContents(), ['1', '0', '1']);
    assert.equal(counterRequests, 1);
    await add('/composition/missing.html');
    const failed = page.locator('cf-include[src="/composition/missing.html"][data-cf-error]');
    await failed.waitFor();
    assert.equal(await failed.textContent(), 'Fallback');
    assert.match(await failed.getAttribute('data-cf-error'), /HTTP 404/);
    assert.match(await page.evaluate(() => window.failures.at(-1)), /HTTP 404/);
    assert.deepEqual(errors, []);
    console.log('PASS: removed includes, classic/module runtime tags, parser-inserted includes, duplicate runtime loading, CSP nonces, dynamic instances, no unexpected browser errors');
    await require('./preparation.cjs')(browser, origin + '/');
    await require('./data-basics.cjs')(browser, origin + '/');
    await require('./parallel-includes.cjs')(browser, origin + '/');
    await require('./nested-source.cjs')(browser, origin + '/');
    await require('./cf-data.cjs')(browser, origin + '/');
    await require('./foundation-docs.cjs')(browser, origin);
    console.log('Browser:', await browser.version());

  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
