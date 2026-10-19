import { mobileBoard } from './workspace-controls.mjs';
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
const streams = ['Above', 'Will Do It Project', 'Uncategorized'].map((title, i) => ({
  id: String(i), user_id: user.id, title, state: 'in_progress', area: 'neutral', position: i,
}));

test('dragging near the top of a tall stream targets the cell under the pointer', async ({ page, isMobile }) => {
  const calls = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let cards = [
    { id: 'above', title: 'Above task', stream_id: '0', status: 'research' },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `tall-${i}`, title: `Tall task ${i}`, stream_id: '1', status: 'research' })),
  ].map(card => ({ ...card, user_id: user.id, position: 0, is_recurring: false }));
  await page.addInitScript(({ storageKey, session }) => {
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
  }, { storageKey, session });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      let data = url.pathname.endsWith('/user') ? user : url.pathname.endsWith('/streams') ? streams : url.pathname.endsWith('/cards') ? cards : url.pathname.endsWith('/recurrence_sources') ? [] : 0;
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        calls.push({ path: url.pathname, body });
        if (url.pathname.endsWith('/save_card_with_undo')) {
          cards = cards.map(card => card.id === body.p_card_id ? { ...card, ...body.p_changes } : card);
          data = { card: cards.find(card => card.id === body.p_card_id), undo_id: 'undo' };
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
  await mobileBoard(page);

  const card = page.locator('.card[data-card-id="tall-0"]');
  await card.scrollIntoViewIfNeeded();
  if (isMobile) await page.locator('.overflow-x-auto').evaluate(el => { el.scrollLeft = 100; });
  const source = await card.boundingBox();
  const row = page.locator('.stream-row').filter({ has: card });
  const destination = row.locator('[data-dragging]').nth(1);
  // Target the top of the tall row, where closest-center incorrectly selects Above.
  const cell = await row.locator('.status-column').nth(1).boundingBox();
  const start = { x: Math.max(24, source.x + 25), y: source.y + 15 };
  const target = { x: Math.min(page.viewportSize().width - 24, cell.x + cell.width / 2), y: start.y };
  let cdp;
  async function begin(point) {
    if (isMobile) {
      point.x = Math.max(24, Math.min(page.viewportSize().width - 24, point.x));
      expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[data-card-id]')?.getAttribute('data-card-id'), point)).toBeTruthy();
      cdp ??= await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await expect(page.locator('[data-dragging="true"]')).not.toHaveCount(0);
    } else {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 10, point.y, { steps: 3 });
    }
  }
  async function move(point) {
    if (isMobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    else await page.mouse.move(point.x, point.y, { steps: 10 });
  }
  async function end() {
    if (isMobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
  }
  await begin(start);
  await move(target);
  await expect(destination).toHaveCSS('border-style', 'dashed');
  await end();
  await expect.poll(() => calls.filter(call => call.path.endsWith('/save_card_with_undo')).length).toBe(1);
  expect(calls.find(call => call.path.endsWith('/save_card_with_undo')).body.p_changes).toMatchObject({ stream_id: '1', status: 'waiting' });
  await expect(row.locator('.status-column').nth(1).locator('.card[data-card-id="tall-0"]')).toBeVisible();

  // Intentional moves to another stream must still work.
  const moved = await card.boundingBox();
  const aboveCell = await page.locator('.stream-row').first().locator('.status-column').nth(1).boundingBox();
  await begin({ x: moved.x + 25, y: moved.y + 15 });
  await move({ x: aboveCell.x + aboveCell.width / 2, y: aboveCell.y + 30 });
  await end();
  await expect.poll(() => calls.filter(call => call.path.endsWith('/save_card_with_undo')).length).toBe(2);
  expect(calls.filter(call => call.path.endsWith('/save_card_with_undo')).at(-1).body.p_changes).toMatchObject({ stream_id: '0', status: 'waiting' });
  // Scrolling down the tall row must preserve the same containment behavior.
  const bottomCard = page.locator('.card[data-card-id="tall-9"]');
  await bottomCard.scrollIntoViewIfNeeded();
  if (isMobile) await page.locator('.overflow-x-auto').evaluate(el => { el.scrollLeft = 100; });
  const bottom = await bottomCard.boundingBox();
  const bottomRow = page.locator('.stream-row').filter({ has: bottomCard });
  const bottomCell = await bottomRow.locator('.status-column').nth(1).boundingBox();
  await begin({ x: Math.max(24, bottom.x + 25), y: bottom.y + 15 });
  await move({ x: Math.min(page.viewportSize().width - 24, bottomCell.x + bottomCell.width / 2), y: bottom.y + 15 });
  await expect(bottomRow.locator('[data-dragging]').nth(1)).toHaveCSS('border-style', 'dashed');
  await end();
  await expect.poll(() => calls.filter(call => call.path.endsWith('/save_card_with_undo')).length).toBe(3);
  expect(calls.filter(call => call.path.endsWith('/save_card_with_undo')).at(-1).body.p_changes).toMatchObject({ stream_id: '1', status: 'waiting' });

  // Releasing outside the cells must cancel rather than choose a nearby stream.
  await bottomCard.scrollIntoViewIfNeeded();
  const last = await bottomCard.boundingBox();
  await begin({ x: last.x + 25, y: last.y + 15 });
  await move({ x: 5, y: last.y + 15 });
  await expect(page.locator('[data-dragging][style*="dashed"]')).toHaveCount(0);
  await end();
  await expect(page.locator('[data-dragging]')).toHaveCount(0);
  expect(calls.filter(call => call.path.endsWith('/save_card_with_undo'))).toHaveLength(3);
  expect(errors).toEqual([]);
  await cdp?.detach();
});
