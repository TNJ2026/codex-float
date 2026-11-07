import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act,useRef} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('native popup glass restores the parent, clears on close and stays disabled on Windows',async()=>{
 const dom=new JSDOM('<div id="root"></div><div class="chat-panel"><section>Chat</section></div>',{url:'http://localhost'});
 const keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 document.documentElement.dataset.windowPlatform='macos';
 document.documentElement.dataset.nativeBackground='liquid-glass';
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,width:this.id==='child'?150:300,height:100};};
 const calls=[];
 window.__TAURI_INTERNALS__={invoke:async(command,args)=>{assert.equal(command,'settings_backdrop');calls.push(args.rect);return true;}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {useSettingsGlass}=await vite.ssrLoadModule('/src/useSettingsGlass.js');
  function Popup({id}){const ref=useRef();const glass=useSettingsGlass(ref,true);return React.createElement('div',{id,ref,'data-native-glass':glass});}
  root=createRoot(document.getElementById('root'));
  const render=child=>act(async()=>root.render(React.createElement(React.Fragment,null,React.createElement(Popup,{id:'parent',key:'parent'}),child&&React.createElement(Popup,{id:'child',key:'child'}))));
  await render(false);
  assert.equal(document.getElementById('parent').dataset.nativeGlass,'true');
  await render(true);
  assert.equal(document.getElementById('child').dataset.nativeGlass,'true');
  assert.equal(document.getElementById('parent').dataset.nativeGlass,'false');
  assert.ok(document.getElementById('parent').style.clipPath);
  await render(false);
  assert.equal(document.getElementById('parent').dataset.nativeGlass,'true');
  assert.equal(document.getElementById('parent').style.clipPath,'');
  assert.deepEqual(calls.at(-1),[0,0,300,100]);
  await act(async()=>root.render(null));
  assert.equal(calls.at(-1),null);
  assert.equal(document.querySelector('.chat-panel section').style.clipPath,'');
  document.documentElement.dataset.windowPlatform='windows';
  const count=calls.length;
  await render(false);
  assert.equal(document.getElementById('parent').dataset.nativeGlass,'false');
  assert.equal(calls.length,count);
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();dom.window.close();
  keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
