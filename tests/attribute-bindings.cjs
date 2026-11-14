const assert = require('node:assert/strict');

module.exports = async function testAttributeBindings(browser, base) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(base + 'attribute-bindings.html', route => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><script defer src="${base}cfjs.js"></script>
            <script>
                window.bindingData = {
                    day: { className: 'contribution-day contribution-day--level3', timestamp: '2026-11-14T12:30:00Z', displayDate: 'Nov 14, 2026' },
                    rows: [
                        { className: 'day level1', timestamp: '2026-11-13T01:02:03+05:30', displayDate: 'Yesterday' },
                        { className: '', timestamp: '' },
                        { className: null, timestamp: null },
                        {},
                        { className: 0, timestamp: false },
                        { className: 'unvalidated', timestamp: ' supplied unchanged ' }
                    ]
                };
            </script>
            <cf-data id="bindings" source="bindingData" name="data"><template>
                <time id="direct" class="static" datetime="old" cf-class="data.day.className" cf-datetime="data.day.timestamp" cf-text="data.day.displayDate"></time>
                <cf-loop items="data.rows" as="day"><template>
                    <time class="static" datetime="old" cf-class="day.className" cf-datetime="day.timestamp" cf-text="day.displayDate"></time>
                </template></cf-loop>
            </template></cf-data>
            ${['cf-style', 'cf-class-extra', 'cf-datetime-extra'].map((binding, index) => `
                <cf-data id="unsupported-${index}" source="bindingData" name="data">
                    <template><span ${binding}="data.day.className"></span></template>
                    <template data-state="error"><p>Rejected</p></template>
                </cf-data>`).join('')}`,
    }));
    await page.goto(base + 'attribute-bindings.html');
    await page.locator('#direct').waitFor();
    const times = page.locator('#bindings time');
    assert.deepEqual(await times.evaluateAll(elements => elements.map(element => ({
        className: element.getAttribute('class'),
        datetime: element.getAttribute('datetime'),
        text: element.textContent,
    }))), [
        { className: 'contribution-day contribution-day--level3', datetime: '2026-11-14T12:30:00Z', text: 'Nov 14, 2026' },
        { className: 'day level1', datetime: '2026-11-13T01:02:03+05:30', text: 'Yesterday' },
        ...Array.from({ length: 3 }, () => ({ className: null, datetime: null, text: '' })),
        { className: '0', datetime: 'false', text: '' },
        { className: 'unvalidated', datetime: ' supplied unchanged ', text: '' },
    ]);
    assert.equal(await page.locator('#bindings [cf-class], #bindings [cf-datetime], #bindings [cf-text]').count(), 0);
    for (const [index, binding] of ['cf-style', 'cf-class-extra', 'cf-datetime-extra'].entries()) {
        await page.locator(`#unsupported-${index}[data-cf-error]`).waitFor();
        assert.match(await page.locator(`#unsupported-${index}`).getAttribute('data-cf-error'), new RegExp(`Unsupported binding: ${binding}`));
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS: class replacement, unchanged datetime, loop scope, empty removal, string conversion, markers, and unsupported binding rejection');
};
