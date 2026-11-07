import React,{useEffect,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {ArrowUp,RefreshCw,Info} from 'lucide-react';
import {ThreadPicker} from './ThreadPicker';
import {Markdown} from './Markdown';
import {MessageActions} from './MessageActions';
import {LinkProvider} from './LinkPreview';
import {messagesOf} from './model';
import {miniStatus} from './mini-status';
import {mergeChatGPTTurns,chatGPTBusy} from './chatgpt';
import {t,useLanguage} from './i18n';

export function ChatGPTSession({ref,active,compact,onMiniStatusChange,windowError,onDismissWindowError}){
 const language=useLanguage();
 const [threads,setThreads]=useState([]),[listCursor,setListCursor]=useState(null),[selected,setSelected]=useState('');
 const [thread,setThread]=useState(null),[turns,setTurns]=useState([]),[cursor,setCursor]=useState(undefined);
 const [error,setError]=useState(''),[loading,setLoading]=useState(false),[loadingOlder,setLoadingOlder]=useState(false),[listLoading,setListLoading]=useState(false);
 const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sent,setSent]=useState(false),[refresh,setRefresh]=useState(0),[status,setStatus]=useState('offline');
 const [autoSync,setAutoSync]=useState(false);
 const scope=useRef(0),target=useRef(selected),sendLock=useRef(false),listScope=useRef(0),scroll=useRef(),input=useRef(),follow=useRef(true),savedScroll=useRef(0);
 target.current=selected;
 const busy=chatGPTBusy(thread),messages=useMemo(()=>messagesOf({turns}).filter(message=>!message.type),[turns,language]);
 async function loadList(nextCursor=null){
  const request=++listScope.current;setListLoading(true);setError('');
  try{
   const result=await invoke('list_chatgpt_threads',{cursor:nextCursor});
   if(request!==listScope.current)return;
   const rows=(result.threads||[]).filter(entry=>entry.kind==='chatgpt').map(entry=>({id:entry.id,thread_name:entry.title,project_id:entry.projectId,project_name:entry.projectId?'ChatGPT':undefined}));
   setThreads(current=>nextCursor?[...current,...rows.filter(row=>!current.some(entry=>entry.id===row.id))]:rows);
   setListCursor(result.nextCursor||null);
   if(!target.current&&rows.length)setSelected(rows[0].id);
  }catch(error){if(request===listScope.current)setError(String(error.message||error));}
  finally{if(request===listScope.current)setListLoading(false);}
 }
 useEffect(()=>{loadList();return()=>{listScope.current++;};},[]);
 useEffect(()=>{
  scope.current++;setThread(null);setTurns([]);setCursor(undefined);setSent(false);setStatus('offline');follow.current=true;
 },[selected]);
 useEffect(()=>{
  if(!active||(compact&&!autoSync)||!selected)return;
  const generation=++scope.current;let disposed=false,timer;
  const current=()=>!disposed&&generation===scope.current;
  async function sync(){
   let succeeded=false;
   setLoading(true);
   try{
    const result=await invoke('read_chatgpt_thread',{threadId:selected,cursor:null});
    if(!current())return;
    setThread(result.thread);setTurns(turns=>mergeChatGPTTurns(turns,result.turns));
    setCursor(value=>value===undefined?result.page?.nextCursor??null:value);
    setStatus('live');setError('');
    succeeded=true;
   }catch(error){if(current()){setStatus('offline');setError(String(error.message||error));}}
   finally{if(current()){setLoading(false);if(autoSync&&succeeded)timer=setTimeout(sync,10000);}}
  }
  sync();
  return()=>{disposed=true;clearTimeout(timer);};
 },[active,compact,selected,refresh,autoSync]);
 async function loadOlder(){
  if(!cursor||loadingOlder)return;
  const id=selected,generation=scope.current;setLoadingOlder(true);
  const before=scroll.current?.scrollHeight||0;
  try{
   const result=await invoke('read_chatgpt_thread',{threadId:id,cursor});
   if(target.current!==id||generation!==scope.current)return;
   follow.current=false;setTurns(turns=>mergeChatGPTTurns(turns,result.turns,{older:true}));setCursor(result.page?.nextCursor||null);
   requestAnimationFrame(()=>{if(target.current===id&&scroll.current)scroll.current.scrollTop+=scroll.current.scrollHeight-before;});
  }catch(error){if(target.current===id)setError(String(error.message||error));}
  finally{setLoadingOlder(false);}
 }
 async function send(){
  if(sendLock.current||!draft.trim()||status!=='live'||busy||!selected)return;
  const id=selected,text=draft;sendLock.current=true;setSending(true);setError('');setSent(false);
  try{
   await invoke('send_chatgpt_message',{threadId:id,text:text.trim()});
   if(target.current!==id)return;
   setDraft(current=>current===text?'':current);setSent(true);setRefresh(value=>value+1);follow.current=true;
  }catch(error){if(target.current===id)setError(String(error.message||error));}
  finally{sendLock.current=false;setSending(false);}
 }
 useLayoutEffect(()=>{if(active&&!compact&&follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[messages,active,compact]);
 useEffect(()=>{if(active&&compact)onMiniStatusChange(miniStatus({turns,threadRuntimeStatus:{type:busy?'active':'idle'}},status,sending));},[active,compact,turns,busy,status,sending,onMiniStatusChange]);
 useImperativeHandle(ref,()=>({saveScroll(){savedScroll.current=scroll.current?.scrollTop||0;},restoreFocus(){if(scroll.current)scroll.current.scrollTop=follow.current?scroll.current.scrollHeight:savedScroll.current;input.current?.focus({preventScroll:true});}}),[]);
 return <LinkProvider scope={selected}>
  <section className="connection">
   <div className="section-label"><label htmlFor="chatgpt-thread-picker">ChatGPT</label><button type="button" className="chatgpt-sync-toggle" aria-pressed={autoSync} onClick={()=>setAutoSync(value=>!value)}>{t(autoSync?'每 10 秒自动同步':'手动同步')}</button></div>
   <div className="thread-row"><ThreadPicker id="chatgpt-thread-picker" threads={threads} value={selected} disabled={sending||listLoading} onChange={id=>{target.current=id;setSelected(id);}}/>
    <button type="button" className="sync-button" aria-label={t('刷新 ChatGPT 会话')} disabled={sending||listLoading} onClick={()=>{loadList();setRefresh(value=>value+1);}}><RefreshCw size={16} className={loading||listLoading?'spin':''}/></button>
   </div>
   {listCursor&&<button type="button" className="chatgpt-more" disabled={listLoading} onClick={()=>loadList(listCursor)}>{t('加载更多会话')}</button>}
  </section>
  {(error||windowError)&&<div className="notice" role="alert"><Info size={16}/><span>{t(error||windowError)}</span>{windowError&&!error&&<button onClick={onDismissWindowError}>×</button>}</div>}
  <section className="messages" ref={scroll} onScroll={()=>{const node=scroll.current;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<85;}}>
   {cursor&&<button type="button" className="chatgpt-more" disabled={loadingOlder} onClick={loadOlder}>{t(loadingOlder?'正在加载…':'加载更早消息')}</button>}
   {!messages.length&&<div className="empty"><h2>{t(loading?'正在同步对话':'选择 ChatGPT 会话')}</h2></div>}
   {messages.map(message=><article key={`${message.turnId}:${message.id}`} className={'message '+message.role}><Markdown text={message.text} streaming={busy&&message.role==='assistant'}/><MessageActions text={message.text} persistentCopy={message.role==='assistant'}/></article>)}
   {busy&&<div className="activity" role="status">{t('ChatGPT 正在回复…')}</div>}
  </section>
  <footer className="composer-area">
   {sent&&<p className="composer-command-status" role="status">{t('已发送，正在同步回复。')}</p>}
   <div className="composer"><div className="composer-input-wrap"><textarea ref={input} aria-label={t('ChatGPT 消息')} rows={2} value={draft} onChange={event=>setDraft(event.target.value)} placeholder={t('发送到当前 ChatGPT 会话…')} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();send();}}}/></div>
    <div className="composer-bottom"><span className="chatgpt-note">{t('在主 App 中继续同一会话')}</span><button type="button" className="send" aria-label={t('发送 ChatGPT 消息')} disabled={!draft.trim()||sending||busy||status!=='live'} onClick={send}>{sending?<RefreshCw size={14} className="spin"/>:<ArrowUp size={16}/>}</button></div>
   </div>
  </footer>
 </LinkProvider>;
}
