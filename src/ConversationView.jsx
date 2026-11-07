import React,{useImperativeHandle,useRef,useState} from 'react';
import {SessionView} from './SessionView';
import {ChatGPTSession} from './ChatGPTSession';
import {t,useLanguage} from './i18n';

const ignoreStatus=()=>{};
export function ConversationView({ref,...props}){
 useLanguage();
 const [source,setSource]=useState('codex'),[visited,setVisited]=useState(false);
 const codex=useRef(),chatgpt=useRef();
 useImperativeHandle(ref,()=>({
  saveScroll(){(source==='codex'?codex:chatgpt).current?.saveScroll();},
  restoreFocus(){(source==='codex'?codex:chatgpt).current?.restoreFocus();}
 }),[source]);
 return <>
  <div className="conversation-source" role="group" aria-label={t('会话来源')}>
   <button aria-pressed={source==='codex'} onClick={()=>setSource('codex')}>Codex</button>
   <button aria-pressed={source==='chatgpt'} onClick={()=>{setVisited(true);setSource('chatgpt');}}>ChatGPT</button>
  </div>
  <div className="conversation-source-panel" hidden={source!=='codex'}>
   <SessionView {...props} ref={codex} onMiniStatusChange={source==='codex'?props.onMiniStatusChange:ignoreStatus}/>
  </div>
  {visited&&<div className="conversation-source-panel" hidden={source!=='chatgpt'}>
   <ChatGPTSession {...props} ref={chatgpt} active={source==='chatgpt'} onMiniStatusChange={source==='chatgpt'?props.onMiniStatusChange:ignoreStatus}/>
  </div>}
 </>;
}
