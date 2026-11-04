import test from 'node:test';
import assert from 'node:assert/strict';
import {effortForModel,effortIndex,effortLabel,withModelSettings} from '../src/model-settings.js';

test('model changes preserve supported effort and fall back only to supported defaults',()=>{
 const model={defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]};
 assert.equal(effortForModel(model,'high'),'high');assert.equal(effortForModel(model,'ultra'),'medium');
 assert.equal(effortForModel({...model,defaultReasoningEffort:'unknown'},'low'),'medium');
 assert.equal(effortForModel({supportedReasoningEfforts:[]},'high'),'');
 assert.equal(effortLabel('xhigh'),'很高');assert.equal(effortLabel(null),'默认');
 assert.equal(effortIndex(model,null),0);assert.equal(effortIndex(model,'high'),1);assert.equal(effortIndex(model,'unsupported'),0);
});
test('confirmed settings update the model display without altering permissions, speed or transcript',()=>{
 const history=[{status:'completed'}],permissions={id:'custom'};
 const state={turns:history,latestModel:'old',latestReasoningEffort:'low',latestThreadSettings:{model:'old',effort:'low',cwd:'C:/project',serviceTier:'priority',activePermissionProfile:permissions},latestCollaborationMode:{mode:'plan',settings:{model:'old',reasoning_effort:'low',developer_instructions:'keep'}}};
 const next=withModelSettings(state,{model:'new',reasoningEffort:'high'});
 assert.equal(next.latestModel,'new');assert.equal(next.latestThreadSettings.effort,'high');
 assert.equal(next.turns,history);assert.equal(next.latestThreadSettings.activePermissionProfile,permissions);assert.equal(next.latestThreadSettings.serviceTier,'priority');
 assert.deepEqual(next.latestCollaborationMode,{mode:'plan',settings:{model:'new',reasoning_effort:'high',developer_instructions:'keep'}});
 assert.equal(state.latestModel,'old');assert.equal(withModelSettings(state,{model:'new',reasoningEffort:null}).latestThreadSettings.effort,null);
});
