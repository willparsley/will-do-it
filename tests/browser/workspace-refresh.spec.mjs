import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { addCard } from './workspace-controls.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(root + '/.env.local');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const storageKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' }) + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const streams = ['Work stream', 'Uncategorized'].map((title, i) => ({ id: String(i), user_id: user.id, title, state: 'in_progress', area: 'neutral', position: i }));

async function fixture(page) {
  const state = { cards: [{ id: 'card', user_id: user.id, stream_id: '0', title: 'Phone task', status: 'waiting', position: 0, is_recurring: false }], reads: 0, processing: 0, gate: null, authGate: null, scriptGate: null, fail: false };
  await page.addInitScript(({ storageKey, session }) => {
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
  }, { storageKey, session });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      if (url.pathname.endsWith('/user') && state.authGate) await state.authGate;
      if (url.pathname.endsWith('/streams')) {
        ++state.reads;
        if (state.gate) await state.gate;
        if (state.fail) return route.fulfill({ status: 400, json: { message: 'Temporarily unavailable' } });
      }
      if (/generate_recurring_instances|promote_due_cards/.test(url.pathname)) ++state.processing;
      const data = url.pathname.endsWith('/user') ? user : url.pathname.endsWith('/streams') ? streams : url.pathname.endsWith('/cards') ? state.cards : url.pathname.endsWith('/get_stream_order') ? { ordered_ids: null, revision: 0 } : url.pathname.includes('/rpc/') ? 0 : [];
      return route.fulfill({ json: data });
    }
    if (url.hostname === 'app.test') {
      if (url.pathname.endsWith('.js') && state.scriptGate) await state.scriptGate;
      const publicFile = url.pathname.startsWith('/branding/') ? '/public' + url.pathname : url.pathname === '/icon.svg' ? '/app/icon.svg' : url.pathname === '/favicon.ico' ? '/app/favicon.ico' : null;
      const asset = url.pathname.startsWith('/_next/static/') ? '/' + url.pathname.slice('/_next/'.length) : '/server/app/index.html';
      const contentType = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.woff2') ? 'font/woff2' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
      return route.fulfill({ body: await readFile(root + (publicFile || '/.next' + asset)), contentType });
    }
    await route.abort();
  });
  return state;
}

const card = page => page.locator('[data-card-id="card"]').first();
const wake = page => page.evaluate(() => window.dispatchEvent(new Event('focus')));

test('controls render before slow workspace data; failed initial load can retry', async ({ page, isMobile }) => {
  const state = await fixture(page);
  let release;
  state.gate = new Promise(resolve => { release = resolve; });
  await page.goto('http://app.test');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Active', exact: true })).toBeVisible();
  await expect(page.getByText('Loading streams and cards…')).toBeVisible();
  await expect(page.getByRole('button', { name: isMobile ? 'Add' : 'Quick Add', exact: true })).toBeDisabled();
  await page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: 'All', exact: true }).click();
  state.fail = true; state.gate = null; release();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  state.fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(card(page)).toContainText('Phone task');
  await expect(page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('tab return updates cards while keeping drafts and board mounted', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('http://app.test');
  await expect(card(page)).toContainText('Phone task');
  expect(state.processing).toBe(2);
  await addCard(page);
  await page.getByLabel('Title', { exact: true }).fill('Keep my draft');
  state.cards = [{ ...state.cards[0], title: 'Updated on phone' }];
  await wake(page);
  await expect(card(page)).toContainText('Updated on phone');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep my draft');
  await expect(page.getByText('Loading streams and cards…')).toHaveCount(0);
  expect(state.processing).toBe(2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  state.cards = [{ ...state.cards[0], status: 'complete', completed_at: new Date().toISOString() }];
  await wake(page);
  await expect(card(page)).toHaveCount(0);
  state.cards = [];
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await wake(page);
  await expect(card(page)).toHaveCount(0);
});


test('visible tab catches up periodically, pauses when hidden, and recovers after a failed read', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await page.goto('http://app.test');
  await expect(card(page)).toContainText('Phone task');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); });
  const reads = state.reads;
  state.cards = [{ ...state.cards[0], title: 'Changed remotely' }];
  await page.clock.fastForward(120_000);
  expect(state.reads).toBe(reads);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(300);
  await expect(card(page)).toContainText('Changed remotely');
  state.fail = true;
  const beforeFailure = state.reads;
  await page.clock.fastForward(60_000); await page.clock.fastForward(300);
  await expect.poll(() => state.reads).toBeGreaterThan(beforeFailure);
  await expect(card(page)).toContainText('Changed remotely');
  state.fail = false;
  state.cards = [{ ...state.cards[0], title: 'Recovered update' }];
  await page.clock.fastForward(60_000); await page.clock.fastForward(300);
  await expect(card(page)).toContainText('Recovered update');
  expect(state.processing).toBe(2);
});


