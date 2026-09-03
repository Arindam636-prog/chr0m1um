import { chromium } from 'playwright';

const outputDir = '/Users/arindam/Documents/SIH 2026/contextshield/tmp/presentations/chr0m1um-sih-deck/assets';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outputDir}/judge-home.png`, fullPage: false });

await page.goto('http://127.0.0.1:4173/privacy-proof.html', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outputDir}/privacy-proof.png`, fullPage: false });

await page.goto('http://127.0.0.1:4173/checkout.html', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outputDir}/checkout-demo.png`, fullPage: false });

await browser.close();
