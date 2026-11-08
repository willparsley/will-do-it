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

// Production bundles with mocked backend traffic; no account writes.
for (const theme of ['light', 'dark']) test(`bump action, validation, errors and Undo in ${theme}`, async ({ page, isMobile }, testInfo) => {
  const initial = { id: 'dated', title: 'Dated task', status: 'waiting', due_at: new Date().toISOString(), updated_at: '2026-11-08T12:00:00.123456Z', user_id: user.id, stream_id: '0', position: 0, is_recurring: true, recurrence_source_id: 'source' };
  let cards = [initial, {...initial, id:'undated', title:'Undated task', due_at:null, is_recurring:false, recurrence_source_id:null}];
  const calls = [];
  const errors = [];
  let fail = true;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ storageKey, session, theme }) => {
    document.cookie = storageKey + '=base64-' + btoa(JSON.stringify(session)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') + '; path=/';
    localStorage.setItem('theme', theme);
  }, { storageKey, session, theme });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(supabaseUrl).origin) {
      let data = url.pathname.endsWith('/user') ? user : url.pathname.endsWith('/streams') ? streams : url.pathname.endsWith('/cards') ? cards : url.pathname.endsWith('/recurrence_sources') ? [{id:'source',stream_id:'0',recurrence_timezone:'America/New_York'}] : 0;
      if(url.pathname.endsWith('/bump_card')) {
        calls.push(route.request().postDataJSON());
        if(fail) { fail=false; return route.fulfill({status:400,json:{message:'This card changed elsewhere. Close and try again.'}}); }
        cards = cards.map(card => card.id === 'dated' ? {...card, status:'backlog',due_at:'2030-01-01T05:00:00Z'} : card);
        data = {card:cards[0],undo_id:'undo'};
      }
      if(url.pathname.endsWith('/undo_card_action')) { cards = [initial, cards[1]]; data=null; }
      return route.fulfill({json:data});
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
  const card = page.locator('[data-card-id="dated"]');
  await expect(card).toBeVisible();
  if(isMobile) { await card.getByRole('button',{name:'Actions for Dated task'}).click(); await card.getByRole('button',{name:'Bump',exact:true}).click(); }
  else await card.getByRole('button',{name:'Bump due date',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Bump due date',exact:true});
  await expect(dialog).toContainText('Only this occurrence moves');
  await dialog.getByRole('button',{name:'1 month',exact:true}).click();
  await expect(dialog.getByLabel('Bump by')).toHaveValue('1');
  await dialog.getByLabel('Bump by').fill('0');
  await expect(dialog.getByRole('button',{name:'Bump card',exact:true})).toBeDisabled();
  await dialog.getByLabel('Bump by').fill('2');
  await dialog.getByRole('button',{name:'Bump card',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('changed elsewhere');
  await expect(dialog).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('bump-dialog.png'),scale:'css'});
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  await dialog.getByRole('button',{name:'Bump card',exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({p_card_id:'dated',p_amount:2,p_unit:'months',p_expected_updated_at:initial.updated_at});
  await expect(card).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('[data-card-id="dated"]')).toBeVisible();
  await expect(page.locator('[data-card-id="undated"]').getByRole('button',{name:'Bump due date',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
