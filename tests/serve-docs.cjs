const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

module.exports = async browser => {
  // Exercise the actual dev server with docs/ as its root, independently of
  // the suite's repository-root server and without any packaging step.
  const server = spawn(process.execPath, [path.join(__dirname, '../scripts/serve-docs.mjs')], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = once(server, 'exit');
  const page = await browser.newPage();
  try {
    const base = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Docs server did not start')), 10000);
      server.stdout.on('data', chunk => {
        output += chunk;
        const url = output.match(/Local: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
        if (url) { clearTimeout(timer); resolve(url); }
      });
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Docs server exited: ${code}`)); });
    });
    const external = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(base).origin) external.push(url.href);
    });
    await page.goto(base + 'quickstart.html#editing');
    await page.waitForFunction(() => document.body.dataset.docsReady === 'true' && !document.querySelector('cf-data[aria-busy]'));
    assert.equal(await page.locator('aside nav a').count(), 18);
    assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-nav-topic'), 'quickstart');
    const example = page.locator('[data-example="hello"]');
    await example.getByRole('button', { name: 'Edit example', exact: true }).click();
    await example.locator('.cm-editor').waitFor();
    await example.getByRole('button', { name: 'Run', exact: true }).click();
    await example.locator('iframe').contentFrame().getByText('A page made of HTML', { exact: true }).waitFor();
    assert.deepEqual(external, [], 'Docs and editor load entirely from the served source directory');
    assert.equal((await page.request.get(base + 'package.json')).status(), 404, 'Server exposes only docs');
    assert.equal((await page.request.get(base + 'data/topics.json')).headers()['content-type'], 'application/json');
  } finally {
    await page.close();
    server.kill();
    await exited;
  }
  console.log('PASS: docs-only static server, direct anchor load, local editor, no external dependencies or packaging');
};
