import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('permission menu selects, saves, retains failures and discards stale chat results',async()=>{
 const dom=new JSDOM('<div id="root"></div><button id="outside">outside</button>',{url:'http://localhost'});
 const keys=['window','document','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,requestAnimationFrame:callback=>setTimeout(callback,0),IS_REACT_ACT_ENVIRONMENT:true});
 let threadId='one',conversation={cwd:'D:\\project',latestThreadSettings:{approvalPolicy:'on-request',sandboxPolicy:{type:'workspaceWrite',networkAccess:false}}},reject=false,defer=false,finish;
 const calls=[],applied=[],states=[];
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{calls.push({cmd,args});if(reject)throw 'permission denied';if(defer)return new Promise(resolve=>{finish=resolve;});return {threadSettings:{approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}}};}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client'),{PermissionPicker}=await vite.ssrLoadModule('/src/PermissionPicker.jsx');
  root=createRoot(document.getElementById('root'));
  const render=()=>act(async()=>root.render(React.createElement(PermissionPicker,{threadId,conversation,onSavingChange:value=>states.push(value),onApplied:(id,settings)=>{applied.push({id,settings});conversation={...conversation,latestThreadSettings:settings};}})));
  const click=element=>act(async()=>element.click());
  const trigger=()=>document.querySelector('[aria-label="修改权限"]'),menu=()=>document.querySelector('[role="menu"]'),option=id=>document.querySelector(`[role="menuitemradio"][data-permission="${id}"]`);
  const key=value=>act(async()=>menu().dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true})));
  await render();assert.match(trigger().textContent,/默认权限/);await click(trigger());
  assert.deepEqual([...menu().querySelectorAll('strong')].map(row=>row.textContent),['只读','默认权限','完全访问']);
  assert.equal(option('auto').getAttribute('aria-checked'),'true');
  await key('End');assert.equal(document.activeElement,option('full-access'));
  await click(option('full-access'));await render();assert.equal(menu(),null);assert.match(trigger().textContent,/完全访问/);
  assert.equal(trigger().dataset.permission,'full-access');assert.deepEqual(calls[0],{cmd:'update_permission_settings',args:{threadId:'one',preset:'full-access',cwd:'D:\\project'}});
  assert.deepEqual(states,[true,false]);assert.equal(applied.length,1);
  await click(trigger());await click(option('full-access'));assert.equal(calls.length,1);assert.equal(menu(),null);
  await click(trigger());reject=true;await click(option('read-only'));assert.match(menu().querySelector('[role="alert"]').textContent,/permission denied/);assert.equal(option('full-access').getAttribute('aria-checked'),'true');
  await key('Escape');assert.equal(menu(),null);assert.equal(document.activeElement,trigger());
  await click(trigger());await act(async()=>document.getElementById('outside').dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true})));assert.equal(menu(),null);
  reject=false;defer=true;await click(trigger());await click(option('read-only'));assert.equal(states.at(-1),true);assert.equal(option('auto').disabled,true);
  await click(option('auto'));assert.equal(calls.length,3);
  threadId='two';await render();assert.equal(menu(),null);
  await act(async()=>finish({threadSettings:{approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly'}}}));assert.equal(applied.length,1);assert.equal(states.at(-1),false);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
