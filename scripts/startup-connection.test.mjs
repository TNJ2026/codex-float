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
 let failure=false,inherited=false,finishDiscovery,delayConnect=false,finishConnect,unloaded=false;
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const calls=[],callbacks=new Map(),events=new Map();
 let nativePageFocused=false;
 document.hasFocus=()=>nativePageFocused;
 window.__CODEX_FLOAT_PLATFORM__='macos';
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(callback){const id=callbacks.size+1;callbacks.set(id,callback);return id;},invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='plugin:event|listen'){events.set(args.event,callbacks.get(args.handler));return events.size;}
  if(cmd==='list_threads')return {threads:ids.map((id,index)=>({id,thread_name:`Chat ${index}`})),currentThread:inherited?ids[2]:null};
  if(cmd==='find_running_thread'){
   if(failure)throw 'connection reset during discovery';
   return new Promise(resolve=>{finishDiscovery=resolve;});
  }
  if(cmd==='connect_thread'){
   if(unloaded&&args.threadId===ids[0])throw 'chat-not-loaded';
   return delayConnect?new Promise(resolve=>{finishConnect=resolve;}):{connected:true};
  }
  if(cmd==='read_usage')return {};
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {SessionView}=await vite.ssrLoadModule('/src/SessionView.jsx');
  const mount=async(compact=false)=>{
   root=createRoot(document.getElementById('root'));
   await act(async()=>{root.render(React.createElement(SessionView,{compact,compactRef:{current:compact},onMiniStatusChange(){}}));await new Promise(resolve=>setTimeout(resolve,50));});
  };
  localStorage.setItem('codex-float-thread',ids[1]);
  await mount();
  assert.equal(document.activeElement,document.querySelector('#prompt-input'),'macOS startup focuses the composer before chat discovery finishes');
  assert.ok(calls.some(call=>call.cmd==='focus_composer'),'DOM autofocus also requests native WebView input focus');
  assert.equal(calls.find(call=>call.cmd==='focus_composer').args.restoreWebFocus,true,'cold DOM focus requests a native responder transition when the page itself is unfocused');
  const focusCalls=calls.filter(call=>call.cmd==='focus_composer').length;
  nativePageFocused=true;
  await act(async()=>document.querySelector('#prompt-input').dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true})));
  assert.equal(calls.filter(call=>call.cmd==='focus_composer').length,focusCalls+1,'a first click retries the native handoff even if DOM focus is already set');
  assert.equal(calls.filter(call=>call.cmd==='focus_composer').at(-1).args.restoreWebFocus,false,'an already focused page must not reset native input or interrupt composition');
  const attachmentButton=document.querySelector('[aria-label="添加附件"]');
  attachmentButton.focus();
  assert.deepEqual(calls.find(call=>call.cmd==='find_running_thread').args.threadIds,[ids[1],ids[0],ids[2]]);
  assert.equal(calls.some(call=>call.cmd==='connect_thread'),false,'do not connect arbitrary history before discovery completes');
  await act(async()=>finishDiscovery(ids[2]));
  assert.equal(document.activeElement,attachmentButton,'background connection updates must not steal focus back to the composer');
  assert.equal(calls.find(call=>call.cmd==='connect_thread').args.threadId,ids[2]);
  assert.deepEqual(calls.find(call=>call.cmd==='connect_thread').args,{threadId:ids[2]},'connections only discover an existing owner');
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
  delayConnect=false;unloaded=true;
  await act(async()=>document.querySelector('[role="combobox"]').click());
  await act(async()=>document.querySelector('[data-option-index="0"]').click());
  assert.equal(document.querySelector('.thread-selection').textContent,'Chat 0');
  assert.deepEqual(calls.filter(call=>call.cmd==='connect_thread').map(call=>call.args.threadId),[ids[2],ids[0]]);
  assert.equal(localStorage.getItem('codex-float-thread'),ids[2],'failed connections do not replace the last connected chat');
  assert.equal(document.querySelector('[role="alert"]'),null,'unloaded chats are an empty state, not an error notice');
  assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.equal(document.querySelector('.empty h2').textContent,'请先在 Codex App 打开此对话');
  assert.match(document.querySelector('.empty p').textContent,/在 Codex App 中打开这个对话一次/);
  assert.equal(document.querySelector('.empty').textContent.includes('让对话留在手边'),false);
  assert.equal(document.querySelector('.empty-sync-button').textContent,'同步聊天');
  assert.equal(document.querySelector('.empty-sync-button').disabled,false);
  assert.equal(document.querySelector('[aria-label="发送提示词"]').disabled,true);
  await act(async()=>document.querySelector('.empty-sync-button').click());
  assert.equal(document.querySelector('.empty h2').textContent,'请先在 Codex App 打开此对话','retry before opening the chat keeps the centered instruction visible');
  assert.equal(document.querySelector('[role="alert"]'),null);
  assert.ok(calls.filter(call=>call.cmd==='connect_thread').every(call=>!('openIfNeeded' in call.args)));
  assert.equal(calls.some(call=>call.cmd==='open_url'),false,'selection and sync must never open the main app');
  unloaded=false;
  await act(async()=>document.querySelector('.empty-sync-button').click());
  assert.equal(document.querySelector('[role="alert"]'),null,'sync works after the user opens the chat in Codex');
  assert.equal(localStorage.getItem('codex-float-thread'),ids[0]);
  assert.equal(document.querySelector('.empty h2').textContent,'让对话留在手边','successful connection clears the unloaded-chat instruction');
  await act(async()=>root.unmount());
  window.__CODEX_FLOAT_PLATFORM__='windows';
  const macFocusCalls=calls.filter(call=>call.cmd==='focus_composer').length;
  await mount();
  assert.notEqual(document.activeElement,document.querySelector('#prompt-input'),'Windows retains its existing startup focus');
  await act(async()=>document.querySelector('#prompt-input').focus());
  assert.equal(calls.filter(call=>call.cmd==='focus_composer').length,macFocusCalls,'Windows never invokes the macOS native focus command');
  await act(async()=>root.unmount());
  window.__CODEX_FLOAT_PLATFORM__='macos';
  await mount(true);
  assert.notEqual(document.activeElement,document.querySelector('#prompt-input'),'a hidden compact composer must not receive startup focus');
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
