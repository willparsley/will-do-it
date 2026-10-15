import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, nodes, text, button } from './helpers/react-driver.mjs';

const user = { id:'user' };
const streams = [
  {id:'old-stream',user_id:'user',title:'Old',state:'in_progress',area:'work',position:0},
  {id:'new-stream',user_id:'user',title:'New',state:'in_progress',area:'personal',position:1},
  {id:'uncategorized',user_id:'user',title:'Uncategorized',state:'in_progress',area:'neutral',position:999},
];
const base = {id:'card',user_id:'user',stream_id:'old-stream',title:'Take a walk',status:'waiting',position:0,is_recurring:true,recurrence_source_id:'source',due_at:'2026-10-15T04:00:42.123Z',remind_at:'2026-10-15T12:00:18.987Z'};
function notifications() {
  const errors = [], successes = [];
  return { errors, successes, module:{toast:{error:m=>errors.push(m),success:m=>successes.push(m)}} };
}

// These invoke the real TSX handlers and rerender with controlled hook state.
// HTTP is mocked; SQL integration lives in recurrence.test.mjs.
test('editing only a title preserves exact date instants and uses the source current stream', async () => {
  const notices = notifications();
  const calls = [];
  let updated;
  const card = {...base,status:'complete',recurrence_stream_id:'new-stream'};
  const supabase = {rpc(name,args) {calls.push({name,args});return {async single(){return {data:{...card,...args.p_changes},error:null};}};}};
  const ui = driver('components/EditCardModal.tsx','EditCardModal',{
    card,streams,onClose(){},onCardDeleted(){},onCardUpdated:c=>{updated=c;},
  },{'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices.module});
  let tree = ui.render();
  nodes(tree,n=>n.type==='input' && n.props.type==='text')[0].props.onChange({target:{value:'New title'}});
  tree=ui.render();
  await button(tree,'Save Changes').props.onClick();
  assert.equal(calls[0].name,'save_card');
  assert.equal(calls[0].args.p_changes.due_at,base.due_at);
  assert.equal(calls[0].args.p_changes.remind_at,base.remind_at);
  assert.equal(calls[0].args.p_changes.stream_id,'new-stream');
  assert.equal(calls[0].args.p_expected_status,'complete');
  assert.equal(updated.title,'New title');
  assert.equal(notices.errors.length,0);
});

test('reopening errors from Supabase are visible and never reported as success', async () => {
  const notices = notifications();
  let closed=false,updated=false;
  const supabase={rpc(){return {async single(){return {error:{message:'This recurrence already has a pending card'}};}};}};
  const ui=driver('components/EditCardModal.tsx','EditCardModal',{card:{...base,status:'complete'},streams,onClose(){closed=true;},onCardUpdated(){updated=true;},onCardDeleted(){}},
    {'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices.module});
  let tree=ui.render();
  nodes(tree,n=>n.props?.onValueChange && n.props.value==='complete')[0].props.onValueChange('waiting');
  tree=ui.render();
  // Expected error is logged by the component; keep test output focused.
  const log=console.error;console.error=()=>{};
  try {await button(tree,'Save Changes').props.onClick();} finally {console.error=log;}
  assert.equal(closed,false);assert.equal(updated,false);
  assert.deepEqual(notices.errors,['This recurrence already has a pending card']);
  assert.equal(notices.successes.length,0);
});

test('closing a stream discovers sources without pending cards and requires separate explicit move/stop choices', async () => {
  const notices=notifications(),calls=[];
  let updated;
  const sources=[{id:'one',base_title:'Walk'},{id:'two',base_title:'Read'}];
  const supabase={rpc(name,args){calls.push({name,args});
    if(name==='recurrences_for_stream')return Promise.resolve({data:sources,error:null});
    return {async single(){return {data:{...streams[0],state:args.p_state},error:null};}};
  }};
  const ui=driver('components/EditStreamModal.tsx','EditStreamModal',{
    stream:streams[0],streams,onClose(){},onStreamUpdated:s=>{updated=s;},onStreamDeleted(){},
  },{'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices.module});
  let tree=ui.render();
  nodes(tree,n=>n.props?.onValueChange && n.props.value==='in_progress')[0].props.onValueChange('complete');
  tree=ui.render();await button(tree,'Save Changes').props.onClick();
  assert.deepEqual(calls.map(c=>c.name),['recurrences_for_stream']);
  tree=ui.render();
  assert.ok(text(tree).includes('Choose what happens to each recurrence'));
  nodes(tree,n=>n.props.id==='recurrence-one')[0].props.onValueChange('move');
  tree=ui.render();
  nodes(tree,n=>n.props['aria-label']==='Move Walk to stream')[0].props.onValueChange('new-stream');
  tree=ui.render();
  nodes(tree,n=>n.props.id==='recurrence-two')[0].props.onValueChange('stop');
  tree=ui.render();await button(tree,'Save Changes').props.onClick();
  assert.deepEqual(calls.at(-1).args.p_recurrences,[{source_id:'one',action:'move',stream_id:'new-stream'},{source_id:'two',action:'stop'}]);
  assert.equal(calls.at(-1).name,'save_stream');
  assert.equal(updated.state,'complete');
});

test('stream deletion uses only the atomic RPC and leaves the modal open on rehome failure', async () => {
  const notices=notifications(),calls=[];
  let closed=false,deleted=false;
  const supabase={async rpc(name,args){calls.push({name,args});return {error:{message:'Rehome failed'}};}};
  const ui=driver('components/EditStreamModal.tsx','EditStreamModal',{
    stream:streams[0],streams,onClose(){closed=true;},onStreamUpdated(){},onStreamDeleted(){deleted=true;},
  },{'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices.module});
  let tree=ui.render();await button(tree,'Delete Stream').props.onClick();
  tree=ui.render();
  const log=console.error;console.error=()=>{};
  try {await button(tree,'Delete & Move Cards').props.onClick();} finally {console.error=log;}
  assert.deepEqual(calls,[{name:'delete_stream_rehoming',args:{p_stream_id:'old-stream',p_target_id:'uncategorized'}}]);
  assert.equal(closed,false);assert.equal(deleted,false);
  assert.deepEqual(notices.errors,['Rehome failed']);
});

test('weekly intervals remain visible after switching from every-N-days and recurring creation is one atomic request', async () => {
  const notices=notifications(),calls=[];
  const supabase={auth:{async getUser(){return {data:{user}};}},rpc(name,args){calls.push({name,args});return {async single(){return {data:{...base,title:args.p_title},error:null};}};}};
  const ui=driver('components/AddCardModal.tsx','AddCardModal',{streams,onClose(){},onCardCreated(){}},
    {'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices.module});
  let tree=ui.render();
  nodes(tree,n=>n.type==='input' && n.props.type==='text')[0].props.onChange({target:{value:'Weekly walk'}});
  nodes(tree,n=>n.type==='input' && n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});
  tree=ui.render();
  nodes(tree,n=>n.props?.onValueChange && n.props.value==='daily')[0].props.onValueChange('every_n_days');
  tree=ui.render();
  nodes(tree,n=>n.type==='input' && n.props.type==='number')[0].props.onChange({target:{value:'3'}});
  tree=ui.render();
  nodes(tree,n=>n.props?.onValueChange && n.props.value==='every_n_days')[0].props.onValueChange('weekly');
  tree=ui.render();
  assert.equal(nodes(tree,n=>n.type==='input' && n.props.type==='number')[0].props.value,3);
  assert.ok(text(tree).includes('weeks'));
  await nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'create_recurring_card');
  assert.equal(calls[0].args.p_frequency,'weekly');
  assert.equal(calls[0].args.p_interval,3);
  assert.equal(calls[0].args.p_due_at,null);
});

test('workspace refresh calls conditional promotion and hydrates cards before displaying archive filters', async () => {
  const notices=notifications(),calls=[];
  const source={id:'source',stream_id:'new-stream',base_title:'Walk',last_completed_at:new Date().toISOString(),recurrence_timezone:'America/New_York'};
  const card={...base,status:'complete',completed_at:new Date().toISOString()};
  const supabase={auth:{async getUser(){return {data:{user},error:null};}},async rpc(name){calls.push(name);return {data:0,error:null};},from(table){return {select(){return this;},eq(){return table==='streams'?this:Promise.resolve({data:table==='cards'?[card]:[source],error:null});},async order(){return {data:streams,error:null};}};}};
  const ui=driver('app/page.tsx','default',{}, {
    '@/lib/supabase/client':{createClient:()=>supabase},sonner:notices.module,
    '@dnd-kit/core':{useSensors:()=>[],useSensor:()=>null,MouseSensor(){},TouchSensor(){},DndContext(){},DragOverlay(){},closestCenter(){}},
  });
  ui.render();ui.effects[0]();
  await new Promise(resolve=>setTimeout(resolve,0));
  let tree=ui.render();
  assert.deepEqual(calls,['generate_recurring_instances','promote_due_cards']);
  button(tree,'All').props.onClick();tree=ui.render();
  const displayed=nodes(tree,n=>n.props.card?.id==='card')[0].props.card;
  assert.equal(displayed.last_completed_at,source.last_completed_at);
  assert.equal(displayed.recurrence_stream_id,'new-stream');
  button(tree,'Archive').props.onClick();tree=ui.render();
  const period=nodes(tree,n=>n.props?.onValueChange && n.props.value==='month')[0];
  assert.ok(period);
  const groups=nodes(tree,n=>n.props.cards?.some(c=>c.id==='card'));
  assert.equal(groups.length,1);
  period.props.onValueChange('all');tree=ui.render();
  assert.ok(nodes(tree,n=>n.props?.onValueChange && n.props.value==='all').length);
});

for (const refreshFails of [false,true]) test(`workspace stays visible during a delayed refresh, including when refresh ${refreshFails ? 'fails' : 'succeeds'}`, async () => {
  const notices=notifications();
  let reads=0,releaseInitial,releaseRefresh;
  let storedCard={...base};
  const supabase={
    auth:{async getUser(){return {data:{user}};}},
    async rpc(){return {data:0};},
    from(table){return {
      select(){return this;},
      eq(){return table==='streams'?this:Promise.resolve({data:table==='cards'?[storedCard]:[]});},
      order(){return new Promise(resolve=>{if(++reads===1)releaseInitial=resolve;else releaseRefresh=resolve;});},
    };},
  };
  const ui=driver('app/page.tsx','default',{}, {
    '@/lib/supabase/client':{createClient:()=>supabase},sonner:notices.module,
    '@dnd-kit/core':{useSensors:()=>[],useSensor:()=>null,MouseSensor(){},TouchSensor(){},DndContext(){},DragOverlay(){},closestCenter(){}},
  });
  assert.ok(text(ui.render()).includes('Loading your workspace'));
  ui.effects[0]();await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(text(ui.render()).includes('Loading your workspace'));
  releaseInitial({data:streams});await new Promise(resolve=>setTimeout(resolve,0));
  let tree=ui.render();
  nodes(tree,n=>n.props.card?.id==='card')[0].props.onClick();tree=ui.render();
  storedCard={...base,title:'Edited card'};
  const refresh=nodes(tree,n=>n.props.onCardUpdated)[0].props.onCardUpdated(storedCard);
  tree=ui.render();
  assert.ok(!text(tree).includes('Loading your workspace'));
  assert.equal(nodes(tree,n=>n.type==='header').length,1);
  assert.equal(nodes(tree,n=>n.props.card?.id==='card')[0].props.card.title,'Edited card');
  assert.equal(nodes(tree,n=>n.props.onCardUpdated).length,1); // The editor also stays mounted.
  releaseRefresh(refreshFails?{error:{message:'Refresh failed'}}:{data:streams});
  await refresh;tree=ui.render();
  assert.ok(!text(tree).includes('Loading your workspace'));
  assert.equal(nodes(tree,n=>n.type==='header').length,1);
  assert.deepEqual(notices.errors,refreshFails?['Refresh failed']:[]);
});

for(const action of ['complete','advance','drag']) test(`failed stale ${action} action reloads persisted state instead of leaving a reopened card on screen`, async () => {
  const notices=notifications();
  let persisted={...base};
  const source={id:'source',stream_id:'old-stream',base_title:'Walk',recurrence_timezone:'America/New_York'};
  const supabase={auth:{async getUser(){return {data:{user}};}},rpc(name){
    if(name==='save_card_with_undo') {
      persisted={...base,status:'complete',completed_at:new Date().toISOString()};
      return Promise.resolve({error:{message:'This card changed elsewhere. Refresh and try again.'}});
    }
    return Promise.resolve({error:null,data:0});
  },from(table){return {select(){return this;},eq(){return table==='streams'?this:Promise.resolve({data:table==='cards'?[persisted]:[source]});},async order(){return {data:streams};}};}};
  const ui=driver('app/page.tsx','default',{}, {
    '@/lib/supabase/client':{createClient:()=>supabase},sonner:notices.module,
    '@dnd-kit/core':{useSensors:()=>[],useSensor:()=>null,MouseSensor(){},TouchSensor(){},DndContext(){},DragOverlay(){},closestCenter(){}},
  });
  ui.render();ui.effects[0]();await new Promise(resolve=>setTimeout(resolve,0));
  button(ui.render(),'All').props.onClick();
  const tree=ui.render();
  const log=console.error;console.error=()=>{};
  try {
    if(action==='drag') await nodes(tree,n=>typeof n.props?.onDragEnd==='function')[0].props.onDragEnd({active:{id:'card'},over:{id:'new-stream::research'}});
    else {
      const card=nodes(tree,n=>n.props.card?.id==='card')[0];
      await card.props[action==='complete'?'onComplete':'onAdvance']('card');
    }
  } finally {console.error=log;}
  const refreshed=nodes(ui.render(),n=>n.props.card?.id==='card')[0].props.card;
  assert.equal(refreshed.status,'complete');
  assert.ok(refreshed.completed_at);
  assert.deepEqual(notices.errors,['This card changed elsewhere. Refresh and try again.']);
});

for (const operation of ['create', 'edit', 'drag']) {
  for (const initial of ['backlog', 'priority_backlog', 'research', 'complete']) {
    for (const field of ['due_at', 'remind_at']) {
      test(`ordinary ${operation}: overdue ${field} refreshes promotion and respects ${initial}`, async () => {
        const notices = notifications(), calls = [];
        const future = new Date(); future.setDate(future.getDate() + 2);
        const past = new Date(); past.setDate(past.getDate() - 2);
        const card = { ...base, is_recurring: false, recurrence_source_id: null, status: initial,
          due_at: null, remind_at: null, [field]: future.toISOString() };
        let persisted = operation === 'create' ? [] : [card];
        const supabase = {
          auth: { async getUser() { return { data: { user } }; } },
          rpc(name, args) {
            calls.push(name);
            if (name === 'save_card_with_undo') {
              persisted = persisted.map(c => ({ ...c, ...args.p_changes }));
              // The transactional quick-action RPC includes promotion.
              persisted = persisted.map(c => ['backlog', 'priority_backlog'].includes(c.status) &&
                [c.due_at, c.remind_at].some(value => value && new Date(value).getTime() <= Date.now())
                ? { ...c, status: 'waiting' } : c);
              return Promise.resolve({ data: { card: persisted[0], undo_id: 'undo' }, error: null });
            }
            if (name === 'promote_due_cards') persisted = persisted.map(c => {
              const eligible = ['backlog', 'priority_backlog'].includes(c.status) &&
                [c.due_at, c.remind_at].some(value => value && new Date(value).getTime() <= Date.now());
              return eligible ? { ...c, status: 'waiting' } : c;
            });
            return Promise.resolve({ data: 0, error: null });
          },
          from(table) { return { select() { return this; },
            eq() { return table === 'streams' ? this : Promise.resolve({ data: table === 'cards' ? persisted : [] }); },
            async order() { return { data: streams }; },
          }; },
        };
        const ui = driver('app/page.tsx', 'default', {}, {
          '@/lib/supabase/client': { createClient: () => supabase }, sonner: notices.module,
          '@dnd-kit/core': { useSensors: () => [], useSensor: () => null, MouseSensor() {}, TouchSensor() {}, DndContext() {}, DragOverlay() {}, closestCenter() {} },
        });
        ui.render(); ui.effects[0](); await new Promise(resolve => setTimeout(resolve, 0));
        let tree = ui.render();
        button(tree,'All').props.onClick(); tree=ui.render();
        const callsBefore = calls.length;
        const saved = { ...card, [field]: past.toISOString() };
        persisted = [saved];
        if (operation === 'drag') {
          await nodes(tree, n => typeof n.props?.onDragEnd === 'function')[0].props.onDragEnd({ active: { id: card.id }, over: { id: `new-stream::${initial}` } });
        } else {
          if (operation === 'create') nodes(tree, n => n.type === 'button' && text(n).includes('Quick Add'))[0].props.onClick();
          else nodes(tree, n => n.props.card?.id === card.id)[0].props.onClick();
          tree = ui.render();
          const callback = operation === 'create' ? 'onCardCreated' : 'onCardUpdated';
          await nodes(tree, n => typeof n.props?.[callback] === 'function')[0].props[callback](saved);
        }
        const displayed = nodes(ui.render(), n => n.props.card?.id === card.id)[0].props.card;
        assert.equal(calls.slice(callsBefore).filter(name => name === (operation === 'drag' ? 'save_card_with_undo' : 'promote_due_cards')).length, 1);
        assert.equal(displayed.status, ['backlog', 'priority_backlog'].includes(initial) ? 'waiting' : initial);
        assert.equal(notices.errors.length, 0);
        if (operation === 'drag') {
          assert.equal(displayed.stream_id, 'new-stream');
          assert.deepEqual(notices.successes, []);
        }
      });
    }
  }
}

for (const action of ['complete','advance']) for (const fails of [false,true]) {
  test(`${action} toast Undo ${fails ? 'reports a conflict' : 'restores the card'} without re-promoting it`, async () => {
    const successes=[],errors=[],calls=[];
    let persisted={...base,is_recurring:false,recurrence_source_id:null,status:action==='advance'?'research':'waiting'};
    let before;
    const supabase={
      auth:{async getUser(){return {data:{user}};}},
      async rpc(name,args){
        calls.push(name);
        if(name==='save_card_with_undo') {
          before={...persisted};persisted={...persisted,...args.p_changes};
          return {data:{card:persisted,undo_id:'token'}};
        }
        if(name==='undo_card_action') {
          assert.deepEqual(args,{p_undo_id:'token'});
          if(fails)return {error:{message:'This card changed since then'}};
          persisted=before;
        }
        return {data:0};
      },
      from(table){return {select(){return this;},eq(){return table==='streams'?this:Promise.resolve({data:table==='cards'?[persisted]:[]});},async order(){return {data:streams};}};},
    };
    const ui=driver('app/page.tsx','default',{}, {
      '@/lib/supabase/client':{createClient:()=>supabase},
      sonner:{toast:{success:(message,options)=>{successes.push({message,options});return 'toast';},error:message=>errors.push(message),loading:()=> 'pending',dismiss(){}}},
      '@dnd-kit/core':{useSensors:()=>[],useSensor:()=>null,MouseSensor(){},TouchSensor(){},DndContext(){},DragOverlay(){},closestCenter(){}},
    });
    ui.render();ui.effects[0]();await new Promise(resolve=>setTimeout(resolve,0));
    button(ui.render(),'All').props.onClick();
    const tree=ui.render();
    await nodes(tree,n=>n.props.card?.id==='card')[0].props[action==='complete'?'onComplete':'onAdvance']('card');
    const notification=successes[0];
    assert.equal(notification.options.duration,8000);
    assert.equal(notification.options.action.label,'Undo');
    const changed={...persisted};
    const callsBefore=calls.length;
    await Promise.all([notification.options.action.onClick(),notification.options.action.onClick()]);
    assert.deepEqual(calls.slice(callsBefore),['undo_card_action']);
    const displayed=nodes(ui.render(),n=>n.props.card?.id==='card')[0].props.card;
    for (const [key,value] of Object.entries(fails?changed:before)) assert.deepEqual(displayed[key],value);
    assert.deepEqual(errors,fails?['This card changed since then']:[]);
    assert.equal(successes.at(-1).message,fails?notification.message:'Undone');
  });
}
