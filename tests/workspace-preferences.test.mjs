import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, nodes, button } from './helpers/react-driver.mjs';

async function workspace(userId='user') {
  const supabase={
    auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},async getUser(){return {data:{user:{id:userId}}};}},
    async rpc(){return {data:0};},
    from(table){return {select(){return this;},eq(){return table==='streams'?this:Promise.resolve({data:[]});},async order(){return {data:[{id:'unc',title:'Uncategorized',state:'in_progress',area:'neutral',position:999}]};}};},
  };
  const ui=driver('app/page.tsx','default',{}, {
    '@/lib/supabase/client':{createClient:()=>supabase},sonner:{toast:{error(){},success(){}}},
    '@dnd-kit/core':{useSensors:()=>[],useSensor:()=>null,MouseSensor(){},TouchSensor(){},KeyboardSensor: class { static activators = []; },DndContext(){},DragOverlay(){},pointerWithin(){}},
  });
  ui.render();ui.effects[0]();await new Promise(resolve=>setTimeout(resolve,0));
  return ui;
}

async function withStorage(storage, run) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  try {await run();}
  finally {if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
}
const memoryStorage = () => {
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
};
const selected = tree => nodes(tree,node=>node.type==='button' && node.props['aria-pressed']===true)[0];
const areaFilter = tree => nodes(tree,node=>typeof node.type==='function' && node.props.value!==undefined && node.props.onChange)[0];

test('Active is the default and every selected view survives a fresh workspace mount', async () => {
  await withStorage(memoryStorage(),async()=>{
    let ui=await workspace();
    assert.equal(button(ui.render(),'Active').props['aria-pressed'],true);
    for(const label of ['Backlog','All','Archive','Active']) {
      button(ui.render(),label).props.onClick();
      ui=await workspace();
      assert.equal(button(ui.render(),label).props['aria-pressed'],true);
    }
  });
});

test('refresh restores the selected area and archive period with the view; preferences are isolated by user', async () => {
  const storage=memoryStorage();
  await withStorage(storage,async()=>{
    let ui=await workspace();
    button(ui.render(),'Archive').props.onClick();
    let tree=ui.render();
    nodes(tree,node=>node.props?.onValueChange && node.props.value==='week')[0].props.onValueChange('year');
    tree=ui.render();areaFilter(tree).props.onChange('work');
    assert.deepEqual(JSON.parse(storage.getItem('will-do-it:workspace:user')),{view:'archive',area:'work',archivePeriod:'year',hideRecurring:false});
    ui=await workspace();tree=ui.render();
    assert.equal(selected(tree),button(tree,'Archive'));
    assert.equal(areaFilter(tree).props.value,'work');
    assert.equal(nodes(tree,node=>node.props?.onValueChange)[0].props.value,'year');
    const other=await workspace('other');tree=other.render();
    assert.equal(selected(tree),button(tree,'Active'));
    assert.equal(areaFilter(tree).props.value,'all');
    assert.equal(JSON.parse(storage.getItem('will-do-it:workspace:user')).view,'archive');
  });
});

test('malformed or unsupported saved settings fall back to defaults', async () => {
  for(const value of ['{broken',JSON.stringify({view:'missing',area:'neutral',archivePeriod:'forever'}),'null']) {
    const storage=memoryStorage();storage.setItem('will-do-it:workspace:user',value);
    await withStorage(storage,async()=>{
      const ui=await workspace();
      assert.equal(button(ui.render(),'Active').props['aria-pressed'],true);
      assert.equal(areaFilter(ui.render()).props.value,'all');
      button(ui.render(),'Archive').props.onClick();
      assert.equal(nodes(ui.render(),node=>node.props?.onValueChange)[0].props.value,'week');
    });
  }
});

test('blocked browser storage does not prevent loading or switching views', async () => {
  await withStorage({getItem(){throw new Error('Storage blocked');},setItem(){throw new Error('Storage blocked');}},async()=>{
    const ui=await workspace();
    assert.equal(button(ui.render(),'Active').props['aria-pressed'],true);
    button(ui.render(),'Backlog').props.onClick();
    assert.equal(button(ui.render(),'Backlog').props['aria-pressed'],true);
  });
});


test('history control appears only in All and Archive and shares its saved selection', async () => {
  await withStorage(memoryStorage(),async()=>{
    let ui=await workspace();
    const control=()=>nodes(ui.render(),node=>node.props?.['aria-label']==='Completed/canceled period');
    for(const label of ['Active','Backlog']) {
      button(ui.render(),label).props.onClick();
      assert.equal(control().length,0);
    }
    button(ui.render(),'All').props.onClick();
    assert.equal(control()[0].props.value,'week');
    assert.deepEqual(control()[0].props.options.map(option=>option.value),['week','month','quarter','year','all']);
    control()[0].props.onValueChange('quarter');
    button(ui.render(),'Archive').props.onClick();
    assert.equal(control()[0].props.value,'quarter');
    ui=await workspace();
    assert.equal(control()[0].props.value,'quarter');
  });
});

test('mobile layout is validated, remembered per user, and retained when other filters change', async () => {
  const storage = memoryStorage();
  const layoutControl = ui => nodes(ui.render(), node => typeof node.props?.onLayout === 'function')[0];
  await withStorage(storage, async () => {
    let ui = await workspace();
    assert.equal(layoutControl(ui).props.layout, 'status');
    layoutControl(ui).props.onLayout('stream');
    ui = await workspace();
    assert.equal(layoutControl(ui).props.layout, 'stream');
    button(ui.render(), 'Backlog').props.onClick();
    ui = await workspace();
    assert.equal(layoutControl(ui).props.layout, 'stream');
    assert.equal(button(ui.render(), 'Backlog').props['aria-pressed'], true);
    assert.equal(layoutControl(await workspace('other')).props.layout, 'status');
    layoutControl(ui).props.onLayout('status');
    ui = await workspace();
    assert.equal(layoutControl(ui).props.layout, 'status');
    storage.setItem('will-do-it:workspace:user', JSON.stringify({ mobileLayout: 'invalid' }));
    assert.equal(layoutControl(await workspace()).props.layout, 'status');
  });
});
