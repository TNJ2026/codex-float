import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {messagesOf} from '../src/model.js';
import {forkSettingsOf} from '../src/forks.js';

test('fork entries only identify the leading user and final response of completed rounds',()=>{
 const items=[{id:'u',type:'userMessage',content:[{type:'text',text:'start'}]},{id:'c',type:'agentMessage',text:'working',phase:'commentary'},{id:'s',type:'steeringUserMessage',input:[{type:'text',text:'more'}]},{id:'a',type:'agentMessage',text:'answer',phase:'final_answer'}];
 for(const status of ['inProgress','failed','interrupted'])assert.equal(messagesOf({turns:[{id:'t',status,items}]}).filter(m=>m.forkable).length,0);
 assert.deepEqual(messagesOf({turns:[{id:'t',status:'completed',items}]}).filter(m=>m.forkable).map(m=>m.id),['u','a']);
 const settings=forkSettingsOf({currentPermissions:{approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly'}},latestThreadSettings:{permissions:':read-only',serviceTier:'priority'},latestModel:'test',latestReasoningEffort:'high',latestCollaborationMode:{mode:'plan'},cwd:'D:/repo'});assert.equal(settings.permissions,':read-only');assert.equal(settings.approvalPolicy,'on-request');assert.equal(settings.collaborationMode.mode,'plan');
});

test('fork creation is retained after open failure and retry never creates a duplicate',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>'),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>globalThis[k]);Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let root,creates=0,opens=0,closed=0;
 try{
  const {createRoot}=await import('react-dom/client'),{ForkMessageDialog}=await vite.ssrLoadModule('/src/ForkMessageDialog.jsx');root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(ForkMessageDialog,{message:{name:'Test · 分叉',text:'original',requestId:'request'},onCreate:async()=>{creates++;return {threadId:'child',warnings:[]};},onOpen:async()=>{if(++opens===1)throw Error('owner unavailable');},onClose:()=>closed++})));
  const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  await submit();assert.equal(creates,1);assert.match(document.querySelector('[role="alert"]').textContent,/owner unavailable/);assert.match(document.querySelector('[role="status"]').textContent,/child/);assert.equal(document.querySelector('[type="submit"]').textContent,'连接已创建的分叉');
  await submit();assert.equal(creates,1);assert.equal(opens,2);assert.equal(closed,1);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((k,i)=>{if(previous[i]===undefined)delete globalThis[k];else globalThis[k]=previous[i];});}
});

test('message fork opens the actual child, restores settings and keeps the unsent draft and attachments',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true}),keys=['window','document','localStorage','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>globalThis[k]);Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,requestAnimationFrame:callback=>setTimeout(callback,0),IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const source='00000000-0000-4000-8000-000000000001',child='00000000-0000-4000-8000-000000000002',calls=[],callbacks=new Map(),events=new Map();let bound=source,childAttempts=0;
 const original={id:source,cwd:'D:/repo',latestModel:'test',latestCollaborationMode:{mode:'plan'},currentPermissions:{approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly'}},turns:[{id:'t1',status:'completed',items:[{id:'u',type:'userMessage',content:[{type:'text',text:'original'}]},{id:'a',type:'agentMessage',text:'original answer'}]}],requests:[]};
 const snapshot=()=>events.get('codex-stream')?.({payload:{conversationId:bound,change:{type:'snapshot',revision:1,conversationState:{...original,id:bound}}}});
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},convertFileSrc:path=>path,transformCallback(callback){const id=callbacks.size+1;callbacks.set(id,callback);return id;},invoke:async(cmd,args)=>{
  calls.push({cmd,args});if(cmd==='plugin:event|listen'){events.set(args.event,callbacks.get(args.handler));return events.size;}if(['plugin:event|unlisten','plugin:window|set_theme','open_url'].includes(cmd))return;
  if(cmd==='list_threads')return {threads:[{id:source,thread_name:'Source'}],currentThread:source};
  if(cmd==='connect_thread'){bound=args.threadId;if(bound===child&&++childAttempts===1)throw Error('owner starting');snapshot();return {connected:true};}
  if(cmd==='background_settings')return {mode:'custom-blur'};if(cmd==='read_usage')return {};
  if(cmd==='pick_attachments')return [{path:'D:/notes.txt',name:'notes.txt',size:5,image:false}];
  if(cmd==='fork_message')return {threadId:child,name:args.name,warnings:[]};
  if(cmd==='restore_fork_settings')return {threadSettings:{model:'test',permissions:':read-only',collaborationMode:{mode:'plan'}}};
  throw Error('Unexpected command: '+cmd);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},plugins:[{name:'root',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/main.jsx'))return code.replace(/createRoot\(document\.getElementById\('root'\)\)\.render\(<App\s*\/>\);/u,"export const testRoot=createRoot(document.getElementById('root'));testRoot.render(<App/>);");}}],server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let module;
 try{
  await act(async()=>{module=await vite.ssrLoadModule('/src/main.jsx');await new Promise(r=>setTimeout(r,180));});await act(async()=>new Promise(r=>setTimeout(r,180)));
  await act(async()=>{const input=document.querySelector('#prompt-input');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,'unsent draft');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector('[aria-label="添加附件"]').click());
  await act(async()=>document.querySelector('[data-message-id="a"] [aria-label="从此轮分叉"]').click());
  assert.match(document.querySelector('.fork-message-dialog').textContent,/所在轮次/);
  await act(async()=>{document.querySelector('.fork-message-dialog form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,1000));});await act(async()=>new Promise(r=>setTimeout(r,160)));
  assert.equal(calls.filter(c=>c.cmd==='fork_message').length,1);assert.equal(calls.find(c=>c.cmd==='fork_message').args.turnId,'t1');assert.ok(calls.some(c=>c.cmd==='open_url'&&c.args.url==='codex://threads/'+child));assert.ok(calls.some(c=>c.cmd==='restore_fork_settings'&&c.args.threadId===child));
  assert.equal(document.querySelector('.fork-message-dialog'),null);assert.equal(document.querySelector('#prompt-input').value,'unsent draft');assert.match(document.querySelector('.composer-attachment').textContent,/notes.txt/);assert.equal(calls.filter(c=>c.cmd==='send_prompt').length,0);assert.equal(original.id,source);
 }finally{if(module?.testRoot)await act(async()=>module.testRoot.unmount());await vite.close();dom.window.close();keys.forEach((k,i)=>{if(previous[i]===undefined)delete globalThis[k];else globalThis[k]=previous[i];});}
});
