import test from 'node:test';
import assert from 'node:assert/strict';
import {activeTurnId,turnIsRunning} from '../src/stop-task.js';
test('stopping targets an active task and never carries over to its successor',()=>{
 const state={turns:[{turnId:'a',status:'completed'},{turnId:'b',status:'inProgress'}]};
 assert.equal(activeTurnId(state),'b');
 assert.equal(turnIsRunning(state,'a'),false);
 const next={turns:[{turnId:'b',status:'interrupted'},{turnId:'c',status:'inProgress'}]};
 assert.equal(turnIsRunning(next,'b'),false);
 assert.equal(activeTurnId(next),'c');
 assert.equal(activeTurnId(null),null);
 assert.equal(activeTurnId({threadRuntimeStatus:{type:'active'}}),null);
});
test('canonical history and fallback identifiers work for task stopping',()=>{
 const state={turnHistory:{history:{entitiesByKey:{t:{id:'turn',status:'inProgress'}},islands:[{entries:[{value:'t'}]}]}}};
 assert.equal(activeTurnId(state),'turn');
 assert.equal(turnIsRunning(state,'turn'),true);
});

test('historical unfinished turns are never offered as the current stop target',()=>{
 const state={turns:[{turnId:'old',status:'inProgress'},{turnId:'latest',status:'completed'}]};
 assert.equal(activeTurnId(state),null);
 assert.equal(turnIsRunning(state,'old'),false);
 assert.equal(activeTurnId({turns:[state.turns[0]],resumeState:'needs_resume'}),null);
});
