import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, nodes, text, button } from './helpers/react-driver.mjs';

const source = { id:'source', user_id:'user', stream_id:'stream', base_title:'Monthly bill', frequency:'monthly', interval:1, month_day:3, weekdays:null, stack_missed:false, recurrence_timezone:'America/New_York', updated_at:'2026-10-14T12:00:00.123456+00:00', end_date:'2026-11-02T01:00:00Z', stopped_at:null };
const streams = [
  {id:'stream',user_id:'user',title:'Bills',state:'in_progress',area:'personal',position:0},
  {id:'target',user_id:'user',title:'Finances',state:'in_progress',area:'personal',position:1},
  {id:'uncategorized',user_id:'user',title:'Uncategorized',state:'in_progress',area:'neutral',position:999},
];
const card = {id:'card',user_id:'user',stream_id:'stream',title:'Monthly bill',status:'waiting',position:0,is_recurring:true,recurrence_source_id:'source'};
const notices = {toast:{success(){},error(){}}};
const field = (tree,id) => nodes(tree,node=>node.props?.id===id)[0];
const submit = tree => nodes(tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});

test('recurrence form loads source settings and submits exact source version and calendar end day', async () => {
  const calls=[];
  let updated,closed=false;
  const supabase={rpc(name,args){calls.push({name,args});return {async single(){return {data:{...source,...args.p_changes},error:null};}};}};
  const ui=driver('components/EditRecurrenceModal.tsx','RecurrenceForm',{
    source,streams,onClose(){closed=true;},onRecurrenceUpdated:value=>{updated=value;},
  },{'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices});
  let tree=ui.render();
  assert.equal(field(tree,'recurrence-month-day').props.value,'3');
  assert.equal(field(tree,'recurrence-end-date').props.value,'2026-11-01');
  field(tree,'recurrence-month-day').props.onValueChange('5');
  field(tree,'recurrence-base-title').props.onChange({target:{value:'Updated bill'}});
  field(tree,'recurrence-stream').props.onValueChange('target');
  tree=ui.render();await submit(tree);
  assert.equal(calls[0].name,'save_recurrence');
  assert.equal(calls[0].args.p_expected_updated_at,source.updated_at);
  assert.equal(calls[0].args.p_timezone,'America/New_York');
  assert.deepEqual(calls[0].args.p_changes,{
    base_title:'Updated bill',stream_id:'target',frequency:'monthly',interval:1,
    weekdays:null,month_day:5,stack_missed:false,end_date:'2026-11-01',enabled:true,
  });
  assert.equal(updated.month_day,5);assert.equal(closed,true);
});

test('weekly editor submits weekday choices, interval, stacking and stop state', async () => {
  let request;
  const supabase={rpc(name,args){request=args;return {async single(){return {data:source};}};}};
  const ui=driver('components/EditRecurrenceModal.tsx','RecurrenceForm',{
    source:{...source,frequency:'weekly',interval:2,weekdays:[1,3]},streams,onClose(){},onRecurrenceUpdated(){},
  },{'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices});
  let tree=ui.render();
  assert.equal(field(tree,'recurrence-interval').props.value,2);
  const boxes=nodes(tree,node=>node.type==='input' && node.props.type==='checkbox');
  boxes[5].props.onChange({target:{checked:true}});
  boxes[7].props.onChange({target:{checked:true}});
  boxes[8].props.onChange({target:{checked:false}});
  tree=ui.render();await submit(tree);
  assert.deepEqual(request.p_changes.weekdays,[1,3,5]);
  assert.equal(request.p_changes.interval,2);
  assert.equal(request.p_changes.month_day,null);
  assert.equal(request.p_changes.stack_missed,true);
  assert.equal(request.p_changes.enabled,false);
});

test('save failures stay in the recurrence editor and preserve entered values', async () => {
  let closed=false,updated=false;
  const supabase={rpc(){return {async single(){return {error:{message:'This recurrence changed elsewhere. Close and reopen the recurrence editor.'}};}};}};
  const ui=driver('components/EditRecurrenceModal.tsx','RecurrenceForm',{
    source,streams,onClose(){closed=true;},onRecurrenceUpdated(){updated=true;},
  },{'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices});
  let tree=ui.render();
  field(tree,'recurrence-base-title').props.onChange({target:{value:'My changes'}});
  tree=ui.render();await submit(tree);tree=ui.render();
  assert.equal(closed,false);assert.equal(updated,false);
  assert.equal(field(tree,'recurrence-base-title').props.value,'My changes');
  assert.ok(text(nodes(tree,node=>node.props.role==='alert')[0]).includes('changed elsewhere'));
  assert.equal(button(tree,'Save Recurrence').props.disabled,false);
});

test('opening recurrence editor fetches the current source and reports missing sources', async () => {
  for (const missing of [false,true]) {
    let queriedId;
    const supabase={from(table){assert.equal(table,'recurrence_sources');return {select(){return this;},eq(key,id){queriedId=id;return this;},async single(){return missing?{error:{message:'Recurrence source not found'}}:{data:source};}};}};
    const ui=driver('components/EditRecurrenceModal.tsx','EditRecurrenceModal',{sourceId:'source',streams,onClose(){},onRecurrenceUpdated(){}},
      {'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices});
    ui.render();ui.effects[0]();await new Promise(resolve=>setTimeout(resolve,0));
    const tree=ui.render();
    assert.equal(queriedId,'source');
    if(missing) {assert.ok(text(tree).includes('Recurrence source not found'));assert.ok(button(tree,'Try again'));}
    else assert.equal(tree.props.source,source);
  }
});

test('recurrence icon opens the source without opening or dragging the card, including archived cards', () => {
  for (const status of ['waiting','complete','canceled']) {
    let edited;
    const ui=driver('components/Card.tsx','CardView',{card:{...card,status},onEditRecurrence:id=>{edited=id;}});
    const tree=ui.render();
    const icon=nodes(tree,node=>node.type==='button' && node.props['aria-label']==='Edit recurrence')[0];
    let stopped=0;
    for(const event of ['onPointerDown','onMouseDown','onTouchStart','onClick']) icon.props[event]({stopPropagation(){stopped++;}});
    assert.equal(edited,'source');assert.equal(stopped,4);
  }
  const overlay=driver('components/Card.tsx','CardView',{card}).render();
  assert.equal(nodes(overlay,node=>node.type==='button').length,0);
});

test('edit card offers recurrence navigation and protects unsaved card edits', () => {
  let edited;
  const supabase={};
  const ui=driver('components/EditCardModal.tsx','EditCardModal',{
    card,streams,onClose(){},onCardUpdated(){},onCardDeleted(){},onEditRecurrence:id=>{edited=id;},
  },{'@/lib/supabase/client':{createClient:()=>supabase},sonner:notices});
  let tree=ui.render();button(tree,'Edit recurrence').props.onClick();assert.equal(edited,'source');
  edited=null;
  nodes(tree,node=>node.type==='input' && node.props.type==='text')[0].props.onChange({target:{value:'Unsaved title'}});
  tree=ui.render();
  const previous=globalThis.confirm;
  try {
    globalThis.confirm=()=>false;button(tree,'Edit recurrence').props.onClick();assert.equal(edited,null);
    globalThis.confirm=()=>true;button(tree,'Edit recurrence').props.onClick();assert.equal(edited,'source');
  } finally {if(previous===undefined)delete globalThis.confirm;else globalThis.confirm=previous;}
});

test('both workspace entry points open the same source editor and saving runs generation and promotion', async () => {
  const calls=[];
  const supabase={auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},async getUser(){return {data:{user:{id:'user'}}};}},async rpc(name){calls.push(name);return {data:0};},from(table){return {select(){return this;},eq(){return table==='streams'?this:Promise.resolve({data:table==='cards'?[card]:[source]});},async order(){return {data:streams};}};}};
  const ui=driver('app/page.tsx','default',{}, {
    '@/lib/supabase/client':{createClient:()=>supabase},sonner:notices,
    '@dnd-kit/core':{useSensors:()=>[],useSensor:()=>null,MouseSensor(){},TouchSensor(){},DndContext(){},DragOverlay(){},pointerWithin(){}},
  });
  ui.render();ui.effects[0]();await new Promise(resolve=>setTimeout(resolve,0));
  let tree=ui.render();
  const displayed=nodes(tree,node=>node.props.card?.id==='card')[0];
  displayed.props.onEditRecurrence('source');tree=ui.render();
  let editor=nodes(tree,node=>node.props.sourceId==='source')[0];assert.ok(editor);
  editor.props.onClose();tree=ui.render();
  nodes(tree,node=>node.props.card?.id==='card')[0].props.onClick();tree=ui.render();
  const editCard=nodes(tree,node=>node.props.card?.id==='card' && node.props.onCardUpdated)[0];
  editCard.props.onEditRecurrence('source');tree=ui.render();
  assert.equal(nodes(tree,node=>node.props.onCardUpdated).length,0);
  editor=nodes(tree,node=>node.props.sourceId==='source')[0];
  editor.props.onRecurrenceUpdated(source);editor.props.onClose();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(calls,['generate_recurring_instances','promote_due_cards','generate_recurring_instances','promote_due_cards']);
});
