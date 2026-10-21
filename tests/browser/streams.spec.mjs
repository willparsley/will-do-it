import { openFilters } from './workspace-controls.mjs';
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

async function setup(page, theme, signedIn = true, fail = false, ordering = null) {
  await page.routeWebSocket('**/realtime/**', socket => socket.close());
  let fixtures = [
    { id: 'z', title: 'zebra', state: 'in_progress', area: 'work', notes: 'Notes for an empty stream' },
    { id: 'unc', title: 'Uncategorized', state: 'in_progress', area: 'neutral' },
    { id: 'a', title: 'Alpha', state: 'in_progress', area: 'personal' },
    { id: 'done-z', title: 'Zoo done', state: 'complete', area: 'neutral' },
    { id: 'done-a', title: 'Apple done', state: 'complete', area: 'work' },
    { id: 'cancel', title: 'Canceled plans', state: 'canceled', area: 'personal' },
  ].map((stream, position) => ({ ...stream, user_id: user.id, position }));
  await page.addInitScript(({ storageKey, session, theme, signedIn }) => {
    if (signedIn) document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    localStorage.setItem('theme', theme);
  }, { storageKey, session, theme, signedIn });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      if (url.pathname.endsWith('/get_stream_order')) return route.fulfill({ json: ordering?.value || null });
      if (url.pathname.endsWith('/move_stream') && ordering) {
        const body = route.request().postDataJSON();
        ordering.calls.push(body);
        if (ordering.failNext) {
          ordering.failNext = false;
          return route.fulfill({ status: 400, json: { message: 'Order save failed' } });
        }
        let ids = [...fixtures].filter(s => s.title !== 'Uncategorized').sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })).map(s => s.id);
        if (ordering.value?.ordered_ids) ids.sort((a, b) => (ordering.value.ordered_ids.indexOf(a) < 0 ? Infinity : ordering.value.ordered_ids.indexOf(a)) - (ordering.value.ordered_ids.indexOf(b) < 0 ? Infinity : ordering.value.ordered_ids.indexOf(b)) || 0);
        if (!body.p_reset) {
          ids = ids.filter(id => id !== body.p_stream_id);
          ids.splice(ids.indexOf(body.p_target_id) + Number(body.p_after), 0, body.p_stream_id);
        }
        ordering.value = { ordered_ids: body.p_reset ? null : ids, revision: (ordering.value?.revision || 0) + 1 };
        return route.fulfill({ json: ordering.value });
      }
      if (url.pathname.endsWith('/cards') && ordering?.cards) return route.fulfill({ json: ordering.cards });
      if (url.pathname.endsWith('/logout')) return route.fulfill({ json: {} });
      if (url.pathname.endsWith('/streams')) {
        if (route.request().method() === 'POST') {
          const stream = { ...route.request().postDataJSON(), id: 'new-stream' };
          fixtures.push(stream);
          return route.fulfill({ json: stream });
        }
        if (fail) { fail = false; return route.fulfill({ status: 400, json: { message: 'Streams unavailable' } }); }
        return route.fulfill({ json: fixtures });
      }
      if (url.pathname.endsWith('/save_stream')) {
        const changes = route.request().postDataJSON();
        const updated = { ...fixtures.find(stream => stream.id === changes.p_stream_id), title: changes.p_title, state: changes.p_state, area: changes.p_area, notes: changes.p_notes };
        fixtures = fixtures.map(stream => stream.id === updated.id ? updated : stream);
        return route.fulfill({ json: updated });
      }
      return route.fulfill({ json: url.pathname.endsWith('/user') ? user : url.pathname.includes('/rpc/') ? 0 : [] });
    }
    if (url.hostname !== 'app.test') return route.abort();
    const publicFile = url.pathname.startsWith('/branding/') ? '/public' + url.pathname : null;
    const asset = url.pathname.startsWith('/_next/static/') ? '/' + url.pathname.slice('/_next/'.length)
      : '/server/app/' + (url.pathname === '/streams' ? 'streams' : url.pathname === '/login' ? 'login' : 'index') + (route.request().headers()['rsc'] === '1' ? '.rsc' : '.html');
    const contentType = route.request().headers()['rsc'] === '1' ? 'text/x-component' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.woff2') ? 'font/woff2' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    return route.fulfill({ body: await readFile(root + (publicFile || '/.next' + asset)), contentType });
  });
}


