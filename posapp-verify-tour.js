const { chromium } = require('playwright');

const BASE_URL = 'https://breeder-enduring-manpower.ngrok-free.dev';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await context.setExtraHTTPHeaders({ 'ngrok-skip-browser-warning': '1' });

  page.on('console', (msg) => console.log('  [console]', msg.type(), msg.text()));
  page.on('response', (res) => {
    if (res.url().includes('sign-in') || res.url().includes('auth')) {
      console.log('  [auth-response]', res.status(), res.url());
    }
  });

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 20000 });
  console.log('Loaded:', page.url());

  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');

  await emailInput.click();
  await emailInput.type('rizkygin@gmail.com', { delay: 30 });
  await passwordInput.click();
  await passwordInput.type('12345678', { delay: 30 });

  const emailVal = await emailInput.inputValue();
  const passVal = await passwordInput.inputValue();
  console.log('Email field value:', JSON.stringify(emailVal));
  console.log('Password field value:', JSON.stringify(passVal));

  await page.screenshot({ path: '/tmp/login-filled.png' });

  await page.click('button[type="submit"]');
  console.log('Submitted, waiting for response...');

  await page.waitForTimeout(5000);
  console.log('URL after wait:', page.url());

  const errorBox = await page.locator('.text-red-400').first().textContent().catch(() => null);
  if (errorBox) console.log('Error shown:', errorBox);

  await page.screenshot({ path: '/tmp/login-after-submit.png' });

  await browser.close();
})();
