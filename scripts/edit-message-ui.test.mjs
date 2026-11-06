import test from 'node:test';
import assert from 'node:assert/strict';
import {act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('editing earlier messages uses the owner edit API, guards stale history and preserves the composer draft',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const keys=['window','document','localStorage','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,requestAnimationFrame:callback=>setTimeout(callback,0),IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const callbacks=new Map(),events=new Map(),calls=[];
 let finishEdit,rejectEdit=true,state={id:'00000000-0000-4000-8000-000000000001',turns:[{turnId:'t1',status:'completed',items:[{id:'u1',type:'userMessage',content:[{type:'text',text:'old message'}]},{id:'a1',type:'agentMessage',text:'old reply'}]},{turnId:'t2',status:'completed',items:[{id:'u2',type:'userMessage',content:[{type:'text',text:'new message'}]}]}],requests:[]};
 const snapshot=()=>events.get('codex-stream')?.({payload:{conversationId:state.id,change:{type:'snapshot',revision:1,conversationState:state}}});
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},convertFileSrc:path=>path,transformCallback(callback){const id=callbacks.size+1;callbacks.set(id,callback);return id;},invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='plugin:event|listen'){events.set(args.event,callbacks.get(args.handler));return events.size;}
  if(cmd==='plugin:event|unlisten'||cmd==='plugin:window|set_theme'||cmd==='copy_text')return;
  if(cmd==='list_threads')return {threads:[{id:state.id,thread_name:'Test'}],currentThread:state.id};
  if(cmd==='connect_thread'){snapshot();return {connected:true};}
  if(cmd==='background_settings')return {mode:'custom-blur'};
  if(cmd==='set_mini_mode')return args.compact;
  if(cmd==='read_usage')return {};
  if(cmd==='edit_sent_message'){if(rejectEdit)throw 'owner unavailable';return new Promise(resolve=>{finishEdit=resolve;});}
  throw Error(`Unexpected command: ${cmd}`);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},plugins:[{name:'expose-root',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/main.jsx'))return code.replace("createRoot(document.getElementById('root')).render(<App/>);","export const testRoot=createRoot(document.getElementById('root'));testRoot.render(<App/>);");}}],server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let module;
 try{
  await act(async()=>{module=await vite.ssrLoadModule('/src/main.jsx');await new Promise(resolve=>setTimeout(resolve,150));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,150));});
  const edit=()=>document.querySelector('[data-message-id="u1"] [aria-label="编辑已发送消息"]');
  const click=element=>act(async()=>element.click());
  const type=(selector,text)=>act(async()=>{const element=document.querySelector(selector);Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(element,text);element.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  const submit=()=>act(async()=>document.querySelector('.message-editor form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  await type('#prompt-input','unsent draft');await click(edit());assert.equal(document.querySelector('[aria-label="编辑消息内容"]').value,'old message');
  await type('[aria-label="编辑消息内容"]','revised');await submit();assert.match(document.querySelector('.message-editor [role="alert"]').textContent,/owner unavailable/);assert.equal(document.querySelector('[aria-label="编辑消息内容"]').value,'revised');
  rejectEdit=false;await submit();assert.equal(document.querySelector('[aria-label="发送提示词"]').disabled,true);
  const sent=calls.filter(call=>call.cmd==='edit_sent_message').at(-1);assert.deepEqual(sent.args,{threadId:state.id,turnId:'t1',text:'revised'});assert.equal(calls.filter(call=>call.cmd==='send_prompt').length,0);
  await act(async()=>finishEdit({ok:true}));assert.equal(document.querySelector('.message-editor'),null);assert.equal(document.querySelector('#prompt-input').value,'unsent draft');
  assert.equal(document.querySelector('.windows-window .titlebar'),null);
  assert.equal(document.querySelector('.windows-window .section-label .window-actions'),null);
  assert.equal(events.has('native-titlebar-action'),false);
  await act(async()=>events.get('windows-caption-action')({payload:'settings'}));
  assert.ok(document.querySelector('.settings-panel'));
  await click(document.querySelector('[aria-label="关闭设置"]'));
  await act(async()=>events.get('windows-caption-action')({payload:'mini'}));
  assert.equal(document.querySelector('.chat-panel').hidden,true);
  await click(document.querySelector('.mini-status'));
  assert.equal(document.querySelector('.chat-panel').hidden,false);
  assert.equal(document.querySelector('#prompt-input').value,'unsent draft');
  await click(edit());await type('[aria-label="编辑消息内容"]','another revision');
  const count=calls.filter(call=>call.cmd==='edit_sent_message').length;
  await act(async()=>{state={...state,turns:[...state.turns,{turnId:'t3',status:'completed',items:[{id:'u3',type:'userMessage',content:[{type:'text',text:'newly arrived'}]}]}]};snapshot();await new Promise(resolve=>setTimeout(resolve,150));});
  await submit();assert.equal(calls.filter(call=>call.cmd==='edit_sent_message').length,count);assert.match(document.querySelector('.message-editor [role="alert"]').textContent,/聊天内容已变化/);
  await click(document.querySelector('[aria-label="关闭预览"]'));
  await act(async()=>{state={...state,turns:[...state.turns,{turnId:'running',status:'inProgress',items:[]}]};snapshot();await new Promise(resolve=>setTimeout(resolve,150));});assert.equal(edit().disabled,true);
 }finally{if(module?.testRoot)await act(async()=>module.testRoot.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
