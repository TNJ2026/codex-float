import {invoke} from '@tauri-apps/api/core';
import {readBrowserLimit} from './browser-settings';

const subscribers=new Set(),pending=new Map();let timer=null,epoch=0;
export function readBrowserContexts(){
 const limit=readBrowserLimit();
 if(!pending.has(limit))pending.set(limit,invoke('read_browser_contexts',{maxChars:limit}).finally(()=>pending.delete(limit)));
 return pending.get(limit);
}
export function subscribeBrowserContexts(update,error=()=>{}){
 const listener={update,error};subscribers.add(listener);
 async function poll(token){
  if(token!==epoch)return;
  clearTimeout(timer);timer=null;
  try{const pages=await readBrowserContexts();if(token!==epoch)return;for(const listener of [...subscribers])listener.update(pages);}
  catch(reason){if(token!==epoch)return;for(const listener of [...subscribers])listener.error(reason);}
  if(subscribers.size)timer=setTimeout(()=>poll(token),2000);
 }
 if(subscribers.size===1)poll(++epoch);
 const changed=()=>poll(++epoch);window.addEventListener('browser-context-limit-changed',changed);
 return ()=>{window.removeEventListener('browser-context-limit-changed',changed);subscribers.delete(listener);if(!subscribers.size){epoch++;clearTimeout(timer);timer=null;}};
}
export function updateBrowserContexts(items,pages){
 let changed=false;
 const next=items.map(item=>{
  if(item.kind!=='browser'||!item.autoUpdate||!item.browserWindowId)return item;
  const page=pages.find(page=>page.browserWindowId===item.browserWindowId);
  const updated=page?{...page,autoUpdate:true,browserUnavailable:false}:{...item,content:'',browserUnavailable:true,description:'浏览器窗口已关闭或当前网页不可读取'};
  if(JSON.stringify(updated)===JSON.stringify(item))return item;
  changed=true;return updated;
 });
 return changed?next:items;
}
