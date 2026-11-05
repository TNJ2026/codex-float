import {isNativeMac} from './native-menu';
import {NativeModelPicker} from './NativePickers';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {invoke} from '@tauri-apps/api/core';
import {Check,ChevronDown,RefreshCw,X} from 'lucide-react';
import {modelDisplayName} from './model';
import {effortForModel,effortLabel,supportedEfforts} from './model-settings';
import {ReasoningSlider} from './ReasoningSlider';

function WebModelPicker({threadId,model,effort,names={},disabled,busy,onApplied,onError,onSavingChange,openRequest}){
 const [open,setOpen]=useState(false),[models,setModels]=useState([]),[base,setBase]=useState(null),[selected,setSelected]=useState(''),[reasoning,setReasoning]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[position,setPosition]=useState({});
 const [saved,setSaved]=useState(false);
 const [adjusting,setAdjusting]=useState(false);
 const button=useRef(),popup=useRef(),scope=useRef(threadId),openRef=useRef(open),loadId=useRef(0),saveLock=useRef(false),callbacks=useRef({onApplied,onError,onSavingChange});
 scope.current=threadId;openRef.current=open;callbacks.current={onApplied,onError,onSavingChange};
 useEffect(()=>{setOpen(false);setBase(null);setError('');setSaved(false);setAdjusting(false);loadId.current++;},[threadId]);
 async function load(forceReload=false){
  const id=++loadId.current,target=threadId;
  setLoading(true);setError('');setSaved(false);setBase(null);setModels([]);
  try{
   const result=await invoke('read_model_options',{threadId:target,forceReload});
   if(id!==loadId.current||target!==scope.current)return;
   setModels(result.models||[]);setBase(result.settings);setSelected(result.settings.model);setReasoning(result.settings.reasoningEffort||'');
   requestAnimationFrame(()=>popup.current?.querySelector('[role="option"][aria-selected="true"]')?.focus({preventScroll:true}));
  }catch(error){if(id===loadId.current&&target===scope.current)setError(String(error.message||error));}
  finally{if(id===loadId.current)setLoading(false);}
 }
 useEffect(()=>{
  if(!open)return;
  load(true);
  const place=()=>{
   const rect=button.current?.getBoundingClientRect();if(!rect)return;
   setPosition({right:Math.max(12,window.innerWidth-rect.right),bottom:Math.max(12,window.innerHeight-rect.top+8),width:Math.min(360,window.innerWidth-24),maxHeight:Math.max(160,Math.min(520,rect.top-24))});
  };
  place();window.addEventListener('resize',place);
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(place);if(button.current?.closest('footer'))observer?.observe(button.current.closest('footer'));
  const pointer=event=>{if(!popup.current?.contains(event.target)&&!button.current?.contains(event.target))setOpen(false);};
  const key=event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);
  return()=>{loadId.current++;window.removeEventListener('resize',place);observer?.disconnect();document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};
 },[open,threadId]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{if(openRequest&&!disabled)setOpen(true);},[openRequest]);
 const option=models.find(entry=>entry.model===selected),options=supportedEfforts(option);
 async function save(nextModel,nextReasoning){
  if(saveLock.current||loading||!base||!models.some(entry=>entry.model===nextModel)||disabled)return false;
  if(nextModel===base.model&&nextReasoning===(base.reasoningEffort||''))return true;
  const target=threadId;saveLock.current=true;setSaving(true);setError('');setSaved(false);setSelected(nextModel);setReasoning(nextReasoning);
  callbacks.current.onSavingChange?.(true);
  try{
   const result=await invoke('update_model_settings',{threadId:target,model:nextModel,effort:nextReasoning||null,expectedModel:base.model,expectedEffort:base.reasoningEffort??null});
   if(target!==scope.current)return false;
   setBase(result.settings);setSelected(result.settings.model);setReasoning(result.settings.reasoningEffort||'');setSaved(true);
   callbacks.current.onApplied?.(target,result.settings);
   return true;
  }catch(error){if(target===scope.current){setSelected(base.model);setReasoning(base.reasoningEffort||'');const message=String(error.message||error);setError(message);if(!openRef.current)callbacks.current.onError?.(message);}return false;}
  finally{saveLock.current=false;setSaving(false);callbacks.current.onSavingChange?.(false);}
 }
 function keyboard(event){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||!event.target.closest('[role="option"]'))return;
  event.preventDefault();const rows=[...popup.current.querySelectorAll('[role="option"]')],index=rows.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
  rows[next]?.focus();
 }
 return <>
  <button type="button" ref={button} className="model-picker-button" aria-label="选择模型与推理强度" aria-haspopup="dialog" aria-expanded={open} aria-controls={open?'model-settings-popup':undefined} disabled={disabled||saving} title={saving?'正在保存模型设置…':disabled?'连接聊天后选择模型与推理强度':`${modelDisplayName(model,names)||'模型'} · ${effortLabel(effort)}`} onClick={()=>setOpen(value=>!value)}><span className="model-name">{modelDisplayName(model,names)||'等待模型信息'}</span><small>{saving?'保存中':effortLabel(effort)}</small><ChevronDown size={11}/></button>
  {open&&createPortal(<div id="model-settings-popup" className="model-settings-popup" style={position} role="dialog" aria-label="模型与推理强度" ref={popup} onKeyDown={keyboard}>
   <div className="model-popup-heading"><strong>模型与推理强度</strong><button type="button" aria-label="刷新模型列表" disabled={loading||saving||adjusting} onClick={()=>load(true)}><RefreshCw size={13} className={loading?'spin':''}/></button><button type="button" aria-label="关闭模型设置" onClick={()=>setOpen(false)}><X size={14}/></button></div>
   {loading?<p className="model-popup-note" role="status">正在读取可用模型…</p>:<>
    <div className="model-options" role="listbox" aria-label="可用模型">{models.map(entry=><button type="button" role="option" aria-selected={selected===entry.model} key={entry.model} disabled={saving} title={entry.description} onClick={()=>{if(entry.model!==selected)save(entry.model,effortForModel(entry,reasoning));}}><span>{modelDisplayName(entry.model,{...names,[entry.model]:entry.displayName||names[entry.model]})}</span>{selected===entry.model&&<Check size={13}/>}</button>)}</div>
    {!option&&base&&<p className="model-popup-note">当前模型不在可选列表中，请选择可用模型。</p>}
    {option?.description&&<p className="model-popup-description">{option.description}</p>}
    <ReasoningSlider model={option} effort={reasoning} disabled={saving||!option} onCommit={value=>save(selected,value)} onPreviewChange={active=>{setAdjusting(active);callbacks.current.onSavingChange?.(active||saveLock.current);}}/>
    {!options.length&&option&&<p className="model-popup-note">此模型未提供可调节的推理强度。</p>}
   </>}
   {error&&<p className="model-popup-error" role="alert">{error}</p>}
   <div className="model-popup-footer"><span role="status">{saving?'正在保存…':adjusting?'松开滑块后自动保存。':error?'保存未确认，请刷新重试。':saved?'已保存，下轮生效。':busy?'任务进行中，选择后下轮生效。':'选择后自动保存，下轮生效。'}</span></div>
  </div>,document.body)}
 </>;
}

export function ModelPicker(props){return isNativeMac()?<NativeModelPicker {...props}/>:<WebModelPicker {...props}/>;}
