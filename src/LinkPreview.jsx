import {t,useLanguage} from './i18n.js';
import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {PreviewDialog} from './PreviewDialog';
import {invoke,convertFileSrc} from '@tauri-apps/api/core';
import {linkTarget} from './links';
import {imageSource} from './images';
import {CodePreview} from './CodePreview';
import {MediaPlayer} from './MessageResources';
import {RichPreview} from './RichPreview';

const LinkContext=createContext(()=>{});
export const useLinkAction=()=>useContext(LinkContext);
export function LinkProvider({cwd,scope,children}){
 useLanguage();
 const [preview,setPreview]=useState(null);
 const request=useRef(0);
 const close=()=>{request.current++;setPreview(null);};
 useEffect(()=>{close();},[scope]);
 async function open(value,image=false){
  const token=++request.current;
  try{
   const target=image?{kind:'image',src:value}:linkTarget(value,cwd);
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
    setPreview({kind:'image',title:target.path?.split(/[\\/]/u).at(-1)||t("图片"),src});
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
 }
 return <LinkContext.Provider value={open}>{children}{preview&&<PreviewDialog title={preview.title} onClose={close}>
    {preview.loading?<p role="status">{t("正在读取…")}</p>:preview.error?<p role="alert">{preview.error}</p>:preview.kind==='image'?<img src={preview.src} alt={preview.title} referrerPolicy="no-referrer" onError={()=>setPreview(current=>current?{...current,error:t("图片无法加载，文件可能已移动或删除")}:null)}/>:preview.kind==='media'?<MediaPlayer src={preview.src} kind={preview.mediaType} name={preview.title}/>:preview.kind==='html'?<RichPreview kind="html" code={preview.text}/>:<CodePreview text={preview.text} filename={preview.title}/>}
  </PreviewDialog>}</LinkContext.Provider>;
}
