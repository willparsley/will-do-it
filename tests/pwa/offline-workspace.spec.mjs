import { addCard } from '../browser/workspace-controls.mjs';
import { test, expect } from '@playwright/test';

const accountKey = 'will-do-it:offline-account:v1';
const snapshotKey = 'will-do-it:offline-workspace:v1';
const owner = 'offline-test-user';
const savedAt = '2026-10-19T14:00:00Z';
const snapshot = {
  version: 1, userId: owner, savedAt,
  streams: [
    { id: 'work', user_id: owner, title: 'Work stream', area: 'work', notes: 'Stream reference notes' },
    { id: 'personal', user_id: owner, title: 'Personal stream', area: 'personal' },
  ],
  cards: [
    { id: 'a', user_id: owner, stream_id: 'work', title: 'Flight reading', notes: '<script>window.injected=true</script>\nRead the briefing', status: 'research', position: 0, due_at: '2026-10-21T14:00:00Z' },
    { id: 'b', user_id: owner, stream_id: 'personal', title: 'Packing checklist', notes: 'Passport and charger', status: 'backlog', position: 0 },
    { id: 'c', user_id: owner, stream_id: 'personal', recurrence_stream_id: 'work', recurrence_source_id: 'source', recurrence_title: 'Daily routine', title: 'Archived routine', status: 'complete', completed_at: '2026-10-19T12:00:00Z', position: 0 },
    { id: 'd', user_id: owner, stream_id: 'personal', title: 'Undated history', status: 'canceled', position: 0 },
  ],
};
async function ready(page) {
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
}
async function seed(page, value = snapshot) {
  await page.evaluate(({ accountKey, snapshotKey, owner, value }) => {
    localStorage.setItem(accountKey, owner);
    localStorage.setItem(snapshotKey, JSON.stringify(value));
  }, { accountKey, snapshotKey, owner, value });
}

test('saved cards survive offline root navigation and refresh, support filters and safe notes, and reconnect', async ({ page, context }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page); await seed(page);
  await context.setOffline(true);
  // A full root navigation, then another refresh, must work without app bundles/auth.
  await page.goto('/'); await page.reload();
  await expect(page.getByRole('heading', { name: 'Will Do It · Offline' })).toBeVisible();
  await expect(page.getByText('Last saved on this device:', { exact: false })).toBeVisible();
  await expect(page.getByText('Read-only saved copy.', { exact: false })).toBeVisible();
  await page.getByText('Flight reading', { exact: true }).click();
  await expect(page.getByText('<script>window.injected=true</script>', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.getByText('Due:', { exact: false })).toBeVisible();
  await page.getByText('Stream notes', { exact: true }).click();
  await expect(page.getByText('Stream reference notes')).toBeVisible();
  await page.getByLabel('View', { exact: true }).selectOption('all');
  await page.getByLabel('History', { exact: true }).selectOption('all');
  await expect(page.getByText('Packing checklist', { exact: true })).toBeVisible();
  await page.getByLabel('Area', { exact: true }).selectOption('personal');
  await expect(page.getByText('Flight reading', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Packing checklist', { exact: true })).toBeVisible();
  await expect(page.getByText('Undated history', { exact: true })).toBeVisible();
  await page.getByLabel('Area', { exact: true }).selectOption('all');
  await page.getByLabel('Search', { exact: true }).fill('briefing');
  await expect(page.getByText('Flight reading', { exact: true })).toBeVisible();
  await expect(page.getByText('Packing checklist', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search', { exact: true }).fill('');
  const work = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Work stream · Work', exact: true }) });
  await expect(work.getByText('Daily routine · 1', { exact: true })).toBeVisible();
  await page.getByLabel('Hide recurring').check();
  await expect(page.getByText('Daily routine · 1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Add|Edit|Complete|Move/i })).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const scenario of ['missing', 'mismatched account', 'corrupt', 'foreign cards']) test(`offline ${scenario} snapshot shows reconnect screen`, async ({ page, context }) => {
  await ready(page);
  if (scenario !== 'missing') await seed(page, scenario === 'mismatched account' ? { ...snapshot, userId: 'someone-else' } : scenario === 'foreign cards' ? { ...snapshot, cards: [{ ...snapshot.cards[0], user_id: 'someone-else' }] } : 'broken');
  await context.setOffline(true); await page.goto('/');
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.getByText('Flight reading', { exact: true })).toHaveCount(0);
});

test('connection loss blocks live controls and resumes them on reconnect', async ({ page, context }) => {
  await ready(page); await seed(page);
  await context.setOffline(true);
  const dialog = page.getByRole('dialog', { name: 'Offline workspace', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.frameLocator('iframe[title="Read-only saved workspace"]').getByText('Flight reading', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await context.setOffline(false);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
});

test('removing the account in another tab immediately hides the saved view', async ({ page, context }) => {
  await ready(page); await seed(page);
  const other = await context.newPage(); await other.goto('/offline.html');
  await page.goto('/offline.html');
  await expect(page.getByText('Flight reading', { exact: true })).toBeVisible();
  await other.evaluate(accountKey => localStorage.removeItem(accountKey), accountKey);
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.getByText('Flight reading', { exact: true })).toHaveCount(0);
});

test('successful workspace load saves real cards for an offline refresh and logout removes them', async ({ page, context, baseURL }) => {
  const { readFile } = await import('node:fs/promises');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  expect(supabaseUrl, 'Test server must receive the same Supabase URL as the build').toBeTruthy();
  const storageKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
  const user = { id: owner, email: 'offline@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: owner, exp: expires, aud: 'authenticated', role: 'authenticated' }) + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
  await context.addCookies([{ name: storageKey, value: 'base64-' + encode(session), url: baseURL }]);
  const streams = snapshot.streams.map(stream => ({ ...stream, state: 'in_progress', position: 0 }));
  streams.push({ id: 'unc', user_id: owner, title: 'Uncategorized', area: 'neutral', state: 'in_progress', position: 999 });
  await context.route(new URL(supabaseUrl).origin + '/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('/user') ? user : path.endsWith('/streams') ? streams : path.endsWith('/cards') ? snapshot.cards : path.endsWith('/recurrence_sources') ? [] : 0 });
  });
  // Serve the real built page without a server auth roundtrip using a fixture token.
  const rootUrl = baseURL + '/';
  await page.route(rootUrl, async route => route.fulfill({ body: await readFile(new URL('../../.next/server/app/index.html', import.meta.url)), contentType: 'text/html' }));
  await page.goto('/');
  await expect(page.getByText('Flight reading', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.cards.length, snapshotKey)).toBe(4);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await addCard(page);
  const editor = page.getByRole('dialog', { name: 'Add New Card', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill('Keep this unsaved draft');
  await context.setOffline(true);
  await expect(page.getByRole('dialog', { name: 'Offline workspace', exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Keep this unsaved draft');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.unroute(rootUrl);
  await context.setOffline(true);
  await expect(page.getByRole('dialog', { name: 'Offline workspace', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Will Do It · Offline' })).toBeVisible();
  await expect(page.getByText('Flight reading', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.route(rootUrl, async route => route.fulfill({ body: await readFile(new URL('../../.next/server/app/index.html', import.meta.url)), contentType: 'text/html' }));
  await page.getByRole('link', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(baseURL + '/login');
  expect(await page.evaluate(key => localStorage.getItem(key), snapshotKey)).toBeNull();
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
});
