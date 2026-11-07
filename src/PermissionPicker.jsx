import {t,useLanguage} from './i18n.js';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {invoke} from '@tauri-apps/api/core';
import {Check,ChevronDown} from 'lucide-react';
import {useSettingsGlass} from './useSettingsGlass';
import {permissionOptions,permissionPreset} from './permissions';

export function PermissionPicker({threadId,conversation,disabled,onApplied,onError,onSavingChange,openRequest}){
 useLanguage();
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[position,setPosition]=useState({});
 const button=useRef(),popup=useRef(),scope=useRef(threadId),lock=useRef(false),openRef=useRef(false),callbacks=useRef({});
 const macOS=document.documentElement.dataset.windowPlatform==='macos';
 const mode=macOS?document.documentElement.dataset.nativeBackground:undefined;
 const nativeGlass=useSettingsGlass(popup,open&&!!position.width,mode);
 scope.current=threadId;openRef.current=open;callbacks.current={onApplied,onError,onSavingChange};
 const selected=permissionPreset(conversation),label=permissionOptions.find(option=>option.id===selected)?.label||t("自定义权限");
 useEffect(()=>{setOpen(false);setError('');},[threadId]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{if(openRequest&&!disabled)setOpen(true);},[openRequest]);
 useEffect(()=>{
  if(!open)return;
  const place=()=>{
   const rect=button.current?.getBoundingClientRect();if(!rect)return;
   const width=Math.min(292,window.innerWidth-24);
   setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),bottom:Math.max(12,window.innerHeight-rect.top+8),width,maxHeight:Math.max(100,rect.top-24)});
  };
  place();window.addEventListener('resize',place);
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(place);if(button.current?.closest('footer'))observer?.observe(button.current.closest('footer'));
  const frame=requestAnimationFrame(()=>popup.current?.querySelector('[aria-checked="true"], [role="menuitemradio"]')?.focus({preventScroll:true}));
  const pointer=event=>{if(!popup.current?.contains(event.target)&&!button.current?.contains(event.target))setOpen(false);};
  const key=event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);button.current?.focus();}};
  const focus=event=>{if(event.target.closest?.('.settings-panel'))setOpen(false);};
  document.addEventListener('focusin',focus);
  document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);
  return()=>{if(typeof cancelAnimationFrame!=='undefined')cancelAnimationFrame(frame);window.removeEventListener('resize',place);observer?.disconnect();document.removeEventListener('focusin',focus);document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};
 },[open,threadId]);
 async function save(preset){
  if(lock.current||disabled)return;
  if(preset===selected){setOpen(false);button.current?.focus();return;}
  const target=threadId;lock.current=true;setSaving(true);setError('');callbacks.current.onSavingChange?.(true);
  try{
   const result=await invoke('update_permission_settings',{threadId:target,preset,cwd:conversation?.cwd||conversation?.latestThreadSettings?.cwd||null});
   if(target!==scope.current)return;
   callbacks.current.onApplied?.(target,result.threadSettings);setOpen(false);button.current?.focus();
  }catch(error){if(target===scope.current){const message=String(error.message||error);setError(message);if(!openRef.current)callbacks.current.onError?.(message);}}
  finally{lock.current=false;setSaving(false);callbacks.current.onSavingChange?.(false);}
 }
 function keyboard(event){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const rows=[...popup.current.querySelectorAll('[role="menuitemradio"]:not(:disabled)')],index=rows.indexOf(document.activeElement);
  rows[event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();
 }
 return <>
  <button type="button" ref={button} className="permission-picker-button" data-permission={selected} aria-label={t("修改权限")} aria-haspopup="menu" aria-expanded={open} aria-controls={open?'permission-settings-popup':undefined} disabled={disabled||saving} title={saving?t("正在保存权限…"):t("{0} · 点击修改权限",[t(label)])} onClick={()=>{setError('');setOpen(value=>!value);}}><span>{saving?t("保存中"):t(label)}</span><ChevronDown size={10}/></button>
  {open&&createPortal(<div ref={popup} id="permission-settings-popup" className="permission-popup" data-native-glass={nativeGlass||undefined} style={position} role="menu" aria-label={t("聊天权限")} aria-busy={saving} onKeyDown={keyboard}>
   {permissionOptions.map(option=><button type="button" role="menuitemradio" aria-checked={selected===option.id} key={option.id} data-permission={option.id} disabled={saving} onClick={()=>save(option.id)}><span><strong>{t(option.label)}</strong><small>{t(option.description)}</small></span>{selected===option.id&&<Check size={14}/>}</button>)}
   {error&&<p className="model-popup-error" role="alert">{t(error)}</p>}
   <p className="permission-popup-note" role="status">{saving?t("正在保存…"):t("选择后自动保存，下轮生效。")}</p>
  </div>,document.body)}
 </>;
}
