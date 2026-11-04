import React from 'react';
import {Users,LoaderCircle,Check,Circle,AlertCircle,Pause,ChevronRight,ExternalLink} from 'lucide-react';
import {subagentFinished,subagentStatusLabels,subagentWorking} from './subagents';
import {modelDisplayName} from './model';
import {useLinkAction} from './LinkPreview';
import {Markdown} from './Markdown';
import {SubagentActions} from './SubagentActions';

export function SubagentProgress({agents=[],errors=[],turnStatus}){
 const openLink=useLinkAction(),live=turnStatus==='inProgress',finished=agents.filter(agent=>subagentFinished(agent.status)).length;
 return <details className="task-details subagent-progress" open>
  <summary><Users size={14}/><strong>子代理进度</strong><span>{finished}/{agents.length} 已结束</span><ChevronRight size={13} className="task-details-chevron"/></summary>
  <div className="task-details-body">
   <ul className="subagent-list" aria-label="子代理列表">{agents.map(agent=>{
    const working=subagentWorking(agent.status),running=working&&live,failed=['errored','notFound'].includes(agent.status);
    const Icon=running?LoaderCircle:failed?AlertCircle:agent.status==='completed'?Check:['interrupted','shutdown'].includes(agent.status)?Pause:Circle;
    const link=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(agent.threadId)?`codex://threads/${agent.threadId.toLowerCase()}`:null;
    return <li key={agent.threadId} data-agent-status={agent.status} data-running={running||undefined}>
     <div className="subagent-heading"><Icon size={13} className={running?'spin':''} aria-hidden="true"/><strong title={agent.threadId}>{agent.name}</strong><small>{working&&!live?'状态待确认':subagentStatusLabels[agent.status]||'状态未知'}</small>{link&&<button type="button" className="icon-button" aria-label={`打开子代理对话 ${agent.name}`} title="在 Codex 主窗口打开子代理对话" onClick={()=>openLink(link)}><ExternalLink size={12}/></button>}</div>
     {(agent.role||agent.model)&&<p className="subagent-meta">{[agent.role,modelDisplayName(agent.model)].filter(Boolean).join(' · ')}</p>}
     {agent.task&&<p className="subagent-task">{agent.task}</p>}
     <SubagentActions agent={agent}/>
     {agent.actionError&&<p className="subagent-error" role="status">{agent.actionError}</p>}
     {agent.result&&<details className="subagent-result"><summary>{failed?'查看错误':'查看最新结果'}</summary><Markdown text={agent.result}/></details>}
    </li>;
   })}</ul>
   {errors.map(error=><p key={error.id} className="subagent-error" role="status">{error.text}</p>)}
   {!live&&agents.some(agent=>subagentWorking(agent.status))&&<p className="subagent-meta">本轮已结束，部分子代理未返回最终状态。</p>}
  </div>
 </details>;
}
