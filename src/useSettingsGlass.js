import {useLayoutEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';

export function useSettingsGlass(panel,open,mode){
 const [nativeGlass,setNativeGlass]=useState(false),queue=useRef(Promise.resolve());
 useLayoutEffect(()=>{
  if(!open||mode!=='liquid-glass')return;
  let active=true,applied=false;
  const originals=new Map();
  const restore=()=>{for(const [element,value] of originals)element.style.clipPath=value;originals.clear();};
  const mask=()=>{
   const bounds=panel.current?.getBoundingClientRect();if(!bounds)return;
   // Remove only the HTML content directly below the native glass surface.
   // Other chat content stays visible, and the popup keeps receiving events.
   for(const element of document.querySelectorAll('.chat-panel > :not(.titlebar):not(.settings-control)')){
    if(!originals.has(element))originals.set(element,element.style.clipPath);
    const box=element.getBoundingClientRect(),x=bounds.left-box.left,y=bounds.top-box.top,r=x+bounds.width,b=y+bounds.height;
    element.style.clipPath=`polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${x}px ${y}px,${r}px ${y}px,${r}px ${b}px,${x}px ${b}px,${x}px ${y}px,0 0)`;
   }
  };
  const update=()=>{
   const bounds=panel.current?.getBoundingClientRect();if(!bounds||!bounds.width||!bounds.height)return;
   const rect=[bounds.left,bounds.top,bounds.width,bounds.height];
   if(applied)mask();
   // Serialize updates and teardown so an in-flight resize cannot resurrect
   // the native backdrop after the user has closed settings.
   queue.current=queue.current.then(()=>invoke('settings_backdrop',{rect})).then(result=>{
    if(!active)return;
    applied=!!result;setNativeGlass(applied);if(applied)mask();else restore();
   }).catch(()=>{if(active){applied=false;setNativeGlass(false);restore();}});
  };
  update();
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(update);
  if(panel.current)observer?.observe(panel.current);
  window.addEventListener('resize',update);
  return ()=>{
   active=false;observer?.disconnect();window.removeEventListener('resize',update);restore();setNativeGlass(false);
   queue.current=queue.current.then(()=>invoke('settings_backdrop',{rect:null})).catch(()=>{});
  };
 },[open,mode,panel]);
 return nativeGlass;
}
