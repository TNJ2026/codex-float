import test from 'node:test';import assert from 'node:assert/strict';
import {turnDurationMs,workDurationLabel} from '../src/work-timing.js';
import {messagesOf,applyChange} from '../src/model.js';import {transcriptMessages} from '../src/transcript.js';
test('total duration uses turn timing and never sums concurrent tool durations',()=>{
 assert.equal(turnDurationMs({durationMs:1234,startedAt:10,completedAt:90}),1234);
 assert.equal(turnDurationMs({startedAt:100,completedAt:105}),5000);
 assert.equal(turnDurationMs({durationMs:0}),0);
 for(const value of [{},{durationMs:null},{durationMs:-1},{durationMs:'1000'},{startedAt:100,completedAt:99},{startedAt:null,completedAt:12}])assert.equal(turnDurationMs(value),null);
 assert.equal(workDurationLabel(undefined),'未提供');assert.equal(workDurationLabel(65000),'1 分 5 秒');assert.equal(workDurationLabel(3661500),'1 小时 1 分 1.5 秒');
 const items=[{id:'note1',type:'agentMessage',phase:'commentary',text:'开始'},{id:'call1',type:'commandExecution',command:'first',status:'completed',durationMs:4000},{id:'note2',type:'agentMessage',phase:'commentary',text:'接着'},{id:'call2',type:'mcpToolCall',tool:'second',status:'completed',durationMs:4000},{id:'answer',type:'agentMessage',phase:'final_answer',text:'完成结果'}];
 const state={turns:[{id:'turn',status:'completed',durationMs:5000,items}]};
 const work=transcriptMessages(messagesOf(state,{toolTimeline:true})).find(m=>m.type==='workSummary');assert.equal(work.turnDurationMs,5000);assert.deepEqual(work.workMessages.map(m=>m.toolCall?.id||m.id),['note1','call1','note2','call2']);
 const next=applyChange(state,1,{type:'patch',baseRevision:1,revision:2,patches:[{op:'replace',path:'/turns/0/durationMs',value:6000}]}).state;
 const updated=transcriptMessages(messagesOf(next,{toolTimeline:true})).find(m=>m.type==='workSummary');assert.equal(updated.turnDurationMs,6000);assert.deepEqual(updated.workMessages.map(m=>m.id),work.workMessages.map(m=>m.id));
});
