import {useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {readPredictions} from '../predictions';
import {miniStatus} from '../mini-status';

export function useWindowSession(){
 const sessionRef=useRef(null),compactRef=useRef(false),changingMode=useRef(false);
 const [compact,setCompact]=useState(false);
 const [status,setStatus]=useState(()=>miniStatus(null,'offline'));
 const [windowError,setWindowError]=useState('');
 const [predictionsEnabled,setPredictionsEnabled]=useState(()=>readPredictions(localStorage));

 function changePredictions(value){
  setPredictionsEnabled(value);
  try{localStorage.setItem('codex-float-predictions',String(value));}catch{}
 }
 async function changeCompact(next){
  if(changingMode.current)return;
  changingMode.current=true;
  if(next)sessionRef.current?.saveScroll();
  compactRef.current=next;
  try{
   const actual=await invoke('set_mini_mode',{compact:next});
   compactRef.current=actual;
   setCompact(actual);
   if(!actual)requestAnimationFrame(()=>sessionRef.current?.restoreFocus());
  }catch(error){
   compactRef.current=compact;
   setWindowError(String(error));
  }finally{changingMode.current=false;}
 }

 return {compact,status,changeCompact,setWindowError,
  settingsProps:{predictionsEnabled,onPredictionsChange:changePredictions},
  sessionProps:{ref:sessionRef,compact,compactRef,predictionsEnabled,windowError,
   onDismissWindowError:()=>setWindowError(''),onMiniStatusChange:setStatus}};
}
