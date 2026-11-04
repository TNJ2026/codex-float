import test from 'node:test';
import assert from 'node:assert/strict';
import {messagesOf,applyChange} from '../src/model.js';
import {subagentMessage} from '../src/subagents.js';

const spawn={id:'spawn',type:'collabAgentToolCall',tool:'spawnAgent',status:'completed',receiverThreadIds:['a','b'],receiverThreads:[{threadId:'a',thread:{agentNickname:'审查员',agentRole:'reviewer'}}],prompt:'检查改动',model:'gpt-test',agentsStates:{a:{status:'running'},b:{status:'pendingInit'}}};
test('subagent calls merge per child and creation completion never implies child completion',()=>{
 const turn={turnId:'t',status:'inProgress',items:[spawn]};
 const initial=messagesOf({turns:[turn]})[0];assert.equal(initial.type,'subagentProgress');assert.equal(initial.agents.length,2);assert.deepEqual(initial.agents.map(agent=>agent.status),['running','pendingInit']);
 assert.equal(initial.agents[0].name,'审查员');assert.equal(initial.agents[0].task,'检查改动');
 const items=[spawn,{id:'wait',type:'collabAgentToolCall',tool:'wait',status:'completed',receiverThreadIds:['a','b'],agentsStates:{a:{status:'completed',message:'没有发现问题'},b:{status:'errored',message:'无法读取文件'}}}];
 const done=messagesOf({turns:[{...turn,items}]}).filter(m=>m.type==='subagentProgress');assert.equal(done.length,1);assert.equal(done[0].id,initial.id);assert.deepEqual(done[0].agents.map(agent=>agent.status),['completed','errored']);assert.equal(done[0].agents[0].result,'没有发现问题');
 const waitOnly={type:'collabAgentToolCall',tool:'wait',status:'completed',receiverThreadIds:['a']};
 assert.equal(messagesOf({turns:[{...turn,items:[spawn,waitOnly]}]})[0].agents[0].status,'running');
 const failedSend={type:'collabAgentToolCall',tool:'sendInput',status:'failed',receiverThreadIds:['a']};
 const failed=messagesOf({turns:[{...turn,items:[spawn,failedSend]}]})[0].agents[0];assert.equal(failed.status,'running');assert.equal(failed.actionError,'发送指令失败');
 const missing=subagentMessage(turn,[{type:'collabAgentToolCall',tool:'spawnAgent',status:'failed'}],'t');assert.equal(missing.agents.length,0);assert.equal(missing.errors[0].text,'创建子代理失败');
});

test('activity updates, resume, shutdown and historical turns retain accurate per-agent state',()=>{
 const first={turnId:'one',status:'completed',items:[spawn,{type:'subAgentActivity',agentThreadId:'a',agentPath:'root/check_files',kind:'completed'}]};
 const second={turnId:'two',status:'inProgress',items:[{type:'collabAgentToolCall',tool:'resumeAgent',status:'completed',receiverThreadIds:['a']},{type:'subAgentActivity',agentThreadId:'a',kind:'interrupted'}]};
 const messages=messagesOf({turns:[first,second]}).filter(m=>m.type==='subagentProgress');assert.equal(messages.length,2);assert.equal(messages[0].agents[0].status,'completed');assert.equal(messages[1].agents[0].status,'interrupted');assert.equal(messages[1].agents[0].name,'check files');assert.equal(messages[1].agents[0].task,'检查改动');
 const closed=messagesOf({turns:[{turnId:'t',items:[spawn,{type:'collabAgentToolCall',tool:'closeAgent',status:'completed',receiverThreadIds:['a']}]}]})[0];assert.equal(closed.agents[0].status,'shutdown');
 const state={turns:[{turnId:'t',status:'inProgress',items:[spawn]}]};
 const updated=applyChange(state,1,{type:'patch',baseRevision:1,revision:2,patches:[{op:'replace',path:'/turns/0/items/0/agentsStates/a/status',value:'completed'}]}).state;
 assert.equal(messagesOf(updated)[0].agents[0].status,'completed');assert.equal(messagesOf(state)[0].agents[0].status,'running');
 const items=[spawn,{id:'end',type:'subAgentActivity',agentThreadId:'a',kind:'completed'}];
 const canonical={turnHistory:{history:{entitiesByKey:{t:{turnId:'t',status:'inProgress',items:{entitiesByKey:{end:items[1],spawn:items[0]},islands:[{entries:[{value:'spawn'},{value:'end'}]}]}}}}}};
 assert.equal(messagesOf(canonical)[0].agents[0].status,'completed');
});
