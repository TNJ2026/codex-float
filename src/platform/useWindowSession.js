import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {invoke} from '@tauri-apps/api/core';
import {readPredictions} from '../predictions';
import {miniStatus} from '../mini-status';

export function useWindowSession(){
 const sessionRef=useRef(null),compactRef=useRef(false),changingMode=useRef(false);
 const modeVersion=useRef(0);
 const [compact,setCompact]=useState(false);
 const [restorePhase,setRestorePhase]=useState('');
 const [status,setStatus]=useState(()=>miniStatus(null,'offline'));
 const [windowError,setWindowError]=useState('');
 const [predictionsEnabled,setPredictionsEnabled]=useState(()=>readPredictions(localStorage));

 useEffect(()=>{
  if(restorePhase!=='appearing')return;
  const timer=setTimeout(()=>setRestorePhase(''),200);
  return()=>clearTimeout(timer);
 },[restorePhase]);

 useEffect(()=>{
  if(!window.__TAURI_INTERNALS__)return;
  let disposed=false;
  const version=modeVersion.current;
  invoke('get_mini_mode').then(actual=>{
   if(disposed||version!==modeVersion.current)return;
   compactRef.current=actual;
   setCompact(actual);
  }).catch(error=>{if(!disposed)setWindowError(String(error));});
  return()=>{disposed=true;};
 },[]);

 function changePredictions(value){
  setPredictionsEnabled(value);
  try{localStorage.setItem('codex-float-predictions',String(value));}catch{}
 }
 async function changeCompact(next){
  if(changingMode.current)return;
  changingMode.current=true;
  modeVersion.current++;
  if(next)sessionRef.current?.saveScroll();
  const previous=compactRef.current;
  compactRef.current=next;
  // Commit either layout before the native window changes size.
  flushSync(()=>{
   setRestorePhase(!next&&previous?'preparing':'');
   setCompact(next);
  });
  try{
   const actual=await invoke('set_mini_mode',{compact:next});
   compactRef.current=actual;
   setCompact(actual);
   setRestorePhase(!actual&&previous?'appearing':'');
   if(!actual)requestAnimationFrame(()=>sessionRef.current?.restoreFocus());
  }catch(error){
   compactRef.current=previous;
   setCompact(previous);
   setRestorePhase('');
   setWindowError(String(error));
  }finally{changingMode.current=false;}
 }

 return {compact,status,restorePhase,changeCompact,setWindowError,
  settingsProps:{predictionsEnabled,onPredictionsChange:changePredictions},
  sessionProps:{ref:sessionRef,compact,compactRef,predictionsEnabled,windowError,
   onDismissWindowError:()=>setWindowError(''),onMiniStatusChange:setStatus}};
}
