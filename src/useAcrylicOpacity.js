import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';

const key='codex-float-acrylic-opacity';
const valid=value=>Number.isFinite(value)&&value>=0&&value<=1;

function savedOpacity(){
 try{
  const value=JSON.parse(localStorage.getItem(key));
  if(valid(value?.tintOpacity)&&valid(value?.luminosityOpacity))return value;
 }catch{}
 return null;
}

export function useAcrylicOpacity(enabled){
 const [opacity,setOpacity]=useState(null),[error,setError]=useState(false);
 const queue=useRef(Promise.resolve());

 useEffect(()=>{
  if(!enabled)return;
  let active=true;
  const saved=savedOpacity();
  invoke('acrylic_opacity',{opacity:saved})
   .catch(failure=>{if(saved)return invoke('acrylic_opacity',{opacity:null});throw failure;})
   .then(value=>{if(active)setOpacity(value);})
   .catch(()=>{if(active)setError(true);});
  return ()=>{active=false;};
 },[enabled]);

 function change(name,value){
  const next={...opacity,[name]:value};
  setOpacity(next);
  // Keep native updates in input order even while a slider is being dragged.
  queue.current=queue.current.then(async()=>{
   try{
    const applied=await invoke('acrylic_opacity',{opacity:next});
    try{localStorage.setItem(key,JSON.stringify(applied));}catch{}
    setError(false);
   }catch{setError(true);}
  });
 }

 return {opacity,error,change};
}
