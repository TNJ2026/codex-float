import {Menu} from '@tauri-apps/api/menu';
import {LogicalPosition} from '@tauri-apps/api/dpi';

export function isNativeMac(){return !!window.__TAURI_INTERNALS__&&document.documentElement.dataset.nativeWindowControls==='true';}

// AppKit owns focus, keyboard navigation, dismissal and accessibility while
// tracking the menu. Release its Tauri resource after native tracking ends.
export async function popupNativeMenu(anchor,items){
 const rect=anchor.getBoundingClientRect();
 const menu=await Menu.new({items});
 try{await menu.popup(new LogicalPosition(rect.left,rect.top));}
 finally{await menu.close();}
}
