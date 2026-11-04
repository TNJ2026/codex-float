import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('settings popup changes and saves appearance, applies native blur and closes accessibly',async()=>{
 const dom=new JSDOM('<div id="root"></div><button id="outside">outside</button>',{url:'http://localhost'});
 const globals=['window','document','localStorage','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(key=>globalThis[key]);
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const calls=[];
 let mode='custom-blur',rejectBlur=false,dragCount=0;
 dom.window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='background_settings')return {mode,amount:10};
  if(cmd==='set_background_blur'){if(rejectBlur)throw Error('native error');return args.amount;}
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {Settings}=await vite.ssrLoadModule('/src/Settings.jsx');
  root=createRoot(document.getElementById('root'));
  const render=key=>act(async()=>root.render(React.createElement('header',{onMouseDown:()=>dragCount++},React.createElement(Settings,{key}))));
  await render('initial');
  const gear=()=>document.querySelector('.settings-button');
  const click=element=>act(async()=>element.click());
  const change=async(id,value)=>act(async()=>{
   const element=document.getElementById(id);
   const prototype=element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;
   Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);
   element.dispatchEvent(new dom.window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));
  });
  await click(gear());
  await change('browser-body-limit','64000');
  await act(async()=>document.getElementById('browser-body-limit').dispatchEvent(new dom.window.Event('pointerup',{bubbles:true})));
  assert.equal(localStorage.getItem('codex-float-browser-limit'),'64000');
  assert.equal(gear().getAttribute('aria-expanded'),'true');
  const themeButton=theme=>document.querySelector(`.theme-option[aria-label="${theme==='light'?'亮色':'暗色'}主题"]`);
  assert.equal(document.activeElement,themeButton('dark'));
  assert.equal(document.querySelectorAll('.settings-theme-toggle button').length,2);
  for(const option of document.querySelectorAll('.theme-option')){assert.equal(option.textContent,'');assert.ok(option.querySelector('svg'));}
  assert.equal(document.getElementById('appearance-blur').disabled,false);
  await click(themeButton('light'));
  assert.equal(themeButton('light').getAttribute('aria-pressed'),'true');
  assert.equal(themeButton('dark').getAttribute('aria-pressed'),'false');
  assert.equal(document.documentElement.dataset.theme,'light');
  assert.equal(localStorage.getItem('codex-float-theme'),'light');
  assert.ok(calls.some(call=>call.cmd==='plugin:window|set_theme'&&call.args.value==='light'));
  await change('appearance-transparency','70');
  assert.equal(document.documentElement.style.getPropertyValue('--background-alpha'),'0.7');
  assert.deepEqual([...document.getElementById('appearance-transparency').parentElement.querySelectorAll('.settings-range-hint span')].map(node=>node.textContent),['透明','不透明']);
  await change('appearance-transparency','0');
  assert.equal(document.documentElement.style.getPropertyValue('--background-alpha'),'0');
  await change('appearance-transparency','5');
  assert.equal(document.documentElement.style.getPropertyValue('--background-alpha'),'0.05');
  await change('appearance-transparency','70');
  assert.equal(JSON.parse(localStorage.getItem('codex-float-appearance')).transparency,70);
  await act(async()=>document.getElementById('appearance-blur').dispatchEvent(new dom.window.MouseEvent('mousedown',{bubbles:true})));
  assert.equal(dragCount,0);
  await change('appearance-blur','21');
  await act(async()=>new Promise(resolve=>setTimeout(resolve,150)));
  assert.deepEqual(calls.filter(call=>call.cmd==='set_background_blur').map(call=>call.args.amount),[21]);
  rejectBlur=true;
  await change('appearance-blur','22');
  await act(async()=>new Promise(resolve=>setTimeout(resolve,150)));
  assert.match(document.querySelector('[role="alert"]').textContent,/未能应用/);
  assert.equal(document.getElementById('appearance-blur').value,'21');
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('.settings-panel'),null);
  assert.equal(document.activeElement,gear());
  await click(gear());
  await act(async()=>document.getElementById('outside').dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true})));
  assert.equal(document.querySelector('.settings-panel'),null);
  rejectBlur=false;mode='acrylic';
  await render('fallback');
  await click(gear());
  assert.equal(themeButton('light').getAttribute('aria-pressed'),'true');
  assert.equal(document.getElementById('appearance-transparency').value,'70');
  assert.equal(document.getElementById('appearance-blur').disabled,true);
  assert.match(document.querySelector('.settings-note').textContent,/不支持/);
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();globals.forEach((key,index)=>{globalThis[key]=previous[index];});dom.window.close();
 }
});
