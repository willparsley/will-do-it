import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
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
 async function assertValueCentered(control) {
   const alignment = await control.evaluate(el => {
     const value = el.firstElementChild;
     const range = document.createRange();
     range.selectNodeContents(value);
     const text = range.getBoundingClientRect();
     const box = el.getBoundingClientRect();
     return {
       offset: Math.abs((text.top + text.bottom) / 2 - (box.top + box.bottom) / 2),
       valueIcons: value.querySelectorAll('svg').length,
     };
   });
   assert.ok(alignment.offset <= 1, `Selected text is ${alignment.offset}px from the control's vertical center`);
   assert.equal(alignment.valueIcons, 0, 'Closed value must not copy menu checkmark markup');
 }
 await assertValueCentered(trigger);
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
 await assertValueCentered(trigger);
 await page.screenshot({ path: testInfo.outputPath('selected-value.png'), scale: 'css' });
 await trigger.click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('listbox').count(),0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'New Stream',exact:true}).evaluate(el=>el.click());
 await assertValueCentered(page.getByRole('button',{name:/Area/}));
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


// Card forms exercise the same production bundle, with all writes intercepted.
for (const theme of ['light', 'dark']) test(`card forms protect drafts and support optional details in ${theme} mode`, async ({ page, isMobile }, testInfo) => {
 page.setDefaultTimeout(8000);
 await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
 const card = {id:'card',user_id:user.id,stream_id:'1',title:'Walk the dog',status:'waiting',position:0,is_recurring:true,recurrence_source_id:'source',notes:'Bring water',due_at:'2026-10-15T14:00:42.123Z',remind_at:null};
 const source = {id:'source',user_id:user.id,stream_id:'1',base_title:'Dog walks',frequency:'weekly',interval:1,weekdays:[1],stack_missed:false,recurrence_timezone:'America/New_York'};
 const calls=[];
 let failSave=true;
 await page.addInitScript(({storageKey,session,theme})=>{
   document.cookie=storageKey+'=base64-'+btoa(JSON.stringify(session)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')+'; path=/';
   localStorage.setItem('theme',theme);
 },{storageKey,session,theme});
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===new URL(supabaseUrl).origin){
     let data=url.pathname.endsWith('/user')?user:url.pathname.endsWith('/streams')?streams:url.pathname.endsWith('/cards')?[card]:url.pathname.endsWith('/recurrence_sources')?[source]:0;
     if(route.request().method()==='POST') {
       const body=route.request().postDataJSON();calls.push({path:url.pathname,body});
       if(url.pathname.endsWith('/save_card') && failSave) {
         await route.fulfill({status:400,json:{message:'This card changed. Try again.'}});return;
       }
       if(url.pathname.endsWith('/save_card')) data={...card,...body.p_changes};
       if(url.pathname.endsWith('/create_recurring_card_with_notes')) data={...card,title:body.p_title,notes:body.p_notes};
       if(url.pathname.endsWith('/cards')) data={...card,...body};
     }
     await route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});return;
   }
   if(url.hostname==='app.test'){
     const asset=url.pathname.startsWith('/_next/static/')?'/'+url.pathname.slice('/_next/'.length):'/server/app/index.html';
     const contentType=url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.woff2')?'font/woff2':'text/html';
     await route.fulfill({body:await readFile(root+'/.next'+asset),contentType});return;
   }
   await route.abort();
 });
 await page.goto('http://app.test');
 const quickAdd=page.getByRole('button',{name:'Quick Add',exact:true});
 async function cancelWithoutWarning(dialog) {
   let confirmations=0;
   const unexpectedConfirmation=async prompt=>{confirmations++;await prompt.dismiss();};
   page.on('dialog',unexpectedConfirmation);
   try {
     await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
     await dialog.waitFor({state:'hidden'});
     assert.equal(confirmations,0,'Cancel must discard a dirty draft without confirmation');
   } finally { page.off('dialog',unexpectedConfirmation); }
 }
 await quickAdd.click();
 await page.getByLabel('Title',{exact:true}).fill('Discard this draft');
 await cancelWithoutWarning(page.getByRole('dialog',{name:'Add New Card'}));
 await quickAdd.click();
 let dialog=page.getByRole('dialog',{name:'Add New Card'});
 await dialog.waitFor();
 await page.getByLabel('Title',{exact:true}).fill('A recurring walk');
 assert.equal(await dialog.locator('#card-due').isVisible(),false);
 assert.equal(await dialog.locator('#card-notes').isVisible(),false);
 await dialog.getByText('Dates & reminder',{exact:false}).click();
 const due=dialog.locator('#card-due-field');
 const reminder=dialog.locator('#card-reminder-field');
 await due.getByRole('button',{name:'Today',exact:true}).click();
 assert.equal(await due.locator('input[type="time"]').count(),0,'Time is optional');
 await due.getByRole('button',{name:'Tomorrow',exact:true}).click();
 assert.match(await due.locator('#card-due').textContent(),/16/);
 await due.locator('#card-due').click();
 let calendar=page.getByRole('dialog',{name:'Choose due date',exact:true});
 await calendar.waitFor();
 await page.keyboard.press('Escape');await calendar.waitFor({state:'hidden'});
 await expect(due.locator('#card-due')).toBeFocused();
 assert.equal(await dialog.count(),1,'Escape closes the calendar before the card form');
 await due.locator('#card-due').click();
 calendar=page.getByRole('dialog',{name:'Choose due date',exact:true});
 await calendar.waitFor();
 await page.screenshot({path:testInfo.outputPath('date-calendar.png'),scale:'css'});
 const calendarBox=await calendar.boundingBox();
 assert.ok(calendarBox.x>=0 && calendarBox.x+calendarBox.width<=page.viewportSize().width && calendarBox.y>=0 && calendarBox.y+calendarBox.height<=page.viewportSize().height);
 const day=calendar.getByRole('gridcell').filter({has:page.getByText('20',{exact:true})});
 const dayBox=await day.boundingBox();assert.ok(dayBox.width>=44 && dayBox.height>=44);
 if (isMobile) await day.click();
 else { await day.getByRole('button').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter'); }
 await calendar.waitFor({state:'hidden'});
 assert.match(await due.locator('#card-due').textContent(),/20/);
 await due.getByRole('button',{name:'Add time',exact:true}).click();
 await expect(page.getByLabel('Due date time',{exact:true})).toBeFocused();
 await page.getByLabel('Due date time',{exact:true}).fill('10:30');
 await reminder.getByRole('button',{name:'Day before due',exact:true}).click();
 assert.match(await reminder.locator('#card-reminder').textContent(),/19/);
 assert.equal(await page.getByLabel('Reminder time',{exact:true}).inputValue(),'10:30');
 await reminder.getByRole('button',{name:'Remove reminder time',exact:true}).click();
 assert.equal(await reminder.locator('input[type="time"]').count(),0);
 await reminder.getByRole('button',{name:'Clear reminder',exact:true}).click();
 assert.match(await reminder.locator('#card-reminder').textContent(),/Pick a date/);
 await reminder.getByRole('button',{name:'Day before due',exact:true}).click();
 await dialog.locator('summary').filter({hasText:'Notes'}).click();
 await page.getByLabel('Notes',{exact:true}).fill('First occurrence notes');
 await dialog.locator('summary').filter({hasText:'Repeat'}).click();
 assert.equal(await page.getByLabel('Recurring task',{exact:true}).count(),0);
 await page.locator('#card-frequency').waitFor();
 await dialog.locator('summary').filter({hasText:'Repeat'}).click();
 assert.equal(await page.locator('#card-frequency').isVisible(),false);
 await dialog.locator('summary').filter({hasText:'Repeat'}).click();
 await page.locator('#card-frequency').click();
 await page.getByRole('option',{name:'Weekly',exact:true}).click();
 await page.getByLabel('Every N weeks',{exact:true}).fill('2');
 const monday=page.getByRole('checkbox',{name:'Monday',exact:true});
 await monday.focus();await page.keyboard.press('Space');assert.equal(await monday.isChecked(),true);
 const weekday=await monday.locator('..').boundingBox();assert.ok(weekday.height>=44);
 await page.screenshot({path:testInfo.outputPath('card-create-expanded.png'),scale:'css'});
 // Tab and Shift+Tab remain within the dialog; a portaled menu consumes Escape first.
 await page.getByRole('button',{name:'Create Card',exact:true}).focus();
 await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Close card form'}).evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('button',{name:'Create Card',exact:true}).evaluate(el=>el===document.activeElement),true);
 await page.locator('#card-stream').click();await page.keyboard.press('Escape');assert.equal(await dialog.count(),1);
 await page.locator('#card-stream').focus();
 async function rejectDiscard(action) {
   const prompted=page.waitForEvent('dialog',{timeout:8000});
   const result=action();
   const prompt=await prompted;assert.match(prompt.message(),/Discard unsaved/);await prompt.dismiss();await result;
   assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'A recurring walk');
 }
 await rejectDiscard(()=>page.keyboard.press('Escape'));
 await rejectDiscard(()=>page.getByRole('button',{name:'Close card form'}).click());
 await rejectDiscard(()=>page.mouse.click(2,2));
 await page.getByRole('button',{name:'Create Card',exact:true}).click();
 await dialog.waitFor({state:'hidden'});
 const created=calls.find(call=>call.path.endsWith('/create_recurring_card_with_notes'));
 assert.equal(created.body.p_due_at,await page.evaluate(()=>new Date(2026,9,20,10,30).toISOString()));
 assert.equal(created.body.p_remind_at,await page.evaluate(()=>new Date(2026,9,19,10,30).toISOString()));
 assert.equal(created.body.p_notes,'First occurrence notes');assert.equal(created.body.p_interval,2);assert.deepEqual(created.body.p_weekdays,[1]);
 await expect(quickAdd).toBeFocused();
 // Edit is a real form: Enter saves, errors remain visible without losing the draft.
 await page.getByText('Walk the dog',{exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Edit Card'});await dialog.waitFor();
 assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Bring water');
 assert.ok(await dialog.getByText(/also moves pending occurrences/).isVisible());
 assert.ok(await dialog.getByText(/edits apply to this occurrence/).isVisible());
 await page.getByLabel('Title',{exact:true}).fill('Updated walk');await page.keyboard.press('Enter');
 await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').textContent(),/This card changed/);
 assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Updated walk');
 const saved=calls.find(call=>call.path.endsWith('/save_card'));
 assert.equal(saved.body.p_changes.due_at,card.due_at,'Unchanged dates preserve seconds and the original instant');
 const prompted=page.waitForEvent('dialog',{timeout:8000});const navigation=dialog.getByRole('button',{name:'Edit recurrence',exact:true}).click();
 const prompt=await prompted;await prompt.dismiss();await navigation;assert.equal(await dialog.count(),1);
 await page.screenshot({path:testInfo.outputPath('card-edit.png'),scale:'css'});
 failSave=false;await page.getByRole('button',{name:'Save Changes',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.getByText('Walk the dog',{exact:true}).click();
 await page.getByLabel('Title',{exact:true}).fill('Discard this edit');
 const writesBeforeCancel=calls.length;
 await cancelWithoutWarning(page.getByRole('dialog',{name:'Edit Card'}));
 assert.equal(calls.length,writesBeforeCancel,'Cancel must not save the draft');
 // Ordinary creation also includes notes, using the existing insert path.
 await quickAdd.click();
 await page.getByLabel('Title',{exact:true}).fill('One-off task');
 await page.getByRole('dialog').locator('summary').filter({hasText:'Repeat'}).click();
 await page.getByRole('dialog').locator('summary').filter({hasText:'Repeat'}).click();
 await page.getByRole('dialog').locator('summary').filter({hasText:'Notes'}).click();await page.getByLabel('Notes',{exact:true}).fill('One-off notes');
 await page.getByLabel('Title',{exact:true}).focus();await page.keyboard.press('Enter');
 await page.getByRole('dialog',{name:'Add New Card'}).waitFor({state:'hidden'});
 assert.equal(calls.find(call=>call.path.endsWith('/cards')).body.notes,'One-off notes');
});

for (const theme of ['light', 'dark']) test(`hide recurring filters the workspace and persists in ${theme} mode`, async ({ page }) => {
 const preferenceKey = `will-do-it:workspace:${user.id}`;
 const availableStreams = streams.map(stream => ({ ...stream, area: stream.id === '0' ? 'work' : stream.id === '1' ? 'personal' : 'neutral' }));
 const fixtureCards = [
  ...['waiting', 'backlog', 'complete'].flatMap((status, index) => [
   { id: `ordinary-${status}`, stream_id: '0', title: `One-off ${status}`, status, is_recurring: false },
   { id: `recurring-${status}`, stream_id: '1', title: `Routine ${status}`, status, is_recurring: true, recurrence_source_id: 'source' },
   { id: `linked-${status}`, stream_id: '0', title: `Linked ${status}`, status, is_recurring: false, recurrence_source_id: 'source-2' },
   { id: `flagged-${status}`, stream_id: '0', title: `Flagged ${status}`, status, is_recurring: true },
  ].map(card => ({ ...card, user_id: user.id, position: index, completed_at: new Date().toISOString() }))),
 ];
 await page.addInitScript(({ storageKey, session, theme }) => {
  document.cookie = storageKey+'=base64-'+btoa(JSON.stringify(session)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')+'; path=/';
  localStorage.setItem('theme', theme);
 }, { storageKey, session, theme });
 await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(supabaseUrl).origin) {
   const data = url.pathname.endsWith('/user') ? user : url.pathname.endsWith('/streams') ? availableStreams : url.pathname.endsWith('/cards') ? fixtureCards : url.pathname.includes('/rpc/') ? 0 : [];
   await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } }); return;
  }
  if (url.hostname === 'app.test') {
   const asset = url.pathname.startsWith('/_next/static/') ? '/' + url.pathname.slice('/_next/'.length) : '/server/app/index.html';
   const type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.woff2') ? 'font/woff2' : 'text/html';
   await route.fulfill({ body: await readFile(root + '/.next' + asset), contentType: type }); return;
  }
  await route.abort();
 });
 await page.goto('http://app.test');
 const toggle = page.getByRole('switch', { name: 'Hide recurring' });
 await expect(toggle).not.toBeChecked();
 await expect(page.getByText('Routine waiting', { exact: true })).toBeVisible();
 const box = await toggle.boundingBox();
 assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width);
 assert.ok(box.height >= 44);
 const tabs = await page.getByRole('button', { name: 'Archive', exact: true }).boundingBox();
 if (page.viewportSize().width < 640) assert.ok(box.y >= tabs.y + tabs.height);
 else assert.ok(Math.abs(box.y - tabs.y) < 10);
 await toggle.focus();
 await page.keyboard.press('Space');
 await expect(toggle).toBeChecked();
 for (const [view, status] of [['Active', 'waiting'], ['Backlog', 'backlog'], ['All', 'waiting'], ['Archive', 'complete']]) {
  await page.getByRole('button', { name: view, exact: true }).and(page.locator('[aria-pressed]')).click();
  await expect(page.getByText(`One-off ${status}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Routine ${status}`, { exact: true })).toHaveCount(0);
  await expect(page.getByText(`Linked ${status}`, { exact: true })).toHaveCount(0);
  await expect(page.getByText(`Flagged ${status}`, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Exercise', { exact: true })).toHaveCount(0);
 }
 await page.getByRole('button', { name: 'Work', exact: true }).click();
 await expect(page.getByText('One-off complete', { exact: true })).toBeVisible();
 await page.reload();
 await expect(toggle).toBeChecked();
 await expect(page.getByText('One-off complete', { exact: true })).toBeVisible();
 assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), preferenceKey), { view: 'archive', area: 'work', archivePeriod: 'month', hideRecurring: true });
 await page.getByRole('button', { name: 'Personal', exact: true }).click();
 await expect(page.getByText('No non-recurring tasks in this view.', { exact: true })).toBeVisible();
 await page.getByRole('button', { name: 'Show recurring', exact: true }).click();
 await expect(toggle).not.toBeChecked();
 // Archived occurrences are restored inside their collapsed recurrence group.
 await expect(page.getByText('Routine complete', { exact: true })).toBeAttached();
 await page.reload();
 await expect(toggle).not.toBeChecked();
 // Invalid saved values must use the default, rather than treating a string as enabled.
 await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ hideRecurring: 'true' })), preferenceKey);
 await page.reload();
 await expect(toggle).not.toBeChecked();
});
