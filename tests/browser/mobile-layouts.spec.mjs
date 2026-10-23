import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { openFilters, closeFilters } from './workspace-controls.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(root + '/.env.local');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const storageKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' }) + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const baseStreams = [
  { id: 'work', title: 'Website refresh', area: 'work' },
  { id: 'personal', title: 'Kitchen renovation', area: 'personal' },
  { id: 'unc', title: 'Uncategorized', area: 'neutral' },
].map((stream, i) => ({ ...stream, user_id: user.id, state: 'in_progress', position: i }));

for (const theme of ['light', 'dark']) test(`list layouts preserve filtering, movement and history in ${theme}`, async ({ page, isMobile }, testInfo) => {
  const streams = isMobile ? baseStreams : [...baseStreams,
    ...['Home maintenance', 'Learning', 'Trip planning'].map((title, i) => ({ id: `extra-${i}`, title, user_id: user.id, state: 'in_progress', area: 'personal', position: i + 3 })),
  ];
  const sources = [{ id: 'repeat', stream_id: 'personal', base_title: 'Clean kitchen' }];
  let cards = [
    ...(!isMobile ? [
      { id: 'home', title: 'Book the autumn furnace service', stream_id: 'extra-0', status: 'waiting' },
      ...['Test smoke alarms', 'Replace the hallway bulb', 'Clean the dryer vent', 'Order air filters', 'Inspect the window seals', 'Clear the gutters', 'Touch up the front door', 'Check the thermostat', 'Put away garden tools', 'Service the snow blower'].map((title, i) => ({ id: `home-${i}`, title, stream_id: 'extra-0', status: 'waiting' })),
      { id: 'learn', title: 'Choose the next photography course', stream_id: 'extra-1', status: 'research' },
      { id: 'travel', title: 'Compare places to stay for the weekend', stream_id: 'extra-2', status: 'research' },
    ] : []),
    { id: 'research', title: 'Compare a very long list of cabinet handles and finishes for the entire kitchen', stream_id: 'personal', status: 'research' },
    { id: 'waiting', title: 'Confirm delivery date', stream_id: 'personal', status: 'waiting', due_at: new Date().toISOString() },
    { id: 'progress', title: 'Draft proposal', stream_id: 'work', status: 'in_progress' },
    { id: 'backlog', title: 'Choose paint', stream_id: 'personal', status: 'backlog' },
    { id: 'ordinary-done', title: 'Finished cabinet choice', stream_id: 'personal', status: 'complete', completed_at: new Date().toISOString() },
    { id: 'ordinary-canceled', title: 'Canceled installer visit', stream_id: 'personal', status: 'canceled', completed_at: new Date().toISOString() },
    { id: 'work-done', title: 'Finished proposal outline', stream_id: 'work', status: 'complete', completed_at: new Date().toISOString() },
    { id: 'done', title: 'Old kitchen task', stream_id: 'work', status: 'complete', is_recurring: true, recurrence_source_id: 'repeat', completed_at: new Date().toISOString() },
    { id: 'done2', title: 'Another kitchen task', stream_id: 'personal', status: 'complete', is_recurring: true, recurrence_source_id: 'repeat', completed_at: new Date().toISOString() },
  ].map((card, i) => ({ user_id: user.id, position: i, is_recurring: false, ...card }));
  const calls = [], errors = [];
  let undoCard;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ storageKey, session, theme }) => {
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    localStorage.setItem('theme', theme);
  }, { storageKey, session, theme });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      let data = url.pathname.endsWith('/user') ? user : url.pathname.endsWith('/streams') ? streams : url.pathname.endsWith('/cards') ? cards : url.pathname.endsWith('/recurrence_sources') ? sources : 0;
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

  const card = id => page.locator(`.card[data-card-id="${id}"]`);
  const layout = async label => {
    await page.getByRole('button', { name: isMobile ? 'Mobile layout' : 'Desktop layout' }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  const view = async label => page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: label, exact: true }).click();
  const fits = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const board = page.getByRole('region', { name: 'Task board', exact: true });
    if (!isMobile && await page.locator('[data-list-layout="stream"]').count()) return;
    expect(await board.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  };
  if (!isMobile) {
    await expect(page.locator('[data-status-headers]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Desktop layout' })).toContainText('Board');
    await layout('By status');
  }
  await expect(page.locator('[data-mobile-layout="status"]')).toBeVisible();
  await fits();
  await expect(card('waiting')).toContainText('Kitchen renovation');
  await expect(card('waiting')).toContainText('Today');
  await expect(card('backlog')).toHaveCount(0);
  const waitingSection = page.locator('details').filter({ has: card('waiting') });
  await waitingSection.locator(':scope > summary').click();
  await expect(card('waiting')).toBeHidden();
  await waitingSection.locator(':scope > summary').click();
  if (isMobile) await card('waiting').locator('.card-title button').tap();
  else { await card('waiting').focus(); await page.keyboard.press('Enter'); }
  for (const button of await card('waiting').getByRole('group').getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('by-status.png'), fullPage: true });
  await layout('By stream');
  await expect(card('waiting')).toContainText('Waiting');
  await expect(card('waiting')).not.toHaveAttribute('data-selected');
  if (!isMobile) {
    await card('waiting').getByRole('button', { name: 'Edit Confirm delivery date', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Card', exact: true });
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await fits();
  if (!isMobile) {
    const board = page.getByRole('region', { name: 'Task board', exact: true });
    const lanes = page.locator('[data-list-layout="stream"] > [data-stream-id]');
    const boxes = await lanes.evaluateAll(elements => elements.map(el => ({ x: el.offsetLeft, y: el.offsetTop })));
    expect(new Set(boxes.map(box => box.y)).size).toBe(1);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(await board.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await board.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = 0; });
    await expect(card('progress')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('by-stream-scrolled.png'), fullPage: true });
    await board.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
  }
  await page.screenshot({ path: testInfo.outputPath('by-stream.png'), fullPage: true });
  if (!isMobile) {
    const lane = page.locator('[data-stream-id="extra-0"] > details');
    expect(await lane.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await lane.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(card('home-9')).toBeInViewport();
    await lane.evaluate(el => { el.scrollTop = 0; });
  }
  await page.reload();
  await expect(page.locator('[data-mobile-layout="stream"]')).toBeVisible();
  await openFilters(page);
  const filters = isMobile ? page.getByRole('dialog', { name: 'Filters', exact: true }) : page;
  await filters.getByRole('group', { name: 'Area filter', exact: true }).getByRole('button', { name: 'Work', exact: true }).click();
  await closeFilters(page);
  await expect(card('waiting')).toHaveCount(0);
  await expect(card('progress')).toBeVisible();
  await openFilters(page);
  await filters.getByRole('group', { name: 'Area filter', exact: true }).getByRole('button', { name: 'All', exact: true }).click();
  await closeFilters(page);
  if (isMobile) await card('waiting').locator('.card-title button').tap();
  else { await card('waiting').focus(); await page.keyboard.press('Enter'); }
  await card('waiting').getByRole('button', { name: 'Move', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'Move Card', exact: true });
  await move.getByRole('button', { name: 'Destination stream' }).click();
  await page.getByRole('option', { name: 'Website refresh', exact: true }).click();
  await move.getByRole('button', { name: 'Destination status' }).click();
  await page.getByRole('option', { name: 'In Progress', exact: true }).click();
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toBeHidden();
  await expect(card('waiting')).toContainText('In Progress');
  expect(calls.filter(call => call.path.endsWith('/save_card_with_undo')).at(-1).body.p_changes).toMatchObject({ stream_id: 'work', status: 'in_progress' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card('waiting')).toContainText('Waiting');
  // All keeps active cards visible and nests each stream's terminal history.
  await view('All');
  const personalHistory = page.locator('[data-stream-history="personal"]');
  const workHistory = page.locator('[data-stream-history="work"]');
  await expect(personalHistory).not.toHaveAttribute('open');
  await expect(personalHistory.locator(':scope > summary')).toContainText('Complete / Canceled');
  await expect(personalHistory.locator(':scope > summary')).toContainText('4');
  await expect(workHistory.locator(':scope > summary')).toContainText('1');
  await expect(card('waiting')).toBeVisible();
  await expect(card('backlog')).toBeVisible();
  await expect(card('ordinary-done')).toBeHidden();
  await expect(card('ordinary-canceled')).toBeHidden();
  await expect(card('work-done')).toBeHidden();
  await personalHistory.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(card('ordinary-done')).toBeVisible();
  await expect(card('ordinary-canceled')).toBeVisible();
  await expect(card('work-done')).toBeHidden();
  // Recurring history keeps its own second level of expansion.
  await expect(page.getByText('2 completed', { exact: true })).toBeVisible();
  await expect(card('done')).toBeHidden();
  await page.getByText('Clean kitchen', { exact: true }).click();
  await expect(card('done')).toBeVisible();
  await personalHistory.locator(':scope > summary').click();
  await expect(card('ordinary-done')).toBeHidden();
  await expect(card('waiting')).toBeVisible();
  await page.reload();
  await expect(personalHistory).not.toHaveAttribute('open');
  await expect(card('ordinary-done')).toBeHidden();
  await fits();
  await page.screenshot({ path: testInfo.outputPath('stream-history-collapsed.png'), fullPage: true });
  await view('Archive');
  await expect(page.locator('[data-stream-history]')).toHaveCount(0);
  await expect(card('ordinary-done')).toBeVisible();
  await expect(card('ordinary-canceled')).toBeVisible();
  await expect(page.getByText('2 completed', { exact: true })).toBeVisible();
  await expect(page.getByText('Clean kitchen', { exact: true })).toBeVisible();
  await layout('By status');
  await expect(page.getByText('2 completed', { exact: true })).toBeVisible();
  await expect(page.locator('details').filter({ hasText: '2 completed' }).last()).toContainText('Kitchen renovation');
  await openFilters(page);
  await filters.getByRole('switch', { name: 'Hide recurring' }).click();
  await closeFilters(page);
  await expect(page.getByText('Clean kitchen', { exact: true })).toHaveCount(0);
  await fits();
  await expect(card('ordinary-done')).toBeVisible();
  await openFilters(page);
  await filters.getByRole('switch', { name: 'Hide recurring' }).click();
  await closeFilters(page);
  await expect(page.getByText('Clean kitchen', { exact: true })).toBeVisible();
  await view('Active');
  await layout('Board');
  await expect(page.locator('[data-status-headers]')).toBeVisible();
  await expect(card('waiting')).toBeAttached();
  await layout('By status');
  await fits();
  if (!isMobile) {
    // Desktop preference survives reload and remains separate from mobile.
    await page.reload();
    await expect(page.locator('[data-list-layout="status"]')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Mobile layout' }).click();
    await page.getByRole('option', { name: 'By stream', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('[data-list-layout="status"]')).toBeVisible();
    await fits();
    await page.setViewportSize({ width: 768, height: 1024 });
    await fits();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await fits();
    expect(errors).toEqual([]);
    return;
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('[data-mobile-layout]')).toHaveCount(0);
  await expect(page.locator('[data-status-headers]')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.locator('[data-mobile-layout="status"]')).toBeVisible();
  await fits();
  await page.setViewportSize({ width: 320, height: 640 });
  await fits();
  expect(errors).toEqual([]);
});
