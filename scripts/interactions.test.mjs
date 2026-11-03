import test from 'node:test';
import assert from 'node:assert/strict';
import {describeInteraction,buildInteractionReply,initialValues,formFields,interactionMethods} from '../src/interactions.js';
const card=(kind,params={},extra={})=>describeInteraction({id:12,method:interactionMethods[kind],params,...extra});

test('approval buttons honor available decisions and never grant access without an explicit decision',()=>{
 const approval=card('command',{command:'echo hello',availableDecisions:['accept','decline']});
 assert.equal(approval.details.命令,'echo hello');
 assert.deepEqual(buildInteractionReply(approval,{},'decline').payload,{decision:'decline'});
 assert.throws(()=>buildInteractionReply(approval));
 assert.throws(()=>buildInteractionReply(approval,{},'acceptForSession'));
 assert.equal(card('file').kind,'unsupported');
 assert.equal(card('file',{}, {fileChanges:[{path:'a.txt',diff:'change'}]}).kind,'file');
});
test('permissions responses only grant requested permissions for the current turn',()=>{
 const permissions={network:{enabled:true},fileSystem:{read:['D:/demo']}};
 const approval=card('permissions',{permissions});
 assert.deepEqual(buildInteractionReply(approval,{},'accept').payload.response,{permissions,scope:'turn'});
 assert.deepEqual(buildInteractionReply(approval,{},'decline').payload.response,{permissions:{},scope:'turn'});
});
test('question replies preserve question identity, require answers and mask secret summaries',()=>{
 const questions=card('questions',{questions:[{id:'choice',header:'方向',question:'请选择',options:[{label:'A',description:'first'}]},{id:'secret',header:'口令',question:'输入',isSecret:true}]});
 assert.throws(()=>buildInteractionReply(questions,{choice:'A'}));
 assert.throws(()=>buildInteractionReply(questions,{choice:'unknown',secret:'sensitive'}));
 const answer=buildInteractionReply(questions,{choice:'A',secret:'sensitive'});
 assert.deepEqual(answer.payload.response.answers,{choice:{answers:['A']},secret:{answers:['sensitive']}});
 assert.ok(!answer.summary.includes('sensitive'));
 assert.match(answer.summary,/已填写/);
});
test('MCP form supports typed fields, defaults, enums and multi-select with bounds',()=>{
 const form=card('form',{mode:'form',serverName:'demo',requestedSchema:{type:'object',required:['count','confirm','choices'],properties:{count:{type:'integer',minimum:1,maximum:3,default:2},confirm:{type:'boolean'},choices:{type:'array',items:{type:'string',enum:['x','y']},minItems:1,maxItems:2},name:{type:'string',minLength:2}}}});
 assert.equal(form.kind,'form');
 assert.deepEqual(initialValues(form),{count:2});
 const values={count:'2',confirm:false,choices:['x'],name:'ok'};
 assert.deepEqual(buildInteractionReply(form,values).payload.response,{action:'accept',content:{count:2,confirm:false,choices:['x'],name:'ok'}});
 for(const invalid of [{...values,count:0},{...values,count:1.5},{...values,choices:[]},{...values,choices:['unknown']},{...values,name:'a'}])assert.throws(()=>buildInteractionReply(form,invalid));
 assert.deepEqual(buildInteractionReply(form,{},'decline').payload.response,{action:'decline',content:null});
});
test('external authentication, unsupported methods and complex schemas remain visible but cannot submit',()=>{
 for(const mode of ['url','openai/userVerification']){
  const request=card('form',{mode});
  assert.equal(request.kind,'unsupported');
  assert.throws(()=>buildInteractionReply(request));
 }
 assert.equal(describeInteraction({method:'item/tool/requestOptionPicker'}).kind,'unsupported');
 assert.equal(formFields({type:'object',properties:{nested:{type:'object'}}}),null);
 assert.equal(formFields({type:'object',properties:{pattern:{type:'string',pattern:'^x'}}}),null);
});
