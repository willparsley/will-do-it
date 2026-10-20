import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('installation metadata and icons are public and valid', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/login');
  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await request.get(manifestPath);
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: '/', name: 'Will Do It', start_url: '/', scope: '/', display: 'standalone',
    theme_color: '#008751', background_color: '#008751',
  });
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=auto/);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');
  for (const meta of await page.locator('meta[name="theme-color"]').all()) {
    await expect(meta).toHaveAttribute('content', '#008751');
  }
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
  expect(manifest.icons.find((icon) => icon.purpose === 'maskable')).toBeTruthy();
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBeTruthy();
    const metadata = await sharp(await image.body()).metadata();
    expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes);
    expect(metadata.hasAlpha).toBe(false);
  }
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const apple = await request.get(appleIcon);
  const appleMetadata = await sharp(await apple.body()).metadata();
  expect([appleMetadata.width, appleMetadata.height]).toEqual([180, 180]);
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Will Do It');

  const session = await page.context().newCDPSession(page);
  const { installabilityErrors } = await session.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test('offline navigation recovers online and never caches account requests', async ({ page, context, request }) => {
  const worker = await request.get('/sw.js');
  expect(worker.ok()).toBeTruthy();
  expect(worker.headers()['content-type']).toContain('application/javascript');
  expect(worker.headers()['cache-control']).toContain('no-store');

  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  // The cached, self-contained page follows the OS and explicit app preferences.
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveCSS('background-color', theme === 'dark' ? 'rgb(0, 193, 119)' : 'rgb(0, 135, 81)');
  }
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await page.evaluate(theme => localStorage.setItem('theme', theme), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(23, 23, 26)' : 'rgb(226, 229, 227)');
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveCSS('background-color', theme === 'dark' ? 'rgb(0, 193, 119)' : 'rgb(0, 135, 81)');
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveCSS('color', theme === 'dark' ? 'rgb(11, 18, 32)' : 'rgb(255, 255, 255)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme === 'dark' ? '#00C177' : '#008751');
  }
  await page.evaluate(() => localStorage.removeItem('theme'));
  const cachedPaths = await page.evaluate(async () => {
    const cache = await caches.open('will-do-it-offline-v6');
    return (await cache.keys()).map((entry) => new URL(entry.url).pathname);
  });
  expect(cachedPaths).toEqual(['/offline.html']);
  // Non-navigation requests must fail normally, never receive fallback HTML.
  expect(await page.evaluate(async () => {
    try { await fetch('/account-request-probe', { method: 'POST', body: '{}' }); return false; }
    catch { return true; }
  })).toBe(true);
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
});

test('app theme changes reapply logo green to every system theme tag', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
  for (const dark of [true, false]) {
    await page.evaluate(dark => {
      document.querySelectorAll('meta[name="theme-color"]').forEach(meta => { meta.content = '#ffffff'; });
      document.documentElement.classList.toggle('dark', dark);
    }, dark);
    await expect.poll(() => page.locator('meta[name="theme-color"]').evaluateAll(tags => tags.map(meta => meta.content)))
      .toEqual(dark ? ['#00C177', '#00C177'] : ['#008751', '#008751']);
    await expect(page.getByRole('button', { name: 'Send magic link' })).toHaveCSS('background-color', dark ? 'rgb(0, 193, 119)' : 'rgb(0, 135, 81)');
  }
});