for (const theme of ['light', 'dark']) test(`all streams, grouping, and editing in ${theme}`, async ({ page, isMobile }, testInfo) => {
  page.setDefaultTimeout(8000);
  await setup(page, theme);
  await page.goto('http://app.test');
  await expect(page.getByText('No streams with cards in this view.')).toBeVisible();
  const directoryLink = page.getByRole('link', { name: 'View all streams' });
  if (await directoryLink.isVisible()) await directoryLink.click();
  else { await openFilters(page); await page.getByRole('link', { name: 'All streams', exact: true }).click(); }
  await expect(page).toHaveURL('http://app.test/streams');
  await expect(page.getByRole('heading', { level: 1, name: 'Streams', exact: true })).toBeVisible();
  const sections = page.locator('main section');
  await expect(sections.locator('h2')).toHaveText(['Active (3)', 'Complete (2)', 'Canceled (1)']);
  await expect(sections.nth(0).locator('li')).toHaveText(['Alpha', 'zebraNotes for an empty stream', 'Uncategorized']);
  await expect(sections.nth(1).locator('li')).toHaveText(['Apple done', 'Zoo done']);
  await expect(page.getByRole('button', { name: 'Edit stream Uncategorized' })).toHaveCount(0);
  const areaFilter = page.getByRole('group', { name: 'Area filter', exact: true });
  for (const [title, area] of [['zebra', 'Work'], ['Alpha', 'Personal']]) {
    const color = await areaFilter.getByRole('button', { name: area, exact: true }).locator('svg').evaluate(icon => getComputedStyle(icon).color);
    await expect(page.getByRole('button', { name: `Edit stream ${title}`, exact: true }).locator('..').getByRole('img', { name: area }).locator('svg')).toHaveCSS('color', color);
  }
  const edit = page.getByRole('button', { name: 'Edit stream zebra', exact: true });
  await edit.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit Stream', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Active Status', exact: true }).click();
  await page.getByRole('option', { name: 'Complete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sections.locator('h2')).toHaveText(['Active (2)', 'Complete (3)', 'Canceled (1)']);
  await expect(sections.nth(1).locator('li')).toHaveText(['Apple done', 'zebraNotes for an empty stream', 'Zoo done']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('streams.png'), fullPage: true });
  await page.getByRole('link', { name: 'Back to workspace' }).click();
  if (isMobile) {
    await expect(page.getByRole('dialog', { name: 'Filters', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
  } else await expect(page.getByRole('link', { name: 'View all streams' })).toBeVisible();
});

test('streams load failure can be retried', async ({ page }) => {
  await setup(page, 'light', true, true);
  await page.goto('http://app.test/streams');
  await expect(page.locator('main').getByRole('alert')).toContainText('Streams unavailable');
  await expect(page.locator('main section')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('main section')).toHaveCount(3);
});

test('signed-out streams redirects to sign-in', async ({ page }) => {
  await setup(page, 'light', false);
  await page.goto('http://app.test/streams');
  await expect(page).toHaveURL('http://app.test/login');
  await expect(page.locator('main section')).toHaveCount(0);
});

for (const theme of ['light', 'dark']) test(`area filtering and new streams in ${theme}`, async ({ page }, testInfo) => {
  await setup(page, theme);
  await page.goto('http://app.test/streams');
  const filter = page.getByRole('group', { name: 'Area filter', exact: true });
  const sections = page.locator('main section');
  await expect(sections).toHaveCount(3);
  await filter.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(sections.locator('h2')).toHaveText(['Active (2)', 'Complete (2)', 'Canceled (0)']);
  await expect(page.getByRole('button', { name: 'Edit stream Alpha', exact: true })).toHaveCount(0);
  await expect(sections.nth(0).getByText('Uncategorized', { exact: true })).toBeVisible();
  await page.reload();
  await expect(filter.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await filter.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(sections.locator('h2')).toHaveText(['Active (2)', 'Complete (1)', 'Canceled (1)']);
  await expect(page.getByRole('button', { name: 'Edit stream zebra', exact: true })).toHaveCount(0);
  await filter.getByRole('button', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'New Stream', exact: true }).click();
  await page.getByPlaceholder('e.g. Personal Projects, Work Q4').fill('Brand new plans');
  await page.getByRole('button', { name: 'Create Stream', exact: true }).click();
  await expect(page.getByPlaceholder('e.g. Personal Projects, Work Q4')).toHaveCount(0);
  // A personal stream created from the Work filter becomes visible immediately.
  await expect(filter.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sections.nth(0).locator('li')).toHaveText(['Alpha', 'Brand new plans', 'zebraNotes for an empty stream', 'Uncategorized']);
  await filter.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(sections.nth(0).locator('li')).toHaveText(['Alpha', 'Brand new plans', 'Uncategorized']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('streams-controls.png'), fullPage: true });
  await page.getByRole('link', { name: 'Back to workspace' }).click();
  await expect(filter.getByRole('button', { name: 'Personal', exact: true })).toHaveAttribute('aria-pressed', 'true');
});


function orderingFixture() {
  return { value: null, calls: [], cards: [
    { id: 'alpha-task', stream_id: 'a', title: 'Alpha task', status: 'research', position: 0 },
    { id: 'zebra-task', stream_id: 'z', title: 'Zebra task', status: 'research', position: 0 },
  ].map(c => ({ ...c, user_id: user.id, is_recurring: false })) };
}

async function keyboardMove(page, name, arrow = 'ArrowUp') {
  const surface = page.getByRole('button', { name: `Reorder stream ${name}`, exact: true });
  await expect(surface).toBeEnabled();
  await surface.focus();
  const target = await surface.evaluate((node, arrow) => {
    const row = node.closest('[data-stream-id]');
    const rows = [...row.parentElement.children].filter(el => el.hasAttribute('data-stream-id'));
    return rows[rows.indexOf(row) + (arrow === 'ArrowUp' ? -1 : 1)].getAttribute('data-stream-id');
  }, arrow);
  await page.keyboard.press('Space');
  await expect(surface).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press(arrow);
  await expect(page.getByRole('status').filter({ hasText: `was moved over droppable area stream:${target}.` })).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(surface).not.toHaveAttribute('aria-pressed', 'true');
}

test('stream ordering persists across devices, refresh, board, filters, and reset', async ({ page, context, isMobile }) => {
  const ordering = orderingFixture();
  await setup(page, 'light', true, false, ordering);
  await page.goto('http://app.test/streams');
  await expect(page.getByRole('button', { name: 'Reorder stream Uncategorized' })).toHaveCount(0);
  await keyboardMove(page, 'zebra');
  await expect.poll(() => ordering.calls.length).toBe(1);
  expect(ordering.calls[0]).toMatchObject({ p_stream_id: 'z', p_target_id: 'a', p_after: false });
  const rows = page.locator('main section').first().locator('li');
  await expect(rows.first()).toHaveAttribute('data-stream-id', 'z');
  await expect(page.getByRole('button', { name: 'Reorder stream zebra' })).toBeFocused();
  await page.reload();
  await expect(rows.first()).toHaveAttribute('data-stream-id', 'z');

  const other = await context.newPage();
  await setup(other, 'dark', true, false, ordering);
  await other.goto('http://app.test/streams');
  await expect(other.locator('main section').first().locator('li').first()).toHaveAttribute('data-stream-id', 'z');
  await keyboardMove(other, 'zebra', 'ArrowDown');
  await expect.poll(() => ordering.calls.length).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(rows.first()).toHaveAttribute('data-stream-id', 'a');
  await other.close();

  // Only zebra is visible in Work, so hidden streams keep their saved order.
  await page.getByRole('group', { name: 'Area filter', exact: true }).getByRole('button', { name: 'Work', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('group', { name: 'Area filter', exact: true }).getByRole('button', { name: 'All', exact: true }).click();
  await keyboardMove(page, 'zebra');
  await expect.poll(() => ordering.calls.length).toBe(3);
  await page.goto('http://app.test');
  if (isMobile) {
    await page.getByRole('button', { name: /Mobile layout/ }).click();
    await page.getByRole('option', { name: 'By stream', exact: true }).click();
  }
  await expect(page.locator('[data-stream-id]').first()).toHaveAttribute('data-stream-id', 'z');
  await expect(page.getByRole('button', { name: 'Reorder stream zebra' })).toBeEnabled();
  await keyboardMove(page, 'zebra', 'ArrowDown');
  await expect(page.locator('[data-stream-id]').first()).toHaveAttribute('data-stream-id', 'a');
  await keyboardMove(page, 'zebra');
  await expect(page.locator('[data-stream-id]').first()).toHaveAttribute('data-stream-id', 'z');
  await expect(page.getByRole('button', { name: 'Reset stream order to alphabetical' })).toHaveCount(0);
  await page.goto('http://app.test/streams');
  await page.getByRole('button', { name: 'Reset stream order to alphabetical' }).click();
  await expect(page.locator('[data-stream-id]').first()).toHaveAttribute('data-stream-id', 'a');
  expect(ordering.value.ordered_ids).toBe(null);
});

test('stream background moves a row and a failed save restores its order', async ({ page, isMobile }) => {
  const ordering = orderingFixture();
  await setup(page, 'dark', true, false, ordering);
  await page.goto('http://app.test/streams');
  const surface = page.getByRole('button', { name: 'Reorder stream zebra', exact: true });
  await expect(surface).toBeEnabled();
  const start = await surface.boundingBox();
  const target = await page.getByRole('button', { name: 'Reorder stream Alpha', exact: true }).boundingBox();
  let cdp;
  if (isMobile) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x + 6, y: start.y + 6 }] });
    await page.waitForTimeout(250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + 6, y: target.y + 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(start.x + 6, start.y + 6);
    await page.mouse.down();
    await page.mouse.move(start.x + 16, start.y + 6, { steps: 3 });
    await page.mouse.move(target.x + 6, target.y + 6, { steps: 10 });
    await page.mouse.up();
  }
  await expect.poll(() => ordering.calls.length).toBe(1);
  const rows = page.locator('main section').first().locator('li');
  await expect(rows.first()).toHaveAttribute('data-stream-id', 'z');
  ordering.failNext = true;
  await keyboardMove(page, 'zebra', 'ArrowDown');
  await expect(page.getByText('Order save failed', { exact: true })).toBeVisible();
  await expect(rows.first()).toHaveAttribute('data-stream-id', 'z');
});


