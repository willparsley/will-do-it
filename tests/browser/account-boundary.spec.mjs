import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(root + '/.env.local');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const storageKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
const user = { id:'11111111-1111-4111-8111-111111111111',email:'private@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{} };
const other = { ...user,id:'22222222-2222-4222-8222-222222222222',email:'other@example.test' };
const encode = value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now()/1000)+3600;
const sessionFor = identity=>({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:identity.id,exp:expires,aud:'authenticated',role:'authenticated'})+'.fixture',refresh_token:'fixture',token_type:'bearer',expires_in:3600,expires_at:expires,user:identity});
const streams = [{id:'private-stream',user_id:user.id,title:'Private stream',notes:'Private stream notes',state:'in_progress',area:'neutral',position:0},{id:'unc',user_id:user.id,title:'Uncategorized',state:'in_progress',area:'neutral',position:999}];
const cards = [{id:'private-card',user_id:user.id,stream_id:'private-stream',title:'Private card',notes:'Private card notes',status:'research',position:0,is_recurring:false}];

for(const theme of ['light','dark']) for(const action of ['logout','switch-account']) test(`${action} clears all open private pages in ${theme}`,async({context},testInfo)=>{
  let current=user;
  const errors=[];
  const setSession = identity=>context.addCookies([{name:storageKey,value:'base64-'+encode(sessionFor(identity)),url:'http://app.test'}]);
  await setSession(user);
  await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===new URL(supabaseUrl).origin){
      if(url.pathname.endsWith('/logout')){current=null;return route.fulfill({json:{}});}
      if(url.pathname.endsWith('/user'))return route.fulfill({status:current?200:401,json:current||{message:'Not authenticated'}});
      return route.fulfill({json:url.pathname.includes('/rpc/')?0:current?.id===user.id?(url.pathname.endsWith('/streams')?streams:url.pathname.endsWith('/cards')?cards:[]):(current && url.pathname.endsWith('/streams')?[{...streams[1],id:'other-unc',user_id:current.id}]:[])});
    }
    if(url.hostname!=='app.test')return route.abort();
    const publicFile=url.pathname.startsWith('/branding/')?'/public'+url.pathname:['/apple-icon.png','/icon.svg','/favicon.ico'].includes(url.pathname)?'/app'+url.pathname:null;
    const rsc=route.request().headers()['rsc']==='1';
    const asset=url.pathname.startsWith('/_next/static/')?'/'+url.pathname.slice('/_next/'.length):'/server/app/'+(url.pathname==='/'?'index':url.pathname.slice(1))+(rsc?'.rsc':'.html');
    const contentType=rsc?'text/x-component':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.woff2')?'font/woff2':url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.ico')?'image/x-icon':'text/html';
    return route.fulfill({body:await readFile(root+(publicFile||'/.next'+asset)),contentType});
  });
  const pages=[];
  for(const path of ['/','/streams','/profile']){
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://app.test'+path);pages.push(page);
  }
  const [board,directory,profile]=pages;
  await expect(board.getByText('Private card',{exact:true})).toBeVisible();
  await expect(directory.getByRole('button',{name:'Edit stream Private stream',exact:true})).toBeVisible();
  await expect(profile.locator('dd')).toHaveText(user.email);
  await board.getByRole('button',{name:'Quick Add',exact:true}).click();
  await board.getByRole('dialog').getByLabel('Title',{exact:true}).fill('Private unsaved draft');
  await directory.getByRole('button',{name:'Edit stream Private stream',exact:true}).click();
  if(action==='logout'){
    await profile.getByRole('button',{name:'Account menu',exact:true}).click();
    await profile.getByRole('menuitem',{name:'Log out',exact:true}).click();
    for(const page of pages)await expect(page).toHaveURL('http://app.test/login');
  }else{
    current=other;await setSession(other);
    // Use the same cross-tab channel as Supabase Auth, with the new cookie/session.
    await profile.evaluate(({storageKey,session})=>{
      const channel=new BroadcastChannel(storageKey);channel.postMessage({event:'SIGNED_IN',session});channel.close();
    },{storageKey,session:sessionFor(other)});
    await expect(profile.locator('dd')).toHaveText(other.email);
    await expect(board.getByRole('button',{name:'Account menu',exact:true})).toBeVisible();
    await expect(directory.getByRole('heading',{name:'Streams',exact:true})).toBeVisible();
  }
  for(const page of pages){
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/Private card|Private stream|Private unsaved draft|private@example.test/)).toHaveCount(0);
  }
  await board.screenshot({path:testInfo.outputPath('after-account-change.png')});
  expect(errors).toEqual([]);
});
