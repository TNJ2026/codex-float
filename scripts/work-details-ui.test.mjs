import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('completed work defaults to collapsed and preserves order when expanded and reopened',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let root;
 try{
  const {createRoot}=await import('react-dom/client'),{WorkDetails}=await vite.ssrLoadModule('/src/WorkDetails.jsx');root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(WorkDetails,{items:[{},{}]},React.createElement('p',null,'过程内容'))));
  const details=document.querySelector('details');assert.equal(details.open,false);assert.match(details.querySelector('summary').textContent,/上 2 条消息/);
  await act(async()=>{details.open=true;});assert.equal(details.open,true);assert.equal(details.querySelector('.work-details-body').textContent,'过程内容');
  assert.match(details.querySelector('summary').textContent,/用时 未提供/);
  await act(async()=>root.render(React.createElement(WorkDetails,{items:[{},{},{},{}],durationMs:65000},[React.createElement('p',{key:'one'},'先说明'),React.createElement('details',{key:'call-one'},React.createElement('summary',null,'调用 A')),React.createElement('p',{key:'two'},'后说明'),React.createElement('details',{key:'call-two'},React.createElement('summary',null,'调用 B'))])));
  assert.match(details.querySelector('summary').textContent,/用时 1 分 5 秒/);assert.equal(details.open,true);
  assert.deepEqual([...details.querySelector('.work-details-body').children].map(el=>el.textContent),['先说明','调用 A','后说明','调用 B']);
  await act(async()=>{details.open=false;details.open=true;});assert.deepEqual([...details.querySelector('.work-details-body').children].map(el=>el.textContent),['先说明','调用 A','后说明','调用 B']);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
