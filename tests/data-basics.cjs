const assert = require('node:assert/strict');

module.exports = async function testData(browser, base) {
    const context = await browser.newContext();
    let requests = 0;
    await context.route(base + 'data-test/**', route => {
        const path = route.request().url().split('/data-test/')[1];
        if (path === 'rows.json') {
            requests++;
            return route.fulfill({ json: { rows: [
                { name: '<b>First</b>', url: 'javascript:alert(1)', tags: [{ label: 'Nested' }] },
                { name: 'Second', url: 'https://example.com/', tags: [] },
            ] } });
        }
        if (path === 'empty.json') return route.fulfill({ json: [] });
        if (path === 'bad.json') return route.fulfill({ body: '{', contentType: 'application/json' });
        if (path === 'failed.json') return route.fulfill({ status: 503, body: '' });
        if (path === 'card.html') return route.fulfill({ contentType: 'text/html', body: '<article><slot></slot><span cf-text="row.name"></span></article>' });
        return route.fulfill({ contentType: 'text/html', body: `<script defer src="${base}cfjs.js"></script>
            <script>
                function syncSource() { return { message: 'Sync' }; }
                async function asyncSource() { return { message: 'Async' }; }
                function failedSource() { throw new Error('Source failed'); }
                async function rejectedSource() { throw new Error('Source rejected'); }
                window.sourceValues = { object: { message: 'Object' }, promise: Promise.resolve({ message: 'Promise' }), zero: 0, empty: null };
            </script>
            ${['syncSource', 'asyncSource', 'sourceValues.object', 'sourceValues.promise', 'sourceValues.zero', 'sourceValues.empty', 'missingSource', 'failedSource', 'rejectedSource', 'sourceValues.constructor', 'syncSource()'].map((source, index) => `
                <cf-data id="source-${index}" source="${source}" name="result">
                    <template><p cf-text="${index === 4 || index === 5 ? 'result' : 'result.message'}"></p></template>
                    <template data-state="error"><p role="alert">Source error</p></template>
                </cf-data>`).join('')}
            <cf-data id="rows" src="./rows.json" name="response"><template><p cf-text="response.rows.length"></p></template></cf-data>
            <cf-data id="shared" src="./rows.json" name="other"><template><p cf-text="other.rows.length"></p></template></cf-data>
            ${['bad', 'failed'].map(id => `<cf-data id="${id}" src="./${id}.json" name="response"><template><p>Success</p></template><template data-state="error"><p role="alert">Failed</p></template></cf-data>`).join('')}
        ` });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + 'data-test/index.html');
    await page.locator('#rows p').waitFor();
    assert.equal(await page.locator('#rows p').textContent(), '2');
    assert.equal(await page.locator('#shared p').textContent(), '2');
    for (const [index, expected] of ['Sync', 'Async', 'Object', 'Promise', '0', ''].entries()) {
        await page.locator(`#source-${index} p`).waitFor({ state: 'attached' });
        assert.equal(await page.locator(`#source-${index} p`).textContent(), expected);
        assert.equal(await page.locator(`#source-${index}`).getAttribute('data-cf-error'), null);
    }
    for (const index of [6, 7, 8, 9, 10]) {
        await page.locator(`#source-${index} [role="alert"]`).waitFor();
        assert(await page.locator(`#source-${index}`).getAttribute('data-cf-error'));
    }
    assert.equal(requests, 1, 'JSON requests are shared across data containers');
    for (const id of ['bad', 'failed']) {
        await page.locator(`#${id} [role="alert"]`).waitFor();
        assert(await page.locator(`#${id}`).getAttribute('data-cf-error'));
        assert.equal(await page.locator(`#${id}`).getAttribute('aria-busy'), null);
    }
    assert.equal(await page.locator('cf-loop, cf-include').count(), 0);
    let release;
    let received;
    const requested = new Promise(resolve => { received = resolve; });
    await context.route(base + 'data-test/delayed.json', route => {
        release = () => route.fulfill({ json: { message: 'Late result' } });
        received();
    });
    await page.evaluate(() => {
        const element = document.createElement('cf-data');
        element.id = 'delayed';
        element.setAttribute('src', './delayed.json');
        element.setAttribute('name', 'response');
        element.innerHTML = '<template><p cf-text="response.message"></p></template><template data-state="loading"><p>Waiting</p></template>';
        element.addEventListener('cf:load', () => { window.lateLoad = true; });
        window.detachedData = element;
        document.body.append(element);
    });
    await requested;
    assert.equal(await page.locator('#delayed p').textContent(), 'Waiting');
    assert.equal(await page.locator('#delayed').getAttribute('aria-busy'), 'true');
    await page.locator('#delayed').evaluate(element => element.remove());
    await release();
    await page.waitForFunction(() => !window.detachedData.hasAttribute('aria-busy'));
    assert.equal(await page.evaluate(() => window.lateLoad), undefined);
    assert.equal(await page.evaluate(() => window.detachedData.textContent), 'Waiting');
    assert.deepEqual(errors, []);
    await page.goto(base + 'docs/examples/bindings.html');
    await page.locator('a#project').waitFor();
    assert.equal(await page.locator('a#project').getAttribute('aria-label'), 'View the project');
    assert.equal(await page.locator('a#project').getAttribute('data-kind'), 'demo');
    assert.equal(await page.locator('img').nth(1).getAttribute('src'), null);
    assert.equal(await page.locator('img').nth(2).getAttribute('src'), null);
    assert.equal(await page.locator('img').first().getAttribute('alt'), 'CFJS project mark');
    await context.close();
    console.log('PASS: JSON/global data, promises, failures, caching, disconnected data, and safe attribute bindings');
};
