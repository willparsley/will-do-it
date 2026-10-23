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
const streams = ['Old stream', 'Current stream', 'Uncategorized'].map((title, i) => ({ id: String(i), title, user_id: user.id, state: 'in_progress', area: 'neutral', position: i }));

for (const theme of ['light', 'dark']) test(`desktop status dragging preserves streams and transactional saves in ${theme}`, async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile);
  const sources = [{ id: 'source', stream_id: '1', base_title: 'Daily planning', stack_missed: true, recurrence_timezone: 'America/New_York' }];
  let cards = [
    { id: 'ordinary', title: 'Compare alternatives', stream_id: '0', status: 'research', remind_at: new Date().toISOString() },
    { id: 'recurring', title: 'Plan the day', stream_id: '1', status: 'waiting', is_recurring: true, recurrence_source_id: 'source' },
    { id: 'history', title: 'An earlier plan', stream_id: '0', status: 'complete', completed_at: new Date().toISOString(), is_recurring: true, recurrence_source_id: 'source' },
  ].map(card => ({ user_id: user.id, position: 0, is_recurring: false, ...card }));
  const calls = [], errors = [];
  let failSave = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ storageKey, session, theme, userId }) => {
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    localStorage.setItem('theme', theme);
    localStorage.setItem(`will-do-it:workspace:${userId}`, JSON.stringify({ desktopLayout: 'status' }));
  }, { storageKey, session, theme, userId: user.id });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      let data = url.pathname.endsWith('/user') ? user : url.pathname.endsWith('/streams') ? streams : url.pathname.endsWith('/cards') ? cards : url.pathname.endsWith('/recurrence_sources') ? sources : 0;
      if (url.pathname.endsWith('/save_card_with_undo')) {
        const body = route.request().postDataJSON();
        calls.push(body);
        if (failSave) return route.fulfill({ status: 400, json: { message: 'Try saving again' } });
        cards = cards.map(card => card.id === body.p_card_id ? { ...card, ...body.p_changes,
          ...(['complete', 'canceled'].includes(body.p_changes.status) ? { completed_at: new Date().toISOString(), remind_at: null } : { completed_at: null }),
        } : card);
        data = { card: cards.find(card => card.id === body.p_card_id), undo_id: 'undo' };
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
  const section = status => page.locator(`[data-status-drop="${status}"]`);
  const begin = async id => {
    await card(id).scrollIntoViewIfNeeded();
    const box = await card(id).boundingBox();
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 24, box.y + 12, { steps: 3 });
    await expect(page.locator('[data-card-dragging]')).toHaveCount(1);
  };
  const hover = async status => {
    const box = await section(status).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 25, { steps: 10 });
    await expect(section(status)).toHaveAttribute('data-drop-over', 'true');
    await expect(section(status)).toHaveCSS('border-style', 'dashed');
  };
  const drop = async (id, status) => { await begin(id); await hover(status); await page.mouse.up(); };
  const view = label => page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: label, exact: true }).click();
  await expect(section('research')).toBeVisible();
  await card('ordinary').getByRole('button', { name: 'Edit Compare alternatives', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit Card', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();

  // Same-status, outside, and Escape drops never write.
  await drop('ordinary', 'research');
  expect(calls).toHaveLength(0);
  await begin('ordinary');
  await page.mouse.move(3, 300, { steps: 5 });
  await expect(page.locator('[data-drop-over]')).toHaveCount(0);
  await page.mouse.up();
  expect(calls).toHaveLength(0);
  await begin('ordinary');
  await hover('waiting');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-card-dragging]')).toHaveCount(0);
  expect(calls).toHaveLength(0);

  await begin('ordinary');
  await hover('waiting');
  await expect(section('waiting').getByRole('button', { name: 'Add card to Waiting', exact: true, includeHidden: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('status-drop-target.png'), fullPage: true });
  await page.mouse.up();
  await expect(section('waiting').locator('[data-card-id="ordinary"]')).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ p_card_id: 'ordinary', p_expected_status: 'research', p_changes: { status: 'waiting' } });
  expect(calls.at(-1).p_changes).not.toHaveProperty('stream_id');
  expect(cards.find(card => card.id === 'ordinary').stream_id).toBe('0');
  await expect(card('ordinary')).not.toHaveAttribute('data-selected');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);

  // A collapsed, empty section is still a target.
  await section('in_progress').locator(':scope > summary').click();
  await drop('ordinary', 'in_progress');
  await expect.poll(() => calls.length).toBe(2);
  await section('in_progress').locator(':scope > summary').click();
  await expect(section('in_progress').locator('[data-card-id="ordinary"]')).toBeVisible();
  failSave = true;
  await drop('ordinary', 'research');
  await expect(page.getByText('Try saving again', { exact: true })).toBeVisible();
  await expect(section('in_progress').locator('[data-card-id="ordinary"]')).toBeVisible();
  failSave = false;

  await view('All');
  await drop('ordinary', 'complete');
  await expect(section('complete').locator('[data-card-id="ordinary"]')).toBeVisible();
  expect(cards.find(card => card.id === 'ordinary')).toMatchObject({ status: 'complete', remind_at: null, stream_id: '0' });
  expect(calls.at(-1).p_expected_status).toBe('in_progress');

  // Preserve both the occurrence's stored stream and its source's current stream when reopening history.
  await section('complete').getByText('Daily planning', { exact: true }).click();
  await drop('history', 'research');
  await expect(section('research').locator('[data-card-id="history"]')).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ p_card_id: 'history', p_expected_status: 'complete', p_changes: { status: 'research' } });
  expect(calls.at(-1).p_changes).not.toHaveProperty('stream_id');
  expect(sources[0].stream_id).toBe('1');
  expect(cards.find(card => card.id === 'history').stream_id).toBe('0');
  await expect(card('history')).toContainText('Old stream');
  await drop('recurring', 'canceled');
  await expect.poll(() => cards.find(card => card.id === 'recurring').status).toBe('canceled');
  expect(calls.at(-1).p_changes).not.toHaveProperty('stream_id');
  await expect(page.locator('[data-card-dragging]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
