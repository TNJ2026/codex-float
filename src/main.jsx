import React, {memo,useEffect,useMemo,useRef,useState,startTransition} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {ArrowUp, Minus, X, Pin, RefreshCw, MessageSquare, ArrowDown, Info, Zap, Square} from 'lucide-react';
import {Markdown} from './Markdown';
import {LinkProvider} from './LinkPreview';
import {ChangedFiles} from './ChangedFiles';
import {applyChange,messagesOf,activityOf,modelDisplayName,turnsOf} from './model';
import {ThreadPicker} from './ThreadPicker';
import {AccountUsage} from './AccountUsage';
import {InteractionMessages} from './InteractionMessages';
import {Settings} from './Settings';
import {readTheme} from './theme';
import {readAppearance,applyTransparency} from './appearance';
import {MiniStatus} from './MiniStatus';
import {miniStatus} from './mini-status';
import {asyncQuestionRequests,questionReplyText,parseQuestionReply} from './async-questions';
import {QuestionAnswer} from './QuestionAnswer';
import {activeTurnId,turnIsRunning} from './stop-task';
import {afterMessagePaint,hasMessageEcho,mergeOptimisticMessages,unconfirmedMessages} from './optimistic';
import chatgptIcon from './assets/chatgpt-mark.svg';
import './fluent.css';

