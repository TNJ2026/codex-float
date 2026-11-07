import React,{useRef,useState} from 'react';
import {ChevronDown,MessageSquare} from 'lucide-react';
import {popupNativeMenu} from './native-menu';
import {groupThreads} from './thread-groups';

export function NativeThreadPicker({threads,value,disabled,onChange}){
 const button=useRef(),scope=useRef(),[open,setOpen]=useState(false);scope.current={value,disabled,onChange};
 const selected=threads.find(thread=>thread.id===value);
 async function show(){if(open||disabled)return;setOpen(true);const before=value;let choice=null;
  try{await popupNativeMenu(button.current,groupThreads(threads).map(group=>({text:group.name,items:group.threads.map(thread=>({text:thread.thread_name||thread.id,checked:thread.id===value,action:()=>{choice=thread.id;}}))})));if(choice&&choice!==before&&scope.current.value===before&&!scope.current.disabled)scope.current.onChange(choice);}
  finally{setOpen(false);}
 }
 return <div className="thread-picker"><button type="button" id="thread-picker" ref={button} className="thread-selector" aria-label="选择聊天" aria-haspopup="menu" aria-expanded={open} disabled={disabled||!threads.length} onClick={show}><MessageSquare size={16}/><span className="thread-selection" title={selected?.thread_name||value}>{selected?.thread_name||value||'暂无聊天'}</span><ChevronDown size={12}/></button></div>;
}
