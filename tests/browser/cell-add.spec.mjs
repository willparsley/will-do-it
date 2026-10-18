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
const statuses = ['backlog', 'priority_backlog', 'research', 'waiting', 'in_progress', 'complete', 'canceled'];
const labels = ['Backlog', 'Priority Backlog', 'Research', 'Waiting', 'In Progress', 'Complete', 'Canceled'];
const streams = ['Work stream', 'Uncategorized', 'Closed complete', 'Closed canceled', 'Hidden stream'].map((title, i) => ({ id: String(i), user_id: user.id, title, state: i === 2 ? 'complete' : i === 3 ? 'canceled' : 'in_progress', area: 'neutral', position: i }));

// Exercise the built application, intercepting every account read/write.
for (const theme of ['light', 'dark']) test(`cell add defaults, saves, focus, and drag in ${theme} mode`, async ({ page, isMobile }, testInfo) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  let cards = streams.slice(0, 4).flatMap(stream => ['backlog', 'waiting', 'complete'].map(status => ({ id: stream.id + status, user_id: user.id, stream_id: stream.id, title: stream.title + ' ' + status, status, is_recurring: false, position: 0, completed_at: new Date().toISOString() })));
  cards.push(...['in_progress'].map(status => ({ id: '0' + status, user_id: user.id, stream_id: '0', title: 'Work stream ' + status, status, is_recurring: false, position: 0 })));
  let failSave = false;
  const calls = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ storageKey, session, theme }) => {
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    localStorage.setItem('theme', theme);
  }, { storageKey, session, theme });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      let data = url.pathname.endsWith('/user') ? user : url.pathname.endsWith('/streams') ? streams : url.pathname.endsWith('/cards') ? cards : url.pathname.endsWith('/recurrence_sources') ? [] : 0;
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        calls.push({ path: url.pathname, body });
        if (url.pathname.endsWith('/cards') || url.pathname.endsWith('/create_recurring_card_with_prerequisite')) {
          if (failSave) return route.fulfill({ status: 400, json: { message: 'Try saving again' } });
          data = { id: 'created-' + calls.length, user_id: user.id, position: 0, ...(url.pathname.endsWith('/cards') ? body : { title: body.p_title, stream_id: body.p_stream_id, status: body.p_status, is_recurring: true }), completed_at: new Date().toISOString() };
          cards.push(data);
        }
      }
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
  const addButton = (stream, status) => page.getByRole('button', { name: `Add card to ${stream} — ${status}.`, exact: true, includeHidden: true });
  await expect(page.locator('.status-dot')).toHaveCount(3);
  await expect(page.locator('.card[data-card-id="0in_progress"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('active-status-palette.png'), scale: 'css' });
  const dialog = page.getByRole('dialog', { name: 'Add New Card', exact: true });
  const streamSelect = () => dialog.locator('button[aria-label="Stream"]');
  const statusSelect = () => dialog.locator('button[aria-label="Status"]');
  let confirmations = 0;
  const dismissConfirmation = async prompt => { confirmations++; await prompt.dismiss(); };
  page.on('dialog', dismissConfirmation);
  for (const [view, viewStatuses] of [['Active', [2, 3, 4]], ['Backlog', [0, 1, 2]], ['All', statuses.map((_, i) => i)], ['Archive', [5, 6]]]) {
    await page.getByRole('group', { name: 'Board view', exact: true }).locator('button[aria-pressed]').filter({ hasText: new RegExp('^' + view + '$') }).click();
    await expect(addButton('Work stream', labels[viewStatuses[0]])).toBeAttached();
    await expect(page.locator('.status-dot-review')).toHaveCount(0);
    if (view === 'All') {
      const contrasts = await page.evaluate(({ statuses }) => {
        const style = getComputedStyle(document.documentElement);
        const token = name => style.getPropertyValue(name).trim();
        const luminance = hex => {
          const rgb = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
        return statuses.flatMap(status => ['--canvas', '--surface', '--surface-sunken'].map(surface => ({
          label: status + ' on ' + surface, ratio: contrast(token('--status-' + status), token(surface)),
        })));
      }, { statuses });
      for (const { label, ratio } of contrasts) expect(ratio, label).toBeGreaterThanOrEqual(3);
      await page.screenshot({ path: testInfo.outputPath('status-palette.png'), scale: 'css' });
    }
    await expect(page.getByRole('button', { name: /^Add card to Closed/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Add card to Hidden/ })).toHaveCount(0);
    for (const stream of ['Work stream', 'Uncategorized']) for (const index of viewStatuses) {
      const button = addButton(stream, labels[index]);
      await expect(button).toHaveAttribute('title', `Add card to ${stream} — ${labels[index]}.`);
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(streamSelect()).toContainText(stream);
      await expect(statusSelect()).toContainText(labels[index]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(button).toBeFocused();
    }
  }
  expect(confirmations).toBe(0);
  await page.getByRole('button', { name: 'Quick Add', exact: true }).click();
  await expect(streamSelect()).toContainText('Uncategorized');
  await expect(statusSelect()).toContainText('Backlog');
  await page.keyboard.press('Escape');

  // Dirty draft protection, editable defaults, and failed saves retain the draft.
  const canceled = addButton('Work stream', 'Canceled');
  await canceled.focus();
  await page.keyboard.press('Space');
  await dialog.getByLabel('Title', { exact: true }).fill('Cell-created ordinary card');
  await page.keyboard.press('Escape');
  expect(confirmations).toBe(1);
  await expect(dialog).toBeVisible();
  await streamSelect().click();
  await page.getByRole('option', { name: 'Uncategorized', exact: true }).click();
  await statusSelect().click();
  await page.getByRole('option', { name: 'Complete', exact: true }).click();
  failSave = true;
  await dialog.getByRole('button', { name: 'Create Card', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Try saving again');
  await expect(streamSelect()).toContainText('Uncategorized');
  await expect(statusSelect()).toContainText('Complete');
  failSave = false;
  await dialog.getByRole('button', { name: 'Create Card', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(canceled).toBeFocused();
  const ordinary = calls.filter(call => call.path.endsWith('/cards')).at(-1).body;
  expect(ordinary).toMatchObject({ title: 'Cell-created ordinary card', stream_id: '1', status: 'complete', position: 0 });
  const recurring = addButton('Work stream', 'Complete');
  await recurring.click();
  await dialog.getByLabel('Title', { exact: true }).fill('Cell-created recurring card');
  await dialog.locator('summary').filter({ hasText: 'Repeat' }).click();
  await dialog.getByRole('button', { name: 'Create Card', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(calls.find(call => call.path.endsWith('/create_recurring_card_with_prerequisite')).body).toMatchObject({ p_title: 'Cell-created recurring card', p_stream_id: '0', p_status: 'complete' });
  await expect.poll(() => calls.filter(call => call.path.endsWith('/promote_due_cards')).length).toBeGreaterThan(1);

  // Desktop hover/focus and touch visibility reserve exactly the same cell space.
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await page.getByRole('button', { name: 'Active', exact: true }).focus();
  const button = addButton('Work stream', 'Research');
  await button.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const cell = button.locator('..');
  const before = await cell.boundingBox();
  await expect(button).toHaveCSS('height', '44px');
  await expect(button).toHaveCSS('border-top-style', 'dashed');
  await expect(button).toHaveCSS('opacity', isMobile ? '0.5' : '0');
  if (!isMobile) {
    await cell.hover();
    await expect(button).toHaveCSS('opacity', '1');
    expect(await cell.boundingBox()).toEqual(before);
  }
  await page.screenshot({ path: testInfo.outputPath('cell-add.png'), scale: 'css' });
  if (!isMobile) {
    const card = page.locator('.card').filter({ hasText: 'Work stream waiting' });
    const cardBox = await card.boundingBox();
    await page.mouse.move(cardBox.x + 20, cardBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + 35, cardBox.y + 35, { steps: 5 });
    await expect(button).toBeDisabled();
    await expect(button).toHaveCSS('visibility', 'hidden');
    const target = await cell.boundingBox();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await expect(cell.getByText('Drop here', { exact: true })).toBeVisible();
    await expect(cell).toHaveCSS('border-top-style', 'dashed');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(button).toBeEnabled();
    expect(await cell.boundingBox()).toEqual(before);
  }
  page.off('dialog', dismissConfirmation);
  expect(errors).toEqual([]);
});
