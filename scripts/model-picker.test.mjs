import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('model popup saves each selection automatically, rolls back failures and discards stale chat results',async()=>{
 const dom=new JSDOM('<div id="root"></div><button id="outside">outside</button>',{url:'http://localhost'});
 const globals=['window','document','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,requestAnimationFrame:callback=>setTimeout(callback,0),IS_REACT_ACT_ENVIRONMENT:true});
 const calls=[],applied=[],savingStates=[];
 const models=[{model:'model-a',displayName:'Model A',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:'fast'},{reasoningEffort:'ultra',description:'deep'}]},{model:'model-b',displayName:'Model B',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]}];
 let threadId='one',currentModel='model-a',effort='low',rejectSave=false,rejectLoad=false,deferLoad=false,finishLoad,deferSave=false,finishSave;
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='read_model_options'){
   if(deferLoad)return new Promise(resolve=>{finishLoad=resolve;});
   if(rejectLoad)throw 'catalog unavailable';
   return {models,settings:{model:currentModel,reasoningEffort:effort}};
  }
  if(cmd==='update_model_settings'){if(rejectSave)throw 'changed in main window';if(deferSave)return new Promise(resolve=>{finishSave=resolve;});return {settings:{model:args.model,reasoningEffort:args.effort}};}
  throw Error(cmd);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');const {ModelPicker}=await vite.ssrLoadModule('/src/ModelPicker.jsx');
  root=createRoot(document.getElementById('root'));
  const render=()=>act(async()=>root.render(React.createElement(ModelPicker,{threadId,model:currentModel,effort,busy:true,onSavingChange:saving=>savingStates.push(saving),onApplied:(id,settings)=>{applied.push({id,settings});currentModel=settings.model;effort=settings.reasoningEffort;}})));
  const click=element=>act(async()=>element.click());
  const trigger=()=>document.querySelector('[aria-label="选择模型与推理强度"]');
  const option=name=>[...document.querySelectorAll('[role="option"]')].find(element=>element.textContent===name);
  const slider=()=>document.querySelector('[type="range"][aria-label="推理强度"]');
  const reset=()=>document.querySelector('[aria-label="恢复默认推理强度"]');
  const strength=index=>act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(slider(),String(index));slider().dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await render();await click(trigger());
  assert.ok(document.querySelector('[role="dialog"]'));assert.equal(option('Model A').getAttribute('aria-selected'),'true');
  assert.match(document.querySelector('.reasoning-scale').textContent,/极高/);assert.equal(slider().max,'1');assert.equal(document.querySelector('.model-apply'),null);assert.equal(calls.filter(call=>call.cmd==='update_model_settings').length,0);
  await click(option('Model B'));assert.ok(!document.querySelector('.reasoning-scale').textContent.includes('极高'));assert.equal(slider().getAttribute('aria-valuetext'),'中');
  assert.equal(applied.length,1);assert.equal(applied[0].id,'one');assert.ok(document.querySelector('[role="dialog"]'),'popup stays open to adjust reasoning after changing model');
  const sent=calls.find(call=>call.cmd==='update_model_settings').args;
  assert.deepEqual(sent,{threadId:'one',model:'model-b',effort:'medium',expectedModel:'model-a',expectedEffort:'low'});
  await strength(1);assert.equal(applied.length,2);
  assert.deepEqual(calls.filter(call=>call.cmd==='update_model_settings').at(-1).args,{threadId:'one',model:'model-b',effort:'high',expectedModel:'model-b',expectedEffort:'medium'});
  await strength(1);await click(option('Model B'));assert.equal(applied.length,2,'unchanged selections do not issue duplicate updates');
  assert.match(document.querySelector('.model-popup-footer').textContent,/已保存/);
  await click(reset());assert.equal(applied.length,3);rejectSave=true;await strength(1);
  assert.match(document.querySelector('[role="alert"]').textContent,/changed in main window/);assert.equal(applied.length,3);assert.equal(slider().value,'0','failed save restores the confirmed slider position');
  rejectSave=false;await strength(1);assert.equal(applied.length,4);assert.equal(document.querySelector('[role="alert"]'),null);
  assert.match(document.querySelector('.model-popup-footer').textContent,/下轮/);
  rejectLoad=true;await click(document.querySelector('[aria-label="刷新模型列表"]'));assert.match(document.querySelector('[role="alert"]').textContent,/catalog unavailable/);assert.equal(slider().disabled,true);
  rejectLoad=false;await click(document.querySelector('[aria-label="刷新模型列表"]'));assert.equal(document.querySelector('[role="alert"]'),null);
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(document.querySelector('[role="dialog"]'),null);
  deferLoad=true;await click(trigger());threadId='two';await render();
  await act(async()=>finishLoad({models,settings:{model:'stale',reasoningEffort:'ultra'}}));
  assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(applied.length,4);
  deferLoad=false;await click(trigger());deferSave=true;await strength(0);
  assert.match(document.querySelector('.model-popup-footer').textContent,/正在保存/);assert.equal(slider().disabled,true);
  assert.equal(savingStates.at(-1),true);
  const count=calls.filter(call=>call.cmd==='update_model_settings').length;await strength(1);assert.equal(calls.filter(call=>call.cmd==='update_model_settings').length,count);
  threadId='three';await render();await act(async()=>finishSave({settings:{model:'model-b',reasoningEffort:'medium'}}));
  assert.equal(applied.length,4,'late save completion cannot update a different chat');assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.equal(savingStates.at(-1),false);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();globals.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
