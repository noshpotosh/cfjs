import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../cfjs.js', import.meta.url);
const target = new URL('../docs/vendor/cfjs.js', import.meta.url);
const canonical = await readFile(source);
if (process.argv.includes('--check')) {
  if (!canonical.equals(await readFile(target))) {
    console.error('Docs runtime differs from cfjs.js. Compare the copies, then run npm run docs:sync.');
    process.exitCode = 1;
  } else console.log('Docs runtime matches cfjs.js.');
} else {
  await writeFile(target, canonical);
  console.log('Copied cfjs.js to docs/vendor/cfjs.js.');
}
