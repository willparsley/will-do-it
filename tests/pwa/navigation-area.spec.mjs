import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(root + '/.env.local');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' }) + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const streams = [{ id: '1', user_id: user.id, title: 'Uncategorized', state: 'in_progress', area: 'neutral', position: 0 }];

for (const theme of ['light', 'dark']) test(`installed Android paints the navigation safe area and keeps forms usable in ${theme} mode`, async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, 'Exercise the installed Android viewport in the mobile project.');
  await page.setViewportSize({ width: 360, height: 740 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ theme, storageKey, session }) => {
    localStorage.setItem('theme', theme);
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = originalMatchMedia(query);
      if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true });
      return result;
    };
  }, { theme, storageKey: 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token', session });
  await page.route(new URL(supabaseUrl).origin + '/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/user') ? user : path.endsWith('/streams') ? streams : path.includes('/rpc/') ? 0 : [];
    await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
  });
  // The board uses real production assets; bypass only server session middleware
  // so the fixture account never reaches the live Supabase backend.
  await page.route('http://127.0.0.1:3101/', async route => {
    await route.fulfill({ body: await readFile(root + '/.next/server/app/index.html'), contentType: 'text/html' });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 24, topMax: 24, bottom: 48, bottomMax: 48, left: 0, right: 0 },
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Quick Add', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-android-pwa', '');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  expect(await page.locator('body').evaluate(element => {
    const style = getComputedStyle(element, '::after');
    return { background: style.backgroundColor, height: style.height, bottom: style.bottom, pointerEvents: style.pointerEvents };
  })).toEqual({ background: 'rgb(0, 153, 91)', height: '48px', bottom: '0px', pointerEvents: 'none' });
  expect(await page.locator('.app-shell').evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe(theme === 'dark' ? 'rgb(23, 23, 26)' : 'rgb(238, 238, 239)');
  expect((await page.locator('.app-header').boundingBox()).y).toBeGreaterThanOrEqual(24);

  await page.getByRole('button', { name: 'Quick Add', exact: true }).click();
  await page.getByPlaceholder('What needs to be done?').fill('Test safe area');
  await page.locator('summary').filter({ hasText: 'Dates & reminder' }).click();
  await page.locator('summary').filter({ hasText: 'Notes' }).click();
  await page.locator('summary').filter({ hasText: 'Repeat' }).click();
  const modal = await page.locator('.modal-panel').boundingBox();
  expect(modal.y).toBeGreaterThanOrEqual(24 + 16);
  expect(modal.y + modal.height).toBeLessThanOrEqual(740 - 48 - 16 + 1);
  const save = page.getByRole('button', { name: 'Create Card', exact: true });
  await expect(save).toBeInViewport();
  expect((await save.boundingBox()).y + (await save.boundingBox()).height).toBeLessThan(740 - 48);
  await page.screenshot({ path: testInfo.outputPath('android-navigation-area.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.modal-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('ordinary browser tabs retain their existing viewport and canvas', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-android-pwa');
  await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute('content', /viewport-fit=cover/);
  expect(await page.locator('body').evaluate(element => getComputedStyle(element, '::after').content)).toBe('none');
});
