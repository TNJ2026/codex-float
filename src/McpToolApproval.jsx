import {t,useLanguage} from './i18n.js';
import React,{useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {InteractionCard} from './InteractionMessages';
import {describeInteraction} from './interactions';

export function McpToolApproval({request,onReply}){
 useLanguage();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(describeInteraction(request).kind!=='unsupported')return <InteractionCard request={request} active disabled={false} onReply={onReply}/>;
 const params=request.params||{};let url;
 try{const candidate=new URL(params.url);if(['https:','http:'].includes(candidate.protocol)&&!candidate.username&&!candidate.password)url=candidate.href;}catch{}
 async function submit(action){if(busy)return;setBusy(true);setError('');try{await onReply(request,{response:{action}});}catch(reason){setError(String(reason));setBusy(false);}}
 return <section className="interaction-card mcp-tool-approval"><strong>{params.mode==='url'?t("卡片需要网页授权"):t("卡片请求需要处理")}</strong><p>{params.message||t("此交互格式暂不支持，可取消本次请求。")}</p>{url&&<button type="button" disabled={busy} onClick={()=>invoke('open_url',{url}).catch(reason=>setError(String(reason)))}>{t("打开授权网页")}</button>}<div className="interaction-actions">{url&&<button type="button" disabled={busy} onClick={()=>submit('accept')}>{t("已完成授权，继续")}</button>}<button type="button" disabled={busy} onClick={()=>submit('cancel')}>{t("取消")}</button></div>{error&&<p className="interaction-error" role="alert">{t(error)}</p>}</section>;
}
