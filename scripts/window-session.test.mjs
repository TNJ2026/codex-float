import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('reloaded interfaces recover native mini mode and ignore stale startup reads',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','localStorage','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT'];
 const previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,requestAnimationFrame:fn=>fn(),IS_REACT_ACT_ENVIRONMENT:true});
 let read,session,rejectMode=false;
 const calls=[];
 window.__TAURI_INTERNALS__={invoke:(command,args)=>{
  calls.push(command);
  if(command==='get_mini_mode')return new Promise(resolve=>{read=resolve;});
  if(command==='set_mini_mode'){
   assert.equal(document.querySelector('button').textContent,args.compact?'ball':'chat','the target UI is committed before native resizing');
   assert.equal(session.restorePhase,args.compact?'':'preparing','restoring content stays hidden until native placement finishes');
   return rejectMode?Promise.reject(Error('resize failed')):Promise.resolve(args.compact);
  }
  throw Error(command);
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {useWindowSession}=await vite.ssrLoadModule('/src/platform/useWindowSession.js');
  function Harness(){session=useWindowSession();return React.createElement('button',{onClick:()=>session.changeCompact(false)},session.compact?'ball':'chat');}
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Harness)));
  await act(async()=>read(true));
  assert.equal(document.querySelector('button').textContent,'ball');
  assert.equal(session.sessionProps.compactRef.current,true);
  await act(async()=>document.querySelector('button').click());
  assert.equal(document.querySelector('button').textContent,'chat');
  assert.equal(session.restorePhase,'appearing');
  assert.equal(session.sessionProps.compactRef.current,false);
  await act(async()=>root.unmount());
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Harness)));
  await act(async()=>session.changeCompact(true));
  await act(async()=>read(false));
  assert.equal(session.compact,true,'old startup response must not undo a newer transition');
  assert.equal(session.sessionProps.compactRef.current,true);
  assert.equal(calls.filter(command=>command==='get_mini_mode').length,2);
  await act(async()=>session.changeCompact(false));
  rejectMode=true;
  await act(async()=>session.changeCompact(true));
  assert.equal(session.compact,false,'failed native resize restores the previous UI');
  assert.equal(session.sessionProps.compactRef.current,false);
  assert.equal(session.sessionProps.windowError,'Error: resize failed');
  assert.equal(session.restorePhase,'');
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();dom.window.close();
  keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
