import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('interaction confirmation sees disconnects during the RPC and during confirmation', async () => {
 for(const delayedReply of [false, true]){
  const dom=new JSDOM('<!doctype html><div id="root"></div>', {url:'http://localhost'});
  const keys=['window','document','localStorage','IS_REACT_ACT_ENVIRONMENT'];
  const previous=keys.map(key=>globalThis[key]);
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
  const callbacks=new Map(),events=new Map();
  const threadId='00000000-0000-4000-8000-000000000001';
  const state={id:threadId,turns:[],requests:[{id:'approval',method:'item/commandExecution/requestApproval',params:{command:'echo test',availableDecisions:['accept','decline']}}]};
  let replies=0,finishReply;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(callback){const id=callbacks.size+1;callbacks.set(id,callback);return id;},invoke:async(cmd,args)=>{
   if(cmd==='plugin:event|listen'){events.set(args.event,callbacks.get(args.handler));return events.size;}
   if(cmd==='list_threads')return {threads:[{id:threadId,thread_name:'Test'}],currentThread:threadId};
   if(cmd==='connect_thread'){events.get('codex-stream')({payload:{conversationId:threadId,change:{type:'snapshot',revision:1,conversationState:state}}});return {connected:true};}
   if(cmd==='reply_interaction'){replies++;return delayedReply?new Promise(resolve=>{finishReply=resolve;}):{};}
   if(cmd==='read_usage')return {};
  }};
  const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
  let root;
  try{
   const {SessionView}=await vite.ssrLoadModule('/src/SessionView.jsx');
   const {createRoot}=await import('react-dom/client');
   root=createRoot(document.getElementById('root'));
   await act(async()=>{root.render(React.createElement(SessionView,{compact:false,compactRef:{current:false},onMiniStatusChange(){}}));});
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,150));});
   const button=[...document.querySelectorAll('.interaction-card button')].find(button=>button.textContent==='允许一次');
   assert.ok(button);
   await act(async()=>button.click());
   assert.equal(replies,1);
   await act(async()=>{
    events.get('codex-disconnected')({payload:{conversationId:threadId,message:'connection lost'}});
    finishReply?.({});
    await new Promise(resolve=>setTimeout(resolve,150));
   });
   assert.match(document.querySelector('.interaction-error')?.textContent||'',/连接已变化，请检查主窗口是否收到回答/);
   assert.equal(replies,1,'confirmation errors never resubmit the answer');
  }finally{
   if(root)await act(async()=>root.unmount());
   await vite.close();dom.window.close();
   keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
  }
 }
});
