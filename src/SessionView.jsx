import React, {memo,useCallback,useEffect,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState,startTransition} from 'react';
import {flushSync} from 'react-dom';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {ArrowUp, X, RefreshCw, MessageSquare, ArrowDown, Info, Square} from 'lucide-react';
import {Markdown} from './Markdown';
import {LinkProvider} from './LinkPreview';
import {ChangedFiles} from './ChangedFiles';
import {TaskDetails} from './TaskDetails';
import {SubagentActionsContext} from './SubagentActions';
import {SubagentProgress} from './SubagentProgress';
import {MessageActions,MessageEditor} from './MessageActions';
import {ForkMessageDialog} from './ForkMessageDialog';
import {forkSettingsOf} from './forks';
import {editHistoryKey} from './message-actions';
import {finalReplyCopies} from './final-reply-copy';
import {transcriptMessages} from './transcript';
import {completedWorkEntries} from './completed-work';
import {WorkDetails} from './WorkDetails';
import {ToolTimelineRow,ToolProcessGroup} from './ToolDetails';
import {McpAppCard,McpAppsContext} from './McpAppCard';
import {SpeedPicker} from './SpeedPicker';
import {applyChange,messagesOf,activityOf,turnsOf} from './model';
import {ThreadPicker} from './ThreadPicker';
import {AccountUsage} from './AccountUsage';
import {InteractionMessages} from './InteractionMessages';
import {ComposerPrediction,useComposerPrediction} from './ComposerPrediction';
import {predictionKey} from './predictions';
import {AttachmentButton,ComposerAttachments,useAttachments} from './ComposerAttachments';
import {attachmentMessage} from './attachments';
import {ContextButton,ContextChips,ContextPicker,useContextDraft} from './ContextPicker';
import {contextMessage,mentionAt} from './context';
import {ModelPicker} from './ModelPicker';
import {PermissionPicker} from './PermissionPicker';
import {SlashMenu,ChatStatus} from './SlashMenu';
import {slashAt,slashCommands} from './slash-commands';
import {withModelSettings} from './model-settings';
import {miniStatus} from './mini-status';
import {asyncQuestionRequests,questionReplyText,parseQuestionReply} from './async-questions';
import {QuestionAnswer} from './QuestionAnswer';
import {activeTurnId,turnIsRunning} from './stop-task';
import {afterMessagePaint,hasMessageEcho,mergeOptimisticMessages,unconfirmedMessages,isSendTimeout,waitForMessageEcho} from './optimistic';

