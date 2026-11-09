import {t,useLanguage} from './i18n.js';
import React,{useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Zap} from 'lucide-react';
import {effectiveTier,fastTier,isFast,speedLabel} from './speed-settings';

export function SpeedPicker({threadId,model,tier,disabled,toggleRequest,onApplied,onError,onSavingChange}){
 useLanguage();
 const [entry,setEntry]=useState(null),[saving,setSaving]=useState(false);
 const scope=useRef(threadId),generation=useRef(0),lock=useRef(false),props=useRef({});
 scope.current=threadId;props.current={onApplied,onError,onSavingChange,model,tier};
 const current=effectiveTier(tier,entry?.model===model?entry:null),fast=isFast(current);
 useEffect(()=>{generation.current++;setEntry(null);},[threadId,model]);
 async function toggle(){
  if(lock.current||disabled)return;
  const target=threadId,expected=model,id=++generation.current;
  lock.current=true;setSaving(true);props.current.onSavingChange?.(true);
  try{
   const catalog=await invoke('read_model_options',{threadId:target,forceReload:false});
   if(id!==generation.current||target!==scope.current||props.current.model!==expected)return;
   if(catalog.settings?.model!==expected)throw Error(t("模型已在主 App 变化，请重新同步后设置速度"));
   const option=catalog.models?.find(option=>option.model===expected)||null;setEntry(option);
   const next=!isFast(effectiveTier(props.current.tier,option));
   if(next&&!fastTier(option))throw Error(t("当前模型未提供快速模式，或账号暂无此档位"));
   const result=await invoke('update_speed_settings',{threadId:target,model:expected,fast:next});
   if(id!==generation.current||target!==scope.current||props.current.model!==expected)return;
   props.current.onApplied?.(target,result.threadSettings);
  }catch(error){if(id===generation.current&&target===scope.current&&props.current.model===expected)props.current.onError?.(String(error.message||error));}
  finally{lock.current=false;setSaving(false);props.current.onSavingChange?.(false);}
 }
 useEffect(()=>{if(toggleRequest&&!disabled)toggle();},[toggleRequest]);
 return <button type="button" className={'speed-picker-button model-speed'+(fast||current==='ultrafast'?' fast':'')} aria-label={t("切换响应速度")} aria-pressed={fast||current==='ultrafast'} disabled={disabled||saving} title={saving?t("正在保存速度设置…"):t("{0} · 点击切换响应速度",[speedLabel(current)])} onClick={toggle}><Zap size={14} fill={fast||current==='ultrafast'?'currentColor':'none'}/></button>;
}
