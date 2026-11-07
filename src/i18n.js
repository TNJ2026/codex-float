import {useSyncExternalStore} from 'react';
import english from './locales/en.js';

const storageKey='codex-float-language';
const listeners=new Set();
const chinese=Object.fromEntries(Object.entries(english).map(([zh,en])=>[en,zh]));
export function readLanguage(storage){
 try{return storage.getItem(storageKey)==='en'?'en':'zh-CN';}catch{return 'zh-CN';}
}
let language='zh-CN';
try{language=readLanguage(globalThis.localStorage);}catch{}

export const getLanguage=()=>language;
export function setLanguage(value){
 const next=value==='en'?'en':'zh-CN';
 language=next;
 try{globalThis.localStorage.setItem(storageKey,next);}catch{}
 if(typeof document!=='undefined')document.documentElement.lang=next;
 for(const listener of listeners)listener();
}
function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function useLanguage(){return useSyncExternalStore(subscribe,getLanguage,getLanguage);}

export function t(message,values=[]){
 if(typeof message!=='string')return message;
 const source=chinese[message]??message;
 const translated=language==='en'?(english[source]??source):source;
 return translated.replace(/\{(\d+)\}/gu,(token,index)=>values[index]===undefined?token:String(values[index]));
}
