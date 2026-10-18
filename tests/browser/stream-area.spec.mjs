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
const streams = [
  { id: 'work', title: 'A work stream with a deliberately long title for wrapping', area: 'work', state: 'in_progress' },
  { id: 'personal', title: 'B personal plans', area: 'personal', state: 'in_progress' },
  { id: 'neutral', title: 'C neutral plans', area: 'neutral', state: 'in_progress' },
  { id: 'closed-work', title: 'D completed work', area: 'work', state: 'complete' },
  { id: 'closed-personal', title: 'E canceled personal', area: 'personal', state: 'canceled' },
  { id: 'uncategorized', title: 'Uncategorized', area: 'neutral', state: 'in_progress' },
].map((stream, position) => ({ ...stream, user_id: user.id, position }));

for (const theme of ['light', 'dark']) test(`stream area indicators and accessible editing in ${theme}`, async ({ page, isMobile }, testInfo) => {
  page.setDefaultTimeout(10000);
  const cards = streams.flatMap(stream => Array.from({ length: stream.id === 'work' ? 3 : 1 }, (_, index) => ({
    id: stream.id + index, title: `Task ${stream.id} ${index}`, status: 'waiting', stream_id: stream.id,
    user_id: user.id, position: index, is_recurring: false,
  })));
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
      const asset = url.pathname.startsWith('/_next/static/') ? '/' + url.pathname.slice('/_next/'.length) : '/server/app/index.html';
      const contentType = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.woff2') ? 'font/woff2' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : url.pathname.endsWith('.ico') ? 'image/x-icon' : 'text/html';
      return route.fulfill({ body: await readFile(root + (publicFile || '/.next' + asset)), contentType });
    }
    await route.abort();
  });
  await page.goto('http://app.test');

  const filter = page.getByRole('group', { name: 'Area filter', exact: true });
  const cell = title => page.locator('.stream-row [data-area]').filter({ hasText: title });
  const workCell = cell(streams[0].title);
  const personalCell = cell(streams[1].title);
  const workFilter = filter.getByRole('button', { name: 'Work', exact: true });
  const personalFilter = filter.getByRole('button', { name: 'Personal', exact: true });
  const allFilter = filter.getByRole('button', { name: 'All', exact: true });
  const normalText = theme === 'light' ? 'rgb(24, 24, 27)' : 'rgb(237, 237, 237)';
  const style = locator => locator.evaluate(el => {
    const s = getComputedStyle(el); return { background: s.backgroundColor, color: s.color };
  });
  await expect(workCell.getByRole('img', { name: 'Work', exact: true })).toHaveCount(1);
  await expect(personalCell.getByRole('img', { name: 'Personal', exact: true })).toHaveCount(1);
  for (const [areaCell, button] of [[workCell, workFilter], [personalCell, personalFilter]]) {
    expect(await style(areaCell)).toEqual(await style(button));
    expect((await style(button)).color).toBe(normalText);
    expect((await style(button)).background).not.toBe('rgba(0, 0, 0, 0)');
    const iconColor = await areaCell.locator('svg').first().evaluate(el => getComputedStyle(el).color);
    expect(await button.locator('svg').evaluate(el => getComputedStyle(el).color)).toBe(iconColor);
  }
  await expect(cell(streams[2].title).getByRole('img')).toHaveCount(0);
  await expect(cell('Uncategorized').getByRole('button')).toHaveCount(0);
  await expect(cell('Uncategorized')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(cell(streams[3].title).getByText('Complete', { exact: true })).toBeAttached();
  await expect(cell(streams[4].title).getByText('Canceled', { exact: true })).toBeAttached();
  const before = await workFilter.boundingBox();
  await workFilter.click();
  await expect(workFilter).toHaveAttribute('aria-pressed', 'true');
  await expect(personalCell).toHaveCount(0);
  await expect(cell(streams[2].title)).toHaveCount(1);
  expect((await workFilter.boundingBox()).width).toBe(before.width);
  expect(await style(workCell)).toEqual(await style(workFilter));
  await page.reload();
  await expect(workFilter).toHaveAttribute('aria-pressed', 'true');
  await personalFilter.click();
  await expect(workCell).toHaveCount(0);
  await expect(personalCell).toHaveCount(1);
  await allFilter.click();
  await expect(workCell).toHaveCount(1);
  // The tint stretches alongside tall task cells without changing status-cell backgrounds.
  const row = workCell.locator('..');
  const neighboringCell = row.locator('.status-column').first();
  expect(Math.abs((await workCell.boundingBox()).height - (await neighboringCell.boundingBox()).height)).toBeLessThanOrEqual(1);
  await expect(neighboringCell).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const title = workCell.getByRole('button', { name: `Edit stream ${streams[0].title}`, exact: true });
  await title.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(title.locator('svg')).toHaveCSS('opacity', '0');
  const beforePencil = await title.boundingBox();
  if (!isMobile) {
    await title.hover();
    await expect(title.locator('svg')).toHaveCSS('opacity', '1');
    expect(await title.boundingBox()).toEqual(beforePencil);
  }
  await title.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(title).toBeFocused();
  await expect(title.locator('svg')).toHaveCSS('opacity', '1');
  expect(await title.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none');
  await page.screenshot({ path: testInfo.outputPath('area-indicators.png'), scale: 'css' });
  const dialog = page.getByRole('dialog', { name: 'Edit Stream', exact: true });
  for (const key of ['Enter', 'Space']) {
    await title.focus();
    await page.keyboard.press(key);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Title', { exact: true })).toBeFocused();
    const box = await dialog.locator('..').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    await dialog.locator('button[aria-label="Area"]').click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(dialog.locator('button[aria-label="Area"]')).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.locator('button[aria-label="Area"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(title).toBeFocused();
  }
  if (isMobile) await title.tap();
  else await title.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(title).toBeFocused();
  const headerBox = await page.getByRole('banner').boundingBox();
  expect(headerBox.width).toBe(page.viewportSize().width);
  const filterBox = await filter.boundingBox();
  expect(filterBox.x).toBeGreaterThanOrEqual(0);
  expect(filterBox.x + filterBox.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(errors).toEqual([]);
});
