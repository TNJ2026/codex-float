import test from 'node:test';
import assert from 'node:assert/strict';
import {permissionPreset} from '../src/permissions.js';

test('permission labels prefer next-turn settings and retain custom policies',()=>{
 const currentPermissions={approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}};
 assert.equal(permissionPreset({currentPermissions}),'full-access');
 const latestThreadSettings={approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly'},activePermissionProfile:null};
 assert.equal(permissionPreset({currentPermissions,latestThreadSettings}),'read-only');
 assert.equal(permissionPreset({latestThreadSettings:{approvalPolicy:'on-request',sandboxPolicy:{type:'workspaceWrite',networkAccess:false}}}),'auto');
 for(const change of [{approvalPolicy:'untrusted'},{approvalsReviewer:'guardian_subagent'},{activePermissionProfile:{id:'custom-profile'}}]){
  assert.equal(permissionPreset({latestThreadSettings:{...latestThreadSettings,...change}}),'');
 }
 assert.equal(permissionPreset(null),'');
});
