import test from 'node:test';
import assert from 'node:assert/strict';
import {messagesOf} from '../src/model.js';
import {hasMessageEcho,mergeOptimisticMessages,unconfirmedMessages,afterMessagePaint} from '../src/optimistic.js';
import {isSendTimeout,waitForMessageEcho} from '../src/optimistic.js';
test('start timeout reconciles late echoes and never confuses old messages or switched chats',async()=>{
 const pending=local('timeout-message','prompt',['old']);let history=[remote('old')],current=true;
 assert.equal(isSendTimeout('thread-follower-start-turn-timeout'),true);assert.equal(isSendTimeout('permission denied'),false);
 const timer=setTimeout(()=>history.push(remote('echo','prompt','timeout-message')),15);
 assert.equal(await waitForMessageEcho(()=>history,pending,()=>current,{timeout:100,interval:5}),true);clearTimeout(timer);
 assert.equal(await waitForMessageEcho(()=>[remote('old')],pending,()=>current,{timeout:15,interval:5}),false);
 current=false;assert.equal(await waitForMessageEcho(()=>history,pending,()=>current,{timeout:100,interval:5}),false);
});

const local=(id,text='prompt',baseline=[])=>({id,role:'user',text,pending:true,baselineIds:new Set(baseline)});
const remote=(id,text='prompt',clientMessageId)=>({id,role:'user',text,clientMessageId});
test('prompt appears immediately before remote history acknowledges it',()=>{
 const pending=local('local');
 assert.deepEqual(mergeOptimisticMessages([], [pending]),[pending]);
 assert.deepEqual(mergeOptimisticMessages([remote('server','prompt','local')],[pending]),[remote('server','prompt','local')]);
 assert.equal(hasMessageEcho([remote('local')],pending),true);
});
test('old identical prompts and assistant output do not acknowledge a new submission',()=>{
 const pending=local('local','prompt',['old']);
 const history=[remote('old'),{id:'assistant',role:'assistant',text:'prompt'}];
 assert.equal(mergeOptimisticMessages(history,[pending]).length,3);
 assert.equal(unconfirmedMessages([...history,remote('new')],[pending]).length,0);
});
test('repeated prompts reconcile one-to-one and exact identifiers take priority',()=>{
 const first=local('first'),second=local('second');
 assert.deepEqual(unconfirmedMessages([remote('one')],[first,second]),[second]);
 assert.deepEqual(unconfirmedMessages([remote('one','prompt','second')],[first,second]),[first]);
 assert.deepEqual(unconfirmedMessages([remote('one'),remote('two')],[first,second]),[]);
});
test('both steering and normal message identities are available for reconciliation',()=>{
 const parsed=messagesOf({turns:[{items:[{id:'server',type:'userMessage',clientId:'local',content:[{type:'text',text:'prompt'}]},{id:'steer',type:'steeringUserMessage',clientUserMessageId:'local-steer',input:[{type:'text',text:'next'}]}]}]});
 assert.equal(parsed[0].clientMessageId,'local');
 assert.equal(parsed[1].clientMessageId,'local-steer');
});
test('native send can wait for a paint opportunity without waiting for remote acknowledgement',async()=>{
 const previous=globalThis.requestAnimationFrame;
 const frames=[];
 globalThis.requestAnimationFrame=callback=>{frames.push(callback);};
 try{
  let ready=false;
  const pending=afterMessagePaint().then(()=>{ready=true;});
  assert.equal(ready,false);
  frames.shift()();
  assert.equal(ready,false);
  frames.shift()();
  await pending;
  assert.equal(ready,true);
 }finally{globalThis.requestAnimationFrame=previous;}
});
