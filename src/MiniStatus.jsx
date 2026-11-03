import React,{useRef} from 'react';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {LoaderCircle,WifiOff,CircleAlert,CircleHelp,Pause,MessageSquare} from 'lucide-react';

export function MiniStatus({status,onRestore,onError}){
 const gesture=useRef(null);
 const Icon={working:LoaderCircle,connecting:LoaderCircle,completed:MessageSquare,offline:WifiOff,failed:CircleAlert,waiting:CircleHelp,stopped:Pause,idle:MessageSquare}[status.kind];
 return <button className={'mini-status '+status.kind} aria-label={`${status.label}，点击恢复聊天窗口`} onPointerDown={e=>{if(e.button===0)gesture.current={x:e.screenX,y:e.screenY,dragged:false};}} onPointerMove={e=>{
  const start=gesture.current;
  if(!start||start.dragged||!(e.buttons&1)||Math.hypot(e.screenX-start.x,e.screenY-start.y)<5)return;
  start.dragged=true;
  getCurrentWindow().startDragging().catch(error=>onError(String(error)));
 }} onClick={()=>{if(gesture.current?.dragged){gesture.current=null;return;}onRestore();}}>
  <svg className="mini-frame" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24.5" strokeWidth="1"/></svg>
  <Icon size={24} className={'mini-icon'+(['working','connecting'].includes(status.kind)?' spin':'')} aria-hidden="true"/>
 </button>;
}
