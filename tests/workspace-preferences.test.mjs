import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, nodes, button } from './helpers/react-driver.mjs';

async function workspace(userId='user') {
  const supabase={
    auth:{async getUser(){return {data:{user:{id:userId}}};}},
    async rpc(){return {data:0};},
    from(table){return {select(){return this;},eq(){return table==='streams'?this:Promise.resolve({data:[]});},async order(){return {data:[{id:'unc',title:'Uncategorized',state:'in_progress',area:'neutral',position:999}]};}};},
  };
  const ui=driver('app/page.tsx','default',{}, {
    '@/lib/supabase/client':{createClient:()=>supabase},sonner:{toast:{error(){},success(){}}},
    '@dnd-kit/core':{useSensors:()=>[],useSensor:()=>null,MouseSensor(){},TouchSensor(){},DndContext(){},DragOverlay(){},closestCenter(){}},
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
    nodes(tree,node=>node.type==='select' && node.props.value==='month')[0].props.onChange({target:{value:'year'}});
    tree=ui.render();areaFilter(tree).props.onChange('work');
    assert.deepEqual(JSON.parse(storage.getItem('will-do-it:workspace:user')),{view:'archive',area:'work',archivePeriod:'year'});
    ui=await workspace();tree=ui.render();
    assert.equal(selected(tree),button(tree,'Archive'));
    assert.equal(areaFilter(tree).props.value,'work');
    assert.equal(nodes(tree,node=>node.type==='select')[0].props.value,'year');
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
      assert.equal(nodes(ui.render(),node=>node.type==='select')[0].props.value,'month');
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
