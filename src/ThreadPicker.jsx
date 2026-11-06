import {usesNativeMenus} from './native-menu';
import {NativeThreadPicker} from './NativePickers';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {MessageSquare, ChevronDown, Check, Folder} from 'lucide-react';
import {groupThreads} from './thread-groups';

function WebThreadPicker({threads, value, disabled, onChange}) {
 const [open,setOpen]=useState(false),[active,setActive]=useState(0);
 const root=useRef(null),trigger=useRef(null),list=useRef(null),search=useRef({text:'',at:0});
 const groups=useMemo(()=>groupThreads(threads),[threads]);
 const choices=useMemo(()=>groups.flatMap(g=>g.threads),[groups]);
 const indexes=useMemo(()=>new Map(choices.map((t,i)=>[t.id,i])),[choices]);
 const selected=choices.findIndex(t=>t.id===value);
 const unavailable=disabled||choices.length===0;
 const listId='thread-picker-list';
 const openList=()=>{setActive(Math.max(0,selected));setOpen(true);};
 const choose=index=>{
  const thread=choices[index];if(!thread)return;
  if(thread.id!==value)onChange(thread.id);
  setOpen(false);trigger.current?.focus({preventScroll:true});
 };
 useEffect(()=>{
  if(!open)return;
  const dismiss=e=>{if(!root.current?.contains(e.target))setOpen(false);};
  document.addEventListener('pointerdown',dismiss,true);
  return()=>document.removeEventListener('pointerdown',dismiss,true);
 },[open]);
 useEffect(()=>{if(unavailable)setOpen(false);},[unavailable]);
 useEffect(()=>{if(open)list.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[open,active]);
 const onKeyDown=e=>{
  if(unavailable)return;
  if(e.key==='Escape'){if(open){e.preventDefault();e.stopPropagation();setOpen(false);}return;}
  if(e.key==='Tab'){setOpen(false);return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();if(!open){openList();return;}
   setActive(i=>Math.max(0,Math.min(choices.length-1,i+(e.key==='ArrowDown'?1:-1))));return;
  }
  if(e.key==='Home'||e.key==='End'){
   e.preventDefault();setOpen(true);setActive(e.key==='Home'?0:choices.length-1);return;
  }
  if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)choose(active);else openList();return;}
  if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
   const now=Date.now();search.current={text:(now-search.current.at<700?search.current.text:'')+e.key.toLocaleLowerCase(),at:now};
   const index=choices.findIndex(t=>(t.thread_name||t.id).toLocaleLowerCase().startsWith(search.current.text));
   if(index>=0){e.preventDefault();setOpen(true);setActive(index);}
  }
 };
 return <div ref={root} className="thread-picker" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
  <button ref={trigger} id="thread-picker" type="button" className="thread-selector" role="combobox" aria-label="选择聊天" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open?`${listId}-${active}`:undefined} disabled={unavailable} onKeyDown={onKeyDown} onClick={()=>open?setOpen(false):openList()}>
   <MessageSquare size={16} aria-hidden="true"/>
   <span className="thread-selection" title={choices[selected]?.thread_name||value}>{choices[selected]?.thread_name||value||'暂无聊天'}</span>
   <ChevronDown size={12} aria-hidden="true"/>
  </button>
  {open&&<div ref={list} id={listId} role="listbox" aria-label="聊天列表" className="thread-popup">
   {groups.map((group,groupIndex)=><div className="thread-project-group" role="group" aria-labelledby={`${listId}-group-${groupIndex}`} key={group.key}>
    <div id={`${listId}-group-${groupIndex}`} className="thread-project-heading"><Folder size={13} aria-hidden="true"/><span title={group.name}>{group.name}</span><small>{group.threads.length}</small></div>
    {group.threads.map(thread=>{
     const index=indexes.get(thread.id);
     return <div id={`${listId}-${index}`} data-option-index={index} key={thread.id} role="option" aria-selected={thread.id===value} className={'thread-option'+(index===active?' active':'')+(thread.id===value?' selected':'')} onPointerMove={()=>setActive(index)} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(index)}>
      <span className="thread-option-title" title={thread.thread_name||thread.id}>{thread.thread_name||thread.id}</span>
      {thread.id===value&&<Check size={14} aria-hidden="true"/>}
     </div>;
    })}
   </div>)}
  </div>}
 </div>;
}

export function ThreadPicker(props){
 const windowsMenu=usesNativeMenus()&&document.documentElement.dataset.nativeCaption==='true';
 return windowsMenu?<NativeThreadPicker {...props}/>:<WebThreadPicker {...props}/>;
}
