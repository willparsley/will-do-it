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
const streams = ['Work stream', 'Uncategorized', 'Closed complete', 'Closed canceled', 'Hidden stream'].map((title, i) => ({ id: String(i), user_id: user.id, title, state: i === 2 ? 'complete' : i === 3 ? 'canceled' : 'in_progress', area: 'neutral', position: i }));

// Fixtures intercept all backend reads; no live account data is touched.
for (const theme of ['light', 'dark']) test(`Later groups across layouts and Profile in ${theme}`, async ({ page, isMobile }, testInfo) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const future = new Date(); future.setDate(future.getDate() + 90); future.setHours(12, 0, 0, 0);
  const soon = new Date(); soon.setDate(soon.getDate() + 2); soon.setHours(12, 0, 0, 0);
  const cards = ['backlog', 'priority_backlog', 'research'].flatMap(status => [
    { id: status + '-future', user_id: user.id, stream_id: '0', title: 'Distant ' + status, status, due_at: future.toISOString(), position: 0, is_recurring: false },
    { id: status + '-soon', user_id: user.id, stream_id: '0', title: 'Soon ' + status, status, due_at: soon.toISOString(), position: 1, is_recurring: false },
    { id: status + '-undated', user_id: user.id, stream_id: '0', title: 'Undated ' + status, status, position: 2, is_recurring: false },
  ]);
  cards.push({ id: 'recurring-future', user_id: user.id, stream_id: '0', title: 'Distant recurring', status: 'backlog', due_at: future.toISOString(), position: 3, is_recurring: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ storageKey, session, theme }) => {
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    localStorage.setItem('theme', theme);
  }, { storageKey, session, theme });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      const data = url.pathname.endsWith('/user') ? user : url.pathname.endsWith('/streams') ? streams : url.pathname.endsWith('/cards') ? cards : url.pathname.endsWith('/recurrence_sources') ? [] : 0;
      return route.fulfill({ json: data });
    }
    if (url.hostname === 'app.test') {
      const publicFile = url.pathname.startsWith('/branding/') ? '/public' + url.pathname : url.pathname === '/icon.svg' ? '/app/icon.svg' : url.pathname === '/favicon.ico' ? '/app/favicon.ico' : null;
      const asset = url.pathname.startsWith('/_next/static/') ? '/' + url.pathname.slice('/_next/'.length) : (url.pathname === '/profile' ? '/server/app/profile.html' : '/server/app/index.html');
      const contentType = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.woff2') ? 'font/woff2' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : url.pathname.endsWith('.ico') ? 'image/x-icon' : 'text/html';
      return route.fulfill({ body: await readFile(root + (publicFile || '/.next' + asset)), contentType });
    }
    await route.abort();
  });

  await page.goto('http://app.test');
  await page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: 'Backlog', exact: true }).click();
  const chooseLayout = async label => {
    await page.locator(isMobile ? 'button[aria-label="Mobile layout"]' : 'button[aria-label="Desktop layout"]').click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  for (const layout of ['Board', 'By status', 'By stream']) {
    await chooseLayout(layout);
    const groups = page.locator('[data-later-status]');
    await expect(groups).toHaveCount(2);
    const later = page.locator('[data-later-status="backlog"]');
    await expect(later).not.toHaveAttribute('open');
    await expect(later.locator('summary')).toContainText('Later');
    await expect(later.locator('summary')).toContainText('2');
    await expect(page.getByText('Soon backlog', { exact: true })).toBeVisible();
    await expect(page.getByText('Undated backlog', { exact: true })).toBeVisible();
    await expect(page.getByText('Distant backlog', { exact: true })).toBeHidden();
    await expect(page.getByText('Distant research', { exact: true })).toBeVisible();
    await later.locator('summary').click();
    await expect(page.getByText('Distant backlog', { exact: true })).toBeVisible();
    await expect(page.getByText('Distant recurring', { exact: true })).toBeVisible();

    await later.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Distant backlog', { exact: true })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath(layout.replaceAll(' ', '-') + '.png'), scale: 'css' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const hideRecurring = page.getByRole('switch', { name: 'Hide recurring' });
  if (!await hideRecurring.isVisible()) await page.getByRole('button', { name: /^Filters/ }).click();
  await hideRecurring.check();
  const done = page.getByRole('button', { name: 'Done', exact: true });
  if (await done.isVisible()) await done.click();
  await expect(page.locator('[data-later-status="backlog"] > summary')).toContainText('1');
  await expect(page.getByText('Distant recurring', { exact: true })).toHaveCount(0);
  await page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('[data-later-status]')).toHaveCount(2);
  await page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: 'Active', exact: true }).click();
  await expect(page.locator('[data-later-status]')).toHaveCount(0);
  await page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: 'Backlog', exact: true }).click();
  await page.goto('http://app.test/profile');
  await expect(page.getByRole('spinbutton', { name: 'Show cards this many days ahead' })).toHaveValue('3');
  await page.getByRole('spinbutton', { name: 'Show cards this many days ahead' }).fill('100');
  await page.getByRole('button', { name: 'Save Later preferences' }).click();
  await expect(page.getByText('Later preferences saved.')).toBeVisible();
  await page.goto('http://app.test');
  await expect(page.locator('[data-later-status]')).toHaveCount(0);
  await expect(page.getByText('Distant backlog', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
