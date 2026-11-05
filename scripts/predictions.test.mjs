import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('predictions are once per newly completed turn, cancellable and scoped to the chat',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>globalThis[k]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const calls=[],pending=[];
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{calls.push({cmd,args});if(cmd==='predict_message')return new Promise(resolve=>pending.push(resolve));}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {useComposerPrediction,ComposerPrediction}=await vite.ssrLoadModule('/src/ComposerPrediction.jsx');
  const {predictionKey,predictionTarget,readPredictions}=await vite.ssrLoadModule('/src/predictions.js');
  const turn=(id,status='completed')=>({id,status,items:[{id:'u'+id,type:'userMessage',content:[{type:'text',text:'请检查'}]},{id:'a'+id,type:'agentMessage',phase:'final_answer',text:'发现问题'}]});
  let props={threadId:'one',conversation:{latestModel:'model',turns:[turn('old')]},enabled:true,available:true,draft:'',hasAttachments:false},current;
  function Harness(){current=useComposerPrediction(props);return React.createElement(ComposerPrediction,{text:current.text});}
  const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));
  const render=()=>act(async()=>root.render(React.createElement(Harness)));
  const wait=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,1250)));
  await render();await wait();assert.equal(pending.length,0,'connecting to old history does not spend quota');
  props={...props,conversation:{latestModel:'model',turns:[turn('new','inProgress')]}};await render();
  props={...props,conversation:{latestModel:'model',turns:[turn('new')]}};await render();await wait();assert.equal(pending.length,1);
  await act(async()=>pending.shift()({text:'修复这个问题'}));assert.equal(current.text,'修复这个问题');assert.match(document.body.textContent,/Tab 接受/);
  assert.equal(predictionKey({key:'Tab'},current.text),'accept');assert.equal(predictionKey({key:'Escape'},current.text),'dismiss');
  for(const event of [{key:'Tab',shiftKey:true},{key:'Tab',nativeEvent:{isComposing:true}},{key:'Tab',keyCode:229},{key:'Enter'}])assert.equal(predictionKey(event,current.text),null);
  props={...props,draft:'我来'};await render();assert.equal(current.text,'');assert.ok(calls.some(c=>c.cmd==='cancel_prediction'));
  props={...props,draft:''};await render();await wait();assert.equal(pending.length,0,'clearing the draft does not regenerate');
  props={...props,conversation:{latestModel:'model',turns:[turn('next')]}};await render();await wait();assert.equal(pending.length,1);
  props={...props,threadId:'two'};await render();await act(async()=>pending.shift()({text:'旧聊天建议'}));assert.equal(current.text,'');
  props={...props,conversation:{latestModel:'model',turns:[turn('third')]}};await render();await wait();
  props={...props,enabled:false};await render();await act(async()=>pending.shift()({text:'已禁用的建议'}));assert.equal(current.text,'');
  assert.equal(predictionTarget({turns:[turn('running','inProgress')]}),null);
  const bounded=predictionTarget({turns:Array.from({length:20},(_,i)=>({...turn(String(i)),items:[{id:'a'+i,type:'agentMessage',text:'a'.repeat(10000)}]}))});
  assert.ok(bounded.context.length<=12);assert.ok(bounded.context.reduce((n,m)=>n+m.text.length,0)<=16000);
  assert.equal(readPredictions(dom.window.localStorage),false,'predictions are opt-in on first launch');
  dom.window.localStorage.setItem('codex-float-predictions','true');assert.equal(readPredictions(dom.window.localStorage),true);
  dom.window.localStorage.setItem('codex-float-predictions','false');assert.equal(readPredictions(dom.window.localStorage),false);
  dom.window.localStorage.setItem('codex-float-predictions','invalid');assert.equal(readPredictions(dom.window.localStorage),false);
  assert.equal(readPredictions({getItem(){throw Error('unavailable');}}),false);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((k,i)=>{if(previous[i]===undefined)delete globalThis[k];else globalThis[k]=previous[i];});}
});