const native=!!window.__TAURI_INTERNALS__;
document.documentElement.dataset.theme=readTheme(localStorage);
applyTransparency(document.documentElement,readAppearance(localStorage).transparency);
const Message = memo(function Message({id,type,role,phase,text='',images,files,cwd,pending,failed}) {
 const answers=useMemo(()=>role==='user'?parseQuestionReply(text):[],[text,role]);
 return <article className={'message '+role+(phase==='commentary'?' commentary':'')} data-message-id={id}>
  {type==='changedFiles'?<ChangedFiles files={files} cwd={cwd}/>:answers.length?<QuestionAnswer answers={answers}/>:<Markdown text={text} images={images}/>}
  {pending&&<small>正在发送…</small>}
  {failed&&<small>发送未确认，请检查错误提示后重试。</small>}
 </article>;
});
function App(){
 const [stopping,setStopping]=useState(false);
 const stoppingRef=useRef(false);
 const [compact,setCompact]=useState(false);
 const compactRef=useRef(false),changingMode=useRef(false),savedScroll=useRef(0);
 const [optimistic,setOptimistic]=useState([]);
 const sendingRef=useRef(false);
 const [modelNames,setModelNames]=useState({});
 const [threads,setThreads]=useState([]),[selected,setSelected]=useState(''),[status,setStatus]=useState('offline'),[error,setError]=useState(''),[conversation,setConversation]=useState(null),[draft,setDraft]=useState(''),[pinned,setPinned]=useState(true),[sending,setSending]=useState(false),[follow,setFollow]=useState(true);
 const live=useRef({state:null,revision:null}),selectedRef=useRef(''),boundRef=useRef(''),connecting=useRef(false),scroll=useRef(),draftBox=useRef(),schedule=useRef(null),resyncing=useRef(false);
 const remoteMessages=useMemo(()=>messagesOf(conversation),[conversation?.turnHistory?.history,conversation?.turns]);
 const messages=useMemo(()=>mergeOptimisticMessages(remoteMessages,optimistic),[remoteMessages,optimistic]);
 useEffect(()=>{setOptimistic(current=>{
  const remaining=unconfirmedMessages(remoteMessages,current);
  return remaining.length===current.length?current:remaining;
 });},[remoteMessages]);
 const activity=useMemo(()=>activityOf(conversation),[conversation]);
 const busy=!!activity;
 const stopTurnId=activeTurnId(conversation);
 const requests=useMemo(()=>[...(conversation?.requests||[]),...asyncQuestionRequests(conversation)].map(request=>{
  if(request.method!=='item/fileChange/requestApproval')return request;
  const item=turnsOf(conversation).flatMap(turn=>Array.isArray(turn.items)?turn.items:Object.values(turn.items?.entitiesByKey||{})).find(item=>item.id===request.params?.itemId);
  return {...request,fileChanges:item?.changes};
 }),[conversation?.requests,conversation?.turnHistory?.history,conversation?.turns]);
 const serviceTier=conversation?.latestThreadSettings?.serviceTier;
 const fastMode=serviceTier==='priority';
 const speedLabel=!conversation?'等待速度信息':fastMode?'快速模式':serviceTier==='flex'?'弹性模式':'标准速度';
 const selectedProject=threads.find(thread=>thread.id===selected)?.project_name||'未分配项目';
 async function refresh(){try{const r=await invoke('list_threads');setThreads(r.threads);setModelNames(r.modelNames||{});return r;}catch(e){setError(String(e));}}
 async function connect(id=selectedRef.current){
  if(!id||connecting.current)return;if(id!==boundRef.current)setOptimistic([]);connecting.current=true;boundRef.current=id;setStatus('connecting');setError('');live.current={state:null,revision:null};setConversation(null);
  try{await invoke('connect_thread',{threadId:id});setStatus('live');localStorage.setItem('codex-float-thread',id);}catch(e){setStatus('offline');setError(String(e));}finally{connecting.current=false;}
 }
 useEffect(()=>{
  if(!native){setError('请使用 Tauri 启动此面板以连接桌面端');return;}
  invoke('background_settings').then(settings=>{document.documentElement.dataset.nativeBackground=settings.mode;if(settings.error)setError('背景材质已回退：'+settings.error);}).catch(()=>{});
  let disposed=false,off=[];
  (async()=>{
   off.push(await listen('codex-stream',({payload})=>{
    if(payload.conversationId!==boundRef.current)return;
    try{
     live.current=applyChange(live.current.state,live.current.revision,payload.change);
     setStatus('live');
     if(!schedule.current)schedule.current=setTimeout(()=>{startTransition(()=>setConversation(live.current.state));schedule.current=null;},90);
    }catch(e){
     setError(String(e.message));
     if(!resyncing.current){resyncing.current=true;setTimeout(async()=>{await connect(boundRef.current);resyncing.current=false;},500);}
    }
   }));
   off.push(await listen('codex-disconnected',({payload})=>{setStatus('offline');setError(payload);}));
   if(disposed){off.forEach(f=>f());return;}
   const r=await refresh();if(disposed||!r)return;
   const id=r.currentThread||localStorage.getItem('codex-float-thread')||r.threads[0]?.id||'';
   selectedRef.current=id;setSelected(id);await connect(id);
  })();
  return()=>{disposed=true;off.forEach(f=>f());clearTimeout(schedule.current);};
 },[]);
 const lastMessage=messages.at(-1);
 useEffect(()=>{if(!compact&&follow&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[messages.length,lastMessage?.id,lastMessage?.text,activity?.label,conversation?.requests,follow,compact]);
 async function changeCompact(next){
  if(changingMode.current)return;
  changingMode.current=true;
  if(next)savedScroll.current=scroll.current?.scrollTop||0;
  compactRef.current=next;
  try{
   const actual=await invoke('set_mini_mode',{compact:next});
   compactRef.current=actual;
   setCompact(actual);
   if(!actual)requestAnimationFrame(()=>{if(scroll.current)scroll.current.scrollTop=follow?scroll.current.scrollHeight:savedScroll.current;draftBox.current?.focus({preventScroll:true});});
  }catch(e){compactRef.current=compact;setError(String(e));}
  finally{changingMode.current=false;}
 }
 async function replyInteraction(request,payload){
  const threadId=boundRef.current;
  if(status!=='live'||selectedRef.current!==threadId)throw Error('请先同步当前聊天');
  if(request.method==='local/asyncQuestions'){
   const current=asyncQuestionRequests(live.current.state).find(r=>r.id===request.id);
   if(!current||JSON.stringify(current.params)!==JSON.stringify(request.params))throw Error('问题已回答或已更新');
   await invoke('send_prompt',{threadId,text:questionReplyText(current,payload.response),steer:!!activityOf(live.current.state),clientMessageId:crypto.randomUUID()});
   await confirmInteraction(threadId,()=>asyncQuestionRequests(live.current.state).some(r=>r.id===request.id));
   return;
  }
  const pending=live.current.state?.requests?.find(r=>r.id===request.id&&r.method===request.method);
  if(!pending||JSON.stringify(pending.params)!==JSON.stringify(request.params))throw Error('请求已处理或已更新，请查看最新会话');
  await invoke('reply_interaction',{threadId,requestId:request.id,requestMethod:request.method,payload});
  await confirmInteraction(threadId,()=>(live.current.state?.requests||[]).some(r=>r.id===request.id&&r.method===request.method));
 }
 async function confirmInteraction(threadId,isPending){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   if(boundRef.current!==threadId||status!=='live')throw Error('连接已变化，请检查主窗口是否收到回答，避免重复提交');
   if(live.current.state&&!isPending())return;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('回答已发送，但尚未收到问题处理确认；请检查主窗口，避免重复提交');
 }
 async function send(){
  if(!draft.trim()||sendingRef.current||stoppingRef.current||status!=='live'||selected!==boundRef.current)return;
  const submittedDraft=draft,threadId=boundRef.current;
  const local={id:crypto.randomUUID(),role:'user',text:submittedDraft.trim(),pending:true,baselineIds:new Set(messagesOf(live.current.state).map(m=>m.id))};
  sendingRef.current=true;
  flushSync(()=>{setOptimistic(current=>[...current,local]);setDraft('');setSending(true);setError('');setFollow(true);});
  draftBox.current?.focus();
  try{
   await afterMessagePaint();
   if(selectedRef.current!==threadId||boundRef.current!==threadId)throw new Error('聊天已切换，提示词尚未发送');
   const pendingQuestions=asyncQuestionRequests(live.current.state);
   const single=pendingQuestions.length===1&&pendingQuestions[0].params.questions.length===1?pendingQuestions[0]:null;
   const text=single?questionReplyText(single,{answers:{[single.params.questions[0].id]:{answers:[local.text]}}}):local.text;
   await invoke('send_prompt',{threadId,text,steer:!!activityOf(live.current.state),clientMessageId:local.id});
   setOptimistic(current=>current.map(m=>m.id===local.id?{...m,pending:false}:m));
  }catch(e){
   const echoed=boundRef.current===threadId&&hasMessageEcho(messagesOf(live.current.state),local);
   setOptimistic(current=>echoed?current.filter(m=>m.id!==local.id):current.map(m=>m.id===local.id?{...m,pending:false,failed:true}:m));
   if(!echoed&&selectedRef.current===threadId){setDraft(current=>current||submittedDraft);setError(String(e));}
  }finally{sendingRef.current=false;setSending(false);}
 }
 async function stopTask(){
  if(stoppingRef.current||status!=='live'||selected!==boundRef.current)return;
  const threadId=boundRef.current,turnId=activeTurnId(live.current.state);
  if(!turnId)return;
  stoppingRef.current=true;setStopping(true);setError('');
  try{
   const result=await invoke('stop_task',{threadId,turnId});
   if(boundRef.current!==threadId)return;
   if(result?.goalPauseError)setError('任务已停止，但长期目标暂停失败：'+result.goalPauseError);
   const deadline=Date.now()+5000;
   while(boundRef.current===threadId&&turnIsRunning(live.current.state,turnId)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
   if(boundRef.current===threadId&&turnIsRunning(live.current.state,turnId))setError('已发送停止请求，尚未收到任务停止确认，请检查主窗口');
  }catch(e){if(boundRef.current===threadId)setError('停止任务失败：'+String(e));}
  finally{stoppingRef.current=false;setStopping(false);}
 }
 const iconButton=(title,icon,onClick,cls='',pressed)=><button className={'icon-button '+cls} title={title} aria-label={title} aria-pressed={pressed} onClick={onClick}>{icon}</button>;
 return <LinkProvider cwd={conversation?.cwd||conversation?.latestThreadSettings?.cwd} scope={selected}><main className={'shell'+(compact?' compact':'')}>
  {compact&&<MiniStatus status={miniStatus(conversation,status,sending||optimistic.some(m=>!m.failed))} onRestore={()=>changeCompact(false)} onError={setError}/>}
  <div className="chat-panel" hidden={compact}>
  <header className="titlebar" onMouseDown={e=>{if(e.button===0&&!e.target.closest('button'))native&&getCurrentWindow().startDragging().catch(()=>{});}}>
   <div className="brand"><img className="brand-mark" src={chatgptIcon} alt="" aria-hidden="true"/><span>Codex 悬浮窗</span></div>
   <div className="window-actions">
    <Settings/>
    <button className={'icon-button caption-button pin-button'+(pinned?' active':'')} aria-label={pinned?'取消置顶':'置顶'} aria-pressed={pinned} title={pinned?'取消置顶':'置顶'} onClick={async()=>{try{await getCurrentWindow().setAlwaysOnTop(!pinned);setPinned(!pinned);}catch(e){setError(String(e));}}}><Pin size={16}/></button>
    {iconButton('最小化为状态球',<Minus size={16}/>,()=>changeCompact(true),'caption-button')}
    {iconButton('关闭面板',<X size={16}/>,()=>getCurrentWindow().close(),'caption-button close')}
   </div>
  </header>
  <section className="connection">
   <div className="section-label"><label htmlFor="thread-picker">当前聊天</label><span className="current-project" title={selectedProject}>{selectedProject}</span></div>
   <div className="thread-row"><ThreadPicker threads={threads} value={selected} disabled={status==='connecting'} onChange={id=>{selectedRef.current=id;setSelected(id);setFollow(true);connect(id);}}/>
    <button type="button" className={'sync-button '+status} disabled={status==='connecting'||!selected} title={status==='live'?'已同步，点击重新同步当前聊天':status==='connecting'?'正在同步当前聊天…':'未同步，点击连接当前聊天'} aria-label={status==='live'?'已同步，点击重新同步当前聊天':status==='connecting'?'正在同步当前聊天':'未同步，点击连接当前聊天'} onClick={async()=>{await refresh();await connect();}}><RefreshCw size={16} aria-hidden="true" className={status==='connecting'?'spin':''}/></button>
   </div>
  </section>
  {error&&<div className="notice" role="alert"><Info size={16}/><span>{error}</span><button aria-label="关闭提示" onClick={()=>setError('')}><X size={14}/></button></div>}
  <section className="messages" ref={scroll} onLoadCapture={e=>{if(e.target.tagName==='IMG'&&follow&&!compactRef.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;}} onScroll={()=>{if(compactRef.current)return;const e=scroll.current;setFollow(e.scrollHeight-e.scrollTop-e.clientHeight<85);}}>
   {!messages.length&&!requests.length?<div className="empty"><div className="empty-mark"><MessageSquare size={28}/></div><h2>{status==='connecting'?'正在同步对话':'让对话留在手边'}</h2><p>在 Codex 主窗口打开聊天，<br/>连接后即可在这里继续对话。</p></div>:<div className="history-divider"><span>与主窗口同步</span></div>}
   <InteractionMessages key={boundRef.current} threadId={boundRef.current} requests={requests} messages={messages} MessageComponent={Message} disabled={status!=='live'||selected!==boundRef.current} onReply={replyInteraction}/>
   {activity&&<div className="typing" role="status" aria-live="polite"><span/><span/><span/><em>{activity.label}</em></div>}
  </section>
  {!follow&&iconButton('回到最新消息',<ArrowDown size={16}/>,()=>setFollow(true),'jump')}
  <footer className="composer-area">
   <div className="composer">
    <textarea id="prompt-input" ref={draftBox} aria-label="提示词" rows="2" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}} placeholder={busy?'告诉 Codex 接下来怎么做…':'向 Codex 发送消息…'}/>
    <div className="composer-bottom">
     <div className="footer-meta">

    <span className="model-summary"><span className={'model-speed'+(fastMode?' fast':'')} title={speedLabel} role="img" aria-label={speedLabel}><Zap size={14} fill={fastMode?'currentColor':'none'} aria-hidden="true"/></span><span className="model-name" title={modelDisplayName(conversation?.latestModel,modelNames)}>{modelDisplayName(conversation?.latestModel,modelNames)||'等待模型信息'}</span></span>
      <AccountUsage busy={busy}><button className={'send'+(busy||stopping?' stop-task':'')} aria-label={busy||stopping?'停止任务':'发送提示词'} aria-busy={stopping||sending} title={stopping?'正在停止任务…':busy?'停止当前任务（输入后 Enter 可追加指令）':'发送到当前聊天'} disabled={status!=='live'||selected!==boundRef.current||(busy||stopping?stopping||!stopTurnId:!draft.trim()||sending)} onClick={busy||stopping?stopTask:send}>{stopping||sending?<RefreshCw size={14} className="spin"/>:busy?<Square size={10} fill="currentColor"/>:<ArrowUp size={16}/>}</button></AccountUsage>
     </div>
    </div>
   </div>

  </footer>
  </div>
 </main></LinkProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