for (const [view, label] of [['archive', 'Archive'], ['all', 'All'], ['backlog', 'Backlog']]) test(`refresh first shows saved ${label} toolbar while auth and data are still loading`, async ({ page, isMobile }) => {
  const state = await fixture(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ userId, view }) => {
    localStorage.setItem('will-do-it:offline-account:v1', userId);
    localStorage.setItem(`will-do-it:workspace:${userId}`, JSON.stringify({ view, archivePeriod: 'year' }));
    window.visibleToolbarViews = [];
    new MutationObserver(() => {
      const toolbar = document.querySelector('[data-workspace-toolbar]');
      if (toolbar && getComputedStyle(toolbar).visibility === 'visible') {
        const label = toolbar.querySelector('[aria-label="Board view"] [aria-pressed="true"]')?.textContent;
        if (label) window.visibleToolbarViews.push(label);
      }
    }).observe(document, { childList: true, subtree: true, attributes: true });
  }, { userId: user.id, view });
  let releaseAuth;
  state.authGate = new Promise(resolve => { releaseAuth = resolve; });
  await page.goto('http://app.test');
  const toolbar = page.locator('[data-workspace-toolbar]');
  await expect(toolbar).toBeVisible();
  await expect(page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Loading streams and cards…')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: label, exact: true })).toHaveCSS('transition-duration', '0s');
  if (!isMobile) {
    await expect(page.getByRole('button', { name: /Completed\/canceled period/ })).toHaveCount(view === 'backlog' ? 0 : 1);
    if (view !== 'backlog') await expect(page.getByRole('button', { name: /Completed\/canceled period/ })).toContainText('Past year');
  }
  const before = await toolbar.boundingBox();
  releaseAuth();
  await expect(page.getByRole('region', { name: 'Task board' })).toHaveAttribute('aria-busy', 'false');
  const after = await toolbar.boundingBox();
  expect(after.height).toBe(before.height);
  expect(after.y).toBe(before.y);
  expect(await page.evaluate(() => [...new Set(window.visibleToolbarViews)])).toEqual([label]);
  expect(errors).toEqual([]);
});

test('server shell never paints a default selected view while hydration scripts are delayed', async ({ page }) => {
  const state = await fixture(page);
  let release;
  state.scriptGate = new Promise(resolve => { release = resolve; });
  await page.goto('http://app.test', { waitUntil: 'commit' });
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('[data-workspace-toolbar]')).toBeHidden();
  release();
  await expect(page.locator('[data-workspace-toolbar]')).toBeVisible();
});


test('a view selected in the app survives a real reload without a visible Active toolbar', async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(() => {
    window.visibleToolbarViews = [];
    new MutationObserver(() => {
      const toolbar = document.querySelector('[data-workspace-toolbar]');
      if (toolbar && getComputedStyle(toolbar).visibility === 'visible') {
        const selected = toolbar.querySelector('[aria-label="Board view"] [aria-pressed="true"]')?.textContent;
        if (selected) window.visibleToolbarViews.push(selected);
      }
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  await page.goto('http://app.test');
  await expect(card(page)).toBeVisible();
  for (const label of ['All', 'Archive', 'Backlog']) {
    const viewButton = page.getByRole('group', { name: 'Board view', exact: true }).getByRole('button', { name: label, exact: true });
    await viewButton.click();
    let releaseAuth;
    state.authGate = new Promise(resolve => { releaseAuth = resolve; });
    await page.reload();
    await expect(viewButton).toBeVisible();
    await expect(viewButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Task board' })).toHaveAttribute('aria-busy', 'true');
    releaseAuth();
    await expect(page.getByRole('region', { name: 'Task board' })).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => [...new Set(window.visibleToolbarViews)])).toEqual([label]);
  }
});
