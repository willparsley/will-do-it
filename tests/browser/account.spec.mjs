import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(root + '/.env.local');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const storageKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' }) + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };

async function setup(page, theme, signedIn = true) {
  await page.addInitScript(({ storageKey, session, theme, signedIn }) => {
    if (signedIn) document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    localStorage.setItem('theme', theme);
  }, { storageKey, session, theme, signedIn });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      if (url.pathname.endsWith('/logout')) return route.fulfill({ json: {} });
      return route.fulfill({ json: url.pathname.endsWith('/user') ? user : url.pathname.includes('/rpc/') ? 0 : [] });
    }
    if (url.hostname !== 'app.test') return route.abort();
    const publicFile = url.pathname.startsWith('/branding/') ? '/public' + url.pathname : null;
    const asset = url.pathname.startsWith('/_next/static/') ? '/' + url.pathname.slice('/_next/'.length)
      : '/server/app/' + (url.pathname === '/profile' ? 'profile' : url.pathname === '/login' ? 'login' : 'index') + (route.request().headers()['rsc'] === '1' ? '.rsc' : '.html');
    const contentType = route.request().headers()['rsc'] === '1' ? 'text/x-component' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.woff2') ? 'font/woff2' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    return route.fulfill({ body: await readFile(root + (publicFile || '/.next' + asset)), contentType });
  });
}

for (const theme of ['light', 'dark']) test(`account menu, profile, and helper text in ${theme}`, async ({ page, isMobile }, testInfo) => {
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page, theme);
  await page.goto('http://app.test');
  const account = page.getByRole('button', { name: 'Account menu' });
  await account.click();
  const menu = page.getByRole('menu', { name: 'Account menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  await expect(menu).toHaveCSS('color', theme === 'dark' ? 'rgb(237, 237, 237)' : 'rgb(37, 43, 40)');
  const box = await menu.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({ path: testInfo.outputPath('account-menu.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(account).toBeFocused();
  await account.click();
  await page.mouse.click(5, 5);
  await expect(menu).toBeHidden();
  if (!isMobile) {
    const themeButton = page.getByRole('button', { name: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode' });
    await themeButton.hover();
    await expect(page.getByRole('tooltip')).toHaveText(theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'New Stream', exact: true }).focus();
    await expect(page.getByRole('tooltip')).toHaveText('Create a stream to organize your cards');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toBeHidden();
    await account.focus();
    await page.keyboard.press('ArrowDown');
  } else await account.click();
  await expect(menu).toBeVisible();
  await page.getByRole('menuitem', { name: 'Profile', exact: true }).click();
  await expect(page).toHaveURL('http://app.test/profile');
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await expect(page.locator('dd')).toHaveText(user.email);
  await page.screenshot({ path: testInfo.outputPath('profile.png') });
  await page.getByRole('link', { name: 'Back to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Will Do It', exact: true })).toBeVisible();
  await account.click();
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL('http://app.test/login');
  expect(errors).toEqual([]);
});

test('signed-out profile redirects to sign-in', async ({ page }) => {
  await setup(page, 'light', false);
  await page.goto('http://app.test/profile');
  await expect(page).toHaveURL('http://app.test/login');
  await expect(page.getByRole('heading', { name: 'Your profile' })).toHaveCount(0);
});
