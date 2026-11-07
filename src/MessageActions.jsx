import {t,useLanguage} from './i18n.js';
import React,{useEffect,useRef,useState} from 'react';
import {Check,Copy,Pencil,GitFork} from 'lucide-react';
import {copyText} from './message-actions';
import {PreviewDialog} from './PreviewDialog';

export function MessageActions({text,editable,editDisabled,onEdit,forkable,forkDisabled,onFork,persistentCopy=false}){
 useLanguage();
 const [copied,setCopied]=useState(false),[error,setError]=useState(''),timer=useRef(),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);};},[]);
 async function copy(){
  try{await copyText(text);if(!mounted.current)return;setCopied(true);setError('');clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),1600);}
  catch(error){if(mounted.current)setError(String(error.message||error));}
 }
 if(!text&&!editable&&!forkable)return null;
 return <div className={'message-actions'+(persistentCopy?' final-reply-actions':'')}>
  {text&&<button type="button" data-copy-message aria-label={copied?t("消息已复制"):t("复制消息")} title={copied?t("已复制"):t("复制最终显示的回复")} onClick={copy}>{copied?<Check size={13}/>:<Copy size={13}/>}</button>}
  {editable&&<button type="button" aria-label={t("编辑已发送消息")} title={editDisabled?t("当前操作尚未结束，暂不能编辑"):t("编辑并重新发送")} disabled={editDisabled} onClick={onEdit}><Pencil size={13}/></button>}
  {forkable&&<button type="button" aria-label={t("从此轮分叉")} title={forkDisabled?t("任务进行中或设置正在保存，暂不能分叉"):t("创建新聊天，包含此轮及之前的完整历史")} disabled={forkDisabled} onClick={onFork}><GitFork size={13}/></button>}
  {copied&&<small role="status">{t("已复制")}</small>}{error&&<small className="message-action-error" role="alert">{t(error)}</small>}
 </div>;
}

export function MessageEditor({message,onSave,onClose,disabled,running}){
 useLanguage();
 const [text,setText]=useState(message.text||''),[saving,setSaving]=useState(false),[error,setError]=useState(''),lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const unavailable=disabled||saving||!text.trim()||text===message.text;
 async function submit(event){
  event.preventDefault();if(unavailable||lock.current)return;
  lock.current=true;setSaving(true);setError('');
  try{await onSave(message,text);}catch(error){if(mounted.current)setError(String(error.message||error));}
  finally{lock.current=false;if(mounted.current)setSaving(false);}
 }
 return <PreviewDialog title={t("编辑已发送消息")} onClose={onClose} className="message-editor"><form onSubmit={submit}>
  <p>{running&&t("提交后将先停止当前任务。已执行的操作不会撤销。")}{t("保存后会从这条消息重新生成，后续消息和回复会被替换。原消息的附件将保留。")}</p>
  <textarea autoFocus aria-label={t("编辑消息内容")} value={text} maxLength={100000} disabled={saving} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form.requestSubmit();}}}/>
  {error&&<p className="message-action-error" role="alert">{t(error)}</p>}
  <div className="message-editor-actions"><button type="button" onClick={onClose}>{t("取消")}</button><button type="submit" disabled={unavailable}>{saving?t("正在重新发送…"):running?t("停止任务并重新发送"):t("保存并重新发送")}</button></div>
 </form></PreviewDialog>;
}
