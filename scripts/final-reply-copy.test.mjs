import test from 'node:test';import assert from 'node:assert/strict';
import {finalReplyCopies} from '../src/final-reply-copy.js';
import {messagesOf} from '../src/model.js';import {transcriptMessages} from '../src/transcript.js';
test('copy belongs only to the last visible completed reply, never to users, tools or folded work',()=>{
 const items=[{id:'u',type:'userMessage',content:[{type:'text',text:'用户指令'}]},{id:'note',type:'agentMessage',phase:'commentary',text:'过程说明，不可复制到最终回复'},{id:'tool',type:'commandExecution',command:'secret command',status:'completed',aggregatedOutput:'工具输出'},{id:'final1',type:'agentMessage',phase:'final_answer',text:'前一段'},{id:'final2',type:'agentMessage',phase:'final_answer',text:'最后显示的回复'}];
 for(const status of ['inProgress','completed','failed','interrupted']){
  const messages=finalReplyCopies(transcriptMessages(messagesOf({turns:[{id:'round',status,items}]},{toolTimeline:true})));
  const copies=messages.filter(m=>m.copyable);assert.equal(copies.length,status==='completed'?1:0);
  if(status==='completed'){assert.equal(copies[0].id,'final2');assert.equal(copies[0].text,'最后显示的回复');assert.ok(messages.filter(m=>m.type==='workSummary').flatMap(m=>m.workMessages).every(m=>!m.copyable));}
 }
});
test('each completed round has one copy target and a later visible update is the copied message',()=>{
 const message=(id,turnId,text)=>({id,turnId,role:'assistant',turnStatus:'completed',text});
 const result=finalReplyCopies([message('duplicate','one','older'),message('latest','one','latest'),message('duplicate','two','second round'),{...message('update','two','last visible update'),phase:'commentary',delivery:'async'}]);
 assert.deepEqual(result.filter(m=>m.copyable).map(m=>m.text),['latest','last visible update']);
});
