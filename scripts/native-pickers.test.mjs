import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

for(const platform of ['macOS','Windows'])test(`${platform} menus save selections and discard cancellations or stale selections`,async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const globals=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 if(platform==='Windows'){
  document.documentElement.dataset.nativeMenus='true';
  document.documentElement.dataset.nativeCaption='true';
 }else document.documentElement.dataset.nativeWindowControls='true';
 dom.window.HTMLButtonElement.prototype.getBoundingClientRect=()=>({left:12,top:40,bottom:66});
 const calls=[],applied=[],errors=[],saving=[];
 let items,choose='只读',threadId='one',model='sol',effort='medium',fail=false,finishPopup,hold=false;
 const models=[{model:'sol',displayName:'Sol',supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:'medium',additionalSpeedTiers:['fast']},{model:'astra',displayName:'Astra',supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'low'}];
 const find=(entries,text)=>entries.flatMap(item=>[item,...(item.items?find(item.items,text):[])]).filter(item=>item.text===text);
 window.__TAURI_INTERNALS__={transformCallback:()=>1,invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='read_model_options')return {models,settings:{model,reasoningEffort:effort}};
  if(cmd==='plugin:menu|new'){items=args.options.items;return [1,'test-menu'];}
  if(cmd==='plugin:menu|popup'){
   const select=()=>{if(choose){const item=find(items,choose)[0];assert.ok(item,choose);assert.notEqual(item.enabled,false);item.handler.onmessage(item.id);}};
   if(hold)return new Promise(resolve=>{finishPopup=()=>{select();resolve();};});select();return;
  }
  if(cmd==='plugin:resources|close')return;
  if(cmd.startsWith('update_')){if(fail)throw Error('save rejected');return {threadSettings:{saved:true}};}
  throw Error(cmd);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {PermissionPicker}=await vite.ssrLoadModule('/src/PermissionPicker.jsx');
  const {SpeedPicker}=await vite.ssrLoadModule('/src/SpeedPicker.jsx');
  const {ThreadPicker}=await vite.ssrLoadModule('/src/ThreadPicker.jsx');
  root=createRoot(document.getElementById('root'));
  const props=()=>({threadId,model,effort,onApplied:(...args)=>applied.push(args),onError:error=>errors.push(error),onSavingChange:state=>saving.push(state)});
  const render=Component=>act(async()=>root.render(React.createElement(Component,props())));
  const click=()=>act(async()=>document.querySelector('button').click());
  await render(PermissionPicker);await click();
  assert.equal(document.querySelector('[role="dialog"]'),null,'the operating system owns the popup');
  const popup=calls.find(call=>call.cmd==='plugin:menu|popup');
  assert.equal(popup.args.at.toJSON().Logical.y,platform==='Windows'?66:40);
  assert.equal(calls.find(call=>call.cmd==='update_permission_settings').args.preset,'read-only');
  assert.deepEqual(saving,[true,false]);assert.equal(applied.length,1);
  choose=null;await click();assert.equal(applied.length,1,'dismissal does not save');
  fail=true;choose='只读';await click();assert.match(errors.at(-1),/save rejected/);assert.equal(saving.at(-1),false);fail=false;
  hold=true;await click();threadId='two';await render(PermissionPicker);
  await act(async()=>finishPopup());assert.equal(applied.length,1,'selection made for an old chat is discarded');hold=false;
  choose='快速模式';await render(SpeedPicker);await click();assert.equal(calls.filter(call=>call.cmd==='update_speed_settings').at(-1).args.fast,true);
  assert.ok(calls.some(call=>call.cmd==='plugin:resources|close'),'native menu resources are released');
  const changed=[];choose='Other';
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  await act(async()=>root.render(React.createElement(ThreadPicker,{threads:[{id:'one',thread_name:'Current'},{id:'two',thread_name:'Other'}],value:'one',onChange:id=>changed.push(id)})));
  const popupCount=calls.filter(call=>call.cmd==='plugin:menu|popup').length;
  await click();
  if(platform==='macOS'){
   assert.equal(calls.filter(call=>call.cmd==='plugin:menu|popup').length,popupCount);
   const list=document.querySelector('[role="listbox"]');
   assert.ok(list.querySelector('[role="group"]'));
   assert.equal(list.querySelector('[aria-selected="true"]').textContent,'Current');
   await act(async()=>list.querySelector('[aria-selected="false"]').click());
   assert.equal(document.querySelector('[role="listbox"]'),null);
  }
  assert.deepEqual(changed,['two']);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();globals.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
