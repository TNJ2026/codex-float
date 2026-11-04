import test from 'node:test';import assert from 'node:assert/strict';
import {messagesOf,applyChange} from '../src/model.js';import {transcriptMessages} from '../src/transcript.js';
const items=[{id:'user',type:'userMessage',content:[{type:'text',text:'检查项目'}]},{id:'before',type:'agentMessage',phase:'commentary',text:'先读取文件'},{id:'a',type:'commandExecution',command:'read file',status:'inProgress',aggregatedOutput:'first'},{id:'middle',type:'agentMessage',phase:'commentary',text:'接下来验证'},{id:'b',type:'mcpToolCall',tool:'validate',status:'inProgress',arguments:{value:1}},{id:'final',type:'agentMessage',phase:'final_answer',text:'检查结果'}];
const state=status=>({turns:[{id:'round',status,items:{entitiesByKey:Object.fromEntries([...items].reverse().map(item=>[item.id,{...item}])),islands:[{entries:items.map(item=>({value:item.id}))}]}}]});
const visible=value=>transcriptMessages(messagesOf(value,{toolTimeline:true}));
const order=messages=>messages.filter(m=>m.type!=='toolHistory').map(m=>m.type==='toolDetails'?m.toolCall.id:m.id);
test('live messages show only the newest call in source order even when an older concurrent call updates',()=>{
 const initial=state('inProgress');assert.deepEqual(order(visible(initial)),['user','before','middle','b','final']);
 const next=applyChange(initial,1,{type:'patch',baseRevision:1,revision:2,patches:[{op:'replace',path:'/turns/0/items/entitiesByKey/a/status',value:'completed'},{op:'replace',path:'/turns/0/items/entitiesByKey/a/aggregatedOutput',value:'updated output'}]}).state;
 assert.deepEqual(order(visible(next)),order(visible(initial)));
 const row=messagesOf(next,{toolTimeline:true}).find(m=>m.type==='toolDetails'&&m.toolCall.id==='a');assert.equal(row.toolCall.aggregatedOutput,'updated output');assert.equal(row.toolStatus,'completed');assert.equal(initial.turns[0].items.entitiesByKey.a.aggregatedOutput,'first');
 assert.equal(visible(next).find(m=>m.type==='toolDetails'&&m.toolCall.id==='b').toolStatus,'inProgress');
 const list=visible(next);assert.ok(!list.some(m=>m.type==='toolHistory'),'running timeline contains no search or filter index');
 const latestDone=structuredClone(next);latestDone.turns[0].items.entitiesByKey.b.status='completed';assert.deepEqual(order(visible(latestDone)),order(list),'latest call stays visible after finishing until another call starts');
 const completed=structuredClone(next);completed.turns[0].status='completed';assert.deepEqual(order(visible(completed).find(m=>m.type==='workSummary').workMessages),['before','a','middle','b'],'completion restores the complete ordered history');
});
test('completed work folds in original order while final answers stay visible and history index disappears',()=>{
 const value=state('completed'),list=visible(value);assert.ok(!list.some(m=>m.type==='toolHistory'));const work=list.find(m=>m.type==='workSummary');assert.ok(work);assert.deepEqual(order(work.workMessages),['before','a','middle','b']);assert.ok(list.some(m=>m.id==='final'));assert.ok(work.workMessages.filter(m=>m.type==='toolDetails').every(m=>m.toolStatus!=='inProgress'));
 for(const status of ['interrupted','failed']){const list=visible(state(status));assert.ok(!list.some(m=>m.type==='toolDetails'));assert.deepEqual(order(list.flatMap(m=>m.type==='workSummary'?m.workMessages:[m])),['user','before','a','middle','b','final']);}
});
test('failed calls fold inside work and identical call IDs in different rounds have independent row identities',()=>{
 const value=state('completed');value.turns[0].items.entitiesByKey.a.exitCode=1;const list=visible(value);assert.ok(!list.some(m=>m.type==='toolDetails'));assert.equal(list.flatMap(m=>m.workMessages||[]).find(m=>m.type==='toolDetails').toolStatus,'failed');
 const other=structuredClone(value.turns[0]);other.id='other-round';value.turns.push(other);const raw=messagesOf(value,{toolTimeline:true}).filter(m=>m.type==='toolDetails');assert.equal(new Set(raw.map(m=>m.id)).size,4);
});
