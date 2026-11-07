import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {invoke} from '@tauri-apps/api/core';
import {Check,Zap} from 'lucide-react';
import {useSettingsGlass} from './useSettingsGlass';
import {effectiveTier,fastTier,isFast,speedLabel} from './speed-settings';

export function SpeedPicker({threadId,model,tier,disabled,toggleRequest,onApplied,onError,onSavingChange}){
 const [open,setOpen]=useState(false),[entry,setEntry]=useState(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[position,setPosition]=useState({});
 const button=useRef(),popup=useRef(),scope=useRef(threadId),generation=useRef(0),lock=useRef(false),openRef=useRef(open),props=useRef({});
 const mode=document.documentElement.dataset.windowPlatform==='macos'?document.documentElement.dataset.nativeBackground:undefined;
 const nativeGlass=useSettingsGlass(popup,open&&!!position.width,mode);
 scope.current=threadId;openRef.current=open;props.current={onApplied,onError,onSavingChange,model,tier};
 const current=effectiveTier(tier,entry?.model===model?entry:null),fast=isFast(current);
 useEffect(()=>{generation.current++;setOpen(false);setEntry(null);setError('');setLoading(false);},[threadId,model]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 async function catalog(){
  const target=threadId,expected=model,id=++generation.current;setLoading(true);setError('');
  try{const result=await invoke('read_model_options',{threadId:target,forceReload:false});if(id!==generation.current||target!==scope.current||props.current.model!==expected)return null;
   if(result.settings?.model!==expected)throw Error('模型已在主 App 变化，请重新同步后设置速度');
   const option=result.models?.find(option=>option.model===expected)||null;setEntry(option);return option;
  }catch(error){if(id===generation.current){const message=String(error.message||error);setError(message);throw Error(message);}return null;}
  finally{if(id===generation.current)setLoading(false);}
 }
 useEffect(()=>{
  if(!open)return;catalog().catch(()=>{});
  const place=()=>{const rect=button.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(270,window.innerWidth-24);setPosition({right:Math.max(12,Math.min(window.innerWidth-rect.right,window.innerWidth-width-12)),bottom:Math.max(12,window.innerHeight-rect.top+8),width});};place();window.addEventListener('resize',place);
  const pointer=event=>{if(!popup.current?.contains(event.target)&&!button.current?.contains(event.target))setOpen(false);};
  const focus=event=>{if(event.target.closest?.('.settings-panel'))setOpen(false);};
  document.addEventListener('focusin',focus);
  const key=event=>{if(event.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);
  return()=>{generation.current++;document.removeEventListener('focusin',focus);window.removeEventListener('resize',place);document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};
 },[open,threadId,model]);
 useEffect(()=>{
  if(open&&!loading)popup.current?.querySelector('[aria-checked="true"]:not(:disabled), [role="menuitemradio"]:not(:disabled)')?.focus({preventScroll:true});
 },[open,loading]);
 function keyboard(event){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const rows=[...popup.current.querySelectorAll('[role="menuitemradio"]:not(:disabled)')];
  if(!rows.length)return;
  event.preventDefault();const index=rows.indexOf(document.activeElement);
  rows[event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();
 }
 async function save(wanted,toggle=false){
  if(lock.current||disabled)return;const target=threadId,expected=model;
  lock.current=true;setSaving(true);setError('');props.current.onSavingChange?.(true);
  try{
   let option=entry?.model===expected?entry:null;
   if(wanted||toggle){option=await catalog();if(target!==scope.current||props.current.model!==expected)return;}
   const before=effectiveTier(props.current.tier,option),next=toggle?!isFast(before):wanted;
   if(next&&!fastTier(option))throw Error('当前模型未提供快速模式，或账号暂无此档位');
   if((next&&isFast(before))||(!next&&['default','standard','auto'].includes(before)&&(props.current.tier!=null||option))){setOpen(false);return;}
   const result=await invoke('update_speed_settings',{threadId:target,model:expected,fast:next});
   if(target!==scope.current||props.current.model!==expected)return;
   props.current.onApplied?.(target,result.threadSettings);setOpen(false);button.current?.focus();
  }catch(error){if(target===scope.current){const message=String(error.message||error);setError(message);if(!openRef.current)props.current.onError?.(message);}}
  finally{lock.current=false;setSaving(false);props.current.onSavingChange?.(false);}
 }
 useEffect(()=>{if(toggleRequest&&!disabled)save(false,true);},[toggleRequest]);
 return <>
  <button type="button" ref={button} className={'speed-picker-button model-speed'+(fast||current==='ultrafast'?' fast':'')} aria-label="切换响应速度" aria-haspopup="menu" aria-expanded={open} disabled={disabled||saving} title={saving?'正在保存速度设置…':`${speedLabel(current)} · 点击切换响应速度`} onClick={()=>setOpen(value=>!value)}><Zap size={14} fill={fast||current==='ultrafast'?'currentColor':'none'}/></button>
  {open&&createPortal(<div ref={popup} className="permission-popup speed-popup" data-native-glass={nativeGlass||undefined} style={position} role="menu" aria-label="响应速度" onKeyDown={keyboard}><button type="button" role="menuitemradio" aria-checked={['default','standard','auto'].includes(current)} disabled={saving||loading} onClick={()=>save(false)}><span><strong>标准速度</strong><small>常规响应速度与用量</small></span>{['default','standard','auto'].includes(current)&&<Check size={14}/>}</button><button type="button" role="menuitemradio" aria-checked={fast} disabled={saving||loading||!fastTier(entry)} onClick={()=>save(true)}><span><strong>快速模式</strong><small>{loading?'正在读取模型支持情况…':fastTier(entry)?'加快模型响应，更快消耗额度或点数':'当前模型或账号未提供快速档位'}</small></span>{fast&&<Check size={14}/>}</button><p className="permission-popup-note" role="status">{saving?'正在保存…':'选择后自动保存，下轮生效。'}</p>{error&&<p className="model-popup-error" role="alert">{error}</p>}</div>,document.body)}
 </>;
}
