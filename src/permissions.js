export const permissionOptions=[
 {id:'read-only',label:'只读',description:'可读取文件；修改文件或执行受限操作时请求批准。'},
 {id:'auto',label:'默认权限',description:'可修改工作目录中的文件；访问外部目录或网络时请求批准。'},
 {id:'full-access',label:'完全访问',description:'可访问所有文件和网络，执行操作无需批准。'},
];
export function permissionPreset(state){
 const settings=state?.latestThreadSettings||{},current=state?.currentPermissions||{};
 const profile=settings.activePermissionProfile===undefined?current.activePermissionProfile:settings.activePermissionProfile;
 const id=settings.permissions??profile?.id;
 const sandbox=settings.sandboxPolicy??current.sandboxPolicy;
 const approval=settings.approvalPolicy??current.approvalPolicy;
 const reviewer=settings.approvalsReviewer??current.approvalsReviewer;
 if(reviewer&&reviewer!=='user')return '';
 if(id&&![':read-only',':workspace',':danger-full-access'].includes(id))return '';
 const type=sandbox?.type||({':read-only':'readOnly',':workspace':'workspaceWrite',':danger-full-access':'dangerFullAccess'}[id]);
 if(type==='readOnly'&&approval==='on-request')return 'read-only';
 if(type==='workspaceWrite'&&approval==='on-request'&&!sandbox?.networkAccess)return 'auto';
 if(type==='dangerFullAccess'&&approval==='never')return 'full-access';
 return '';
}
