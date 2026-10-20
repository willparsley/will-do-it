import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, nodes, text } from './helpers/react-driver.mjs';
import { loadTypeScript } from './helpers/load-typescript.mjs';
const { watchAccount } = loadTypeScript('lib/supabase/account-boundary.ts');
const user = { id:'account-a',email:'private@example.test' };
const other = { id:'account-b',email:'other@example.test' };
const streams = [{ id:'stream',user_id:user.id,title:'Private stream',state:'in_progress',area:'neutral',position:0 },{ id:'unc',user_id:user.id,title:'Uncategorized',state:'in_progress',area:'neutral',position:999 }];
const cards = [{ id:'card',user_id:user.id,stream_id:'stream',title:'Private card',status:'research',is_recurring:false,position:0 }];
const tick = () => new Promise(resolve=>setTimeout(resolve,0));
const deferred = () => { let resolve;const promise = new Promise(done=>{resolve=done;});return {promise,resolve}; };
function authEmitter() {
  const listeners=new Set();let subscriptions=0;
  return {auth:{onAuthStateChange(callback){listeners.add(callback);subscriptions++;return {data:{subscription:{unsubscribe(){listeners.delete(callback);}}}};}},
    emit(event,identity){for(const callback of listeners)callback(event,identity?{user:identity}:null);},
    get listeners(){return listeners.size;},get subscriptions(){return subscriptions;}};
}

test('account boundary ignores same-account refreshes and invalidates once on logout or account switch',()=>{
  for(const [event,identity,expected] of [['SIGNED_OUT',null,true],['SIGNED_IN',other,false]]) {
    const emitter=authEmitter();const invalidations=[];
    const boundary=watchAccount(emitter, signedOut=>invalidations.push(signedOut));
    assert.equal(boundary.acceptUser(user.id),true);
    for(const event of ['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'])emitter.emit(event,user);
    assert.equal(boundary.active,true);assert.deepEqual(invalidations,[]);
    emitter.emit(event,identity);emitter.emit('SIGNED_OUT',null);
    assert.deepEqual(invalidations,[expected]);assert.equal(boundary.acceptUser(user.id),false);
    boundary.dispose();assert.equal(emitter.listeners,0);
  }
});

test('account boundary catches a session change before getUser resolves and unsubscribes on disposal',()=>{
  const emitter=authEmitter();const invalidations=[];
  const boundary=watchAccount(emitter,signedOut=>invalidations.push(signedOut));
  emitter.emit('INITIAL_SESSION',other);
  assert.equal(boundary.acceptUser(user.id),false);assert.deepEqual(invalidations,[false]);
  boundary.dispose();emitter.emit('SIGNED_OUT',null);assert.deepEqual(invalidations,[false]);
});

for(const page of ['app/page.tsx','app/streams/page.tsx','app/profile/page.tsx']) {
  for(const scenario of (page.includes('profile')?['signed-out','account-switch','late-identity']:['signed-out','account-switch','late-identity','late-data'])) {
    test(`${page}: ${scenario} clears private UI and ignores pending loads`,async()=>{
      const emitter=authEmitter();const pending=deferred();const redirects=[];let dismissed=0;
      let holdIdentity=scenario==='late-identity';let holdData=scenario==='late-data' && page.includes('streams');
      const supabase={auth:{...emitter.auth,async getUser(){return holdIdentity?pending.promise:{data:{user}};}},async rpc(){return {data:0};},from(table){return {select(){return this;},eq(){if(table==='streams')return this;return holdData?pending.promise:Promise.resolve({data:table==='cards'?cards:[]});},then(resolve,reject){return (holdData?pending.promise:Promise.resolve({data:streams})).then(resolve,reject);},async order(){return holdData?pending.promise:{data:streams};}};}};
      const ui=driver(page,'default',{}, {'@/lib/supabase/client':{createClient:()=>supabase},'next/link':()=>null,'next/image':()=>null,
        sonner:{toast:{dismiss(){dismissed++;},error(){},success(){}}},
        '@dnd-kit/core':{useSensors:()=>[],useSensor:()=>null,MouseSensor(){},TouchSensor(){},DndContext(){},DragOverlay(){},pointerWithin(){}},
      });
      const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
      Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{replace:url=>redirects.push(url)}}});
      let cleanup;
      try {
        ui.render();cleanup=ui.effects[0]();await tick();
        if(!holdIdentity && !(holdData && page.includes('streams'))) {
          if(page==='app/page.tsx')assert.equal(nodes(ui.render(),n=>n.props?.card?.id==='card').length,1);
          else assert.ok(text(ui.render()).includes(page.includes('profile')?user.email:'Private stream'));
        }
        if(scenario==='late-data' && page==='app/page.tsx') {
          holdData=true;
          // Start a refresh through the real recurrence-update callback.
          const card=nodes(ui.render(),n=>n.props?.card?.id==='card')[0];card.props.onEdit({ detail: 0 });
          const editor=nodes(ui.render(),n=>typeof n.props?.onCardUpdated==='function')[0];
          void editor.props.onCardUpdated(cards[0]);await tick();
        }
        emitter.emit(scenario==='account-switch'?'SIGNED_IN':'SIGNED_OUT',scenario==='account-switch'?other:null);
        const hidden=ui.render();
        assert.equal(nodes(hidden,n=>n.props?.card?.id==='card').length,0);
        assert.ok(!text(hidden).includes('Private stream'));assert.ok(!text(hidden).includes(user.email));
        assert.deepEqual(redirects,[scenario==='account-switch'?(page==='app/page.tsx'?'/':page.includes('streams')?'/streams':'/profile'):'/login']);
        if(holdIdentity) {holdIdentity=false;pending.resolve({data:{user}});}
        else pending.resolve({data:page.includes('streams')?streams:cards});
        await tick();
        const after=ui.render();assert.equal(nodes(after,n=>n.props?.card?.id==='card').length,0);
        assert.ok(!text(after).includes('Private stream'));assert.ok(!text(after).includes(user.email));
        if(!page.includes('profile'))assert.equal(dismissed,1);
        assert.equal(emitter.subscriptions,1);
      } finally {
        cleanup?.();assert.equal(emitter.listeners,0);
        if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else delete globalThis.window;
      }
    });
  }
}
