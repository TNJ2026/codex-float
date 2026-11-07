import {t,useLanguage} from './i18n.js';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Cpu,SlidersHorizontal,Shield,AtSign,ListTodo,Play,Archive,Info,RefreshCw,X,Zap} from 'lucide-react';
import {slashRows} from './slash-commands';
import {PreviewDialog} from './PreviewDialog';
import {modelDisplayName} from './model';
import {effortLabel} from './model-settings';
import {permissionOptions,permissionPreset} from './permissions';
import {speedLabel} from './speed-settings';

const commandIcons={model:SlidersHorizontal,fast:Zap,permissions:Shield,skills:Cpu,mention:AtSign,plan:ListTodo,agent:Play,compact:Archive,status:Info};

export function SlashMenu({scope,cwd,token,busy,disabled,onClose,onSelect,onRows,onSelectRef,activeIndex}){
 const root=useRef(),generation=useRef(0),[catalog,setCatalog]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{generation.current++;setCatalog(null);setError('');setLoading(false);},[scope,cwd]);
 useEffect(()=>{
  if(!token||catalog)return;
  const id=++generation.current;setLoading(true);setError('');
  invoke('context_catalog',{cwd:cwd||''}).then(value=>{if(id===generation.current)setCatalog(value);}).catch(error=>{if(id===generation.current)setError(String(error));}).finally(()=>{if(id===generation.current)setLoading(false);});
  return()=>{if(generation.current===id)generation.current++;};
 },[!!token,scope,cwd,catalog,revision]);
 const language=useLanguage();
 const rows=useMemo(()=>token?slashRows(token.query,catalog?.skills||[],busy):[],[token?.query,!!token,catalog,busy,language]);
 useEffect(()=>{onRows(rows);},[rows,onRows]);
 useEffect(()=>{onSelectRef.current=index=>{const row=rows[index];if(row&&!row.disabled&&!disabled)onSelect(row);};return()=>{onSelectRef.current=null;};},[rows,onSelect,onSelectRef,disabled]);
 useEffect(()=>{root.current?.querySelector(`[data-command-index="${activeIndex}"]`)?.scrollIntoView?.({block:'nearest'});},[activeIndex]);
 useEffect(()=>{
  if(!token)return;
  const update=()=>root.current?.style.setProperty('--context-max-height',`${Math.max(120,root.current.parentElement.getBoundingClientRect().top-50)}px`);
  update();window.addEventListener('resize',update);
  const pointer=event=>{if(!root.current?.contains(event.target)&&!event.target.closest('#prompt-input'))onClose();};
  const key=event=>{if(event.key==='Escape'){event.preventDefault();onClose();}};
  document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);
  return()=>{window.removeEventListener('resize',update);document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};
 },[!!token,onClose]);
 if(!token)return null;
 return <div ref={root} className="context-picker slash-menu" role="dialog" aria-label={t("斜杠命令和技能")}>
  <div className="context-picker-heading"><strong>{t("命令与技能")}</strong><button type="button" aria-label={t("刷新技能")} disabled={loading} onClick={()=>{setCatalog(null);setRevision(value=>value+1);}}><RefreshCw size={13} className={loading?'spin':''}/></button><button type="button" aria-label={t("关闭命令菜单")} onClick={onClose}><X size={14}/></button></div>
  <div className="context-results" id="slash-suggestions" role="listbox" aria-label={t("命令候选项")}>{rows.map((row,index)=>{const Icon=row.kind==='skill'?Cpu:commandIcons[row.id]||Info;return <button type="button" role="option" id={`slash-option-${index}`} aria-selected={index===activeIndex} aria-disabled={row.disabled||disabled} data-command-index={index} key={`${row.kind}:${row.skill?.path||row.id}`} disabled={row.disabled||disabled} onClick={()=>onSelect(row)}><Icon size={14}/><span><strong>/{row.id}<b>{row.kind==='command'?t(row.title):''}</b></strong><small>{row.disabled?t("任务结束后可用"):(row.kind==='command'?t(row.description):row.description)}</small></span><em>{row.kind==='skill'?t("技能"):t("命令")}</em></button>;})}</div>
  {loading&&<p className="context-note" role="status">{t("正在读取技能…")}</p>}
  {error&&<p className="context-error" role="alert">{t(error)}</p>}
  {catalog?.warnings?.map(warning=><p className="context-note" key={warning}>{warning}</p>)}
  {!rows.length&&!loading&&<p className="context-note">{t("没有匹配的命令或技能。")}</p>}
  <p className="context-note">{t("↑↓ 选择 · Enter / Tab 确认 · Esc 关闭")}</p>
 </div>;
}

export function ChatStatus({conversation,names,onClose}){
 useLanguage();
 const permission=permissionOptions.find(option=>option.id===permissionPreset(conversation))?.label||t("自定义权限");
 return <PreviewDialog title={t("聊天状态")} onClose={onClose}><dl className="chat-status">{[
  [t("聊天 ID"),conversation?.id],[t("模型"),modelDisplayName(conversation?.latestModel,names)],[t("推理强度"),effortLabel(conversation?.latestReasoningEffort)],[t("权限"),permission],[t("模式"),conversation?.latestCollaborationMode?.mode==='plan'?t("计划模式"):t("执行模式")],[t("工作目录"),conversation?.cwd||conversation?.latestThreadSettings?.cwd],[t("速度"),speedLabel(conversation?.latestThreadSettings?.serviceTier)],
 ].map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd>{value||t("暂无信息")}</dd></React.Fragment>)}</dl></PreviewDialog>;
}
