import test from 'node:test';
import assert from 'node:assert/strict';
import {messagesOf,applyChange} from '../src/model.js';

test('reasoning displays only supplied summaries in canonical item order and streams incremental edits',()=>{
 const items=[{id:'u',type:'userMessage',content:[{type:'text',text:'开始'}]},{id:'r',type:'reasoning',summary:['**检查项目**',''],content:['PRIVATE CONTENT']},{id:'a',type:'agentMessage',text:'已完成'}];
 const state={turnHistory:{history:{entitiesByKey:{turn:{turnId:'t',status:'inProgress',items:{entitiesByKey:{a:items[2],r:items[1],u:items[0]},islands:[{entries:items.map(item=>({value:item.id}))}]}}}}}};
 assert.deepEqual(messagesOf(state).map(message=>message.id),['u','r','a']);
 assert.equal(messagesOf(state)[1].text,'**检查项目**');assert.equal(messagesOf(state)[1].active,false);
 const streaming={turns:[{turnId:'t',status:'inProgress',items:[items[0],items[1]]}]};
 assert.equal(messagesOf(streaming)[1].active,true);
 const next=applyChange(streaming,1,{type:'patch',baseRevision:1,revision:2,patches:[{op:'replace',path:'/turns/0/items/1/summary/0',value:'检查项目并确认方案'}]}).state;
 assert.equal(messagesOf(next)[1].text,'检查项目并确认方案');assert.equal(messagesOf(streaming)[1].text,'**检查项目**');
 assert.equal(messagesOf({turns:[{items:[{id:'raw',type:'reasoning',summary:[],content:['PRIVATE CONTENT']}]}]}).length,0);
 const completed={...streaming,turns:[{...streaming.turns[0],completedItemIds:{r:true}}]};assert.equal(messagesOf(completed)[1].active,false);
});

test('latest plan snapshot replaces the prior plan at a stable position without inventing completion',()=>{
 const first={id:'p1',type:'todo-list',plan:[{step:'检查',status:'inProgress'},{step:'修改',status:'pending'}]};
 const latest={id:'p2',type:'todo-list',explanation:'已检查，开始修改',plan:[{step:'检查',status:'completed'},{step:'修改',status:'inProgress'},{step:'验证',status:'pending'}]};
 const turn={turnId:'t',status:'inProgress',items:[first,{id:'a',type:'agentMessage',text:'处理中'},latest]};
 const messages=messagesOf({turns:[turn]});assert.deepEqual(messages.map(message=>message.id),['task-plan:t','a']);
 assert.equal(messages[0].steps.length,3);assert.equal(messages[0].explanation,latest.explanation);
 assert.equal(messagesOf({turns:[{...turn,items:[first]}]})[0].id,messages[0].id);
 for(const status of ['completed','failed','interrupted']){
  const plan=messagesOf({turns:[{...turn,status}]})[0];assert.equal(plan.active,false);assert.deepEqual(plan.steps.map(step=>step.status),['completed','inProgress','pending']);
 }
 assert.equal(messagesOf({turns:[turn,{...turn,turnId:'other'}]}).filter(message=>message.type==='taskPlan').length,2);
 assert.deepEqual(messagesOf({turns:[{items:[first,{type:'todo-list',plan:[]}]}]}),[]);
 const draft=messagesOf({turns:[{status:'inProgress',items:[{id:'draft',type:'plan',text:'# 实施方案'}]}]})[0];assert.equal(draft.type,'proposedPlan');assert.equal(draft.active,true);
});
