import {Menu} from '@tauri-apps/api/menu';
import {LogicalPosition} from '@tauri-apps/api/dpi';

export function usesNativeMenus(){
 const {nativeMenus,nativeWindowControls}=document.documentElement.dataset;
 return !!window.__TAURI_INTERNALS__&&(nativeMenus==='true'||nativeWindowControls==='true');
}

// The system owns focus, keyboard navigation and dismissal while tracking the menu.
export async function popupNativeMenu(anchor,items){
 const rect=anchor.getBoundingClientRect();
 const windows=document.documentElement.dataset.nativeCaption==='true';
 const menu=await Menu.new({items:windows?windowsMenuItems(items):items});
 try{await menu.popup(new LogicalPosition(rect.left,windows?rect.bottom:rect.top));}
 finally{await menu.close();}
}

// Win32 interprets ampersands in menu labels as keyboard mnemonics.
function windowsMenuItems(items){
 return items.map(item=>{
  if(!item.text)return item;
  const label={...item,text:item.text.replaceAll('&','&&')};
  if(item.items)label.items=windowsMenuItems(item.items);
  return label;
 });
}
