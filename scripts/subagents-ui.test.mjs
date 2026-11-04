import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('subagent cards show live progress and expandable results without spinning after the parent turn ends',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client'),{SubagentProgress}=await vite.ssrLoadModule('/src/SubagentProgress.jsx');root=createRoot(document.getElementById('root'));
  const agents=[{threadId:'00000000-0000-4000-8000-000000000001',name:'检查员',status:'running',task:'检查文件',model:'gpt-test'},{threadId:'b',name:'验证员',status:'completed',result:'**验证通过**'}];
  const render=(turnStatus,list=agents)=>act(async()=>root.render(React.createElement(SubagentProgress,{turnStatus,agents:list})));
  await render('inProgress');assert.match(document.querySelector('summary').textContent,/子代理进度1\/2 已结束/);assert.equal(document.querySelectorAll('.spin').length,1);assert.equal(document.querySelectorAll('.subagent-list > li').length,2);assert.equal(document.querySelector('.subagent-task').textContent,'检查文件');
  assert.ok(document.querySelector('[aria-label="打开子代理对话 检查员"]'));assert.equal(document.querySelectorAll('.subagent-heading button').length,1);
  const result=document.querySelector('.subagent-result');assert.equal(result.open,false);await act(async()=>{result.open=true;});assert.equal(result.querySelector('.markdown strong').textContent,'验证通过');
  await render('interrupted');assert.equal(document.querySelectorAll('.spin').length,0);assert.match(document.querySelector('[data-agent-status="running"]').textContent,/状态待确认/);assert.match(document.querySelector('.subagent-progress').textContent,/未返回最终状态/);
  await render('inProgress',[{...agents[0],status:'errored',result:'读取失败'},agents[1]]);assert.match(document.querySelector('summary').textContent,/2\/2 已结束/);assert.match(document.querySelector('[data-agent-status="errored"]').textContent,/失败/);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
