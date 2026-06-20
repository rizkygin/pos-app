const { chromium } = require('playwright');
const BASE_URL = 'https://breeder-enduring-manpower.ngrok-free.dev';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { 'ngrok-skip-browser-warning': 'true' },
  });
  const page = await context.newPage();
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'rizkygin@gmail.com');
  await page.fill('input[type="password"]', '12345678');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  // inject tall content to force a real scroll, then scroll down
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    spacer.id = 'test-spacer';
    document.body.appendChild(spacer);
  });
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(300);

  const rect = await page.evaluate(() => {
    const el = document.querySelector('[data-sidebar="trigger"]');
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, scrollY: window.scrollY };
  });
  console.log('After scrolling 600px, trigger getBoundingClientRect:', JSON.stringify(rect));
  await page.screenshot({ path: '/tmp/sticky-scrolled.png' });

  await browser.close();
})();
