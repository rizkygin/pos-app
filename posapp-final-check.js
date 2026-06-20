const { chromium } = require('playwright');
const BASE_URL = 'https://breeder-enduring-manpower.ngrok-free.dev';

(async () => {
  const browser = await chromium.launch();

  // Desktop check
  const desktopCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'ngrok-skip-browser-warning': 'true' },
  });
  const dPage = await desktopCtx.newPage();
  const dErrors = [];
  dPage.on('console', (m) => { if (m.type() === 'error') dErrors.push(m.text()); });
  dPage.on('pageerror', (e) => dErrors.push(String(e)));
  await dPage.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
  await dPage.fill('input[type="email"]', 'rizkygin@gmail.com');
  await dPage.fill('input[type="password"]', '12345678');
  await dPage.click('button[type="submit"]');
  await dPage.waitForURL('**/dashboard**', { timeout: 15000 });
  await dPage.waitForLoadState('networkidle');
  await dPage.screenshot({ path: '/tmp/final-desktop.png' });
  const dTrigger = await dPage.locator('[data-sidebar="trigger"]').boundingBox();
  console.log('Desktop trigger box:', JSON.stringify(dTrigger));
  console.log('Desktop console errors:', JSON.stringify(dErrors));

  // Real content page check on mobile
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true,
    extraHTTPHeaders: { 'ngrok-skip-browser-warning': 'true' },
  });
  const mPage = await mobileCtx.newPage();
  await mPage.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
  await mPage.fill('input[type="email"]', 'rizkygin@gmail.com');
  await mPage.fill('input[type="password"]', '12345678');
  await mPage.click('button[type="submit"]');
  await mPage.waitForURL('**/dashboard**', { timeout: 15000 });
  for (const path of ['/dashboard/admin/customer', '/dashboard/admin/user']) {
    await mPage.goto(BASE_URL + path, { waitUntil: 'networkidle' });
  }
  await mPage.screenshot({ path: '/tmp/final-mobile-content.png' });

  await browser.close();
})();
