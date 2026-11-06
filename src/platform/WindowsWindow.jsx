import React,{useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {SessionView} from '../SessionView';
import {Settings} from '../Settings';
import {MiniStatus} from '../MiniStatus';
import chatgptIcon from '../assets/chatgpt-mark.svg';
import {useWindowSession} from './useWindowSession';
import './windows.css';

export function WindowsWindow(){
 const native=!!window.__TAURI_INTERNALS__;
 const [settingsOpenRequest,setSettingsOpenRequest]=useState(0);
 const [titlebarHeight,setTitlebarHeight]=useState(0);
 const {compact,status,changeCompact,setWindowError,settingsProps,sessionProps}=useWindowSession();

 const minimize=useRef(null);
 minimize.current=()=>changeCompact(true);

 useEffect(()=>{
  if(!native)return;
  let disposed=false;
  invoke('background_settings').then(settings=>{
   if(disposed)return;
   document.documentElement.dataset.nativeBackground=settings.mode;
   if(Number.isFinite(settings.titlebarHeight))setTitlebarHeight(settings.titlebarHeight);
   if(settings.error)setWindowError('背景材质已回退：'+settings.error);
  }).catch(()=>{});
  const subscription=listen('windows-caption-action',({payload})=>{
   if(disposed)return;
   if(payload==='settings')setSettingsOpenRequest(value=>value+1);
   if(payload==='mini')minimize.current();
  });
  subscription.catch(error=>{if(!disposed)setWindowError(String(error));});
  return()=>{disposed=true;subscription.then(unlisten=>unlisten(),()=>{});};
 },[native,setWindowError]);


 return <main className={'windows-window'+(compact?' compact':'')}>
  {compact&&<MiniStatus status={status} onRestore={()=>changeCompact(false)} onError={setWindowError}/>}
 <div className="chat-panel" hidden={compact} style={{'--windows-titlebar-height':`${titlebarHeight}px`}}>
   {titlebarHeight>0&&<header className="windows-titlebar"><img src={chatgptIcon} alt=""/><span>Codex Float</span></header>}
   {native?<Settings hideTrigger openRequest={settingsOpenRequest} available={!compact} {...settingsProps}/>:<header className="browser-brand">
    <img src={chatgptIcon} alt="" aria-hidden="true"/><span>Codex 悬浮窗</span><Settings {...settingsProps}/>
   </header>}
   <SessionView {...sessionProps}/>
  </div>
 </main>;
}
