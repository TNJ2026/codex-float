import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Code2,ChartNoAxesCombined,Workflow,Maximize2,Minimize2,RefreshCw,Copy,Check} from 'lucide-react';
import {CodePreview} from './CodePreview';
import {copyText} from './message-actions';

export function RichPreview({kind,code,complete=true}){
 const root=useRef(),frame=useRef(),expandedBefore=useRef(false),expandedRef=useRef(false),timer=useRef(),latestTheme=useRef(document.documentElement.dataset.theme||'light');
 const [running,setRunning]=useState(kind!=='html'),[visible,setVisible]=useState(!window.IntersectionObserver),[page,setPage]=useState(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[height,setHeight]=useState(kind==='echarts'?360:300),[retry,setRetry]=useState(0),[expanded,setExpanded]=useState(false),[copied,setCopied]=useState(false);
 const label=kind==='mermaid'?'Mermaid 图表':kind==='echarts'?'交互式图表':'HTML 预览',Icon=kind==='mermaid'?Workflow:kind==='echarts'?ChartNoAxesCombined:Code2;
 expandedRef.current=expanded;
 useEffect(()=>{
  if(visible||!window.IntersectionObserver)return;const observer=new window.IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(root.current)observer.observe(root.current);return()=>observer.disconnect();
 },[visible]);
 useEffect(()=>{
  let disposed=false,loaded;setPage(null);setReady(false);setError('');setExpanded(false);clearTimeout(timer.current);
  if(!complete||!running||!visible)return;
  invoke('load_rich_preview',{kind,code,theme:latestTheme.current}).then(result=>{loaded=result;if(disposed){invoke('release_mcp_app',{token:result.token}).catch(()=>{});return;}if(!/^http:\/\/127\.0\.0\.1:\d+\/mcp-app\/[a-f\d-]+\/index\.html$/u.test(result.url))throw Error('预览地址无效');setPage(result);timer.current=setTimeout(()=>setError('预览尚未完成，可重试或查看源码'),20000);}).catch(error=>{if(!disposed)setError(String(error.message||error));});
  return()=>{disposed=true;clearTimeout(timer.current);if(loaded)invoke('release_mcp_app',{token:loaded.token}).catch(()=>{});};
 },[kind,code,complete,running,visible,retry]);
 useEffect(()=>{
  if(!page)return;
  const listener=event=>{if(event.source!==frame.current?.contentWindow||event.origin!=='null')return;const data=event.data;if(data?.type==='rich/ready'){clearTimeout(timer.current);setReady(true);setError('');}if(data?.type==='rich/size'&&!expandedRef.current&&Number.isFinite(data.height))setHeight(Math.max(160,Math.min(560,data.height)));if(data?.type==='rich/error'){clearTimeout(timer.current);setError(String(data.message||'无法渲染此内容').slice(0,500));}};
  window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
 },[page?.token]);
 useEffect(()=>{
  const update=()=>{latestTheme.current=document.documentElement.dataset.theme||'light';frame.current?.contentWindow?.postMessage({type:'rich/context',theme:latestTheme.current,expanded:expandedRef.current},'*');};
  const observer=new window.MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();
 },[]);
 useEffect(()=>{if(ready)frame.current?.contentWindow?.postMessage({type:'rich/context',theme:latestTheme.current,expanded},'*');},[expanded,ready]);
 useLayoutEffect(()=>{const dialog=root.current;if(!dialog)return;if(expanded){dialog.close();dialog.showModal();}else if(expandedBefore.current){dialog.close();if(typeof dialog.show==='function')dialog.show();else dialog.setAttribute('open','');}expandedBefore.current=expanded;},[expanded]);
 async function copy(){try{await copyText(code);setCopied(true);setTimeout(()=>setCopied(false),1500);}catch(error){setError(String(error.message||error));}}
 return <dialog open ref={root} className={'rich-preview'+(expanded?' expanded':'')} role={expanded?'dialog':'group'} aria-label={label} aria-modal={expanded||undefined} onCancel={event=>{event.preventDefault();setExpanded(false);}}>
  <header><Icon size={14}/><strong>{label}</strong><button type="button" className="rich-copy" aria-label={copied?'代码已复制':'复制代码'} onClick={copy}>{copied?<Check size={12}/>:<Copy size={12}/>}</button>{page&&<button type="button" aria-label={expanded?'收起预览':'放大预览'} onClick={()=>setExpanded(value=>!value)}>{expanded?<Minimize2 size={12}/>:<Maximize2 size={12}/>}</button>}</header>
  {!complete?<p className="rich-status">等待代码块生成完成…</p>:!running?<button type="button" className="rich-run" onClick={()=>setRunning(true)}>预览 HTML</button>:!page&&!error?<p className="rich-status">{visible?'正在准备预览…':'滚动到此处加载预览'}</p>:null}
  {page&&<iframe ref={frame} title={label} src={page.url} sandbox="allow-scripts" referrerPolicy="no-referrer" aria-busy={!ready} style={{height:expanded?'100%':height,pointerEvents:ready?'auto':'none'}}/>}
  {page&&!ready&&!error&&<small className="rich-status">正在渲染…</small>}
  {error&&<div className="rich-error" role="alert"><span>{error}</span><button type="button" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={11}/>重试</button></div>}
  <details className="rich-source" open={!!error||undefined}><summary>查看源码</summary><CodePreview text={code} filename={kind==='mermaid'?'diagram.mermaid':kind==='echarts'?'chart.json':'preview.html'}/></details>
 </dialog>;
}
