import {t,useLanguage} from './i18n.js';
import React,{useState} from 'react';
import {invoke,convertFileSrc} from '@tauri-apps/api/core';
import {File,ExternalLink,Link,FileAudio,FileVideo} from 'lucide-react';
import {useLinkAction} from './LinkPreview';
import {mediaSource,localResourcePath} from './rich-content';

const convert=path=>window.__TAURI_INTERNALS__?convertFileSrc(path):'';
export function MediaPlayer({src,kind,name=t("媒体"),cwd=''}){
 useLanguage();
 const [error,setError]=useState(''),Tag=kind==='video'?'video':'audio',source=mediaSource(src,convert,cwd),path=localResourcePath(src,cwd);
 async function fallback(){try{await invoke(path?'reveal_file':'open_url',path?{path}:{url:src});}catch(error){setError(String(error.message||error));}}
 return <figure className={'media-player '+kind}><figcaption>{kind==='video'?<FileVideo size={14}/>:<FileAudio size={14}/>}<span>{name}</span></figcaption>{source?<Tag key={source} src={source} controls preload="none" playsInline={kind==='video'||undefined} onError={()=>setError(t("此媒体无法播放，请检查文件、网络或编码格式"))}/>:<p>{t("媒体地址不可访问")}</p>}{error&&<small role="alert">{t(error)}</small>}{(path||/^https?:/iu.test(src))&&<button type="button" className="resource-open" onClick={fallback}>{path?t("在文件夹中查看"):t("在浏览器打开")}<ExternalLink size={11}/></button>}</figure>;
}
export function AttachmentCards({files=[],cwd='',exclude=[]}){
 useLanguage();
 const key=value=>{const path=localResourcePath(value,cwd).replaceAll('\\','/');return /^[a-z]:\//iu.test(path)?path.toLowerCase():path||value;},openLink=useLinkAction(),seen=new Set(exclude.map(key));
 return <div className="message-attachments">{files.filter(file=>{const id=key(file.src);if(seen.has(id))return false;seen.add(id);return true;}).map(file=>file.kind==='audio'||file.kind==='video'?<MediaPlayer key={file.src} {...file} cwd={cwd}/>:<button key={file.src} type="button" className="attachment-card" onClick={()=>openLink(file.src)} title={file.src}><File size={17}/><span><strong>{file.name}</strong><small>{Number.isFinite(file.size)?`${(file.size/1024).toFixed(1)} KB · `:''}{file.name.split('.').at(-1)?.toUpperCase()||t("文件")}</small></span><ExternalLink size={12}/></button>)}</div>;
}
export function SourceCards({sources=[]}){
 useLanguage();
 const openLink=useLinkAction(),unique=[...new Map(sources.map(source=>[source.url,source])).values()];
 if(!unique.length)return null;
 return <details className="source-cards"><summary><Link size={12}/>{t("来源 ·")}{unique.length}</summary><div>{unique.map((source,index)=><button type="button" key={source.url} className="source-card" onClick={()=>openLink(source.url)}><small>{index+1}</small><span><strong>{source.title}</strong><small>{source.kind==='file'?source.url:(()=>{try{return new URL(source.url).hostname;}catch{return source.url;}})()}</small>{source.description&&<p>{source.description}</p>}</span><ExternalLink size={12}/></button>)}</div></details>;
}
