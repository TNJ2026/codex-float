import test from 'node:test';
import assert from 'node:assert/strict';
import {activityOf} from '../src/model.js';

const state = (items, extra = {}) => ({turns:[{status:'inProgress',items,...extra}]});
test('idle and finished turns never retain a running tool indicator', () => {
  assert.equal(activityOf(null), null);
  assert.equal(activityOf({turns:[{status:'completed',items:[{type:'commandExecution',status:'inProgress'}]}]}), null);
});
test('active turn without explicit running tools uses an honest fallback', () => {
  for (const items of [[], [{type:'reasoning'}], [{type:'commandExecution',status:'completed'}], [{type:'mcpToolCall',status:'failed'}]]) {
    assert.equal(activityOf(state(items)).label, '思考');
  }
  assert.equal(activityOf({threadRuntimeStatus:{type:'active'}}).kind, 'thinking');
});
test('tools are recognized independently of later messages, including concurrent tools', () => {
  const result=activityOf(state([{id:'a',type:'commandExecution',status:'inProgress'}, {id:'b',type:'mcpToolCall',status:'inProgress',tool:'search'}, {type:'agentMessage'}]));
  assert.equal(result.kind, 'tool');
  assert.equal(result.label, '正在调用工具');
  assert.equal(result.toolTitle, 'search');
  assert.equal(activityOf(state([{type:'fileChange',status:'inProgress'}])).label, '正在修改文件');
});
test('canonical history, completion markers and approval take precedence', () => {
  const turn={status:'inProgress',completedItemIds:['a'],items:{entitiesByKey:{a:{id:'a',type:'commandExecution',status:'inProgress'}}}};
  const canonical={turnHistory:{history:{entitiesByKey:{turn},islands:[{entries:[{value:'turn'}]}]}}};
  assert.equal(activityOf(canonical).kind, 'thinking');
  turn.completedItemIds={a:true};
  assert.equal(activityOf(canonical).kind, 'thinking');
  turn.completedItemIds={a:false};
  assert.equal(activityOf(canonical).kind, 'tool');
  assert.equal(activityOf({...canonical,requests:[{type:'approval'}]}).kind, 'waiting');
});

test('latest invocation title replaces older tools and does not revert when it completes', () => {
  const older={id:'old',type:'mcpToolCall',status:'inProgress',tool:'old_tool',arguments:{title:'旧调用'}};
  const latest={id:'new',type:'dynamicToolCall',status:'inProgress',tool:'new_tool',arguments:JSON.stringify({title:'读取\n  最新文件'})};
  assert.equal(activityOf(state([older,latest])).toolTitle, '读取 最新文件');
  latest.status='completed';
  assert.equal(activityOf(state([older,latest],{completedItemIds:['new']})).toolTitle, '读取 最新文件');
  older.status='completed';
  const result=activityOf(state([older,latest]));
  assert.equal(result.kind, 'thinking');
  assert.equal(result.toolTitle, '读取 最新文件');
  assert.equal(activityOf({turns:[{status:'completed',items:[older,latest]}]}), null);
  assert.equal(activityOf({turns:[{status:'completed',items:[latest]},{status:'inProgress',items:[]}]}).toolTitle, undefined);
});

test('tool titles prefer display metadata and fall back to commands and tool names', () => {
  const title=item=>activityOf(state([{type:'mcpToolCall',status:'inProgress',...item}])).toolTitle;
  assert.equal(title({title:'显示标题',toolTitle:'工具标题',arguments:{title:'参数标题'},tool:'raw'}), '显示标题');
  assert.equal(title({toolTitle:'工具标题',tool:'raw'}), '工具标题');
  assert.equal(title({type:'commandExecution',command:'rg --files'}), 'rg --files');
  assert.equal(title({arguments:'invalid JSON',tool:'raw'}), 'raw');
  assert.equal(title({tool:'   '}), '正在调用工具');
});

test('latest title follows canonical item ordering rather than entity insertion order', () => {
  const old={id:'old',type:'mcpToolCall',status:'inProgress',tool:'old'};
  const latest={id:'latest',type:'mcpToolCall',status:'completed',tool:'latest'};
  const items={entitiesByKey:{latest,old},islands:[{entries:[{value:'old'},{value:'latest'}]}]};
  assert.equal(activityOf(state(items)).toolTitle, 'latest');
});

test('unfinished context compaction is shown ahead of tools, but approvals take precedence', () => {
  const live=state([{id:'c',type:'contextCompaction',completed:false}, {type:'commandExecution',status:'inProgress'}]);
  assert.deepEqual(activityOf(live), {kind:'compacting',label:'正在压缩上下文'});
  assert.equal(activityOf({...live,requests:[{type:'approval'}]}).kind, 'waiting');
});
test('finished, historical and uncertain compaction cannot leave a stale indicator', () => {
  for (const item of [{type:'contextCompaction',completed:true}, {type:'contextCompaction'}]) {
    assert.equal(activityOf(state([item])).kind, 'thinking');
  }
  for (const completedItemIds of [['c'], {c:true}]) {
    assert.equal(activityOf(state([{id:'c',type:'contextCompaction',completed:false}], {completedItemIds})).kind, 'thinking');
  }
  const historical={status:'completed',items:[{type:'contextCompaction',completed:false}]};
  assert.equal(activityOf({turns:[historical]}), null);
  assert.equal(activityOf({turns:[historical,{status:'inProgress',items:[]}]}).kind, 'thinking');
});
test('compaction completion patches switch back to the current activity', async () => {
  const {applyChange}=await import('../src/model.js');
  const before=state([{id:'c',type:'contextCompaction',completed:false}]);
  assert.equal(activityOf(before).kind, 'compacting');
  const after=applyChange(before,1,{baseRevision:1,revision:2,patches:[{op:'replace',path:['turns',0,'items',0,'completed'],value:true}]}).state;
  assert.equal(activityOf(after).kind, 'thinking');
  assert.equal(activityOf(before).kind, 'compacting');
});
