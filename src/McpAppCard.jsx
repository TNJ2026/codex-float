import React,{createContext,useContext,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {AppWindow,ExternalLink,Maximize2,Minimize2,RefreshCw} from 'lucide-react';
import {useLinkAction} from './LinkPreview';
import {createAppBridge} from './mcp-apps';
import {McpToolApproval} from './McpToolApproval';

export const McpAppsContext=createContext({enabled:false});
export function McpAppCard({card,threadId}){
 const host=useContext(McpAppsContext),openLink=useLinkAction(),container=useRef(),frame=useRef(),bridge=useRef(),latest=useRef(),timer=useRef(),mounted=useRef(true),wasExpanded=useRef(false);
 const [visible,setVisible]=useState(!globalThis.IntersectionObserver),[page,setPage]=useState(null),[error,setError]=useState(''),[actionError,setActionError]=useState(''),[loading,setLoading]=useState(false),[ready,setReady]=useState(false),[retry,setRetry]=useState(0),[height,setHeight]=useState(280),[expanded,setExpanded]=useState(false),[theme,setTheme]=useState(document.documentElement.dataset.theme||'light');
 const [toolRequests,setToolRequests]=useState([]),[toolBusy,setToolBusy]=useState(0);
 const resource={...card.resource,threadId:card.resource.threadId||threadId||host.threadId},resourceKey=JSON.stringify(resource),enabled=host.enabled&&host.threadId===resource.threadId;
 latest.current={card,host,resource,enabled,expanded,theme};
 const context=()=>{
  const style=window.getComputedStyle(document.documentElement),dark=latest.current.theme==='dark',color=(name,fallback)=>style.getPropertyValue(name).trim()||fallback;
  return {theme:latest.current.theme,displayMode:latest.current.expanded?'fullscreen':'inline',availableDisplayModes:['inline','fullscreen'],locale:window.navigator.language||'zh-CN',platform:'desktop',styles:{variables:{'--color-background-primary':color('--control',dark?'#181a20':'#fff'),'--color-background-secondary':color('--hover-fill',dark?'#252830':'#f4f5f7'),'--color-text-primary':color('--text',dark?'#f4f4f5':'#18181b'),'--color-text-secondary':color('--text-muted',dark?'#a1a1aa':'#71717a'),'--color-border-primary':color('--stroke',dark?'#3f3f46':'#d4d4d8')}},containerDimensions:{width:Math.max(1,Math.round(frame.current?.getBoundingClientRect().width||400)),maxHeight:latest.current.expanded?Math.max(120,window.innerHeight-120):480}};
 };
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);};},[]);
 useEffect(()=>{
  if(visible||!globalThis.IntersectionObserver)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(container.current)observer.observe(container.current);return()=>observer.disconnect();
 },[visible]);
 useEffect(()=>{const observer=new window.MutationObserver(()=>setTheme(document.documentElement.dataset.theme||'light'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
 useEffect(()=>{
  let disposed=false,loaded;setPage(null);setReady(false);setExpanded(false);setError('');setActionError('');setToolRequests([]);setToolBusy(0);clearTimeout(timer.current);
  if(!visible||!enabled){setLoading(false);return;}
  setLoading(true);
  invoke('load_mcp_app',{resource}).then(result=>{
   loaded=result;if(disposed){invoke('release_mcp_app',{token:result.token}).catch(()=>{});return;}
   if(!/^http:\/\/127\.0\.0\.1:\d+\/mcp-app\/[a-f\d-]+\/index\.html$/u.test(result.url))throw Error('卡片地址无效');
   setPage(result);setLoading(false);timer.current=setTimeout(()=>{if(mounted.current)setError('卡片未完成初始化，可重试或在主 App 打开');},15000);
  }).catch(error=>{if(!disposed){setLoading(false);setError(String(error.message||error));}});
  return()=>{disposed=true;clearTimeout(timer.current);if(loaded)invoke('release_mcp_app',{token:loaded.token}).catch(()=>{});};
 },[visible,enabled,resourceKey,retry]);
 useEffect(()=>{
  if(!page)return;let disposed=false;
  const send=message=>{if(!disposed)frame.current?.contentWindow?.postMessage(message,'*');};
  const subscription=listen('mcp-app-interaction',({payload})=>{if(disposed||payload.token!==page.token||payload.threadId!==latest.current.resource.threadId)return;setToolRequests(current=>payload.resolvedId?current.filter(request=>request.id!==payload.resolvedId):payload.request&&!current.some(request=>request.id===payload.request.id)?[...current,payload.request]:current);});
  subscription.catch(reason=>{if(!disposed)setActionError('卡片交互监听失败：'+String(reason));});
  const toolAction=async(action,name,args)=>{await subscription;if(disposed||!latest.current.enabled)throw Error('卡片已关闭或聊天已切换');setActionError('');if(action==='call')setToolBusy(value=>value+1);try{return await invoke('mcp_app_tool',{token:page.token,action,...action==='call'?{name,arguments:args}:{}});}finally{if(!disposed&&action==='call')setToolBusy(value=>Math.max(0,value-1));}};
  const appBridge=createAppBridge({frame:()=>frame.current?.contentWindow,send,getData:()=>({enabled:latest.current.enabled&&!disposed,input:latest.current.card.input,result:latest.current.card.result}),getContext:context,onInitialized:()=>{clearTimeout(timer.current);setReady(true);setError('');},onSize:height=>{if(!latest.current.expanded)setHeight(height);},onDisplayMode:mode=>setExpanded(mode==='fullscreen'),onMessage:async text=>{setExpanded(false);await latest.current.host.onFollowUp(latest.current.resource.threadId,text);},onOpenLink:url=>invoke('open_url',{url}),onReadResource:uri=>invoke('read_mcp_app_resource',{token:page.token,uri}),onListTools:()=>toolAction('list'),onCallTool:(name,args)=>toolAction('call',name,args),onError:setActionError});
  bridge.current=appBridge;
  const listener=event=>appBridge.handle(event);window.addEventListener('message',listener);
  return()=>{disposed=true;bridge.current=null;window.removeEventListener('message',listener);subscription.then(off=>off()).catch(()=>{});};
 },[page?.token]);
 useEffect(()=>{if(ready)bridge.current?.pushData();},[ready,card.input,card.result]);
 useEffect(()=>{
  const notify=()=>{if(ready)bridge.current?.notify('ui/notifications/host-context-changed',context());};notify();window.addEventListener('resize',notify);return()=>window.removeEventListener('resize',notify);
 },[ready,theme,expanded]);
 useLayoutEffect(()=>{
  const dialog=container.current;if(!dialog)return;
  if(expanded){dialog.close();dialog.showModal();}else if(wasExpanded.current){dialog.close();if(typeof dialog.show==='function')dialog.show();else dialog.setAttribute('open','');}wasExpanded.current=expanded;
 },[expanded]);
 // A non-modal dialog keeps the same iframe alive when promoted to the top layer.
 return <dialog open ref={container} className={'mcp-app-card'+(expanded?' expanded':'')} role={expanded?'dialog':'group'} aria-label={card.title} aria-modal={expanded||undefined} onCancel={event=>{event.preventDefault();setExpanded(false);}}>
  <header><AppWindow size={14}/><strong>{card.title}</strong><button type="button" aria-label="在主 App 打开卡片" title="在主 App 打开" onClick={()=>openLink(`codex://threads/${resource.threadId}`)}><ExternalLink size={12}/></button>{page&&<button type="button" aria-label={expanded?'收起卡片':'放大卡片'} title={expanded?'收起':'放大'} onClick={()=>setExpanded(value=>!value)}>{expanded?<Minimize2 size={12}/>:<Maximize2 size={12}/>}</button>}</header>
  {(loading||page&&!ready&&!error)&&<p className="mcp-app-status" role="status">{loading?'正在加载卡片…':'正在初始化卡片…'}</p>}
  {toolBusy>0&&<p className="mcp-app-status" role="status">正在执行卡片操作{toolBusy>1?`（${toolBusy} 项）`:''}…</p>}
  {toolRequests.map(request=><McpToolApproval key={request.id} request={request} onReply={async(request,payload)=>{await invoke('reply_mcp_app_request',{token:page.token,requestId:request.id,payload});setToolRequests(current=>current.filter(item=>item.id!==request.id));}}/>)}
  {!enabled&&!page&&<p className="mcp-app-status">连接聊天后加载卡片</p>}
  {page&&<iframe ref={frame} src={page.url} title={`${card.title} · MCP App`} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{height:expanded?'100%':height}}/>}
  {(error||actionError)&&<div className="mcp-app-error" role="alert"><span>{error||actionError}</span>{error&&<button type="button" disabled={loading||!enabled} onClick={()=>setRetry(value=>value+1)}><RefreshCw size={11}/>重试</button>}</div>}
 </dialog>;
}
