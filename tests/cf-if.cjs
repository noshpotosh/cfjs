const assert = require('node:assert/strict');

module.exports = async (browser, base) => {
  await checkConditions(browser, base, false);
  await checkConditions(browser, base, true);
};

async function checkConditions(browser, base, inserted) {
  const context = await browser.newContext();
  const hits = [];
  const data = (id, body, fallback = true) => `<cf-data id="${id}" source="values" name="v"><template>${body}</template>${fallback ? '<template data-state="error"><p role="alert">Failed condition</p></template>' : ''}</cf-data>`;
  const condition = (test, yes = '<b>yes</b>', no = '<i>no</i>') => `<cf-if test="${test}"><template>${yes}</template>${no === null ? '' : `<template data-state="else">${no}</template>`}</cf-if>`;
  const forbidden = `<cf-include src="./forbidden.html"></cf-include><cf-data src="./forbidden.json" name="x"><template>bad</template></cf-data><img src="./forbidden.png"><img cf-src="v.hiddenImage"><script src="./forbidden.js"></script><script>window.forbidden = true;</script><style>#forbidden-style { color: red; }</style><b cf-text="v.constructor"></b>`;
  const scopeBranch = `<span cf-text="v.label"></span><cf-loop items="v.rows" as="row"><template><cf-include src="./row.html"></cf-include></template></cf-loop><cf-data source="inner" name="v"><template>${condition('v.ok', '<strong cf-text="v.label"></strong>')}<small cf-text="row.label"></small></template></cf-data>`;
  const invalid = [
    '<cf-if><template></template></cf-if>',
    '<cf-if test=""><template></template></cf-if>',
    '<cf-if test="   "><template></template></cf-if>',
    '<cf-if test="v.no"><template data-state="else">else</template></cf-if>',
    '<cf-if test="v.no"><div><template>nested</template></div></cf-if>',
    ...['v.constructor', 'v.__proto__', 'v.prototype', '!v.ok', 'v.ok()', 'v[0]', 'v..ok'].map(test => condition(test)),
    condition('v.no', '', '<b cf-text="v.constructor"></b>'),
  ];
  await context.route(base + 'if-test/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    hits.push(name);
    if (name === 'row.html') return route.fulfill({ contentType: 'text/html', body: condition('row.ok', '<em cf-text="row.label"></em>', '<em cf-text="v.label"></em>') });
    if (name === 'forbidden.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.forbiddenExternal = true;' });
    if (name === 'selected.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.externalSelected = (window.externalSelected || 0) + 1;' });
    if (name !== 'index.html') return route.fulfill({ status: 404, body: '' });
    const body = `<script defer src="${base}cfjs.js"></script><script>
      window.values = { hiddenImage: './forbidden-bound.png', ok: true, no: false, label: 'outer', rows: [{ ok: true, label: 'row' }, { ok: false }], truthy: [true, 1, -1, '0', [], {}], falsy: [false, 0, -0, '', null, undefined, NaN] };
      window.inner = { ok: true, label: 'inner' };
      window.failures = []; document.addEventListener('cf:error', event => failures.push(event.target.id));
      </script>
      ${data('truthy', '<cf-loop items="v.truthy" as="value"><template>' + condition('value') + '</template></cf-loop>')}
      ${data('falsy', '<cf-loop items="v.falsy" as="value"><template>' + condition('value') + '</template></cf-loop>')}
      ${data('missing', condition('v.absent.deep'))}
      ${data('nothing', condition('v.no', '<b>unused</b>', null))}
      ${data('duplicates', '<cf-if test="v.ok"><template>first</template><template>second</template></cf-if><cf-if test="v.no"><template>unused</template><template data-state="else">else-first</template><template data-state="else">else-second</template></cf-if>')}
      ${data('nested-else', '<cf-if test="v.no"><template></template><div><template data-state="else">ignored</template></div></cf-if>')}
      ${data('scope-yes', condition('v.ok', scopeBranch))}
      ${data('scope-no', condition('v.no', '', scopeBranch))}
      ${data('inert-yes', condition('v.ok', '<p>safe</p>', forbidden))}
      ${data('inert-no', condition('v.no', forbidden, '<p>safe</p>'))}
      ${data('scripts', condition('v.ok', '<script>window.selected = (window.selected || 0) + 1;</script><script src="./selected.js"></script>'))}
      ${invalid.map((markup, i) => data('invalid-' + i, markup)).join('')}
      ${data('default-error', condition('!v.ok'), false)}
      ${data('static-empty', '<cf-loop items="v.truthyEmpty" as="x"><template></template><template data-state="empty">' + condition('v.ok') + '</template></cf-loop>')}
      <script>values.truthyEmpty = [];</script>
      <div id="standalone">${condition('v.ok')}</div>`;
    // Also parse the fixture without the document preload scanner. CFJS must not
    // request any unselected resources, even on engines that preload raw HTML.
    return route.fulfill({ contentType: 'text/html', body: inserted
      ? `<script>document.addEventListener('DOMContentLoaded', () => {
          const template = document.createElement('template');
          template.innerHTML = ${JSON.stringify(body).replaceAll('<', '\\u003c')};
          const scripts = [...template.content.querySelectorAll('script')];
          document.body.append(template.content);
          for (const inert of scripts) {
            const script = document.createElement('script');
            for (const attribute of inert.attributes) script.setAttribute(attribute.name, attribute.value);
            script.textContent = inert.textContent;
            inert.replaceWith(script);
          }
        }, { once: true });</script><body></body>`
      : body });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + 'if-test/index.html');
  await page.waitForFunction(() => !document.querySelector('cf-data[aria-busy]') && window.externalSelected === 1);
  assert.equal(await page.locator('#truthy b').count(), 6);
  assert.equal(await page.locator('#falsy i').count(), 7);
  assert.equal(await page.locator('#missing i').textContent(), 'no');
  for (const id of ['nothing', 'nested-else']) assert.equal(await page.locator('#' + id).textContent(), '');
  assert.equal(await page.locator('#duplicates').textContent(), 'firstelse-first');
  for (const id of ['scope-yes', 'scope-no']) {
    assert.equal(await page.locator(`#${id} span`).textContent(), 'outer');
    assert.deepEqual(await page.locator(`#${id} em`).allTextContents(), ['row', 'outer']);
    assert.equal(await page.locator(`#${id} strong`).textContent(), 'inner');
    assert.equal(await page.locator(`#${id} small`).textContent(), '');
  }
  for (let i = 0; i < invalid.length; i++) {
    assert.equal(await page.locator(`#invalid-${i} [role="alert"]`).textContent(), 'Failed condition');
    assert(await page.locator(`#invalid-${i}`).getAttribute('data-cf-error'));
  }
  assert.equal(await page.locator('#default-error [role="alert"]').textContent(), 'Content could not load.');
  assert.equal(await page.evaluate(() => failures.length), invalid.length + 1);
  assert.equal(await page.locator('cf-data[aria-busy]').count(), 0);
  assert.equal(await page.locator('cf-if').count(), 2, 'Only standalone and static empty-state conditions remain');
  assert.equal(await page.evaluate(() => window.selected), 1);
  assert.equal(await page.evaluate(() => window.forbidden), undefined);
  assert.equal(await page.evaluate(() => window.forbiddenExternal), undefined);
  const forbiddenHits = hits.filter(name => name.startsWith('forbidden'));
  assert.deepEqual(inserted ? forbiddenHits : forbiddenHits.filter(name => !['forbidden.js', 'forbidden.png'].includes(name)), []);
  assert(!await page.locator('head style').allTextContents().then(styles => styles.some(css => css.includes('#forbidden-style'))));
  await page.evaluate(() => { values.ok = false; values.no = true; });
  assert.equal(await page.locator('#inert-yes p').textContent(), 'safe');
  assert.equal(await page.locator('#inert-no p').textContent(), 'safe');
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`PASS: conditional truthiness, validation, scopes, inert branches, scripts, wrapper removal, and one-time rendering (${inserted ? 'inserted' : 'document'} HTML)`);
}
