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

  const result = await page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    spacer.style.background = 'linear-gradient(red, blue)';
    main.appendChild(spacer);
    const scrollHeightAfter = main.scrollHeight;
    main.scrollTop = 600;
    const scrollTopImmediately = main.scrollTop;
    const trigger = document.querySelector('[data-sidebar="trigger"]');
    const rectImmediately = trigger.getBoundingClientRect();
    return {
      scrollHeightAfter,
      clientHeight: main.clientHeight,
      scrollTopImmediately,
      rectTopImmediately: rectImmediately.top,
    };
  });
  console.log('Combined result:', JSON.stringify(result));

  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    const trigger = document.querySelector('[data-sidebar="trigger"]');
    const r = trigger.getBoundingClientRect();
    return { mainScrollTop: main.scrollTop, triggerTop: r.top };
  });
  console.log('After 300ms wait:', JSON.stringify(after));
  await page.screenshot({ path: '/tmp/sticky-scrolled3.png' });

  await browser.close();
})();
