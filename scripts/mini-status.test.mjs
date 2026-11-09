import test from 'node:test';
import assert from 'node:assert/strict';
import {miniStatus} from '../src/mini-status.js';
const completed={turns:[{status:'completed',items:[{type:'commandExecution',status:'inProgress'}]}]};
test('completed history does not retain stale tool status',()=>{
 assert.equal(miniStatus(completed,'live').kind,'completed');
 assert.equal(miniStatus({turns:[]},'live').kind,'idle');
});
test('pending submission and active tasks override old completed history',()=>{
 assert.equal(miniStatus(completed,'live',true).kind,'working');
 assert.equal(miniStatus({threadRuntimeStatus:{type:'active'}},'live').kind,'working');
 assert.equal(miniStatus({...completed,resumeState:'needs_resume',threadRuntimeStatus:{type:'active'}},'live').kind,'working');
 assert.equal(miniStatus({...completed,unconfirmedTurnSubmissions:[{terminal:false}]},'live').kind,'working');
 assert.equal(miniStatus({...completed,unconfirmedTurnSubmissions:[{terminal:true}]},'live').kind,'completed');
});

test('stale inProgress history and runtime flags cannot keep the ball spinning after the latest turn ends',()=>{
 const stale={turnId:'old',status:'inProgress',items:[{type:'commandExecution',status:'inProgress'}]};
 for(const [status,kind] of [['completed','completed'],['failed','failed'],['interrupted','stopped']]){
  const latest={turnId:'latest',status,items:[]};
  const state={resumeState:'resumed',threadRuntimeStatus:{type:'active'},turns:[stale,latest]};
  assert.equal(miniStatus(state,'live').kind,kind);
  const canonical={...state,turns:[],turnHistory:{history:{entitiesByKey:{old:stale,latest},islands:[{entries:[{value:'old'},{value:'latest'}]}]}}};
  assert.equal(miniStatus(canonical,'live').kind,kind);
 }
 assert.equal(miniStatus({turns:[stale,{turnId:'current',status:'inProgress',items:[]}]},'live').kind,'working');
});
test('waiting, errors and disconnection cannot masquerade as completion',()=>{
 assert.equal(miniStatus({...completed,requests:[{}]},'live').kind,'waiting');
 assert.equal(miniStatus(completed,'offline').kind,'offline');
 assert.equal(miniStatus(completed,'connecting').kind,'connecting');
 assert.equal(miniStatus(null,'live').kind,'offline');
 for(const [status,kind] of [['failed','failed'],['interrupted','stopped']])assert.equal(miniStatus({turns:[{status}]},'live').kind,kind);
});
