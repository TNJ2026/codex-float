import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('reasoning slider previews discrete levels, commits only on release and cancels abandoned gestures',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const globals=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root,model={model:'full',defaultReasoningEffort:'medium',supportedReasoningEfforts:['low','medium','high','xhigh','max','ultra'].map(reasoningEffort=>({reasoningEffort}))},effort=null;
 const commits=[],previews=[];
 try{
  const {createRoot}=await import('react-dom/client');const {ReasoningSlider}=await vite.ssrLoadModule('/src/ReasoningSlider.jsx');
  root=createRoot(document.getElementById('root'));
  const render=()=>act(async()=>root.render(React.createElement(ReasoningSlider,{model,effort,onCommit:next=>{commits.push(next);effort=next;return true;},onPreviewChange:active=>previews.push(active)})));
  const slider=()=>document.querySelector('input[type="range"]');
  const pointer=type=>act(async()=>slider().dispatchEvent(new dom.window.Event(type,{bubbles:true})));
  const change=value=>act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(slider(),String(value));slider().dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await render();assert.equal(slider().value,'1');assert.equal(slider().max,'5');assert.match(slider().getAttribute('aria-valuetext'),/中.*默认/);
  await pointer('pointerdown');await change(2);await change(4);await change(5);
  assert.equal(commits.length,0);assert.equal(previews.at(-1),true);assert.equal(slider().getAttribute('aria-valuetext'),'极高');
  await pointer('pointerup');await pointer('lostpointercapture');
  assert.deepEqual(commits,['ultra']);assert.equal(previews.at(-1),false);await render();
  await pointer('pointerdown');await change(2);await pointer('pointercancel');
  assert.deepEqual(commits,['ultra']);assert.equal(slider().value,'5');assert.equal(previews.at(-1),false);
  await change(0);assert.deepEqual(commits,['ultra','low'],'keyboard/native input changes save without a pointer gesture');await render();
  await pointer('pointerdown');await change(3);await act(async()=>root.unmount());root=null;
  assert.equal(previews.at(-1),false,'closing the popup cancels the preview and releases the send guard');assert.equal(commits.length,2);
  model={model:'single',defaultReasoningEffort:'none',supportedReasoningEfforts:[{reasoningEffort:'none'}]};effort=null;
  root=createRoot(document.getElementById('root'));await render();assert.equal(slider().disabled,true);assert.equal(slider().max,'0');
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();globals.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
