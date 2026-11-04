export function forkSettingsOf(state){
 const effective={...state?.currentPermissions,...state?.latestThreadSettings},result={};
 for(const key of ['approvalPolicy','approvalsReviewer','sandboxPolicy','permissions','activePermissionProfile','serviceTier'])if(effective[key]!=null)result[key]=effective[key];
 result.cwd=state?.cwd||effective.cwd;result.model=state?.latestModel;result.reasoningEffort=state?.latestReasoningEffort;
 result.collaborationMode=state?.latestCollaborationMode;
 if(result.serviceTier==null&&state?.latestServiceTier!=null)result.serviceTier=state.latestServiceTier;
 return result;
}
