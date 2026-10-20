import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(root + '/.env.local');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const storageKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'reminders@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' }) + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };

for (const theme of ['light', 'dark']) test(`reminder preferences save and reload in ${theme}`, async ({ page }, testInfo) => {
  let preferences = { user_id: user.id, default_reminder_time: '09:00:00', timezone: 'America/New_York' };
  let failSave = false;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ storageKey, session, theme }) => {
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    localStorage.setItem('theme', theme);
  }, { storageKey, session, theme });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === supabaseUrl) {
      if (url.pathname.endsWith('/user')) return route.fulfill({ json: user });
      if (url.pathname.endsWith('/reminder_preferences')) {
        if (request.method() === 'POST') {
          const body = request.postDataJSON();
          expect(body.user_id).toBe(user.id);
          if (body.default_reminder_time) {
            if (failSave) return route.fulfill({ status: 500, json: { message: 'Test save failure' } });
            preferences = body;
          }
          return route.fulfill({ status: 201, json: [] });
        }
        return route.fulfill({ json: preferences });
      }
      return route.fulfill({ json: [] });
    }
    if (url.hostname !== 'app.test') return route.abort();
    const file = url.pathname.startsWith('/branding/') ? '/public' + url.pathname
      : url.pathname.startsWith('/_next/static/') ? '/.next/' + url.pathname.slice('/_next/'.length)
      : '/.next/server/app/profile.html';
    const contentType = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.woff2') ? 'font/woff2' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    return route.fulfill({ body: await readFile(root + file), contentType });
  });
  await page.goto('http://app.test/profile');
  const input = page.getByLabel('Default reminder time', { exact: true });
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('09:00');
  await input.fill('08:30');
  await page.getByRole('button', { name: 'Save reminder preferences', exact: true }).click();
  await expect(page.getByText('Reminder preferences saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue('08:30');
  failSave = true;
  await input.fill('10:45');
  await page.getByRole('button', { name: 'Save reminder preferences', exact: true }).click();
  await expect(page.getByText('Could not save reminder preferences. Please try again.', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('10:45');
  const bounds = await input.boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('reminder-preferences.png'), fullPage: true });
});
