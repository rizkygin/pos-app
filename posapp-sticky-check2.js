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

  const mainInfo = await page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    const cs = getComputedStyle(main);
    return {
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      clientHeight: main.clientHeight,
      scrollHeight: main.scrollHeight,
    };
  });
  console.log('main computed overflow:', JSON.stringify(mainInfo));

  // append spacer INSIDE main, then scroll main itself
  await page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    main.appendChild(spacer);
  });
  await page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    main.scrollTop = 600;
  });
  await page.waitForTimeout(300);

  const rect = await page.evaluate(() => {
    const el = document.querySelector('[data-sidebar="trigger"]');
    const r = el.getBoundingClientRect();
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    return { top: r.top, left: r.left, mainScrollTop: main.scrollTop };
  });
  console.log('After scrolling main by 600px, trigger rect:', JSON.stringify(rect));
  await page.screenshot({ path: '/tmp/sticky-scrolled2.png' });

  await browser.close();
})();
