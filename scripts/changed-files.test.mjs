import test from 'node:test';
import assert from 'node:assert/strict';
import {changedFilesOf,fileLabel} from '../src/changed-files.js';
import {messagesOf} from '../src/model.js';
const edit=(changes,status='completed')=>({type:'fileChange',status,changes});
const change=(path,type='update',move_path)=>({path,kind:{type,move_path}});

test('completed turns deduplicate successful file edits and exclude failed or pending changes',()=>{
 const turn={status:'completed',items:[edit([change('D:\\project\\a.js'),change('D:/project/b.md','add')]),edit([change('d:/project/A.js')]),edit([change('D:/failed')],'failed'),edit([change('D:/pending')],'inProgress')]};
 const files=changedFilesOf(turn);
 assert.equal(files.length,2);
 assert.equal(files.find(f=>f.path.endsWith('A.js')).kind,'update');
 assert.equal(files.find(f=>f.path.endsWith('b.md')).kind,'add');
 assert.equal(changedFilesOf(turn),files);
 for(const status of ['inProgress','interrupted','failed'])assert.deepEqual(changedFilesOf({...turn,status}),[]);
});
test('combine adds, deletes and renames into one list without temporary files',()=>{
 const turn={status:'completed',items:[edit([
  change('temporary.txt','add'),change('temporary.txt','delete'),
  change('new.txt','add'),change('new.txt'),
  change('old.txt','update','moved.txt'),change('moved.txt'),
  change('removed.txt','delete'),change('replaced.txt','delete'),change('replaced.txt','add')
 ])]};
 assert.deepEqual(changedFilesOf(turn),[
  {path:'moved.txt',kind:'rename',previousPath:'old.txt'},
  {path:'new.txt',kind:'add'},
  {path:'removed.txt',kind:'delete'},
  {path:'replaced.txt',kind:'update'}
 ]);
});
test('file summaries follow each completed turn and omit empty turns across canonical history',()=>{
 const first={turnId:'one',status:'completed',params:{cwd:'D:/project'},items:{entitiesByKey:{edit:edit([change('D:/project/a.js')]),answer:{id:'answer',type:'agentMessage',text:'完成'}}}};
 const second={turnId:'two',status:'completed',items:[{id:'next',type:'agentMessage',text:'没有修改'}]};
 const state={turnHistory:{history:{entitiesByKey:{first,second},islands:[{entries:[{value:'first'},{value:'second'}]}]}}};
 const messages=messagesOf(state);
 assert.deepEqual(messages.map(m=>m.id),['answer','changed-files:one','next']);
 assert.equal(messages[1].type,'changedFiles');
 assert.equal(messages[1].cwd,'D:/project');
 assert.deepEqual(fileLabel('D:\\project\\src\\a.js','d:/project'),{name:'a.js',relative:'src/a.js'});
 assert.equal(fileLabel('D:/project-extra/a.js','D:/project').relative,'D:/project-extra/a.js');
});
