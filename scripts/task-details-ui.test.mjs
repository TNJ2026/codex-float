import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('summary disclosure and plan progress render, update and stop spinning when interrupted',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client'),{TaskDetails}=await vite.ssrLoadModule('/src/TaskDetails.jsx');root=createRoot(document.getElementById('root'));
  const render=props=>act(async()=>root.render(React.createElement(TaskDetails,props)));
  await render({type:'reasoningSummary',text:'**检查入口**',active:true});
  assert.equal(document.querySelector('details').open,true);assert.match(document.querySelector('summary').textContent,/思考摘要.*更新中/);assert.equal(document.querySelector('.markdown strong').textContent,'检查入口');
  await render({type:'reasoningSummary',text:'检查完成',active:false});assert.equal(document.querySelector('details').open,false);
  await act(async()=>{document.querySelector('details').open=true;});assert.equal(document.querySelector('details').open,true);
  const steps=[{text:'检查',status:'completed'},{text:'修改',status:'inProgress'},{text:'验证',status:'pending'}];
  await render({type:'taskPlan',steps,turnStatus:'inProgress',explanation:'开始修改'});
  assert.match(document.querySelector('summary').textContent,/计划步骤1\/3进行中/);assert.equal(document.querySelectorAll('.task-plan-steps > li').length,3);assert.equal(document.querySelectorAll('.spin').length,1);
  await render({type:'taskPlan',steps,turnStatus:'interrupted'});assert.match(document.querySelector('summary').textContent,/已中断/);assert.equal(document.querySelectorAll('.spin').length,0);assert.match(document.querySelector('[data-status="inProgress"]').textContent,/已中断/);
  await render({type:'taskPlan',steps:steps.map(step=>({...step,status:'completed'})),turnStatus:'completed'});assert.match(document.querySelector('summary').textContent,/3\/3全部完成/);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});
