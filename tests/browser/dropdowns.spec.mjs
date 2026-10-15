import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(root + '/.env.local');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) throw new Error('Build the app with NEXT_PUBLIC_SUPABASE_URL before running browser tests.');
const storageKey='sb-'+new URL(supabaseUrl).hostname.split('.')[0]+'-auth-token';
const user={id:'11111111-1111-4111-8111-111111111111',email:'preview@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const expires=Math.floor(Date.now()/1000)+3600;
const session={access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:user.id,exp:expires,aud:'authenticated',role:'authenticated'})+'.fixture',refresh_token:'fixture',token_type:'bearer',expires_in:3600,expires_at:expires,user};
const streams=['Car','Exercise','Netbox','test','Uncategorized'].map((title,i)=>({id:String(i),user_id:user.id,title,state:'in_progress',area:'neutral',position:i}));
// Serve the real Next production assets; mock all account traffic to avoid live writes.
// This catches missing CSS processing and stylesheet loading, unlike a component fixture.
for (const theme of ['light', 'dark']) test(`dropdown layout and surfaces in ${theme} mode`, async ({ page, isMobile }, testInfo) => {
 page.setDefaultTimeout(12000);
 let availableStreams = streams;
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message)});
 await page.addInitScript(({storageKey,session,theme})=>{document.cookie=storageKey+'=base64-'+btoa(JSON.stringify(session)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')+'; path=/';localStorage.setItem('theme',theme)}, {storageKey,session,theme});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===new URL(supabaseUrl).origin){
   const data=url.pathname.endsWith('/user')?user:url.pathname.endsWith('/streams')?availableStreams:url.pathname.includes('/rpc/')?0:[];
   await route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});return;
  }
  if(url.hostname==='app.test'){
   const asset=url.pathname.startsWith('/_next/static/')?'/'+url.pathname.slice('/_next/'.length):'/server/app/index.html';
   const type=url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.woff2')?'font/woff2':'text/html';
   await route.fulfill({body:await readFile(root+'/.next'+asset),contentType:type});return;
  }
  await route.abort();
 });
 await page.goto('http://app.test');
 await page.getByRole('button',{name:'Quick Add',exact:true}).click();
 await page.getByRole('heading',{name:'Add New Card'}).waitFor();
 const trigger=page.locator('button[aria-haspopup="listbox"][aria-label="Stream"]');
 const input=page.getByPlaceholder('What needs to be done?');
 const inputBox=await input.boundingBox(),triggerBox=await trigger.boundingBox();
 const modal=await page.locator('.modal-panel').boundingBox();
 assert.ok(modal.x >= 16 && modal.x + modal.width <= page.viewportSize().width - 16);
 assert.ok(modal.y >= 16 && modal.y + modal.height <= page.viewportSize().height - 16);
 assert.equal(triggerBox.height,42);assert.equal(triggerBox.height,inputBox.height);
 assert.equal(await trigger.evaluate(el=>getComputedStyle(el).display),'flex');
 const children=await trigger.evaluate(el=>Array.from(el.children).map(c=>{const r=c.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}));
 assert.ok(Math.abs((children[0].top+children[0].bottom)/2-(children[1].top+children[1].bottom)/2)<1);
 await trigger.click();await page.getByRole('listbox').waitFor();
 const menu=page.locator('[data-trigger="Select"]');
 const menuStyle=await menu.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow,font:s.fontFamily}});
 assert.equal(menuStyle.background,theme==='dark'?'rgb(35, 35, 39)':'rgb(255, 255, 255)');
 assert.equal(menuStyle.border,'1px');assert.notEqual(menuStyle.shadow,'none');assert.match(menuStyle.font,/Geist/);
 const menuBox=await menu.boundingBox();assert.ok(menuBox.width >= triggerBox.width && menuBox.width >= Math.min(192, page.viewportSize().width - 24));
 assert.ok(menuBox.x>=0&&menuBox.x+menuBox.width<=page.viewportSize().width&&menuBox.y+menuBox.height<=page.viewportSize().height);
 const row=await page.getByRole('option',{name:'Exercise',exact:true}).boundingBox();
 assert.ok(row.height>= (isMobile?44:36));
 const filename=testInfo.outputPath('dropdown.png');await page.screenshot({path:filename, scale:'css'});
 await page.getByRole('option',{name:'Exercise',exact:true}).click();assert.match(await trigger.textContent(),/Exercise/);
 await trigger.click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('listbox').count(),0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'New Stream',exact:true}).evaluate(el=>el.click());
 await page.getByRole('button',{name:/Area/}).click();
 assert.equal(await page.getByRole('option').count(),3);
 assert.equal(await page.locator('[data-trigger="Select"]').evaluate(el=>getComputedStyle(el).backgroundColor),menuStyle.background);
 await page.keyboard.press('Escape');
 await page.getByRole('button', { name: 'Cancel', exact: true }).click();
 availableStreams = [...streams, ...Array.from({ length: 45 }, (_, i) => ({ ...streams[0], id: `extra-${i}`, title: `Stream ${i}` }))];
 await page.reload();
 await page.getByRole('button', { name: 'Quick Add', exact: true }).click();
 await page.locator('button[aria-label="Stream"]').click();
 assert.ok(await page.locator('[data-trigger="Select"]').evaluate(el => el.scrollHeight > el.clientHeight));
 const longMenu = await page.locator('[data-trigger="Select"]').boundingBox();
 assert.ok(longMenu.height <= 322 && longMenu.y >= 0 && longMenu.y + longMenu.height <= page.viewportSize().height);
 assert.deepEqual(errors,[]);
});

