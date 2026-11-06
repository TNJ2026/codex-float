import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('settings popup changes and saves appearance, keeps native glass and closes accessibly',async()=>{
 const dom=new JSDOM('<div id="root"></div><button id="outside">outside</button>',{url:'http://localhost'});
 const globals=['window','document','localStorage','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(key=>globalThis[key]);
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const calls=[];
 let mode='custom-blur',dragCount=0;
 dom.window.__TAURI_INTERNALS__={transformCallback:()=>1,metadata:{currentWindow:{label:'main'}},invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='background_settings')return {mode,amount:10};
  if(cmd==='settings_backdrop')return true;

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
  assert.equal(document.querySelector('.settings-predictions input').checked,false);
  assert.equal(gear().getAttribute('aria-expanded'),'true');
  const themeButton=theme=>document.querySelector(`.theme-option[aria-label="${theme==='light'?'亮色':'暗色'}主题"]`);
  assert.equal(document.activeElement,themeButton('dark'));
  assert.equal(document.querySelectorAll('.settings-theme-toggle button').length,2);
  for(const option of document.querySelectorAll('.theme-option')){assert.equal(option.textContent,'');assert.ok(option.querySelector('svg'));}
  assert.equal(document.getElementById('appearance-blur'),null);
  // WebKit can blur the focused theme button with no next focus target when
  // clicking a button, label or slider inside the popup. It must stay open.
  await act(async()=>themeButton('dark').dispatchEvent(new dom.window.FocusEvent('focusout',{bubbles:true,relatedTarget:null})));
  assert.ok(document.querySelector('.settings-panel'),'internal clicks must not dismiss settings when WebKit reports no focus target');
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
  await act(async()=>document.getElementById('appearance-transparency').dispatchEvent(new dom.window.MouseEvent('mousedown',{bubbles:true})));
  assert.equal(dragCount,0);
  assert.equal(calls.filter(call=>call.cmd==='set_background_blur').length,0);
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('.settings-panel'),null);
  assert.equal(document.activeElement,gear());
  await click(gear());
  await act(async()=>document.getElementById('outside').dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true})));
  assert.equal(document.querySelector('.settings-panel'),null);
  await click(gear());
  await act(async()=>document.getElementById('outside').focus());
  assert.ok(document.querySelector('.settings-panel'),'native focus restoration must not dismiss settings');
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true})));
  await act(async()=>document.getElementById('outside').dispatchEvent(new dom.window.FocusEvent('focusin',{bubbles:true})));
  assert.equal(document.querySelector('.settings-panel'),null,'keyboard focus moving outside closes settings');
  mode='vibrancy';
  await render('vibrancy-fallback');
  await click(gear());
  assert.equal(themeButton('light').getAttribute('aria-pressed'),'true');
  assert.equal(document.getElementById('appearance-transparency').value,'70');
  assert.equal(document.querySelector('.settings-panel').dataset.nativeGlass,undefined);
  assert.ok(!calls.some(call=>call.cmd==='settings_backdrop'));
  assert.equal(document.getElementById('appearance-blur'),null);
  mode='liquid-glass';
  const originalBounds=dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
   return this.classList.contains('settings-panel')?{left:100,top:38,width:280,height:400}:originalBounds.call(this);
  };
  const chat=document.createElement('div');chat.className='chat-panel';chat.innerHTML='<section class="messages" style="clip-path:inset(0)"></section>';document.body.append(chat);
  const blurCalls=calls.filter(call=>call.cmd==='set_background_blur').length;
  await render('liquid-glass');
  await click(gear());
  assert.equal(document.documentElement.dataset.nativeBackground,'liquid-glass');
  assert.equal(document.getElementById('appearance-blur'),null);
  assert.match(document.querySelector('.settings-note').textContent,/原生 Liquid Glass/);
  assert.equal(document.querySelector('.settings-panel').dataset.nativeGlass,'true');
  assert.ok(calls.some(call=>call.cmd==='settings_backdrop'&&JSON.stringify(call.args.rect)==='[100,38,280,400]'));
  assert.match(chat.firstElementChild.style.clipPath,/polygon/);
  await change('appearance-transparency','35');
  assert.equal(JSON.parse(localStorage.getItem('codex-float-appearance')).transparency,35);
  assert.equal(calls.filter(call=>call.cmd==='set_background_blur').length,blurCalls);
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('.settings-panel'),null);
  assert.equal(chat.firstElementChild.style.clipPath,'inset(0)');
  assert.equal(calls.filter(call=>call.cmd==='settings_backdrop').at(-1).args.rect,null);
  document.documentElement.dataset.nativeWindowControls='true';
  await act(async()=>root.render(React.createElement(Settings,{nativeToolbar:true,openRequest:1})));
  assert.ok(document.querySelector('dialog.settings-panel[open]'),'the native action opens settings in the modal top layer');
  await click(themeButton('dark'));
  assert.equal(document.documentElement.dataset.theme,'dark','the theme button applies the chosen theme');
  await act(async()=>root.render(React.createElement(Settings,{nativeToolbar:true,openRequest:2})));
  assert.ok(document.querySelector('.settings-panel'),'repeated native Settings actions keep the panel open');
  await click(document.querySelector('[aria-label="关闭设置"]'));
  assert.equal(document.querySelector('.settings-panel'),null,'the close button dismisses native toolbar settings');
  assert.equal(calls.filter(call=>call.cmd==='settings_backdrop').at(-1).args.rect,null);
  dom.window.HTMLElement.prototype.getBoundingClientRect=originalBounds;
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();globals.forEach((key,index)=>{globalThis[key]=previous[index];});dom.window.close();
 }
});
