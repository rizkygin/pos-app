const { chromium } = require('playwright');
const BASE_URL = 'https://breeder-enduring-manpower.ngrok-free.dev';
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    extraHTTPHeaders: { 'ngrok-skip-browser-warning': 'true' },
  });
  const page = await context.newPage();
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'rizkygin@gmail.com');
  await page.fill('input[type="password"]', '12345678');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  const info = await page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    const cs = getComputedStyle(main);
    return { className: main.className, overflowX: cs.overflowX, overflowY: cs.overflowY };
  });
  console.log(JSON.stringify(info));
  await browser.close();
})();
