import test from 'node:test';
import assert from 'node:assert/strict';
import {asyncQuestionRequests,questionReplyText,parseQuestionReply} from '../src/async-questions.js';
import {describeInteraction,buildInteractionReply} from '../src/interactions.js';
const item={id:'call_test',type:'agentMessage',text:'',questions:[{title:'测试问题',options:[{label:'回答 A',description:'测试'}]}]};
const state=(items,status='inProgress')=>({turns:[{status,items}]});
test('async questions preserve the exact desktop question identity and response envelope',()=>{
 const [request]=asyncQuestionRequests(state([item]));
 const question=JSON.stringify(['request_user_input_async','call_test',0]);
 assert.equal(request.params.questions[0].id,question);
 const reply=buildInteractionReply(describeInteraction(request),{[question]:'回答 A'});
 const text=questionReplyText(request,reply.payload.response);
 assert.deepEqual(parseQuestionReply(text),[{questionItemId:question,question:'测试问题',answer:'回答 A'}]);
 // The installed desktop parser removes only the exact opening/closing tags.
 assert.deepEqual(JSON.parse(text.slice(34,-35)),parseQuestionReply(text));
});
test('only an accepted, identified reply resolves the original question',()=>{
 const [request]=asyncQuestionRequests(state([item]));
 const text=questionReplyText(request,{answers:{[request.params.questions[0].id]:{answers:['回答 A']}}});
 const input=[{type:'text',text}];
 assert.equal(asyncQuestionRequests(state([item,{type:'userMessage',content:input}])).length,0);
 assert.equal(asyncQuestionRequests(state([item,{type:'steeringUserMessage',status:'accepted',input}])).length,0);
 assert.equal(asyncQuestionRequests(state([item,{type:'steeringUserMessage',status:'pending',input}])).length,1);
 assert.equal(asyncQuestionRequests(state([item,{type:'userMessage',content:[{type:'text',text:'回答 A'}]}])).length,1);
});
test('completed question turns remain answerable across later turns',()=>{
 assert.equal(asyncQuestionRequests(state([item],'completed')).length,1);
 assert.equal(asyncQuestionRequests({turns:[...state([item],'completed').turns,{status:'inProgress',items:[]}]}).length,1);
 const [request]=asyncQuestionRequests(state([item]));
 const text=questionReplyText(request,{answers:{[request.params.questions[0].id]:{answers:['回答 A']}}});
 const after={turns:[...state([item],'completed').turns,{status:'completed',items:[{type:'userMessage',content:[{type:'text',text}]}]}]};
 assert.equal(asyncQuestionRequests(after).length,0);
});
test('newer question batch supersedes stale old questions, with no missing-answer submission',()=>{
 assert.equal(asyncQuestionRequests(null).length,0);
 const [request]=asyncQuestionRequests(state([item]));
 assert.throws(()=>questionReplyText(request,{answers:{}}));
 assert.deepEqual(parseQuestionReply('ordinary text'),[]);
 const newer={...item,id:'newer'};
 const turns=[...state([item],'completed').turns,...state([newer],'completed').turns];
 assert.equal(asyncQuestionRequests({turns}).length,1);
 assert.equal(asyncQuestionRequests({turns})[0].id,'async:newer');
 const [latest]=asyncQuestionRequests({turns});
 const text=questionReplyText(latest,{answers:{[latest.params.questions[0].id]:{answers:['done']}}});
 turns.push({status:'completed',items:[{type:'userMessage',content:[{type:'text',text}]}]});
 assert.equal(asyncQuestionRequests({turns}).length,0);
});
