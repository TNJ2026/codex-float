import {t,useLanguage} from './i18n.js';
import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {PreviewDialog} from './PreviewDialog';
import {invoke,convertFileSrc} from '@tauri-apps/api/core';
import {linkTarget} from './links';
import {imageSource} from './images';
import {localResourcePath} from './rich-content';
import {CodePreview} from './CodePreview';
import {MediaPlayer} from './MessageResources';
import {RichPreview} from './RichPreview';
import {ImagePreview} from './ImagePreview';
import {LinkContextMenu} from './LinkContextMenu';

const LinkContext=createContext(()=>{});
const LinkMenuContext=createContext(()=>{});
export const useLinkAction=()=>useContext(LinkContext);
export const useLinkMenu=()=>useContext(LinkMenuContext);
export function LinkProvider({cwd,scope,children}){
 useLanguage();
 const [preview,setPreview]=useState(null);
 const [menu,setMenu]=useState(null),menuRef=useRef(null),menuId=useRef(0);
 menuRef.current=menu;
 const request=useRef(0);
 const close=useCallback(()=>{request.current++;setPreview(null);setMenu(null);},[]);
 useEffect(()=>{close();},[scope,cwd,close]);
 const showMenu=useCallback((event,value)=>{
  if(event.type==='keydown'&&event.key!=='ContextMenu'&&!(event.key==='F10'&&event.shiftKey))return;
  event.preventDefault();event.stopPropagation();
  const trigger=event.target.closest('a,button,img,[tabindex]')||event.currentTarget;
  const rect=trigger.getBoundingClientRect();
  let target;try{target=linkTarget(value,cwd);}catch{}
  setMenu({id:++menuId.current,value,target,trigger,container:trigger.closest('dialog[open]')||document.body,x:event.clientX||event.clientY?event.clientX:rect.left,y:event.clientX||event.clientY?event.clientY:rect.bottom});
 },[cwd]);
 function dismissMenu(id,restore){
  const current=menuRef.current;if(current?.id!==id)return;
  setMenu(null);
  if(restore&&current.trigger.isConnected)current.trigger.focus({preventScroll:true});
 }
 const open=useCallback(async(value,image=false)=>{
  const token=++request.current;
  try{
   const target=image?{kind:'image',src:imageSource(value,path=>convertFileSrc(path))||value,path:localResourcePath(value,cwd)||undefined}:linkTarget(value,cwd);
   if(target.kind==='url'){
    await invoke('open_url',{url:target.url});
    return;
   }
   if(target.kind==='anchor'){
    document.getElementById(target.id)?.scrollIntoView({block:'nearest'});
    return;
   }
   if(target.kind==='media'){
    setPreview({kind:'media',title:target.name||target.path?.split(/[\\/]/u).at(-1)||t("媒体"),src:target.src||target.path,mediaType:target.mediaType});
   }else if(target.kind==='image'){
    const src=target.src||imageSource(target.path,path=>convertFileSrc(path));
    if(!src)throw Error(t("无法显示此图片"));
    setPreview({kind:'image',path:target.path,title:target.path?.split(/[\\/]/u).at(-1)||t("图片"),src});
   }else{
    setPreview({kind:'text',title:target.path.split(/[\\/]/u).at(-1),loading:true});
    const result=await invoke('read_file_preview',{path:target.path});
    if(token!==request.current)return;
    if(result.kind==='folder'){
     await invoke('reveal_file',{path:target.path});
     if(token===request.current)close();
    }else setPreview({kind:/\.html?$/iu.test(target.path)?'html':'text',title:target.path.split(/[\\/]/u).at(-1),text:result.text});
   }
  }catch(error){if(token===request.current)setPreview({title:t("无法打开链接"),error:String(error.message||error)});}
 },[cwd,close]);
 return <LinkContext.Provider value={open}><LinkMenuContext.Provider value={showMenu}>{children}{preview&&<PreviewDialog title={preview.title} onClose={close} className={preview.kind==='image'&&!preview.error?'image-preview-dialog':''}>
    {preview.loading?<p role="status">{t("正在读取…")}</p>:preview.error?<p role="alert">{preview.error}</p>:preview.kind==='image'?<ImagePreview key={preview.src} src={preview.src} alt={preview.title} onContextMenu={event=>showMenu(event,preview.path||preview.src)} onError={()=>setPreview(current=>current?{...current,error:t("图片无法加载，文件可能已移动或删除")}:null)}/>:preview.kind==='media'?<MediaPlayer src={preview.src} kind={preview.mediaType} name={preview.title}/>:preview.kind==='html'?<RichPreview kind="html" code={preview.text}/>:<CodePreview text={preview.text} filename={preview.title}/>}
  </PreviewDialog>}{menu&&<LinkContextMenu key={menu.id} menu={menu} onClose={restore=>dismissMenu(menu.id,restore)} onOpen={open}/>}</LinkMenuContext.Provider></LinkContext.Provider>;
}
