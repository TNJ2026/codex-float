import test from 'node:test';
import assert from 'node:assert/strict';
import {permissionPreset} from '../src/permissions.js';

test('permission labels prefer next-turn settings and retain custom policies',()=>{
 const currentPermissions={approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}};
 assert.equal(permissionPreset({currentPermissions}),'full-access');
 const latestThreadSettings={approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly'},activePermissionProfile:null};
 assert.equal(permissionPreset({currentPermissions,latestThreadSettings}),'auto');
 assert.equal(permissionPreset({latestThreadSettings:{approvalPolicy:'on-request',sandboxPolicy:{type:'workspaceWrite',networkAccess:false}}}),'auto');
 for(const change of [{approvalPolicy:'untrusted'},{approvalsReviewer:'unrecognized_reviewer'},{activePermissionProfile:{id:'custom-profile'}}]){
  assert.equal(permissionPreset({latestThreadSettings:{...latestThreadSettings,...change}}),'');
 }
 assert.equal(permissionPreset(null),'');
});

test('named permission profiles override stale legacy sandbox fields',()=>{
 const latestThreadSettings={
  permissions:':danger-full-access',activePermissionProfile:{id:':read-only'},
  approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'dangerFullAccess'}
 };
 assert.equal(permissionPreset({latestThreadSettings}),'auto');
 assert.equal(permissionPreset({latestThreadSettings:{...latestThreadSettings,
  permissions:':workspace',activePermissionProfile:{id:':workspace'},
  sandboxPolicy:{type:'workspaceWrite',networkAccess:true}}}),'auto');
 assert.equal(permissionPreset({latestThreadSettings:{...latestThreadSettings,
  activePermissionProfile:{id:'custom-profile'}}}),'');
});

test('pending named profiles take precedence over current-turn permissions',()=>{
 assert.equal(permissionPreset({
  currentPermissions:{activePermissionProfile:{id:':danger-full-access'},approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}},
  latestThreadSettings:{permissions:':read-only',approvalPolicy:'on-request',approvalsReviewer:'user'}
 }),'auto');
});

test('guardian approvals use the workspace profile and remain distinct from user approval',()=>{
 for(const approvalsReviewer of ['guardian_subagent','auto_review']){
  assert.equal(permissionPreset({latestThreadSettings:{permissions:':workspace',approvalPolicy:'on-request',approvalsReviewer}}),'guardian-approvals');
 }
 assert.equal(permissionPreset({latestThreadSettings:{permissions:':workspace',approvalPolicy:'on-request',approvalsReviewer:'user'}}),'auto');
 assert.equal(permissionPreset({latestThreadSettings:{permissions:':danger-full-access',approvalPolicy:'never',approvalsReviewer:'guardian_subagent'}}),'');
});
