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

// Real production assets with intercepted account traffic; no live writes.
for (const theme of ['light', 'dark']) test(`card selection and actions in ${theme}`, async ({ page, isMobile }, testInfo) => {
  page.setDefaultTimeout(10000);
  let cards = [
    { id: 'first', title: 'First task', status: 'waiting' },
    { id: 'second', title: 'Second task', status: 'review' },
    { id: 'finished', title: 'Finished task', status: 'complete' },
    { id: 'canceled', title: 'Canceled task', status: 'canceled' },
  ].map(card => ({ ...card, user_id: user.id, stream_id: '0', position: 0, is_recurring: false, completed_at: new Date().toISOString() }));
  let undoCard;
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
        if (url.pathname.endsWith('/save_card_with_undo')) {
          undoCard = { ...cards.find(card => card.id === body.p_card_id) };
          cards = cards.map(card => card.id === body.p_card_id ? { ...card, ...body.p_changes } : card);
          data = { card: cards.find(card => card.id === body.p_card_id), undo_id: 'undo' };
        }
        if (url.pathname.endsWith('/undo_card_action')) {
          cards = cards.map(card => card.id === undoCard.id ? undoCard : card);
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

  const first = page.locator('.card[data-card-id="first"]');
  await expect(first).toHaveCSS('background-color', theme === 'dark' ? 'rgb(41, 41, 46)' : 'rgb(247, 248, 246)');
  const second = page.locator('.card[data-card-id="second"]');
  const editDialog = page.getByRole('dialog', { name: 'Edit Card', exact: true });
  const press = button => isMobile ? button.tap() : button.click();
  const select = async card => {
    await card.scrollIntoViewIfNeeded();
    if (isMobile) await card.locator('.card-title button').tap();
    else { await card.locator('.card-title button').focus(); await page.keyboard.press('Enter'); }
    await expect(card).toHaveAttribute('data-selected', 'true');
  };
  if (!isMobile) {
    await first.locator('.card-title').click();
    await expect(editDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await first.hover();
    await expect(first.getByRole('button', { name: 'Mark complete' })).toHaveCSS('opacity', '1');
  }
  await select(first);
  await expect(editDialog).toBeHidden();
  await expect(first).toHaveCSS('outline-width', '2px');
  const actions = first.getByRole('group', { name: 'Actions for First task', exact: true });
  await expect(actions.getByRole('button')).toHaveCount(3);
  for (const button of await actions.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  if (isMobile) await first.locator('.card-title button').tap();
  else { await first.locator('.card-title button').focus(); await page.keyboard.press('Space'); }
  await expect(first).not.toHaveAttribute('data-selected');
  await expect(actions).toHaveCount(0);
  await expect(editDialog).toBeHidden();
  await select(first);
  await page.screenshot({ path: testInfo.outputPath('selected-card.png'), scale: 'css' });
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const box = await first.locator('.card-title').boundingBox();
    const point = { x: box.x + 15, y: box.y + 10 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(260);
    await expect(page.locator('.card[data-selected]')).toHaveCount(0);
    await expect(page.locator('.rotate-1 .card')).toHaveCount(1);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(page.locator('.rotate-1 .card')).toHaveCount(0);
    await expect(editDialog).toBeHidden();
    // A quick moving touch belongs to scrolling, not selection or editing.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - 35 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.card[data-selected]')).toHaveCount(0);
    await expect(editDialog).toBeHidden();
    await cdp.detach();
  }
  await select(second);
  await expect(first).not.toHaveAttribute('data-selected');
  await page.keyboard.press('Escape');
  await expect(second).not.toHaveAttribute('data-selected');
  await select(first);
  await press(actions.getByRole('button', { name: 'Edit First task', exact: true }));
  await expect(editDialog).toBeVisible();
  await expect(first).not.toHaveAttribute('data-selected');
  await page.keyboard.press('Escape');
  await select(first);
  await press(actions.getByRole('button', { name: 'Advance to In Progress', exact: true }));
  await expect(first).not.toHaveAttribute('data-selected');
  await expect(page.getByText('Moved to In Progress', { exact: true })).toBeVisible();
  const toaster = page.locator('[data-sonner-toaster]');
  await expect(toaster).toHaveAttribute('data-sonner-theme', theme);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  // Keep the same live notification while changing the app theme both ways.
  const themeToggle = page.getByRole('button', { name: 'Toggle dark mode' });
  await themeToggle.click();
  await expect(toaster).toHaveAttribute('data-sonner-theme', theme === 'dark' ? 'light' : 'dark');
  await expect(undo).toBeVisible();
  await themeToggle.click();
  await expect(toaster).toHaveAttribute('data-sonner-theme', theme);
  if (theme === 'dark') {
    await expect(undo).toHaveCSS('background-color', 'rgb(0, 193, 119)');
    await expect(undo.locator('..')).toHaveCSS('background-color', 'rgb(25, 50, 40)');
  }
  expect(calls.filter(call => call.path.endsWith('/save_card_with_undo'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Undone', { exact: true })).toBeVisible();
  await select(second);
  await press(second.getByRole('button', { name: 'Advance to Complete', exact: true }));
  await expect(page.getByText('Card completed', { exact: true })).toBeVisible();
  expect(calls.filter(call => call.path.endsWith('/save_card_with_undo'))).toHaveLength(2);
  await select(first);
  await press(first.getByRole('button', { name: 'Mark complete', exact: true }));
  await expect(first).toHaveCount(0);
  const saves = calls.filter(call => call.path.endsWith('/save_card_with_undo'));
  expect(saves).toHaveLength(3);
  expect(saves.at(-1).body.p_changes.status).toBe('complete');
  await page.getByRole('group', { name: 'Board view', exact: true }).locator('button[aria-pressed]').filter({ hasText: /^All$/ }).focus();
  await page.keyboard.press('Enter');
  const finished = page.locator('.card[data-card-id="finished"]');
  const metadata = finished.locator('.card-metadata');
  await expect(metadata).toHaveCSS('font-size', theme === 'dark' ? '12px' : '10px');
  await expect(metadata).toHaveCSS('color', theme === 'dark' ? 'rgb(145, 145, 155)' : 'rgb(93, 105, 96)');
  const canceledRail = page.locator('.card[data-card-id="canceled"] .card-canceled-rail');
  await expect(canceledRail).toHaveCSS('background-color', theme === 'dark' ? 'rgb(57, 38, 40)' : 'rgb(127, 29, 29)');
  await expect(canceledRail.locator('svg')).toHaveCSS('color', theme === 'dark' ? 'rgb(217, 148, 148)' : 'rgb(248, 113, 113)');
  await select(finished);
  await expect(finished.getByRole('group').getByRole('button')).toHaveCount(1);
  if (isMobile) await page.touchscreen.tap(5, 5);
  else await page.mouse.click(5, 5);
  await expect(finished).not.toHaveAttribute('data-selected');
  expect(errors).toEqual([]);
});
