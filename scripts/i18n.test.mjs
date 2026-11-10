import test from 'node:test';
import assert from 'node:assert/strict';
import {act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('language switches update the interface without replacing drafts or conversation content',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const keys=['window','document','localStorage','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT'];
 const previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,requestAnimationFrame:callback=>setTimeout(callback,0),IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const events=new Map(),callbacks=new Map(),calls=[];
 const message='设置 完全访问 当前聊天 — 用户原文';
 const state={id:'00000000-0000-4000-8000-000000000001',latestModel:'test-model',latestThreadSettings:{sandboxPolicy:{type:'workspaceWrite'},approvalPolicy:'on-request'},requests:[],turns:[{turnId:'one',status:'completed',items:[{id:'user',type:'userMessage',content:[{type:'text',text:message}]},{id:'reply',type:'agentMessage',text:'回答 保留中文'}]}]};
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},convertFileSrc:path=>path,transformCallback(callback){const id=callbacks.size+1;callbacks.set(id,callback);return id;},invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='plugin:event|listen'){events.set(args.event,callbacks.get(args.handler));return events.size;}
  if(cmd==='plugin:event|unlisten'||cmd==='plugin:window|set_theme'||cmd==='set_ui_language')return;
  if(cmd==='background_settings')return {mode:'custom-blur',adjustableBlur:true};
  if(cmd==='set_background_blur')return args.amount;
  if(cmd==='list_threads')return {threads:[{id:state.id,thread_name:'用户聊天名称'}],currentThread:state.id};
  if(cmd==='connect_thread'){events.get('codex-stream')?.({payload:{conversationId:state.id,change:{type:'snapshot',revision:1,conversationState:state}}});return {connected:true};}
  if(cmd==='read_usage')return {};
  if(cmd==='read_model_options')return {settings:{model:'test-model'},models:[{model:'test-model',additionalSpeedTiers:['fast']}]};
  if(cmd==='update_speed_settings')return {threadSettings:{serviceTier:args.fast?'fast':'default'}};
  if(cmd==='list_chatgpt_threads')return {threads:[]};
  throw Error(`Unexpected command: ${cmd}`);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},plugins:[{name:'expose-root',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/main.jsx'))return code.replace(/createRoot\(document\.getElementById\('root'\)\)\.render\(<App\s*\/>\);/u,"export const testRoot=createRoot(document.getElementById('root'));testRoot.render(<App/>);");}}],server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let app,i18n;
 try{
  await act(async()=>{app=await vite.ssrLoadModule('/src/main.jsx');await new Promise(resolve=>setTimeout(resolve,150));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,150));});
  i18n=await vite.ssrLoadModule('/src/i18n.js');
  const input=document.querySelector('#prompt-input');
  await act(async()=>{
   Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,'保留这份草稿');
   input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
   events.get('windows-caption-action')({payload:'settings'});
  });
  const changeLanguage=async value=>act(async()=>{
   const select=document.querySelector('#interface-language');
   Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(select,value);
   select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  });
  await changeLanguage('en');
  assert.equal(document.documentElement.lang,'en');
  assert.ok(document.querySelector('[aria-label="Appearance"]'));
  assert.ok(document.querySelector('[aria-label="Prompt"]'));
  assert.equal(document.querySelector('.section-label label').textContent,'Current chat');
  assert.equal(document.querySelector('.permission-status > span').textContent,'Ask for approval');
  assert.equal(document.querySelector('#prompt-input'),input,'language changes keep the composer mounted');
  assert.equal(input.value,'保留这份草稿');
  assert.equal(document.querySelector('[data-message-id="user"] .markdown').textContent.trimEnd(),message);
  assert.ok(document.body.textContent.includes('用户聊天名称'));
  assert.equal(localStorage.getItem('codex-float-language'),'en');
  assert.equal(i18n.readLanguage(localStorage),'en');
  assert.equal(calls.filter(call=>call.cmd==='set_ui_language').at(-1).args.language,'en');
  assert.equal(i18n.t('移除附件 {0}',['{1} 中文.txt']),'Remove attachment {1} 中文.txt');
  assert.ok(document.querySelector('[aria-label="Current permissions"]'));
  assert.equal(document.querySelector('.permission-status button'),null);
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  await act(async()=>document.querySelector('[aria-label="Change response speed"]').click());
  assert.equal(document.querySelector('.speed-popup'),null);
  assert.equal(document.querySelector('[aria-label="Change response speed"]').getAttribute('aria-pressed'),'true');
  assert.match(document.querySelector('[aria-label="Change response speed"]').title,/Fast mode/);
  await act(async()=>{
   document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
   events.get('windows-caption-action')({payload:'settings'});
  });
  await act(async()=>events.get('codex-disconnected')({payload:'连接 Codex 超时'}));
  assert.equal(document.querySelector('[role="alert"]').textContent,'Timed out connecting to Codex');
  await changeLanguage('zh-CN');
  assert.equal(document.querySelector('[role="alert"]').textContent,'连接 Codex 超时');
  assert.ok(document.querySelector('[aria-label="显示设置"]'));
  assert.equal(input.value,'保留这份草稿');
  assert.equal(i18n.readLanguage({getItem(){throw Error('storage unavailable');}}),'zh-CN');
  assert.equal(document.querySelector('.conversation-source'),null);
  assert.equal(document.querySelector('[aria-label="ChatGPT 消息"]'),null);
  assert.equal(calls.some(call=>/^(?:list_chatgpt_threads|read_chatgpt_thread|send_chatgpt_message)$/.test(call.cmd)),false,'ChatGPT integration stays disabled');
  assert.equal(document.querySelector('#prompt-input'),input);
  assert.equal(input.value,'保留这份草稿');
 }finally{
  if(app)await act(async()=>app.testRoot.unmount());
  if(i18n)i18n.setLanguage('zh-CN');
  await vite.close();dom.window.close();
  keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
