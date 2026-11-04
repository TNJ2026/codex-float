import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {messagesOf} from '../src/model.js';

test('only original user messages with a known turn can be edited',()=>{
 const messages=messagesOf({turns:[{turnId:'turn',items:[{id:'u',type:'userMessage',content:[{type:'text',text:'hello'}]},{id:'steer',type:'steeringUserMessage',input:[{type:'text',text:'extra'}]},{id:'a',type:'agentMessage',text:'reply'}]}]});
 assert.equal(messages[0].editable,true);assert.equal(messages[0].turnId,'turn');assert.equal(messages[1].editable,false);assert.equal(messages[2].editable,false);
 assert.equal(messagesOf({turns:[{items:[{id:'u',type:'userMessage',content:[{type:'text',text:'unknown turn'}]}]}]})[0].editable,false);
});

test('message and code copy preserve source text, while editing requires explicit resubmission and retains failures',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const copies=[],saves=[];let failCopy=false,failSave=false,editing;
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{assert.equal(cmd,'copy_text');if(failCopy)throw 'clipboard busy';copies.push(args.text);}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client'),{MessageActions,MessageEditor}=await vite.ssrLoadModule('/src/MessageActions.jsx'),{Markdown}=await vite.ssrLoadModule('/src/Markdown.jsx');root=createRoot(document.getElementById('root'));
  const text='**原文**\n\n```js\nconst x = "<tag>";\nconsole.log(x);\n```';
  const render=(disabled=false)=>act(async()=>root.render(React.createElement(React.Fragment,null,React.createElement(Markdown,{text}),React.createElement(MessageActions,{text,editable:true,editDisabled:disabled,onEdit:()=>{editing=true;}}))));
  const click=element=>act(async()=>element.click());
  await render();await click(document.querySelector('[aria-label="复制消息"]'));assert.equal(copies[0],text);assert.ok(document.querySelector('[aria-label="消息已复制"]'));
  await click(document.querySelector('[aria-label="复制代码"]'));assert.equal(copies[1],'const x = "<tag>";\nconsole.log(x);');assert.ok(document.querySelector('[aria-label="代码已复制"]'));
  await click(document.querySelector('[aria-label="编辑已发送消息"]'));assert.equal(editing,true);
  editing=false;await render(true);await click(document.querySelector('[aria-label="编辑已发送消息"]'));assert.equal(editing,false);
  failCopy=true;await click(document.querySelector('[aria-label="消息已复制"]'));assert.match(document.querySelector('[role="alert"]').textContent,/clipboard busy/);
  const message={id:'message',turnId:'turn',text:'original'};
  await act(async()=>root.render(React.createElement(MessageEditor,{message,onClose:()=>{},onSave:async(snapshot,next)=>{saves.push({snapshot,next});if(failSave)throw 'owner unavailable';}})));
  assert.match(document.querySelector('form > p').textContent,/后续消息和回复会被替换/);assert.equal(document.querySelector('[type="submit"]').disabled,true);
  const textarea=document.querySelector('[aria-label="编辑消息内容"]');
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'revised');textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  assert.equal(saves.length,0);failSave=true;
  await act(async()=>textarea.form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(saves[0].snapshot,message);assert.equal(saves[0].next,'revised');assert.equal(textarea.value,'revised');assert.match(document.querySelector('[role="alert"]').textContent,/owner unavailable/);
  failSave=false;await act(async()=>textarea.form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(saves.length,2);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
