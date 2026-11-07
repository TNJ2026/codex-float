import {t,useLanguage} from './i18n.js';
import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {PreviewDialog} from './PreviewDialog';
import {messagesOf,turnsOf} from './model';
import {orderedItems} from './task-details';
import {displayCommand,toolDetailItem,toolSections} from './tool-details';
import {Markdown} from './Markdown';

export const SubagentActionsContext=createContext({parentId:'',enabled:false});
export function SubagentActions({agent}){
 useLanguage();
 const context=useContext(SubagentActionsContext),[open,setOpen]=useState(false);
 const [scope,setScope]=useState('');
 const valid=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(agent.threadId);
 return context.enabled&&valid?<><button type="button" className="subagent-manage" onClick={()=>{setScope(context.parentId);setOpen(true);}}>{t("查看并操作")}</button>{open&&scope===context.parentId&&<AgentDialog key={scope+agent.threadId} parentId={scope} agent={agent} onClose={()=>setOpen(false)}/>}</>:null;
}
function AgentDialog({parentId,agent,onClose}){
 useLanguage();
 const [state,setState]=useState(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const active=useRef(true),lock=useRef(false),revision=useRef(0);
 const args={parentId,childId:agent.threadId};
 async function request(action){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  const turn=turnsOf(state).at(-1),submitted=text;let accepted=false;
  try{
   const result=await invoke('subagent_action',{...args,action,text:action==='send'?submitted:null,expectedTurnId:turn?.turnId||turn?.id||null});
   if(!active.current)return;
   if(action==='inspect'){setState(result.state);revision.current++;}
   else {accepted=true;if(action==='send')setText(current=>current===submitted?'':current);setNotice(action==='stop'?t("停止请求已发送，等待状态刷新确认。"):t("指令已发送，等待子代理处理。"));const next=await invoke('subagent_action',{...args,action:'inspect'});if(active.current)setState(next.state);}
  }catch(reason){if(active.current)setError((accepted?t("操作已提交，但刷新失败，请刷新确认，勿重复发送："):'')+String(reason));}
  finally{lock.current=false;if(active.current)setBusy(false);}
 }
 const refresh=useRef(request);refresh.current=request;
 useEffect(()=>{active.current=true;refresh.current('inspect');const timer=setInterval(()=>refresh.current('inspect'),4000);return()=>{active.current=false;clearInterval(timer);};},[]);
 const turns=turnsOf(state),turn=turns.at(-1),running=turn?.status==='inProgress';
 const messages=messagesOf(state).filter(message=>!message.type&&message.text);
 const tools=turns.flatMap(turn=>orderedItems(turn).filter(toolDetailItem));
 return <PreviewDialog title={t("子代理：{0}",[agent.name])} className="subagent-dialog" onClose={onClose}>
  <div className="subagent-controls"><span>{!state?t("正在读取状态…"):running?t("运行中"):turn?.status==='completed'?t("已完成"):turn?.status||t("暂无轮次")}</span><button type="button" disabled={busy} onClick={()=>request('inspect')}>{t("刷新")}</button><button type="button" disabled={busy||!running} onClick={()=>request('stop')}>{t("停止此子代理")}</button></div>
  {error&&<p role="alert" className="subagent-error">{t(error)}</p>}{notice&&<p role="status" className="subagent-meta">{t(notice)}</p>}
  <form className="snippet-form" onSubmit={event=>{event.preventDefault();request('send');}}><label>{t("发送指令")}<textarea aria-label={t("子代理指令")} value={text} maxLength={25000} onChange={event=>setText(event.target.value)} placeholder={running?t("追加或调整任务…"):t("输入后启动下一轮任务…")}/></label><button type="submit" disabled={busy||!turn||!text.trim()}>{running?t("追加指令"):t("发送并继续")}</button></form>
  <details className="subagent-log" open><summary>{t("对话记录（")}{messages.length}）</summary>{messages.map(message=><div key={message.id}><small>{message.role==='user'?t("指令"):t("子代理")}</small><Markdown text={message.text}/></div>)}</details>
  <details className="subagent-log"><summary>{t("工具记录（")}{tools.length}）</summary>{tools.map((item,index)=><details key={item.id||index}><summary>{displayCommand(item.command)||item.tool||item.type} · {item.status}</summary>{toolSections(item).map(section=><div key={t(section.label)}><strong>{t(section.label)}</strong><pre>{section.text}</pre></div>)}</details>)}</details>
 </PreviewDialog>;
}
