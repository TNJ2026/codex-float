import test from 'node:test';
import assert from 'node:assert/strict';
import {messagesOf} from '../src/model.js';
import {transcriptMessages} from '../src/transcript.js';

const user=(id,text='开始')=>({id,type:'userMessage',content:[{type:'text',text}]});
const commentary=(id,text='正在检查')=>({id,type:'agentMessage',phase:'commentary',text});
const answer=(id,text='完成结果')=>({id,type:'agentMessage',phase:'final_answer',text});
const transcript=(items,status='completed')=>transcriptMessages(messagesOf({turns:[{turnId:'t',status,items}]}));

test('completed work folds by phase while live, interrupted and failed work remains visible',()=>{
 const items=[user('u'),commentary('c'),{id:'p',type:'todo-list',plan:[{step:'检查',status:'completed'}]},answer('f')];
 for(const status of ['inProgress','interrupted','failed'])assert.deepEqual(transcript(items,status).map(message=>message.id),['u','c','task-plan:t','f']);
 const messages=transcript(items);assert.deepEqual(messages.map(message=>message.type||message.id),['u','workSummary','f']);
 assert.deepEqual(messages[1].workMessages.map(message=>message.id),['c','task-plan:t']);
 assert.deepEqual(messagesOf({turns:[{turnId:'t',status:'completed',items}]}).map(message=>message.id),['u','c','task-plan:t','f'],'display folding must not alter the underlying transcript');
});

test('async delivery, user-facing updates before steering and messages without a final answer are preserved',()=>{
 const messages=transcript([user('u'),commentary('early'),{...commentary('async'),delivery:'async'},commentary('before-user'),{id:'steer',type:'steeringUserMessage',input:[{type:'text',text:'继续'}]},commentary('later'),answer('f')]);
 assert.deepEqual(messages.filter(message=>message.type!=='workSummary').map(message=>message.id),['u','async','before-user','steer','f']);
 const unfinished=transcript([user('u'),commentary('old'),commentary('latest','请确认后继续')]);
 assert.equal(unfinished.at(-1).id,'latest');assert.equal(unfinished[1].workMessages[0].id,'old');
 const done=transcript([user('u'),commentary('c'),answer('f','done')]);assert.ok(!done.some(message=>message.id==='f'));
 assert.ok(transcript([user('u'),{...answer('f','done'),delivery:'async'}]).some(message=>message.id==='f'));
 assert.ok(transcript([user('u'),{...answer('f','done'),structuredOutput:{value:1}}]).some(message=>message.id==='f'));
});

test('subagent failures and proposed final plans stay visible and work never crosses user or turn boundaries',()=>{
 const items=[user('u'),commentary('c'),{id:'spawn',type:'collabAgentToolCall',tool:'spawnAgent',status:'completed',receiverThreadIds:['child'],agentsStates:{child:{status:'errored',message:'failed'}}},{id:'proposal',type:'plan',text:'实施方案'},answer('f')];
 const messages=transcript(items);assert.ok(messages.some(message=>message.type==='subagentProgress'));assert.ok(messages.some(message=>message.type==='proposedPlan'));
 const state={turns:[{turnId:'one',status:'completed',items:[user('u1'),commentary('c1'),answer('a1')]},{turnId:'two',status:'completed',items:[user('u2'),commentary('c2'),answer('a2')]}]};
 assert.deepEqual(transcriptMessages(messagesOf(state)).filter(message=>message.type==='workSummary').map(message=>message.turnId),['one','two']);
});
