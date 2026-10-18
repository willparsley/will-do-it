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

async function setup(page, theme, signedIn = true, fail = false) {
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


for (const theme of ['light', 'dark']) test(`all streams, grouping, and editing in ${theme}`, async ({ page }, testInfo) => {
  page.setDefaultTimeout(8000);
  await setup(page, theme);
  await page.goto('http://app.test');
  await expect(page.getByText('No streams with cards in this view.')).toBeVisible();
  await page.getByRole('link', { name: 'View all streams' }).click();
  await expect(page).toHaveURL('http://app.test/streams');
  await expect(page.getByRole('heading', { level: 1, name: 'Streams', exact: true })).toBeVisible();
  const sections = page.locator('main section');
  await expect(sections.locator('h2')).toHaveText(['Active (3)', 'Complete (2)', 'Canceled (1)']);
  await expect(sections.nth(0).locator('li')).toHaveText(['Alpha', 'zebraNotes for an empty stream', 'Uncategorized']);
  await expect(sections.nth(1).locator('li')).toHaveText(['Apple done', 'Zoo done']);
  await expect(page.getByRole('button', { name: 'Edit stream Uncategorized' })).toHaveCount(0);
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
  await expect(page.getByRole('link', { name: 'View all streams' })).toBeVisible();
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
