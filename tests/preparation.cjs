const assert = require('node:assert/strict');

module.exports = async function preparation(browser, base) {
  const page = await browser.newPage();
  let hits = 0;
  await page.route(base + 'preparation/prepared/**', route => {
    hits++;
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'svg.html') return route.fulfill({body:'<svg><style><script>window.svgScripts++</script>.svg-cache-probe{color:green}</style></svg><style>.svg-cache-probe{color:green}</style>'});
    if (name === 'invalid.html') return route.fulfill({body:'<base href="/">'});
    return route.fulfill({body:'<section><slot name="title"></slot><slot></slot><x-cache-probe></x-cache-probe></section><style>.cached-probe {color:teal}</style><script nonce="cache-nonce">window.cacheScripts++</script><template><script>window.inertRan=true</script></template>'});
  });
  await page.route(base + 'preparation/index.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Preparation fixture</title><script defer src="/cfjs.js"></script><body></body>'
  }));
  await page.goto(base + 'preparation/index.html');
  await page.waitForFunction(() => !document.querySelector('cf-include'));
  await page.evaluate(() => {
    window.parses = 0; window.cacheScripts = 0; window.constructed = 0; window.connected = 0;
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', {...descriptor, set(value) {
      if (this.localName === 'template' && String(value).includes('x-cache-probe')) window.parses++;
      descriptor.set.call(this, value);
    }});
    customElements.define('x-cache-probe', class extends HTMLElement {
      constructor() { super(); window.constructed++; }
      connectedCallback() { window.connected++; }
    });
    window.addCached = label => {
      const host = document.createElement('div');
      host.className = 'cache-host';
      const include = document.createElement('cf-include');
      include.setAttribute('src', './prepared/shared.html');
      include.innerHTML = `<h2 slot="title">${label}</h2><p>${label} body</p>`;
      host.append(include); document.body.append(host);
    };
    addCached('First'); addCached('Second');
  });
  await page.waitForFunction(() => window.cacheScripts === 2);
  assert.deepEqual(await page.locator('.cache-host h2').allTextContents(), ['First','Second']);
  assert.deepEqual(await page.evaluate(() => [parses,constructed,connected,!!window.inertRan]), [2,2,2,false]);
  await page.locator('.cache-host h2').first().evaluate(node => node.textContent = 'Changed');
  await page.evaluate(() => addCached('Third'));
  await page.waitForFunction(() => window.cacheScripts === 3);
  assert.equal(await page.locator('.cache-host h2').last().textContent(), 'Third');
  assert.deepEqual(await page.evaluate(() => [parses,constructed,connected,cacheScripts]), [3,3,3,3]);
  assert.equal(hits,1);
  assert.deepEqual(await page.locator('.cache-host > script').evaluateAll(nodes=>nodes.map(node=>node.nonce)), ['cache-nonce','cache-nonce','cache-nonce']);
  await page.evaluate(() => {
    for (let index=0;index<2;index++) {
      const include=document.createElement('cf-include');
      include.className='invalid-cache';include.setAttribute('src','./prepared/invalid.html');
      include.textContent='Keep fallback';document.body.append(include);
    }
  });
  await page.waitForFunction(()=>document.querySelectorAll('.invalid-cache[data-cf-error]').length===2);
  assert.equal(hits,2,'Invalid templates keep existing successful-response caching but never mount');
  assert.deepEqual(await page.locator('.invalid-cache').allTextContents(),['Keep fallback','Keep fallback']);
  await page.evaluate(()=>{
    window.svgScripts=0;
    const include=document.createElement('cf-include');
    include.setAttribute('src','./prepared/svg.html');document.body.append(include);
  });
  await page.waitForFunction(()=>window.svgScripts===1);
  assert.equal(await page.evaluate(()=>[...document.head.querySelectorAll('style')].filter(node=>node.textContent.includes('svg-cache-probe')).length),1,'Extract SVG scripts before computing style keys');
  await page.close();
  console.log('PASS: response-text reuse with fresh parsing, independent slots/clones/custom elements, invalid templates never mounted, SVG style/script extraction');
};
