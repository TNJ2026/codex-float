import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('ChatGPT session reads histories, discards stale replies and sends only after explicit input',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','IS_REACT_ACT_ENVIRONMENT','requestAnimationFrame','setTimeout','clearTimeout'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:fn=>fn()});
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const calls=[],first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
 let held,failSend=false,failRead=false;
 const scheduled=new Map();let timerId=100000;
 const originalTimeout=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 globalThis.setTimeout=(fn,delay,...args)=>{if(delay===10000){const id=timerId++;scheduled.set(id,fn);return id;}return originalTimeout(fn,delay,...args);};
 globalThis.clearTimeout=id=>{if(!scheduled.delete(id))originalClear(id);};
 const history=(id,text)=>({thread:{id,kind:'chatgpt',status:{type:'idle'}},page:{nextCursor:null},turns:[{id:'turn-'+id,status:'completed',items:[{id:'answer-'+id,type:'agentMessage',text}]}]});
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='list_chatgpt_threads')return {threads:[{id:first,kind:'chatgpt',title:'First'},{id:second,kind:'chatgpt',title:'Second'}]};
  if(cmd==='read_chatgpt_thread'){
   if(failRead)throw Error('read failed');
   if(args.threadId===first)return new Promise(resolve=>{held=resolve;});
   return history(second,'Second reply');
  }
  if(cmd==='send_chatgpt_message'){if(failSend)throw Error('not confirmed');return {accepted:true};}
  throw Error(cmd);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {ChatGPTSession}=await vite.ssrLoadModule('/src/ChatGPTSession.jsx');
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(ChatGPTSession,{active:true,compact:false,onMiniStatusChange:()=>{}})));
  assert.ok(held);assert.equal(calls.filter(call=>call.cmd==='send_chatgpt_message').length,0);
  await act(async()=>document.querySelector('[role="combobox"]').click());
  await act(async()=>[...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='Second').click());
  assert.match(document.querySelector('.messages').textContent,/Second reply/);
  await act(async()=>held(history(first,'Stale first reply')));
  assert.doesNotMatch(document.querySelector('.messages').textContent,/Stale first reply/);
  const textarea=document.querySelector('textarea');
  const type=async text=>act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(textarea,text);textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await type('A user supplied prompt');
  assert.equal(calls.filter(call=>call.cmd==='send_chatgpt_message').length,0);
  await act(async()=>document.querySelector('.send').click());
  assert.deepEqual(calls.find(call=>call.cmd==='send_chatgpt_message').args,{threadId:second,text:'A user supplied prompt'});
  assert.equal(textarea.value,'');
  failSend=true;await type('Keep this draft');
  await act(async()=>document.querySelector('.send').click());
  assert.equal(textarea.value,'Keep this draft');
  assert.match(document.querySelector('[role="alert"]').textContent,/not confirmed/);
  assert.equal(scheduled.size,0,'manual mode never schedules a background read');
  await act(async()=>document.querySelector('.chatgpt-sync-toggle').click());
  assert.equal(scheduled.size,1,'auto-sync schedules one read after a successful response');
  failRead=true;
  const [timer,callback]=scheduled.entries().next().value;scheduled.delete(timer);
  await act(async()=>callback());
  assert.equal(scheduled.size,0,'failed reads stop polling instead of repeatedly calling the main app');
  assert.match(document.querySelector('[role="alert"]').textContent,/read failed/);
 }finally{
  if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();
  keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
