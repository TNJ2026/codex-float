import {invoke} from '@tauri-apps/api/core';

export async function copyText(text){
 if(window.__TAURI_INTERNALS__)return invoke('copy_text',{text});
 if(window.navigator.clipboard?.writeText)return window.navigator.clipboard.writeText(text);
 throw Error('当前环境无法写入剪贴板，请在悬浮窗中复制');
}
export function editHistoryKey(messages){
 return JSON.stringify(messages.filter(message=>message.role==='user').map(message=>[message.id,message.turnId,message.text,(message.images||[]).map(image=>image.src)]));
}
