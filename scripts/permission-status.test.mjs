import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('permissions are read-only, follow owner updates and distinguish current from next-turn settings',async()=>{
 const dom=new JSDOM('<div id="root"></div>');
 const keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const calls=[];window.__TAURI_INTERNALS__={invoke:async(...args)=>{calls.push(args);}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {PermissionStatus}=await vite.ssrLoadModule('/src/PermissionStatus.jsx');
  root=createRoot(document.getElementById('root'));
  const full={approvalPolicy:'never',approvalsReviewer:'user',activePermissionProfile:{id:':danger-full-access'}};
  const guardian={approvalPolicy:'on-request',approvalsReviewer:'auto_review',activePermissionProfile:{id:':workspace'}};
  const render=(conversation,connected=true)=>act(async()=>root.render(React.createElement(PermissionStatus,{conversation,connected})));
  const status=()=>document.querySelector('.permission-status');
  await render({currentPermissions:full,latestThreadSettings:guardian});
  assert.equal(status().textContent,'帮我批准','the label follows the main app selection even while execution permissions are stale');
  assert.match(status().title,/执行权限记录：完全访问/);
  assert.match(status().title,/仅供查看/);
  assert.equal(document.querySelector('button,[aria-haspopup],[tabindex]'),null);
  await act(async()=>{status().click();status().dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
  assert.equal(document.querySelector('[role="menu"]'),null);
  assert.equal(calls.length,0,'viewing or clicking permissions must never invoke a native command');
  await render({currentPermissions:full,latestThreadSettings:{approvalPolicy:'on-request',activePermissionProfile:{id:':workspace'},approvalsReviewer:'user'}});
  assert.equal(status().textContent,'请求批准','owner setting changes immediately replace the label without a new task');
  await render({currentPermissions:guardian,latestThreadSettings:guardian});
  assert.equal(status().textContent,'帮我批准');
  assert.doesNotMatch(status().title,/执行权限记录/);
  await render({latestThreadSettings:{approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly'}}});
  assert.equal(status().textContent,'请求批准','older owners can supply thread settings without currentPermissions');
  await render({currentPermissions:full},false);
  assert.match(status().title,/未同步/);
  await render(null);
  assert.equal(status().textContent,'权限未知','switching chats clears the previous permission label');
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();dom.window.close();
  keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
