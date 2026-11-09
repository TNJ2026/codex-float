import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('picker, native drop, clipboard files and pasted images share a removable draft scoped to the chat',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const globals=['window','document','FileReader','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,FileReader:dom.window.FileReader,IS_REACT_ACT_ENVIRONMENT:true});
 const callbacks=new Map(),events=new Map(),calls=[],errors=[];
 const file={path:'C:/test.txt',name:'test.txt',size:4,image:false};
 let clipboard=[],picker=[file],finishPicker,api,scope='one';
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},convertFileSrc:path=>`asset://localhost/${encodeURIComponent(path)}`,transformCallback(fn){const id=callbacks.size+1;callbacks.set(id,fn);return id;},invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='plugin:event|listen'){events.set(args.event,callbacks.get(args.handler));return events.size;}
  if(cmd==='plugin:event|unlisten')return;
  if(cmd==='pick_attachments')return finishPicker?new Promise(resolve=>{finishPicker=resolve;}):picker;
  if(cmd==='inspect_attachments')return args.paths.map(path=>({...file,path,name:path.split('/').at(-1)}));
  if(cmd==='clipboard_attachment_paths')return clipboard;
  if(cmd==='save_attachment')return {path:'C:/paste.png',name:args.name,size:3,image:true};
  throw Error(`Unexpected command ${cmd}`);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {useAttachments,ComposerAttachments,AttachmentButton}=await vite.ssrLoadModule('/src/ComposerAttachments.jsx');
  function Harness(){api=useAttachments({scope,onError:error=>errors.push(error)});return React.createElement('div',null,React.createElement(AttachmentButton,{onClick:api.choose}),React.createElement(ComposerAttachments,{files:api.attachments,onRemove:api.remove,preparing:api.preparing,dragging:api.dragging}));}
  root=createRoot(document.getElementById('root'));
  const render=()=>act(async()=>root.render(React.createElement(Harness)));
  await render();
  await act(async()=>document.querySelector('[aria-label="添加附件"]').click());
  assert.equal(api.attachments.length,1);
  assert.match(document.querySelector('.composer-attachment').textContent,/test.txt/);
  await act(async()=>events.get('tauri://drag-drop')({payload:{paths:['C:/drop.txt'],position:{x:0,y:0}}}));
  assert.deepEqual(api.attachments.map(file=>file.path),['C:/test.txt','C:/drop.txt']);
  clipboard=['C:/copied.txt'];
  await act(async()=>{api.onKeyDown({ctrlKey:true,key:'v'});api.onPaste({clipboardData:{files:[]}});});
  assert.equal(api.attachments.length,3);
  clipboard=[];
  await act(async()=>{api.onPaste({clipboardData:{files:[new dom.window.File(['png'],'截图.png',{type:'image/png'})]},preventDefault(){}});});
  const deadline=Date.now()+5000;
  while(!api.attachments.some(file=>file.path==='C:/paste.png')&&Date.now()<deadline){
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  }
  assert.equal(api.attachments.at(-1).image,true);
  assert.equal(calls.find(call=>call.cmd==='save_attachment').args.data,'cG5n');
  assert.ok(document.querySelector('.composer-attachment img'));
  await act(async()=>document.querySelector('[aria-label="移除附件 test.txt"]').click());
  assert.equal(api.attachments.some(file=>file.path==='C:/test.txt'),false);
  const saved=api.attachments;
  await act(async()=>api.clear());assert.equal(api.attachments.length,0);
  await act(async()=>api.restore(saved));assert.equal(api.attachments.length,3);
  finishPicker=true;
  await act(async()=>{api.choose();});
  scope='two';await render();
  await act(async()=>finishPicker([file]));
  assert.equal(api.attachments.length,0,'late picker result cannot attach files to a different chat');
  assert.deepEqual(errors,[]);
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();dom.window.close();globals.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
