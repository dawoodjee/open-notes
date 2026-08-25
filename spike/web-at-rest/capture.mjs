/**
 * Regenerates the spike evidence in one command:
 *   npx vite &          (or npm run dev)
 *   node capture.mjs
 *
 * Drives a real Chrome at ?auto=1 and waits for the page to signal completion
 * by setting document.title. A plain `--screenshot` flag fires before the WASM
 * and IndexedDB work finishes and captures an empty page, which is why this
 * exists instead.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:5173/?auto=1';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 980, height: 1200, deviceScaleFactor: 2 });
page.on('console', (m) => console.log(`  [page] ${m.text()}`));

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.title === 'SPIKE_COMPLETE', { timeout: 120000 });

await page.screenshot({ path: 'evidence/at-rest-scan.png', fullPage: true });
const text = await page.$eval('#out', (el) => el.innerText);
writeFileSync('evidence/at-rest-scan.txt', text);

console.log(text);
console.log('\nWrote evidence/at-rest-scan.png and .txt');
await browser.close();