const Message = memo(function Message({id,type,role,phase,text='',images,files,cwd,pending,failed,active,steps,explanation,turnStatus,turnDurationMs,agents,errors,turnId,copyable,calls,toolCall,toolStatus,toolTitle,editable,onEdit,editDisabled,workMessages,appCard,attachments,references,forkable,onFork,forkDisabled}) {
 const answers=useMemo(()=>role==='user'?parseQuestionReply(text):[],[text,role]);
 return <article className={'message '+role+(phase==='commentary'?' commentary':'')} data-message-id={id}>
  {type==='toolGroup'?<ToolProcessGroup calls={calls}/>:type==='toolDetails'?<ToolTimelineRow call={{id,toolCall,toolStatus,toolTitle}}/>:type==='mcpApp'?<McpAppCard card={appCard} threadId={appCard.resource.threadId}/>:type==='workSummary'?<WorkDetails items={workMessages} durationMs={turnDurationMs}>{completedWorkEntries(workMessages).map(message=><Message key={message.id} {...message} onEdit={onEdit} editDisabled={editDisabled} onFork={onFork} forkDisabled={forkDisabled}/>)}</WorkDetails>:type==='subagentProgress'?<SubagentProgress agents={agents} errors={errors} turnStatus={turnStatus}/>:['reasoningSummary','taskPlan','proposedPlan'].includes(type)?<TaskDetails type={type} text={text} active={active} steps={steps} explanation={explanation} turnStatus={turnStatus}/>:type==='changedFiles'?<ChangedFiles files={files} cwd={cwd}/>:answers.length?<QuestionAnswer answers={answers}/>:<Markdown text={text} images={images} attachments={attachments} references={references} cwd={cwd} streaming={role==='assistant'&&turnStatus==='inProgress'}/>}
  {pending&&<small>正在发送…</small>}
  {failed&&<small>发送未确认，请检查错误提示后重试。</small>}
  {!type&&<MessageActions text={copyable?text:''} persistentCopy={!!copyable} editable={editable} editDisabled={editDisabled||pending||failed} onEdit={()=>onEdit?.({id,turnId,text})} forkable={forkable} forkDisabled={forkDisabled||pending||failed} onFork={()=>onFork?.({id,turnId,text})}/>}
 </article>;
});
export function SessionView({ref,compact,compactRef,predictionsEnabled,windowError,onDismissWindowError,onMiniStatusChange}){
 const [sendWarning,setSendWarning]=useState(null);
 const [forking,setForking]=useState(null),[forkSaving,setForkSaving]=useState(false),forkDraft=useRef(null),forkLock=useRef(false);
 const [editing,setEditing]=useState(null),[editSaving,setEditSaving]=useState(false),editLock=useRef(false);
 const [modelSaving,setModelSaving]=useState(false);
 const [permissionSaving,setPermissionSaving]=useState(false);
 const [speedSaving,setSpeedSaving]=useState(false),[speedToggleRequest,setSpeedToggleRequest]=useState(0);
 const [commandSaving,setCommandSaving]=useState(false),[commandMessage,setCommandMessage]=useState(''),[statusOpen,setStatusOpen]=useState(false),[modelOpenRequest,setModelOpenRequest]=useState(0),[permissionOpenRequest,setPermissionOpenRequest]=useState(0);
 const commandLock=useRef(false);
 const [stopping,setStopping]=useState(false);
 const stoppingRef=useRef(false);
 const [optimistic,setOptimistic]=useState([]);
 const sendingRef=useRef(false);
 const [modelNames,setModelNames]=useState({});
 const [threads,setThreads]=useState([]),[selected,setSelected]=useState(''),[status,setStatus]=useState('offline'),[error,setError]=useState(''),[conversation,setConversation]=useState(null),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[follow,setFollow]=useState(true);
 const uploads=useAttachments({scope:selected,onError:setError});
 const contextDraft=useContextDraft(selected);
 const [contextOpen,setContextOpen]=useState(false),[mention,setMention]=useState(null),[contextRows,setContextRows]=useState([]),[contextIndex,setContextIndex]=useState(0),[snippetSelection,setSnippetSelection]=useState('');
 const activeMention=mention&&draft.slice(mention.start,mention.end)===mention.trigger+mention.query?mention:null;
 const contextSelect=useRef(null);
 const [slash,setSlash]=useState(null),[commandRows,setCommandRows]=useState([]),[commandIndex,setCommandIndex]=useState(0);
 const commandSelect=useRef(null),activeSlash=slash&&draft.slice(0,slash.end)===slash.text?slash:null;
 const closeSlash=useCallback(()=>setSlash(null),[]);
 const closeContext=useCallback(()=>{setContextOpen(false);setMention(null);},[]);
 useEffect(()=>{closeContext();},[selected,closeContext]);
 useEffect(()=>{closeSlash();setStatusOpen(false);setCommandMessage('');},[selected,closeSlash]);
 useEffect(()=>{setEditing(null);},[selected]);
 useEffect(()=>{setCommandIndex(0);},[activeSlash?.query,commandRows]);
 useEffect(()=>{setContextIndex(0);},[mention?.query,contextRows]);
 const live=useRef({state:null,revision:null}),selectedRef=useRef(''),boundRef=useRef(''),connecting=useRef(false),scroll=useRef(),draftBox=useRef(),schedule=useRef(null),resyncing=useRef(false);
 const commandCaret=useRef(null);
 useLayoutEffect(()=>{if(commandCaret.current!==null&&draftBox.current){const caret=commandCaret.current;commandCaret.current=null;draftBox.current.focus();draftBox.current.setSelectionRange(caret,caret);}},[draft]);
 const remoteMessages=useMemo(()=>messagesOf(conversation,{toolTimeline:true}).filter(message=>message.type!=='reasoningSummary'),[conversation?.turnHistory?.history,conversation?.turns]);
 useEffect(()=>{setSendWarning(warning=>warning&&(warning.threadId!==selected||hasMessageEcho(remoteMessages,warning.local))?null:warning);},[selected,remoteMessages]);
 const messages=useMemo(()=>finalReplyCopies(transcriptMessages(mergeOptimisticMessages(remoteMessages,optimistic))),[remoteMessages,optimistic]);
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
 function modelSettingsApplied(threadId,settings){
  if(boundRef.current!==threadId||selectedRef.current!==threadId)return;
  const next=withModelSettings(live.current.state,settings);live.current={...live.current,state:next};setConversation(next);
 }
 function threadSettingsApplied(threadId,settings){
  if(boundRef.current!==threadId||selectedRef.current!==threadId)return;
  const state=live.current.state;if(!state)return;
  const next={...state,latestThreadSettings:{...state.latestThreadSettings,...settings}};
  live.current={...live.current,state:next};setConversation(next);
 }
 const selectedThread=threads.find(thread=>thread.id===selected);
 const selectedProject=selectedThread?.project_name||'未分配项目';
 const selectedProjectTitle=selectedThread?.project_source==='workspace'?`${selectedProject}（根据工作目录匹配）`:selectedProject;
 const contextCwd=conversation?.cwd||conversation?.latestThreadSettings?.cwd||'';
 const contextRoots=[...new Set([contextCwd,...contextDraft.items.filter(item=>item.kind==='folder').map(item=>item.path)].filter(Boolean))].slice(0,8);
 const editDisabled=busy||sending||stopping||modelSaving||permissionSaving||speedSaving||commandSaving||editSaving||forkSaving||status!=='live'||selected!==boundRef.current;
 const prediction=useComposerPrediction({threadId:selected,conversation,enabled:predictionsEnabled,available:!editDisabled&&!compact&&!editing&&!forking&&!requests.length&&!contextOpen&&!uploads.preparing,draft,hasAttachments:!!(uploads.attachments.length||contextDraft.items.length)});
 function predictionKeys(e){
  const action=predictionKey(e,prediction.text);
  if(!action)return false;
  if(action==='dismiss'){e.preventDefault();prediction.dismiss();return true;}
  e.preventDefault();commandCaret.current=prediction.text.length;setDraft(prediction.text);prediction.dismiss();closeSlash();closeContext();return true;
 }
 function beginEdit(message){
  if(editDisabled||activityOf(live.current.state))return;
  const current=messagesOf(live.current.state),original=current.find(item=>item.id===message.id&&item.turnId===message.turnId&&item.editable);
  if(!original||original.text!==message.text){setError('消息已变化，请同步后重试');return;}
  setEditing({...original,threadId:selected,historyKey:editHistoryKey(current)});
 }
 async function saveEdit(message,text){
  if(editLock.current||editDisabled||activityOf(live.current.state))throw Error('请等待当前任务或设置保存结束后再编辑');
  if(selectedRef.current!==message.threadId||boundRef.current!==message.threadId)throw Error('聊天已切换，请重新打开编辑');
  if(editHistoryKey(messagesOf(live.current.state))!==message.historyKey)throw Error('聊天内容已变化，请关闭后重新打开编辑');
  editLock.current=true;setEditSaving(true);setError('');
  try{
   await invoke('edit_sent_message',{threadId:message.threadId,turnId:message.turnId,text});
   if(selectedRef.current===message.threadId){setEditing(null);setFollow(true);}
  }catch(error){if(selectedRef.current===message.threadId)setError(String(error.message||error));throw error;}
  finally{editLock.current=false;setEditSaving(false);}
 }

 function beginFork(message){
  if(editDisabled||forkLock.current||activityOf(live.current.state))return;
  const original=messagesOf(live.current.state).find(item=>item.id===message.id&&item.turnId===message.turnId&&item.forkable);
  if(!original||original.text!==message.text){setError('消息已变化，请同步后重试');return;}
  const title=threads.find(thread=>thread.id===selected)?.thread_name||'聊天';
  setForking({...original,threadId:selected,requestId:crypto.randomUUID(),name:title.slice(0,80)+' · 分叉'});
 }
 async function createFork(message,name){
  if(forkLock.current||editDisabled||selectedRef.current!==message.threadId||boundRef.current!==message.threadId)throw Error('聊天连接已变化，请重新打开分叉');
  const state=live.current.state,original=messagesOf(state).find(item=>item.id===message.id&&item.turnId===message.turnId&&item.forkable);
  if(!original||original.text!==message.text)throw Error('消息已变化，请重新打开分叉');
  forkLock.current=true;setForkSaving(true);
  forkDraft.current={requestId:message.requestId,text:draft,attachments:uploads.attachments,contexts:contextDraft.items,mode:state.latestCollaborationMode?.mode||'default'};
  try{return await invoke('fork_message',{threadId:message.threadId,turnId:message.turnId,requestId:message.requestId,name,settings:forkSettingsOf(state)});}finally{forkLock.current=false;setForkSaving(false);}
 }
 async function openFork(message,result){
  const child=result.threadId;if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(child))throw Error('分叉已创建，但未返回有效聊天 ID');
  if(selectedRef.current!==message.threadId&&selectedRef.current!==child)throw Error('分叉已创建，但当前聊天已切换；请在会话列表打开新聊天');
  setForkSaving(true);
  try{
   const branch={id:child,thread_name:result.name,updated_at:new Date().toISOString()};
   setThreads(current=>[branch,...current.filter(thread=>thread.id!==child)]);
   await invoke('open_url',{url:'codex://threads/'+child});
   const saved=forkDraft.current;
   if(saved?.requestId===message.requestId){saved.target=child;}
   selectedRef.current=child;setSelected(child);setFollow(true);
   for(let attempt=0;attempt<3;attempt++){
    if(selectedRef.current!==child)throw Error('分叉已创建，但当前聊天已切换');
    if(await connect(child)){
     const applied=await invoke('restore_fork_settings',{threadId:child,requestId:message.requestId});
     if(selectedRef.current!==child)throw Error('聊天已切换');
     if(applied.threadSettings){const state=live.current.state;if(state){const next={...state,latestThreadSettings:{...state.latestThreadSettings,...applied.threadSettings},latestCollaborationMode:applied.threadSettings.collaborationMode||state.latestCollaborationMode};live.current={...live.current,state:next};setConversation(next);}}
     setCommandMessage('已切换到分叉聊天。');setError('');return;
    }
    await new Promise(resolve=>setTimeout(resolve,600));
   }
   throw Error('分叉已创建，主 App 尚未就绪。请稍后点击“连接已创建的分叉”，不会重复创建。');
  }finally{setForkSaving(false);}
 }
 useEffect(()=>{
  const saved=forkDraft.current;if(saved?.target===selected){setDraft(saved.text);uploads.restore(saved.attachments);contextDraft.restore(saved.contexts);saved.target=null;}
 },[selected]);
 function addContext(items){
  contextDraft.add(items);
  if(activeMention){const next=draft.slice(0,activeMention.start)+draft.slice(activeMention.end);setDraft(next);requestAnimationFrame(()=>{draftBox.current?.focus();draftBox.current?.setSelectionRange(activeMention.start,activeMention.start);});}
  else draftBox.current?.focus();
  closeContext();
 }
 function updateMention(element){
  if(commandCaret.current!==null)return;
  const collapsed=element.selectionStart===element.selectionEnd,next=collapsed?slashAt(element.value,element.selectionStart):null;
  setSlash(next);setMention(!next&&collapsed?mentionAt(element.value,element.selectionStart):null);if(next)setContextOpen(false);
 }
 async function chooseCommand(row,token=activeSlash){
  if(row.disabled||commandLock.current||modelSaving||permissionSaving||speedSaving||editSaving||forkSaving||sending||status!=='live'||selected!==boundRef.current)return;
  if(row.kind==='command'&&row.id==='compact'&&busy)return;
  const previous=draft,target=selected,remaining=token?draft.slice(token.end):draft;
  if(row.kind==='skill'){
   try{contextDraft.add([row.skill]);setDraft(remaining);closeSlash();draftBox.current?.focus();}catch(error){setError(String(error.message||error));}
   return;
  }
  closeSlash();closeContext();setError('');setCommandMessage('');
  if(row.id==='skills'||row.id==='mention'){
   const trigger=row.id==='skills'?'$':'@',next=trigger+remaining;commandCaret.current=1;setDraft(next);setMention({start:0,end:1,trigger,query:''});return;
  }
  setDraft(remaining);
  if(row.id==='model'){setModelOpenRequest(value=>value+1);return;}
  if(row.id==='permissions'){setPermissionOpenRequest(value=>value+1);return;}
  if(row.id==='status'){setStatusOpen(true);return;}
  if(row.id==='fast'){setSpeedToggleRequest(value=>value+1);return;}
  commandLock.current=true;setCommandSaving(true);
  try{
   const result=await invoke('run_chat_command',{threadId:target,command:row.id});
   if(selectedRef.current!==target||boundRef.current!==target)return;
   if(result.threadSettings){
    const state=live.current.state,patch=result.threadSettings;
    const next={...state,latestThreadSettings:{...state.latestThreadSettings,...patch},latestCollaborationMode:patch.collaborationMode||state.latestCollaborationMode};
    live.current={...live.current,state:next};setConversation(next);
   }
   setCommandMessage(row.id==='compact'?'已请求压缩上下文。':row.id==='plan'?'已切换为计划模式，下轮生效。':'已切换为执行模式，下轮生效。');
   return true;
  }catch(error){if(selectedRef.current===target){setError(String(error.message||error));setDraft(current=>current||previous);}return false;}
  finally{commandLock.current=false;setCommandSaving(false);}
 }
 function contextKeys(event){
  if(activeSlash&&!event.nativeEvent.isComposing){
   if(event.key==='Escape'){event.preventDefault();closeSlash();return true;}
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setCommandIndex(index=>(index+(event.key==='ArrowDown'?1:-1)+Math.max(1,commandRows.length))%Math.max(1,commandRows.length));return true;}
   if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();commandSelect.current?.(commandIndex);return true;}
  }
  if(!activeMention||event.nativeEvent.isComposing)return false;
  if(event.key==='Escape'){event.preventDefault();closeContext();return true;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setContextIndex(index=>(index+(event.key==='ArrowDown'?1:-1)+Math.max(1,contextRows.length))%Math.max(1,contextRows.length));return true;}
  if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();contextSelect.current?.(contextIndex);return true;}
  return false;
 }
 async function refresh(){try{const r=await invoke('list_threads');setThreads(r.threads);setModelNames(r.modelNames||{});return r;}catch(e){setError(String(e));}}
 async function connect(id=selectedRef.current){
  if(!id||connecting.current)return;if(id!==boundRef.current)setOptimistic([]);connecting.current=true;boundRef.current=id;setStatus('connecting');setError('');live.current={state:null,revision:null};setConversation(null);
  try{await invoke('connect_thread',{threadId:id});setStatus('live');localStorage.setItem('codex-float-thread',id);return true;}catch(e){setStatus('offline');setError(String(e));return false;}finally{connecting.current=false;}
 }
 useEffect(()=>{
  if(!window.__TAURI_INTERNALS__){setError('请使用 Tauri 启动此面板以连接桌面端');return;}
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
 useEffect(()=>{if(!compact&&follow&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[messages.length,lastMessage?.id,lastMessage?.text,lastMessage?.steps,lastMessage?.explanation,lastMessage?.agents,lastMessage?.errors,lastMessage?.toolCall,activity?.label,activity?.toolTitle,conversation?.requests,follow,compact]);
 const savedScroll=useRef(0);
 useImperativeHandle(ref,()=>({
  saveScroll(){savedScroll.current=scroll.current?.scrollTop||0;},
  restoreFocus(){
   if(scroll.current)scroll.current.scrollTop=follow?scroll.current.scrollHeight:savedScroll.current;
   draftBox.current?.focus({preventScroll:true});
  }
 }),[follow]);
 const pendingSend=sending||optimistic.some(message=>!message.failed);
 useLayoutEffect(()=>{
  if(compact)onMiniStatusChange(miniStatus(conversation,status,pendingSend));
 },[compact,conversation,status,pendingSend,onMiniStatusChange]);
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
  if(activeSlash){commandSelect.current?.(commandIndex);return;}
  const direct=slashAt(draft),command=direct&&slashCommands.find(entry=>entry.id===direct.query.trim());
  if(command){chooseCommand({...command,kind:'command'},direct);return;}
  if((!draft.trim()&&!uploads.attachments.length&&!contextDraft.items.length)||modelSaving||permissionSaving||speedSaving||commandSaving||editSaving||forkSaving||uploads.preparing||sendingRef.current||stoppingRef.current||status!=='live'||selected!==boundRef.current)return;
  const submittedDraft=draft,submittedAttachments=uploads.attachments,submittedContexts=contextDraft.items,threadId=boundRef.current;
  const local={id:crypto.randomUUID(),role:'user',text:attachmentMessage(contextMessage(submittedDraft,submittedContexts),submittedAttachments).trim(),images:submittedAttachments.filter(file=>file.image).map(file=>({id:file.path,src:file.path,alt:file.name})),pending:true,baselineIds:new Set(messagesOf(live.current.state).map(m=>m.id))};
  sendingRef.current=true;
  flushSync(()=>{setOptimistic(current=>[...current,local]);setDraft('');uploads.clear();contextDraft.consume();closeContext();closeSlash();setCommandMessage('');setSending(true);setError('');setFollow(true);});
  draftBox.current?.focus();
  try{
   await afterMessagePaint();
   if(selectedRef.current!==threadId||boundRef.current!==threadId)throw new Error('聊天已切换，提示词尚未发送');
   const pendingQuestions=asyncQuestionRequests(live.current.state);
   const single=submittedDraft.trim()&&pendingQuestions.length===1&&pendingQuestions[0].params.questions.length===1?pendingQuestions[0]:null;
   const text=single?questionReplyText(single,{answers:{[single.params.questions[0].id]:{answers:[submittedDraft.trim()]}}}):submittedDraft.trim();
   await invoke('send_prompt',{threadId,text,steer:!!activityOf(live.current.state),clientMessageId:local.id,attachmentPaths:submittedAttachments.map(file=>file.path),contextItems:submittedContexts});
   setOptimistic(current=>current.map(m=>m.id===local.id?{...m,pending:false}:m));
  }catch(e){
   const timedOut=isSendTimeout(e);
   const currentScope=()=>boundRef.current===threadId&&selectedRef.current===threadId;
   const echoed=timedOut?await waitForMessageEcho(()=>messagesOf(live.current.state),local,currentScope):currentScope()&&hasMessageEcho(messagesOf(live.current.state),local);
   setOptimistic(current=>echoed?current.filter(m=>m.id!==local.id):current.map(m=>m.id===local.id?{...m,pending:false,failed:!timedOut}:m));
   if(!echoed&&timedOut){if(currentScope())setSendWarning({threadId,local});return;}
   if(!echoed&&selectedRef.current===threadId){setDraft(current=>current||submittedDraft);uploads.restore(submittedAttachments);contextDraft.restore(submittedContexts);setError(String(e));}
  }finally{sendingRef.current=false;setSending(false);}
 }
 async function stopTask(){
  if(stoppingRef.current||status!=='live'||selected!==boundRef.current)return;
  const threadId=boundRef.current,turnId=activeTurnId(live.current.state);
  if(!turnId)return;
  stoppingRef.current=true;setStopping(true);setError('');
  try{
   await invoke('stop_task',{threadId,turnId});
   if(boundRef.current!==threadId)return;
   const deadline=Date.now()+5000;
   while(boundRef.current===threadId&&turnIsRunning(live.current.state,turnId)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
   if(boundRef.current===threadId&&turnIsRunning(live.current.state,turnId))setError('已发送停止请求，尚未收到任务停止确认，请检查主窗口');
  }catch(e){if(boundRef.current===threadId)setError('停止任务失败：'+String(e));}
  finally{stoppingRef.current=false;setStopping(false);}
 }
 const iconButton=(title,icon,onClick,cls='',pressed)=><button className={'icon-button '+cls} title={title} aria-label={title} aria-pressed={pressed} onClick={onClick}>{icon}</button>;
 function stageMcpFollowUp(threadId,text){
  if(status!=='live'||threadId!==boundRef.current||threadId!==selectedRef.current)throw Error('聊天已切换，请重新打开卡片');
  const next=draft.trim()?draft+'\n\n'+text:text;if(next.length>100000)throw Error('输入框内容过长，请先发送或整理草稿');
  setDraft(next);closeSlash();closeContext();setCommandMessage('卡片消息已填入输入框，发送后执行。');requestAnimationFrame(()=>draftBox.current?.focus());
 }
 return <LinkProvider cwd={conversation?.cwd||conversation?.latestThreadSettings?.cwd} scope={selected}><McpAppsContext.Provider value={{threadId:selected,enabled:status==='live'&&selected===boundRef.current&&!compact,onFollowUp:stageMcpFollowUp}}><SubagentActionsContext.Provider value={{parentId:selected,enabled:status==='live'&&selected===boundRef.current}}>
  <section className="connection">
   <div className="section-label"><label htmlFor="thread-picker">当前聊天</label><span className="current-project" title={selectedProjectTitle}>{selectedProject}</span></div>
   <div className="thread-row"><ThreadPicker threads={threads} value={selected} disabled={status==='connecting'||forkSaving} onChange={id=>{selectedRef.current=id;setSelected(id);setFollow(true);connect(id);}}/>
    <button type="button" className={'sync-button '+status} disabled={status==='connecting'||!selected} title={status==='live'?'已同步，点击重新同步当前聊天':status==='connecting'?'正在同步当前聊天…':'未同步，点击连接当前聊天'} aria-label={status==='live'?'已同步，点击重新同步当前聊天':status==='connecting'?'正在同步当前聊天':'未同步，点击连接当前聊天'} onClick={async()=>{await refresh();await connect();}}><RefreshCw size={16} aria-hidden="true" className={status==='connecting'?'spin':''}/></button>
   </div>
  </section>
  {(error||windowError)&&<div className="notice" role="alert"><Info size={16}/><span>{error||windowError}</span><button aria-label="关闭提示" onClick={error?()=>setError(''):onDismissWindowError}><X size={14}/></button></div>}
  <section className="messages" ref={scroll} onLoadCapture={e=>{if(e.target.tagName==='IMG'&&follow&&!compactRef.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;}} onScroll={()=>{if(compactRef.current)return;const e=scroll.current;setFollow(e.scrollHeight-e.scrollTop-e.clientHeight<85);}}>
   {!messages.length&&!requests.length?<div className="empty"><div className="empty-mark"><MessageSquare size={28}/></div><h2>{status==='connecting'?'正在同步对话':'让对话留在手边'}</h2><p>在 Codex 主窗口打开聊天，<br/>连接后即可在这里继续对话。</p></div>:<div className="history-divider"><span>与主窗口同步</span></div>}
   <InteractionMessages key={boundRef.current} threadId={boundRef.current} requests={requests} messages={messages} MessageComponent={Message} disabled={status!=='live'||selected!==boundRef.current} onReply={replyInteraction} onEditMessage={beginEdit} editDisabled={editDisabled} onForkMessage={beginFork} forkDisabled={editDisabled}/>
   {activity&&<div className="activity" role="status" aria-live="polite"><div className="typing"><span/><span/><span/><em>{activity.label}</em></div></div>}
  </section>
  {!follow&&iconButton('回到最新消息',<ArrowDown size={16}/>,()=>setFollow(true),'jump')}
  {forking&&<ForkMessageDialog key={forking.requestId} message={forking} onCreate={createFork} onOpen={openFork} onClose={()=>setForking(null)}/>}
  {editing&&<MessageEditor key={`${editing.threadId}:${editing.id}`} message={editing} onSave={saveEdit} onClose={()=>setEditing(null)} disabled={editDisabled}/>}
  {statusOpen&&<ChatStatus conversation={conversation} names={modelNames} onClose={()=>setStatusOpen(false)}/>}
  <footer className="composer-area">
   {sendWarning&&sendWarning.threadId===selected&&<p className="composer-command-status" role="status">消息启动确认超时，发送结果待确认；任务可能仍会继续，请检查消息记录，避免重复发送。</p>}
   {prediction.failure&&<p className="prediction-error" title={prediction.failure}>预测暂不可用<button type="button" aria-label="关闭预测提示" onClick={prediction.dismiss}>×</button></p>}
   {commandMessage&&<p className="composer-command-status" role="status">{commandMessage}</p>}
   <SlashMenu scope={selected} cwd={contextCwd} token={activeSlash} busy={busy} disabled={status!=='live'||selected!==boundRef.current||sending||modelSaving||permissionSaving||speedSaving||commandSaving||editSaving||forkSaving} onClose={closeSlash} onSelect={chooseCommand} onRows={setCommandRows} onSelectRef={commandSelect} activeIndex={commandIndex}/>
   <ContextPicker scope={selected} cwd={contextCwd} roots={contextRoots} mention={activeMention} open={contextOpen} onClose={closeContext} onAdd={addContext} onError={setError} initialSelection={snippetSelection} onRows={setContextRows} onSelectRef={contextSelect} activeIndex={contextIndex}/>
   <div className={'composer'+(uploads.dragging?' dragging':'')} onDragOver={uploads.onDragOver} onDragLeave={uploads.onDragLeave} onDrop={uploads.onDrop}>
    <ContextChips items={contextDraft.items} onRemove={contextDraft.remove} onToggleBrowser={contextDraft.toggleBrowser}/>
    <ComposerAttachments files={uploads.attachments} onRemove={uploads.remove} preparing={uploads.preparing} dragging={uploads.dragging}/>
    <div className="composer-input-wrap"><textarea id="prompt-input" ref={draftBox} aria-label="提示词" rows="2" value={draft} onChange={e=>{setDraft(e.target.value);updateMention(e.target);}} onSelect={e=>updateMention(e.target)} onPaste={uploads.onPaste} onKeyDown={e=>{uploads.onKeyDown(e);if(contextKeys(e)||predictionKeys(e))return;if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}} aria-describedby={prediction.text?'composer-prediction':undefined} aria-controls={activeSlash?'slash-suggestions':activeMention?'context-suggestions':undefined} aria-activedescendant={activeSlash&&commandRows.length?`slash-option-${commandIndex}`:activeMention&&contextRows.length?`context-option-${contextIndex}`:undefined} placeholder={prediction.text?'':busy?'告诉 Codex 接下来怎么做…':'发送消息，/ 命令，$ 技能…'}/><ComposerPrediction text={prediction.text}/></div>
    <div className="composer-bottom">
     <div className="composer-leading"><AttachmentButton onClick={uploads.choose} disabled={uploads.preparing||sending}/><ContextButton open={contextOpen||!!activeMention} disabled={sending} onClick={()=>{setSnippetSelection(draft.slice(draftBox.current?.selectionStart||0,draftBox.current?.selectionEnd||0));setMention(null);closeSlash();setContextOpen(value=>!value);}}/><PermissionPicker openRequest={permissionOpenRequest} threadId={selected} conversation={conversation} disabled={compact||status!=='live'||selected!==boundRef.current||!conversation||sending||modelSaving||speedSaving||commandSaving||editSaving||forkSaving} onApplied={threadSettingsApplied} onError={setError} onSavingChange={setPermissionSaving}/></div>
     <div className="footer-meta">

    <span className="model-summary"><SpeedPicker threadId={selected} model={conversation?.latestModel} tier={serviceTier} toggleRequest={speedToggleRequest} disabled={compact||status!=='live'||selected!==boundRef.current||!conversation||sending||modelSaving||permissionSaving||commandSaving||editSaving||forkSaving} onApplied={threadSettingsApplied} onError={setError} onSavingChange={setSpeedSaving}/><ModelPicker openRequest={modelOpenRequest} threadId={selected} model={conversation?.latestModel} effort={conversation?.latestReasoningEffort} names={modelNames} busy={busy} disabled={speedSaving||editSaving||forkSaving||commandSaving||permissionSaving||compact||status!=='live'||selected!==boundRef.current||!conversation||sending} onApplied={modelSettingsApplied} onError={setError} onSavingChange={setModelSaving}/></span>
      <AccountUsage busy={busy}><button className={'send'+(busy||stopping?' stop-task':'')} aria-label={busy||stopping?'停止任务':'发送提示词'} aria-busy={stopping||sending} title={stopping?'正在停止任务…':busy?'停止当前任务（输入后 Enter 可追加指令）':(modelSaving||permissionSaving||speedSaving||commandSaving||editSaving||forkSaving)?'正在保存设置…':'发送到当前聊天'} disabled={status!=='live'||selected!==boundRef.current||(busy||stopping?stopping||!stopTurnId:(!draft.trim()&&!uploads.attachments.length&&!contextDraft.items.length)||modelSaving||permissionSaving||speedSaving||commandSaving||editSaving||forkSaving||uploads.preparing||sending)} onClick={busy||stopping?stopTask:send}>{stopping||sending?<RefreshCw size={14} className="spin"/>:busy?<Square size={10} fill="currentColor"/>:<ArrowUp size={16}/>}</button></AccountUsage>
     </div>
    </div>
   </div>

  </footer>
 </SubagentActionsContext.Provider></McpAppsContext.Provider></LinkProvider>;
}
