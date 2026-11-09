import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('standalone startup discovers a live chat before connecting and preserves discovery failures',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const keys=['window','document','localStorage','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,requestAnimationFrame:fn=>setTimeout(fn,0),IS_REACT_ACT_ENVIRONMENT:true});
 const ids=[1,2,3].map(n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
 let failure=false,inherited=false,finishDiscovery,delayConnect=false,finishConnect;
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const calls=[],callbacks=new Map(),events=new Map();
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(callback){const id=callbacks.size+1;callbacks.set(id,callback);return id;},invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='plugin:event|listen'){events.set(args.event,callbacks.get(args.handler));return events.size;}
  if(cmd==='list_threads')return {threads:ids.map((id,index)=>({id,thread_name:`Chat ${index}`})),currentThread:inherited?ids[2]:null};
  if(cmd==='find_running_thread'){
   if(failure)throw 'connection reset during discovery';
   return new Promise(resolve=>{finishDiscovery=resolve;});
  }
  if(cmd==='connect_thread')return delayConnect?new Promise(resolve=>{finishConnect=resolve;}):{connected:true};
  if(cmd==='read_usage')return {};
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {SessionView}=await vite.ssrLoadModule('/src/SessionView.jsx');
  const mount=async()=>{
   root=createRoot(document.getElementById('root'));
   await act(async()=>{root.render(React.createElement(SessionView,{compact:false,compactRef:{current:false},onMiniStatusChange(){}}));await new Promise(resolve=>setTimeout(resolve,50));});
  };
  localStorage.setItem('codex-float-thread',ids[1]);
  await mount();
  assert.deepEqual(calls.find(call=>call.cmd==='find_running_thread').args.threadIds,[ids[1],ids[0],ids[2]]);
  assert.equal(calls.some(call=>call.cmd==='connect_thread'),false,'do not connect arbitrary history before discovery completes');
  await act(async()=>finishDiscovery(ids[2]));
  assert.equal(calls.find(call=>call.cmd==='connect_thread').args.threadId,ids[2]);
  assert.equal(localStorage.getItem('codex-float-thread'),ids[2]);
  assert.equal(document.querySelector('[role="alert"]'),null);
  await act(async()=>root.unmount());calls.length=0;failure=true;
  await mount();
  assert.equal(calls.some(call=>call.cmd==='connect_thread'),false);
  assert.match(document.querySelector('[role="alert"]').textContent,/connection reset during discovery/);
  await act(async()=>root.unmount());calls.length=0;inherited=true;
  await mount();
  assert.equal(calls.some(call=>call.cmd==='find_running_thread'),false,'an inherited current chat remains preferred');
  assert.equal(calls.find(call=>call.cmd==='connect_thread').args.threadId,ids[2]);
  await act(async()=>root.unmount());calls.length=0;delayConnect=true;
  await mount();
  assert.equal(document.querySelector('[role="combobox"]').disabled,true);
  await act(async()=>events.get('codex-stream')({payload:{conversationId:ids[2],change:{type:'snapshot',revision:1,conversationState:{turns:[]}}}}));
  assert.equal(document.querySelector('[role="combobox"]').disabled,true,'snapshot must not unlock selection before the connection request settles');
  await act(async()=>events.get('codex-disconnected')({payload:'owner disconnected'}));
  assert.equal(document.querySelector('[role="combobox"]').disabled,true,'connection lock is independent of stream status');
  await act(async()=>finishConnect({connected:true}));
  assert.equal(document.querySelector('[role="combobox"]').disabled,false);
  delayConnect=false;
  await act(async()=>document.querySelector('[role="combobox"]').click());
  await act(async()=>document.querySelector('[data-option-index="0"]').click());
  assert.equal(document.querySelector('.thread-selection').textContent,'Chat 0');
  assert.deepEqual(calls.filter(call=>call.cmd==='connect_thread').map(call=>call.args.threadId),[ids[2],ids[0]]);
  assert.equal(localStorage.getItem('codex-float-thread'),ids[0]);
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