test('board stream backgrounds drag while title text keeps its space and actions', async ({ page, isMobile }, testInfo) => {
  const ordering = orderingFixture();
  await setup(page, 'light', true, false, ordering);
  await page.goto('http://app.test');
  if (isMobile) {
    await page.getByRole('button', { name: /Mobile layout/ }).click();
    await page.getByRole('option', { name: 'By stream', exact: true }).click();
  }
  const drag = page.getByRole('button', { name: 'Reorder stream zebra', exact: true });
  await expect(drag).toBeEnabled();
  await expect(drag.locator('svg')).toHaveCount(0);
  const start = await drag.boundingBox();
  const target = await page.getByRole('button', { name: 'Reorder stream Alpha', exact: true }).boundingBox();
  const point = { x: start.x + 6, y: start.y + 6 };
  expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.getAttribute('aria-label'), point)).toBe('Reorder stream zebra');
  if (!isMobile) {
    const edit = page.getByRole('button', { name: 'Edit stream zebra', exact: true });
    const title = await edit.boundingBox();
    expect(title.x - start.x).toBeLessThanOrEqual(40);
    // Text belongs to the edit button above the background, so it cannot start a row drag.
    expect(await edit.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('auto');
    await edit.click();
    await expect(page.getByRole('dialog', { name: 'Edit Stream', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  } else {
    const row = page.locator('[data-stream-id="z"]');
    await row.locator('summary').getByText('zebra', { exact: true }).click();
    await expect(row.locator('details')).not.toHaveAttribute('open', '');
    await row.locator('summary').getByText('zebra', { exact: true }).click();
    await expect(row.locator('details')).toHaveAttribute('open', '');
  }
  expect(ordering.calls).toHaveLength(0);
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + 6, y: target.y + 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 10, point.y, { steps: 3 });
    await page.mouse.move(target.x + 6, target.y + 6, { steps: 10 });
    await page.mouse.up();
  }
  await expect.poll(() => ordering.calls.length).toBe(1);
  await expect(page.locator('[data-stream-id]').first()).toHaveAttribute('data-stream-id', 'z');
  await page.screenshot({ path: testInfo.outputPath('stream-background.png') });
});
