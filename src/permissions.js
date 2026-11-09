export const permissionOptions=[
 {id:'auto',label:'请求批准',description:'编辑外部文件和使用互联网时始终询问'},
 {id:'guardian-approvals',label:'帮我批准',description:'仅对检测到的风险操作请求批准'},
 {id:'full-access',label:'完全访问权限',shortLabel:'完全访问',description:'可不受限制地访问互联网和你电脑上的任何文件'},
];
export function permissionPreset(state){
 const settings=state?.latestThreadSettings||{},current=state?.currentPermissions||{};
 const profile=settings.activePermissionProfile===undefined?current.activePermissionProfile:settings.activePermissionProfile;
 const id=settings.activePermissionProfile?.id??settings.permissions??profile?.id;
 const sandbox=settings.sandboxPolicy??current.sandboxPolicy;
 const approval=settings.approvalPolicy??current.approvalPolicy;
 const reviewer=settings.approvalsReviewer??current.approvalsReviewer;
 if(id&&![':read-only',':workspace',':danger-full-access'].includes(id))return '';
 const type=({':read-only':'readOnly',':workspace':'workspaceWrite',':danger-full-access':'dangerFullAccess'}[id])||sandbox?.type;
 if(type==='workspaceWrite'&&approval==='on-request'&&['guardian_subagent','auto_review'].includes(reviewer))return 'guardian-approvals';
 if(reviewer&&reviewer!=='user')return '';
 if(type==='readOnly'&&approval==='on-request')return 'auto';
 if(type==='workspaceWrite'&&approval==='on-request'&&(id===':workspace'||!sandbox?.networkAccess))return 'auto';
 if(type==='dangerFullAccess'&&approval==='never')return 'full-access';
 return '';
}

export function permissionDisplay(state){
 return {
  current:permissionPreset(state),
  execution:state?.currentPermissions?permissionPreset({currentPermissions:state.currentPermissions}):'',
 };
}
