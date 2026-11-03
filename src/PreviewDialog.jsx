import React,{useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

// Only the top dialog is modal and painted. Suspended dialogs retain their DOM and scroll.
const stack=[];
const bodyOf=entry=>entry.element.querySelector('.file-preview-body');

export function PreviewDialog({title,onClose,children,className=''}){
 const dialog=useRef(null);
 const [hasParent,setHasParent]=useState(false);
 useLayoutEffect(()=>{
  const focused=document.activeElement;
  const previous=stack.at(-1);
  if(previous){
   previous.scrollTop=bodyOf(previous)?.scrollTop||0;
   previous.element.close();
  }
  const entry={element:dialog.current,scrollTop:0};
  stack.push(entry);
  setHasParent(!!previous);
  entry.element.showModal();
  return ()=>{
   const index=stack.indexOf(entry),wasTop=index===stack.length-1;
   if(index!==-1)stack.splice(index,1);
   entry.element.close();
   if(!wasTop)return;
   const parent=stack.at(-1);
   if(parent?.element.isConnected)parent.element.showModal();
   if(focused?.isConnected&&(!parent||parent.element.contains(focused)))focused.focus({preventScroll:true});
   if(parent){const body=bodyOf(parent);if(body)body.scrollTop=parent.scrollTop;}
  };
 },[]);
 return createPortal(<dialog className={'file-preview '+className} ref={dialog} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}}>
  <header><strong title={title}>{title}</strong><button type="button" onClick={onClose} aria-label={hasParent?'返回上一层':'关闭预览'}>{hasParent?'返回':'关闭'}</button></header>
  <div className="file-preview-body">{children}</div>
 </dialog>,document.body);
}
