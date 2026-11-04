import React,{useRef,useState} from 'react';
import {PreviewDialog} from './PreviewDialog';

export function ForkMessageDialog({message,onCreate,onOpen,onClose}){
 const [name,setName]=useState(message.name),[result,setResult]=useState(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 async function submit(event){
  event.preventDefault();if(lock.current||!name.trim())return;lock.current=true;setSaving(true);setError('');
  try{let created=result;if(!created){created=await onCreate(message,name.trim());setResult(created);}await onOpen(message,created);onClose();}
  catch(error){setError(String(error.message||error));}finally{lock.current=false;setSaving(false);}
 }
 const unknown=error.includes('分叉结果尚未确认');
 return <PreviewDialog title="消息分叉" className="fork-message-dialog" onClose={()=>{if(!lock.current)onClose();}}><form onSubmit={submit}>
  <p>新聊天将包含所选消息所在轮次及此前的完整历史，不包含后续轮次。原聊天保留。创建后会在主 App 打开并连接到新聊天。</p>
  {message.text&&<blockquote>{message.text.slice(0,240)}{message.text.length>240?'…':''}</blockquote>}
  <label>新聊天名称<input autoFocus aria-label="分叉聊天名称" maxLength={120} value={name} disabled={saving||!!result} onChange={event=>setName(event.target.value)}/></label>
  {result&&<p className="fork-created" role="status">分叉已创建。{result.warnings?.join(' ')}<code>{result.threadId}</code></p>}
  {error&&<p className="message-action-error" role="alert">{error}</p>}
  <div className="message-editor-actions"><button type="button" disabled={saving} onClick={onClose}>关闭</button><button type="submit" disabled={saving||!name.trim()||unknown}>{saving?(result?'正在连接新聊天…':'正在创建分叉…'):result?'连接已创建的分叉':'创建分叉'}</button></div>
 </form></PreviewDialog>;
}
