import React,{useCallback,useEffect,useRef,useState} from 'react';
import {invoke,convertFileSrc} from '@tauri-apps/api/core';
import {getCurrentWebview} from '@tauri-apps/api/webview';
import {File,Paperclip,X} from 'lucide-react';
import {fileData,mergeAttachments,MAX_ATTACHMENTS} from './attachments';

export function useAttachments({scope,onError}){
 const [attachments,setAttachments]=useState([]),[preparing,setPreparing]=useState(0),[dragging,setDragging]=useState(false);
 const current=useRef([]),scopeRef=useRef(scope),errorRef=useRef(onError),clipboardRead=useRef(null);
 scopeRef.current=scope;errorRef.current=onError;
 const update=useCallback(files=>{current.current=files;setAttachments(files);},[]);
 useEffect(()=>{update([]);setDragging(false);},[scope,update]);
 const run=useCallback(async task=>{
  const target=scopeRef.current;
  setPreparing(count=>count+1);
  try{
   const added=await task();
   if(target===scopeRef.current)update(mergeAttachments(current.current,added));
  }catch(error){if(target===scopeRef.current)errorRef.current(String(error.message||error));}
  finally{setPreparing(count=>count-1);}
 },[update]);
 const addPaths=useCallback(paths=>run(()=>invoke('inspect_attachments',{paths})),[run]);
 const addFiles=useCallback(files=>run(async()=>{
  if(files.length+current.current.length>MAX_ATTACHMENTS)throw Error('一次最多添加 20 个附件');
  const added=[];
  for(const file of files){
   const data=await fileData(file);
   added.push(await invoke('save_attachment',{name:file.name||'粘贴图片.png',data}));
  }
  return added;
 }),[run]);
 const choose=()=>run(()=>invoke('pick_attachments'));
 const pastePaths=()=>{
  if(clipboardRead.current)return clipboardRead.current;
  const target=scopeRef.current;
  setPreparing(count=>count+1);
  const pending=invoke('clipboard_attachment_paths').then(async paths=>{
   if(paths.length&&target===scopeRef.current)await addPaths(paths);
   return paths;
  }).catch(error=>{if(target===scopeRef.current)errorRef.current(String(error));return [];});
  clipboardRead.current=pending;
  pending.finally(()=>{setPreparing(count=>count-1);if(clipboardRead.current===pending)clipboardRead.current=null;});
  return pending;
 };
 const onPaste=event=>{
  const files=Array.from(event.clipboardData?.files||[]);
  if(files.length){
   event.preventDefault();
   const target=scopeRef.current;
   (clipboardRead.current||pastePaths()).then(paths=>{if(!paths.length&&target===scopeRef.current)addFiles(files);});
  }else pastePaths();
 };
 const onKeyDown=event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.repeat&&event.key.toLowerCase()==='v')pastePaths();};
 useEffect(()=>{
  if(!window.__TAURI_INTERNALS__)return;
  let disposed=false,off;
  getCurrentWebview().onDragDropEvent(({payload})=>{
   if(disposed)return;
   if(payload.type==='enter'||payload.type==='over')setDragging(true);
   else setDragging(false);
   if(payload.type==='drop')addPaths(payload.paths);
  }).then(unlisten=>{if(disposed)unlisten();else off=unlisten;}).catch(error=>errorRef.current(String(error)));
  return()=>{disposed=true;off?.();};
 },[addPaths]);
 return {attachments,preparing:preparing>0,dragging,choose,onPaste,onKeyDown,
  remove:path=>update(current.current.filter(file=>file.path!==path)),
  clear:()=>update([]),restore:files=>update(mergeAttachments(files,current.current,Infinity)),
  onDragOver:event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();setDragging(true);}},
  onDragLeave:()=>setDragging(false),
  onDrop:event=>{event.preventDefault();setDragging(false);const files=Array.from(event.dataTransfer?.files||[]);if(files.length)addFiles(files);}
 };
}

export function AttachmentButton({onClick,disabled}){
 return <button type="button" className="icon-button attachment-button" title="添加附件（也可拖入或粘贴）" aria-label="添加附件" onClick={onClick} disabled={disabled}><Paperclip size={16}/></button>;
}
export function ComposerAttachments({files,onRemove,preparing,dragging}){
 return <>
  {!!files.length&&<div className="composer-attachments" aria-label="待发送附件">{files.map(file=><div className="composer-attachment" key={file.path} title={file.path}>
   {file.image?<img src={convertFileSrc(file.path)} alt=""/>:<File size={18} aria-hidden="true"/>}
   <span>{file.name}</span><button type="button" aria-label={`移除附件 ${file.name}`} onClick={()=>onRemove(file.path)}><X size={12}/></button>
  </div>)}</div>}
  {preparing&&<div className="attachment-hint" role="status">正在准备附件…</div>}
  {dragging&&<div className="attachment-drop-hint">松开以添加附件</div>}
 </>;
}
