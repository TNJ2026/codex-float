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
 assert.equal(miniStatus({...completed,threadRuntimeStatus:{type:'active'}},'live').kind,'working');
 assert.equal(miniStatus({...completed,unconfirmedTurnSubmissions:[{terminal:false}]},'live').kind,'working');
 assert.equal(miniStatus({...completed,unconfirmedTurnSubmissions:[{terminal:true}]},'live').kind,'completed');
});
test('waiting, errors and disconnection cannot masquerade as completion',()=>{
 assert.equal(miniStatus({...completed,requests:[{}]},'live').kind,'waiting');
 assert.equal(miniStatus(completed,'offline').kind,'offline');
 assert.equal(miniStatus(completed,'connecting').kind,'connecting');
 assert.equal(miniStatus(null,'live').kind,'offline');
 for(const [status,kind] of [['failed','failed'],['interrupted','stopped']])assert.equal(miniStatus({turns:[{status}]},'live').kind,kind);
});
