import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupThreads} from '../src/thread-groups.js';

test('groups use project identity, preserve recency inside each project and put unassigned last',()=>{
 const threads=[
  {id:'free'},
  {id:'b-new',project_id:'b',project_name:'项目',project_order:1},
  {id:'a',project_id:'a',project_name:'项目',project_order:0},
  {id:'b-old',project_id:'b',project_name:'项目',project_order:1}
 ];
 const groups=groupThreads(threads);
 assert.deepEqual(groups.map(g=>g.key),['project:a','project:b','unassigned']);
 assert.deepEqual(groups[1].threads.map(t=>t.id),['b-new','b-old']);
 assert.deepEqual(groups.flatMap(g=>g.threads).map(t=>t.id).sort(),threads.map(t=>t.id).sort());
 assert.equal(groups[2].name,'未分配项目');
});

test('empty lists remain empty; missing project names do not lose membership',()=>{
 assert.deepEqual(groupThreads([]),[]);
 const groups=groupThreads([{id:'one',project_id:'known'}]);
 assert.equal(groups[0].name,'未命名项目');
 assert.equal(groups[0].unassigned,false);
});
