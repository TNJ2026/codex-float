import test from 'node:test';import assert from 'node:assert/strict';import React,{act} from 'react';import {JSDOM} from 'jsdom';import {createServer} from 'vite';
test('three running agents keep interleaved sends, stops and out-of-order responses isolated',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>globalThis[k]);Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
 const states=new Map(ids.map((id,index)=>[id,{turn:'turn-'+index,status:'inProgress',messages:[]}])),pending=new Map(),calls=[];
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
  assert.equal(cmd,'subagent_action');assert.equal(args.parentId,'parent');assert.ok(states.has(args.childId));calls.push({...args});const state=states.get(args.childId);
  if(args.action==='inspect')return {state:{id:args.childId,turns:[{id:state.turn,status:state.status,items:[{id:'answer-'+args.childId,type:'agentMessage',text:'专属记录 '+args.childId}]}]}};
  if(args.expectedTurnId!==state.turn)throw '轮次已变化';
  const apply=()=>{if(args.action==='stop')state.status='interrupted';else state.messages.push(args.text);return {accepted:true};};
  if(args.childId===ids[2])return apply();
  return new Promise(resolve=>pending.set(args.childId,()=>resolve(apply())));
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let root;
 try{const {SubagentActions,SubagentActionsContext}=await vite.ssrLoadModule('/src/SubagentActions.jsx');const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(SubagentActionsContext.Provider,{value:{parentId:'parent',enabled:true}},ids.map((id,index)=>React.createElement('div',{key:id,'data-agent':index},React.createElement(SubagentActions,{agent:{threadId:id,name:'相同名称'}}))))));
 const open=async index=>act(async()=>document.querySelector(`[data-agent="${index}"] button`).click());
 const close=()=>act(async()=>document.querySelector('dialog[open] header button').click());
 const send=async text=>{await act(async()=>{const input=document.querySelector('dialog[open] textarea');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,text);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});await act(async()=>document.querySelector('dialog[open] form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));};
 const stop=()=>act(async()=>[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='停止此子代理').click());
 await open(0);await send('只给 A 的指令');assert.ok(pending.has(ids[0]));await close();
 await open(1);await stop();assert.ok(pending.has(ids[1]));await close();
 await open(2);await send('只给 C 的指令');
 const panel=()=>document.querySelector('dialog[open]');assert.match(panel().textContent,new RegExp(ids[2]));
 await act(async()=>pending.get(ids[1])());assert.equal(states.get(ids[1]).status,'interrupted');assert.equal(states.get(ids[0]).status,'inProgress');assert.equal(states.get(ids[2]).status,'inProgress');assert.match(panel().textContent,new RegExp(ids[2]));
 await act(async()=>pending.get(ids[0])());assert.deepEqual(states.get(ids[0]).messages,['只给 A 的指令']);assert.deepEqual(states.get(ids[1]).messages,[]);assert.deepEqual(states.get(ids[2]).messages,['只给 C 的指令']);assert.match(panel().textContent,new RegExp(ids[2]));assert.ok(!panel().textContent.includes(ids[0]));
 const writes=calls.filter(c=>c.action!=='inspect');assert.deepEqual(writes.map(c=>[c.childId,c.action,c.expectedTurnId]),[[ids[0],'send','turn-0'],[ids[1],'stop','turn-1'],[ids[2],'send','turn-2']]);
 await close();await open(1);states.get(ids[1]).turn='replacement-turn';states.get(ids[1]).status='inProgress';
 // The loaded panel still has the old completed turn; it cannot stop that replacement.
 assert.equal([...panel().querySelectorAll('button')].find(b=>b.textContent==='停止此子代理').disabled,true);
 await act(async()=>[...panel().querySelectorAll('button')].find(b=>b.textContent==='刷新').click());
 states.get(ids[1]).turn='another-new-turn';await stop();assert.match(panel().querySelector('[role="alert"]').textContent,/轮次已变化/);assert.equal(states.get(ids[1]).status,'inProgress');assert.equal(states.get(ids[0]).status,'inProgress');assert.equal(states.get(ids[2]).status,'inProgress');
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((k,i)=>{if(previous[i]===undefined)delete globalThis[k];else globalThis[k]=previous[i];});}
});
