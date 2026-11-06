import React,{useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {ChevronDown,MessageSquare,Zap} from 'lucide-react';
import {popupNativeMenu} from './native-menu';
import {permissionOptions,permissionPreset} from './permissions';
import {effectiveTier,fastTier,isFast,speedLabel} from './speed-settings';
import {groupThreads} from './thread-groups';

function usePicker(props){
 const button=useRef(),latest=useRef(props),generation=useRef(0),locked=useRef(false);
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[loading,setLoading]=useState(false);
 latest.current=props;
 useEffect(()=>{generation.current++;setOpen(false);},[props.threadId]);
 useEffect(()=>()=>{generation.current++;},[]);
 async function run(task){
  if(locked.current||latest.current.disabled)return;
  locked.current=true;const token=++generation.current,target=latest.current.threadId;
  const valid=()=>token===generation.current&&!latest.current.disabled&&target===latest.current.threadId;
  const apply=async(command,args)=>{
   if(!valid())return;
   setSaving(true);latest.current.onSavingChange?.(true);
   try{const result=await invoke(command,{threadId:target,...args});if(valid())latest.current.onApplied?.(target,result.settings||result.threadSettings);}
   finally{setSaving(false);latest.current.onSavingChange?.(false);}
  };
  try{setLoading(true);await task({target,valid,apply,menu:async items=>{
   if(!valid())return;setLoading(false);setOpen(true);
   await popupNativeMenu(button.current,items);
  }});}
  catch(error){if(valid())latest.current.onError?.(String(error.message||error));}
  finally{locked.current=false;setLoading(false);setOpen(false);}
 }
 return {button,open,saving,loading,run};
}
const separator=()=>({item:'Separator'});
const note=text=>({text,enabled:false});

export function NativePermissionPicker(props){
 const {conversation,disabled,openRequest}=props,picker=usePicker(props),selected=permissionPreset(conversation),label=permissionOptions.find(option=>option.id===selected)?.label||'自定义权限';
 async function show(){await picker.run(async({apply,menu})=>{
  let choice=null;
  await menu([...permissionOptions.map(option=>({text:option.label,checked:selected===option.id,action:()=>{choice=option.id;}})),separator(),note('选择后自动保存，下轮生效')]);
  if(choice&&choice!==selected)await apply('update_permission_settings',{preset:choice,cwd:conversation?.cwd||conversation?.latestThreadSettings?.cwd||null});
 });}
 useEffect(()=>{if(openRequest)show();},[openRequest]);
 return <button type="button" ref={picker.button} className="permission-picker-button" data-permission={selected} aria-label="修改权限" aria-haspopup="menu" aria-expanded={picker.open} disabled={disabled||picker.saving} title={`${label} · 点击修改权限`} onClick={show}><span>{picker.saving?'保存中':label}</span><ChevronDown size={10}/></button>;
}

export function NativeSpeedPicker(props){
 const {model,tier,disabled,toggleRequest}=props,picker=usePicker(props),[entry,setEntry]=useState(null);
 const current=effectiveTier(tier,entry?.model===model?entry:null),fast=isFast(current);
 async function show(toggle=false){await picker.run(async({target,valid,apply,menu})=>{
  const result=await invoke('read_model_options',{threadId:target,forceReload:false});if(!valid())return;
  if(result.settings?.model!==model)throw Error('模型已在主 App 变化，请重新同步后设置速度');
  const option=result.models?.find(entry=>entry.model===model)||null;setEntry(option);
  const before=effectiveTier(tier,option);let choice=toggle?!isFast(before):null;
  if(!toggle)await menu([
   {text:'标准速度',checked:['default','standard','auto'].includes(before),action:()=>{choice=false;}},
   {text:'快速模式',checked:isFast(before),enabled:!!fastTier(option),action:()=>{choice=true;}},
   separator(),note(fastTier(option)?'快速模式会更快消耗额度或点数':'当前模型或账号未提供快速档位'),
  ]);
  if(choice===null)return;
  if(choice&&!fastTier(option))throw Error('当前模型未提供快速模式，或账号暂无此档位');
  if((choice&&isFast(before))||(!choice&&['default','standard','auto'].includes(before)))return;
  await apply('update_speed_settings',{model,fast:choice});
 });}
 useEffect(()=>{if(toggleRequest)show(true);},[toggleRequest]);
 return <button type="button" ref={picker.button} className={'speed-picker-button model-speed'+(fast||current==='ultrafast'?' fast':'')} aria-label="切换响应速度" aria-haspopup="menu" aria-expanded={picker.open} disabled={disabled||picker.saving||picker.loading} title={picker.loading?'正在读取速度…':`${speedLabel(current)} · 点击切换响应速度`} onClick={()=>show()}><Zap size={14} fill={fast||current==='ultrafast'?'currentColor':'none'}/></button>;
}

export function NativeThreadPicker({threads,value,disabled,onChange}){
 const button=useRef(),scope=useRef(),[open,setOpen]=useState(false);scope.current={value,disabled,onChange};
 const selected=threads.find(thread=>thread.id===value);
 async function show(){if(open||disabled)return;setOpen(true);const before=value;let choice=null;
  try{await popupNativeMenu(button.current,groupThreads(threads).map(group=>({text:group.name,items:group.threads.map(thread=>({text:thread.thread_name||thread.id,checked:thread.id===value,action:()=>{choice=thread.id;}}))})));if(choice&&choice!==before&&scope.current.value===before&&!scope.current.disabled)scope.current.onChange(choice);}
  finally{setOpen(false);}
 }
 return <div className="thread-picker"><button type="button" id="thread-picker" ref={button} className="thread-selector" aria-label="选择聊天" aria-haspopup="menu" aria-expanded={open} disabled={disabled||!threads.length} onClick={show}><MessageSquare size={16}/><span className="thread-selection" title={selected?.thread_name||value}>{selected?.thread_name||value||'暂无聊天'}</span><ChevronDown size={12}/></button></div>;
}
