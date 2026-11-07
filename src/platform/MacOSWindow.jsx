import React,{useEffect,useRef,useState} from 'react';
import {t} from '../i18n';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {SessionView} from '../SessionView';
import {Settings} from '../Settings';
import {MiniStatus} from '../MiniStatus';
import {useWindowSession} from './useWindowSession';
import './macos.css';

function applyTitlebarHeight(height){
 if(Number.isFinite(height))document.documentElement.style.setProperty('--native-titlebar-height',height+'px');
}

export function MacOSWindow(){
 const [settingsOpenRequest,setSettingsOpenRequest]=useState(0);
 const {compact,status,changeCompact,setWindowError,settingsProps,sessionProps}=useWindowSession();
 const enterCompact=useRef(null);
 enterCompact.current=()=>changeCompact(true);

 useEffect(()=>{
  let disposed=false,layoutReceived=false;
  const subscriptions=[
   listen('native-titlebar-action',({payload})=>{
    if(disposed)return;
    if(payload==='settings')setSettingsOpenRequest(value=>value+1);
    if(payload==='mini')enterCompact.current();
   }),
   listen('native-titlebar-layout',({payload})=>{
    if(disposed)return;
    layoutReceived=true;
    applyTitlebarHeight(payload);
   })
  ];
  for(const subscription of subscriptions)subscription.catch(error=>{if(!disposed)setWindowError(String(error));});
  invoke('background_settings').then(settings=>{
   if(disposed)return;
   document.documentElement.dataset.nativeBackground=settings.mode;
   if(!layoutReceived)applyTitlebarHeight(settings.titlebarHeight);
   if(settings.error)setWindowError(t('背景材质已回退：')+settings.error);
  }).catch(()=>{});
  return()=>{
   disposed=true;
   for(const subscription of subscriptions)subscription.then(unlisten=>unlisten(),()=>{});
  };
 },[setWindowError]);

 return <main className={'macos-window'+(compact?' compact':'')}>
  {compact&&<MiniStatus status={status} onRestore={()=>changeCompact(false)} onError={setWindowError}/>}
  <div className="chat-panel" hidden={compact}>
   <Settings nativeToolbar openRequest={settingsOpenRequest} available={!compact} {...settingsProps}/>
   <SessionView {...sessionProps}/>
  </div>
 </main>;
}
