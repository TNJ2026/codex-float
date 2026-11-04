import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('context menu imports each source, removes chips, inserts snippets and ignores stale chat results',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const globals=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let api,scope='one',failIde=false,finishPick,rows=[],selected,mention=null;
 const errors=[],calls=[],selectRef={current:null};
 const file={kind:'file',label:'main.js',path:'C:/project/main.js'},folder={kind:'folder',label:'src',path:'C:/project/src'},skill={kind:'skill',label:'test-skill',path:'C:/skills/SKILL.md'},plugin={kind:'plugin',label:'Documents',path:'plugin://documents@test'},page={kind:'browser',label:'Example',url:'https://example.com',content:'selected'},ide={kind:'ide',label:'editor.js',path:'C:/project/editor.js'};
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='search_context_files')return [file,folder];
  if(cmd==='search_context_threads')return [{kind:'thread',label:'另一个项目计划',path:'codex://threads/00000000-0000-4000-8000-000000000001',source:'项目甲'}];
  if(cmd==='context_catalog')return {skills:[skill],plugins:[plugin],warnings:[]};
  if(cmd==='read_browser_contexts')return [page];
  if(cmd==='read_ide_context'){if(failIde)throw 'IDE unavailable';return [ide];}
  if(cmd==='pick_context_paths')return finishPick?new Promise(resolve=>{finishPick=resolve;}):[args.directory?folder:file];
  throw Error(cmd);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {ContextPicker,ContextChips,useContextDraft}=await vite.ssrLoadModule('/src/ContextPicker.jsx');
  function Harness(){api=useContextDraft(scope);return React.createElement(React.Fragment,null,React.createElement(ContextChips,{items:api.items,onRemove:api.remove}),React.createElement(ContextPicker,{scope,cwd:'C:/project',open:true,mention,onClose(){},onAdd:items=>{selected=items;api.add(items);},onError:e=>errors.push(e),onRows:items=>{rows=items;},onSelectRef:selectRef}));}
  root=createRoot(document.getElementById('root'));
  const settle=()=>new Promise(resolve=>setTimeout(resolve,210));
  const render=()=>act(async()=>{root.render(React.createElement(Harness));await settle();});
  await render();await act(settle);
  const click=element=>act(async()=>{element.click();await settle();});
  const category=name=>[...document.querySelectorAll('.context-categories button')].find(button=>button.textContent===name);
  const candidate=()=>document.querySelector('[role="option"]');
  await click(candidate());assert.equal(api.items[0].kind,'file');
  await click(category('目录'));await click(candidate());assert.equal(api.items.at(-1).kind,'folder');
  await click(category('技能'));await click(candidate());assert.equal(api.items.at(-1).kind,'skill');
  await click(category('插件'));await click(candidate());assert.equal(api.items.at(-1).kind,'plugin');
  await click(category('网页'));await click(candidate());assert.equal(api.items.at(-1).content,'selected');
  await click(category('IDE'));await click(candidate());assert.equal(api.items.at(-1).kind,'ide');
  await click(category('对话'));await click(candidate());assert.equal(api.items.at(-1).kind,'thread');assert.equal(api.items.at(-1).source,'项目甲');
  assert.ok(calls.some(call=>call.cmd==='search_context_threads'&&call.args.excludeThreadId==='one'));
  await click(category('IDE'));
  failIde=true;await click(document.querySelector('[aria-label="刷新上下文"]'));assert.match(document.querySelector('[role="alert"]').textContent,/IDE unavailable/);
  await click(document.querySelector('[aria-label="移除上下文 main.js"]'));assert.equal(api.items.some(item=>item.kind==='file'),false);
  await click(category('片段'));
  const textarea=document.querySelector('[aria-label="代码片段内容"]');
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'const selected = true;');textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await act(async()=>textarea.closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(api.items.at(-1).kind,'snippet');assert.equal(api.items.at(-1).content,'const selected = true;');
  mention={trigger:'$',query:'test',start:0,end:5};await render();await act(settle);
  assert.equal(rows.length,1);await act(async()=>selectRef.current(0));assert.equal(selected[0].kind,'skill');
  assert.equal(document.querySelector('.context-actions'),null);
  mention=null;await render();
  finishPick=true;
  await act(async()=>document.querySelector('.context-actions button').click());
  scope='two';mention=null;await render();
  await act(async()=>finishPick([file]));assert.equal(api.items.length,0);
  assert.deepEqual(errors,[]);assert.ok(calls.some(call=>call.cmd==='read_browser_contexts'));
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();globals.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
