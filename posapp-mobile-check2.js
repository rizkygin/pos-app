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
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'rizkygin@gmail.com');
  await page.fill('input[type="password"]', '12345678');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  const triggerBox = await page.locator('[data-sidebar="trigger"]').boundingBox();
  console.log('New trigger button box:', JSON.stringify(triggerBox));
  await page.screenshot({ path: '/tmp/mobile-after-fix-1-closed.png' });

  await page.click('[data-sidebar="trigger"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/mobile-after-fix-2-open.png' });

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
