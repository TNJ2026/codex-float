import test from 'node:test';import assert from 'node:assert/strict';import React,{act} from 'react';import {JSDOM} from 'jsdom';import {createServer} from 'vite';
import {completedWorkEntries,completedToolLabel} from '../src/completed-work.js';
const call=(id,type='commandExecution')=>({id,type:'toolDetails',toolTitle:id,toolStatus:'completed',toolCall:{id,type,command:'echo '+id,aggregatedOutput:'output '+id}});
test('completed calls group only while adjacent and retain original references and chronological order',()=>{
 const items=[{id:'before',text:'说明'},call('a'),call('b','fileChange'),{id:'middle',text:'后续说明'},call('c')];const original=JSON.stringify(items),entries=completedWorkEntries(items);
 assert.deepEqual(entries.map(e=>e.type==='toolGroup'?e.calls.map(c=>c.id):e.id),['before',['a','b'],'middle',['c']]);assert.equal(entries[1].calls[0],items[1]);assert.equal(JSON.stringify(items),original);assert.equal(completedToolLabel(entries[1].calls),'编辑了文件和运行了命令');assert.equal(completedToolLabel(entries[3].calls),'已运行 echo c');assert.equal(completedToolLabel([call('a'),call('b')]),'运行了命令');
});
test('completed screenshot-style tool summary opens a popup with every original call selectable',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>globalThis[k]);Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let root;
 try{const {ToolProcessGroup}=await vite.ssrLoadModule('/src/ToolDetails.jsx');const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(ToolProcessGroup,{calls:[call('a'),call('b')]})));
 const button=document.querySelector('.tool-process-completed');assert.equal(button.textContent,'运行了命令');assert.equal(button.querySelector('small'),null);assert.equal(document.querySelector('pre'),null);await act(async()=>button.click());assert.match(document.querySelector('[role="dialog"]').textContent,/output a/);
 const picker=document.querySelector('.tool-group-picker');
 await act(async()=>picker.querySelector('summary').click());
 assert.equal(picker.open,true);
 const choices=picker.querySelectorAll('li button');
 assert.equal(choices.length,2);
 await act(async()=>choices[1].click());
 assert.equal(picker.open,false);
 assert.match(document.querySelector('[role="dialog"]').textContent,/output b/);assert.equal(document.getElementById('root').querySelector('pre'),null);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((k,i)=>{if(previous[i]===undefined)delete globalThis[k];else globalThis[k]=previous[i];});}
});
