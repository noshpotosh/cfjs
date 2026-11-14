const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async (browser, origin) => {
  const base = origin + '/docs/';
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, '../docs/data/examples.json')));
  const originals = Object.fromEntries(await Promise.all([...new Set(Object.values(manifest).flatMap(example => example.files))].map(async file => [file, await fs.readFile(path.join(__dirname, '../docs/examples', file), 'utf8')])));
  let editorRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/editor.js')) editorRequests++; });
  async function open(slug, key) {
    const before = editorRequests;
    await page.goto(base + slug + '.html');
    assert.equal(editorRequests, before, 'Editor is not requested until opt-in');
    const example = page.locator(`[data-example="${key}"]`).first();
    await example.getByRole('button', { name: 'Edit example', exact: true }).click();
    await example.locator('.cm-editor').first().waitFor({ state: 'attached' });
    return example;
  }
  const frame = example => example.locator('iframe').contentFrame();
  async function edit(example, file, text) {
    await example.getByRole('tab', { name: file, exact: true }).click();
    await example.getByRole('textbox', { name: 'Edit ' + file, exact: true }).fill(text);
  }
  async function run(example) {
    await example.getByRole('button', { name: 'Run', exact: true }).click();
    await example.locator('.draft-status').filter({ hasText: 'Preview matches' }).waitFor();
    await frame(example).locator('body').waitFor({ state: 'attached' });
    await example.locator('.preview-status').filter({ hasNotText: 'Loading snapshot…' }).waitFor();
  }
  async function text(example, selector, expected) {
    await frame(example).locator(selector).filter({ hasText: expected }).first().waitFor();
  }
  let example = await open('quickstart', 'hello');
  await edit(example, 'hello.html', originals['hello.html'].replace('A page made of HTML', 'Draft title'));
  assert.match(await example.locator('.draft-status').textContent(), /Unrun edits/);
  await text(example, 'h2', 'A page made of HTML');
  await page.keyboard.press('ControlOrMeta+Enter');
  await text(example, 'h2', 'Draft title');
  assert.equal(await example.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copied = text; } } }));
  await example.locator('.copy-button').click();
  assert.match(await page.evaluate(() => window.copied), /Draft title/);
  await example.getByRole('textbox').press('Escape');
  assert(await example.locator('.run-example').evaluate(node => node === document.activeElement));
  await example.getByRole('button', { name: 'Exit editor' }).click();
  assert.match(await example.locator('code').textContent(), /Draft title/);
  await example.getByRole('button', { name: 'Edit example', exact: true }).click();
  assert.match(await example.getByRole('textbox').textContent(), /Draft title/);
  // A second example on this page keeps its own state and preview.
  const second = page.locator('[data-example="composition"]');
  await second.getByRole('button', { name: 'Edit example', exact: true }).click();
  await second.getByRole('textbox').first().waitFor();
  await edit(second, 'card.html', '<section><h2>Independent</h2></section>');
  await run(second);
  await text(second, 'h2', 'Independent');
  await text(example, 'h2', 'Draft title');
  await example.getByRole('button', { name: 'Reset example' }).click();
  await text(example, 'h2', 'A page made of HTML');
  assert.equal(await example.locator('[role="tabpanel"]:visible').evaluate(panel => panel.editorView.state.doc.toString()), originals['hello.html']);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.docsReady === 'true');
  assert.equal(await page.locator('.cm-editor').count(), 0);
  assert.equal(await page.locator('[data-example="composition"] code').nth(1).textContent(), originals['card.html']);

  example = await open('compose', 'composition');
  const changed = '<section><h2>Fragment draft</h2><script>document.currentScript.parentElement.dataset.ran="yes"</script></section>';
  await edit(example, 'card.html', changed);
  await example.getByRole('textbox').press('End');
  await page.keyboard.type(' ');
  const selection = await example.locator('[role="tabpanel"]:visible').evaluate(panel => panel.editorView.state.selection.main.head);
  await example.getByRole('tab', { name: 'composition.html', exact: true }).click();
  await edit(example, 'composition.html', originals['composition.html'].replace('Composed with CFJS', 'Entry draft'));
  await example.getByRole('tab', { name: 'card.html', exact: true }).click();
  assert.equal(await example.locator('[role="tabpanel"]:visible').evaluate(panel => panel.editorView.state.selection.main.head), selection);
  await example.getByRole('textbox', { name: 'Edit card.html' }).press('ControlOrMeta+z');
  assert.equal(await example.locator('[role="tabpanel"]:visible').evaluate(panel => panel.editorView.state.doc.toString()), originals['card.html']);
  await example.getByRole('textbox', { name: 'Edit card.html' }).press('ControlOrMeta+Shift+z');
  assert.equal(await example.getByRole('textbox', { name: 'Edit card.html' }).textContent(), changed + ' ');
  await run(example);
  await text(example, 'h2', 'Fragment draft');
  assert.equal(await frame(example).locator('section').getAttribute('data-ran'), 'yes');
  // Keyboard tablist navigation stays on tabs, with visible focus and one panel.
  await example.getByRole('tab').first().focus();
  await page.keyboard.press('End');
  assert.equal(await example.getByRole('tab').last().getAttribute('aria-selected'), 'true');
  assert(await example.getByRole('tab').last().evaluate(node => node === document.activeElement));
  assert.equal(await example.locator('[role="tabpanel"]:visible').count(), 1);

  example = await open('render-data', 'json');
  await edit(example, 'json.html', originals['json.html'].replace('<h2 cf-text="response.title"></h2>', '<h2 cf-text="response.title"></h2><p>Whole snapshot</p>'));
  await edit(example, '../data/examples/projects.json', '{"title":"Edited JSON"}');
  await run(example);
  await text(example, 'h2', 'Edited JSON');
  await text(example, 'p', 'Whole snapshot');
  await edit(example, '../data/examples/projects.json', '{invalid');
  await run(example);
  await text(example, '[role="alert"]', 'Projects could not load.');
  // Native JSON parse messages differ between browser engines. Verify that the
  // actual CFJS error reaches the preview status instead of matching its wording.
  const jsonError = await frame(example).locator('[data-cf-error]').getAttribute('data-cf-error');
  assert(jsonError);
  await example.locator('.preview-status').filter({ hasText: jsonError }).waitFor();
  await edit(example, '../data/examples/projects.json', '{"title":"Recovered"}');
  await run(example);
  await text(example, 'h2', 'Recovered');
  await edit(example, 'json.html', originals['json.html'].replace('../data/examples/projects.json', './missing.json'));
  await run(example);
  await example.locator('.preview-status').filter({ hasText: 'not listed' }).waitFor();
  await example.getByRole('button', { name: 'Reset example' }).click();
  await text(example, 'h2', 'Selected projects');

  example = await open('render-data', 'global');
  await edit(example, '../scripts/examples/global.js', 'window.projectData = {title: "Classic edited"};');
  await run(example);
  await text(example, 'h2', 'Classic edited');
  await edit(example, '../scripts/examples/global.js', 'const = broken');
  await run(example);
  await example.locator('.preview-status').filter({ hasText: 'SyntaxError:' }).waitFor();
  await edit(example, '../scripts/examples/global.js', 'window.projectData = {title: "Fixed"}; Promise.reject(new Error("rejected test"));');
  await run(example);
  await text(example, 'h2', 'Fixed');
  await example.locator('.preview-status').filter({ hasText: 'rejected test' }).waitFor();
  // Parser classics execute before inline scripts; deferred classics run after parsing.
  await edit(example, '../scripts/examples/global.js', 'window.order = (window.order || "") + (document.querySelector("#marker") ? "D" : "A"); window.projectData = {};');
  await edit(example, 'global.html', '<script src="../scripts/examples/global.js"></script><script>window.order += "B"</script><script defer src="../scripts/examples/global.js"></script><p id="marker"></p><script>addEventListener("DOMContentLoaded",()=>document.querySelector("p").textContent=window.order)</script>');
  await run(example);
  await text(example, 'p', 'ABD');

  example = await open('scripts', 'scripts');
  await edit(example, '../scripts/examples/status.js', 'document.currentScript.parentElement.dataset.external = "edited";');
  await run(example);
  await frame(example).locator('section[data-external="edited"]').waitFor();
  await edit(example, 'status.html', '<section><script src="./scripts.html"></script><script>window.fragmentRan = true; throw new Error("fragment runtime error")</script></section>');
  await run(example);
  await example.locator('.preview-status').filter({ hasText: 'not listed' }).waitFor();
  assert.equal(await frame(example).locator('body').evaluate(() => window.fragmentRan), true);
  // WebKit can redact dynamic script errors in an opaque-origin sandbox.
  await example.locator('.preview-status').filter({ hasText: /fragment runtime error|Script error\./ }).waitFor();
  // Supplied styles and scripts in fragments pass through resource conversion too.
  await edit(example, 'status.html', '<link rel="stylesheet" href="../styles/examples.css"><section><p>Before</p><script>document.currentScript.parentElement.querySelector("p").textContent="Fragment recovered"</script></section>');
  await run(example);
  await text(example, 'p', 'Fragment recovered');
  await edit(example, 'status.html', '<cf-include src="./status.html"></cf-include>');
  await run(example);
  await example.locator('.preview-status').filter({ hasText: 'Circular include' }).waitFor();
  await example.getByRole('button', { name: 'Reset example' }).click();
  await text(example, '.status', 'Inline script ran after mounting.');

  // Messages require both the current frame WindowProxy and current run id.
  const stale = await example.locator('iframe').evaluate(node => ({ run: node.srcdoc.match(/\},"[^\"]+","([^\"]+)"\)/)?.[1] }));
  assert(stale.run, 'Extracted snapshot identity');
  await example.locator('iframe').evaluate(node => { window.replacedPreview = node.contentWindow; });
  await run(example);
  await text(example, '.status', 'Inline script ran after mounting.');
  const previousStatus = await example.locator('.preview-status').textContent();
  await example.evaluate((node, stale) => {
    const source = node.querySelector('iframe').contentWindow;
    const currentRun = node.querySelector('iframe').srcdoc.match(/\},"[^\"]+","([^\"]+)"\)/)[1];
    for (const [sender, run] of [[source, 'stale'], [window.replacedPreview, currentRun], [window, currentRun]]) {
      const event = new MessageEvent('message', { data: { type: 'cfjs-preview', run, kind: 'error', message: '<b>stale message</b>' } });
      // WebKit rejects detached WindowProxy objects in the constructor. Supply
      // the stale source explicitly to exercise our message filter on all engines.
      Object.defineProperty(event, 'source', { value: sender });
      dispatchEvent(event);
    }
  }, stale);
  assert.equal(await example.locator('.preview-status').textContent(), previousStatus);

  example = await open('quickstart', 'hello');
  await page.evaluate(() => localStorage.setItem('editor-secret', 'private'));
  await edit(example, 'hello.html', `<p id="result"></p><script>
    let results=[];
    for (const check of [()=>parent.document.body, ()=>parent.localStorage.getItem('editor-secret'), ()=>localStorage.getItem('editor-secret'), ()=>{top.location.href='https://example.com/escape'}]) {
      try {check(); results.push('allowed')} catch {results.push('blocked')}
    }
    document.querySelector('p').textContent=results.join(',');
  </script>`);
  await run(example);
  await text(example, '#result', 'blocked,blocked,blocked,blocked');
  assert.equal(page.url(), base + 'quickstart.html');
  // Network, modules, and unsupplied styles report errors, then recover on reset.
  await edit(example, 'hello.html', '<link rel="stylesheet" href="https://example.com/a.css"><script type="module">import "https://example.com/a.js"</script><script>fetch("https://example.com/data")</script>');
  await run(example);
  await example.locator('.preview-status').filter({ hasText: 'not supplied' }).waitFor();
  await example.locator('.preview-status').filter({ hasText: 'Modules' }).waitFor();
  await example.locator('.preview-status').filter({ hasText: 'not listed' }).waitFor();
  assert.equal(await example.locator('.preview-status script, .preview-status b').count(), 0);
  await example.getByRole('button', { name: 'Reset example' }).click();
  await text(example, 'h2', 'A page made of HTML');
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Editor fits ${width}px`);
    if (process.env.DOCS_SCREENSHOTS) {
      await fs.mkdir(process.env.DOCS_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.DOCS_SCREENSHOTS, `editor-${width}.png`), fullPage: true });
    }
    for (const name of ['Run', 'Reset example', 'Exit editor']) {
      const bounds = await example.getByRole('button', { name, exact: true }).boundingBox();
      assert(bounds.width > 20 && bounds.x >= 0 && bounds.x + bounds.width <= width, `${name} fits ${width}px`);
    }
  }
  // Every published example can opt in and run without changing its source.
  const topics = JSON.parse(await fs.readFile(path.join(__dirname, '../docs/data/topics.json')));
  for (const key of Object.keys(manifest)) {
    let slug;
    for (const topic of topics) {
      if ((await fs.readFile(path.join(__dirname, '../docs', topic.slug + '.html'), 'utf8')).includes(`data-example="${key}"`)) { slug = topic.slug; break; }
    }
    example = await open(slug, key);
    await run(example);
    if (key === 'independent') {
      await text(example, 'h2', 'Available immediately');
      await text(example, 'p', 'Optional details arrived independently.');
    }
    if (key === 'states') {
      await example.locator('.preview-status').filter({ hasText: 'Example provider unavailable' }).waitFor();
      await text(example, 'p', 'No projects yet.');
    } else {
      await frame(example).locator('body').evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
      assert.equal(await frame(example).locator('[data-cf-error]').count(), 0, key);
      assert(!/not listed|not supplied|Error/.test(await example.locator('.preview-status').textContent()), key);
    }
  }
  await page.close();
  const failed = await browser.newPage();
  await failed.route('**/editor.js', route => route.abort());
  await failed.goto(base + 'quickstart.html');
  const block = failed.locator('[data-example="hello"]');
  await block.getByRole('button', { name: 'Edit example', exact: true }).click();
  await block.locator('.preview-status').filter({ hasText: 'Editor could not load' }).waitFor();
  assert.equal(await block.locator('code').textContent(), originals['hello.html']);
  await block.locator('iframe').contentFrame().getByText('A page made of HTML', { exact: true }).waitFor();
  assert.equal(await block.getByRole('link', { name: 'Open original example' }).count(), 1);
  await failed.close();
  const missingVendor = await browser.newPage();
  await missingVendor.route('**/vendor/codemirror.js', route => route.abort());
  await missingVendor.goto(base + 'quickstart.html');
  const unavailable = missingVendor.locator('[data-example="hello"]');
  await unavailable.getByRole('button', { name: 'Edit example', exact: true }).click();
  await unavailable.locator('.preview-status').filter({ hasText: 'Editor could not load' }).waitFor();
  assert.equal(await unavailable.locator('code').textContent(), originals['hello.html']);
  await unavailable.locator('iframe').contentFrame().getByText('A page made of HTML', { exact: true }).waitFor();
  await missingVendor.close();
  console.log('PASS: vendored client-side editors, independent drafts, per-file undo/selection, snapshots, reset/reload, error recovery, sandbox, stale messages, keyboard/copy, responsive controls, loading failure');
};
