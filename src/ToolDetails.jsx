import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {PreviewDialog} from './PreviewDialog';
import {Check,LoaderCircle,Terminal,Wrench,Search,FileText,AlertCircle,Pencil,ChevronDown} from 'lucide-react';
import {completedToolLabel} from './completed-work';
import {toolSections} from './tool-details';
import {copyText} from './message-actions';

const statuses={inProgress:'运行中',completed:'已完成',failed:'失败',declined:'已拒绝',interrupted:'已中断',stopped:'任务失败，调用已停止',ended:'任务已结束',unknown:'状态未知'};
function Value({label,text}){
 const [copied,setCopied]=useState(false),[error,setError]=useState(''),timer=useRef(null);
 useEffect(()=>{setCopied(false);setError('');return()=>clearTimeout(timer.current);},[text]);
 async function copy(){try{await copyText(text);setCopied(true);setError('');clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),1500);}catch(reason){setError(String(reason));}}
 return <details className="tool-detail-section" open><summary>{label}<button type="button" className="tool-detail-copy" aria-label={`复制${label}`} onClick={event=>{event.preventDefault();event.stopPropagation();copy();}}>{copied?'已复制':'复制'}</button></summary>{error&&<small role="alert">复制失败：{error}</small>}<pre>{text}</pre></details>;
}
function Body({item}){
 const sections=useMemo(()=>toolSections(item),[item]);
 const hasOutput=sections.some(section=>['输出','结果','文件变更','错误'].includes(section.label));
 return <div className="tool-details-body">
  <div className="tool-detail-meta">{Number.isFinite(item.durationMs)&&<span>耗时 {(item.durationMs/1000).toFixed(2)} 秒</span>}{Number.isInteger(item.exitCode)&&<span>退出码 {item.exitCode}</span>}</div>
  {sections.map(section=><Value key={section.label} {...section}/>)}
  {!hasOutput&&<p className="tool-detail-empty">暂无返回内容</p>}
 </div>;
}
function ToolDetails({item,status,title}){
 const Icon=item.type==='commandExecution'?Terminal:item.type==='webSearch'?Search:item.type==='fileChange'?FileText:Wrench;
 const StatusIcon=status==='inProgress'?LoaderCircle:status==='completed'?Check:['failed','declined'].includes(status)?AlertCircle:null;
 return <div className="tool-details" data-status={status}>
  <header><Icon size={13}/><strong>{title}</strong><small>{StatusIcon&&<StatusIcon size={11} className={status==='inProgress'?'spin':''}/>} {statuses[status]||statuses.unknown}</small></header>
  <Body item={item}/>
 </div>;
}
export function ToolTimelineRow({call}){
 const title=typeof call.toolCall.command==='string'?call.toolCall.command.replace(/\s+/gu,' ').trim():call.toolTitle;
 return <ToolActivity title={title} detail={call} inline/>;
}
export function ToolProcessGroup({calls}){
 if(!calls?.length)return null;
 return <ToolActivity title={completedToolLabel(calls)} detail={calls[0]} inline groupCalls={calls}/>;
}
function HistoryRow({call}){
 const [open,setOpen]=useState(false);
 return <details className="tool-history-row" data-tool-id={call.toolCall.id||call.id} data-status={call.toolStatus} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{call.toolStatus==='inProgress'&&<LoaderCircle size={12} className="spin"/>}<span>{call.toolTitle}</span><small>{statuses[call.toolStatus]||statuses.unknown}</small></summary>{open&&<ToolDetails item={call.toolCall} status={call.toolStatus} title={call.toolTitle}/>}</details>;
}
export function ToolHistory({calls=[],label='工具调用历史'}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[status,setStatus]=useState('all'),[type,setType]=useState('all'),[limit,setLimit]=useState(50);
 const names={commandExecution:'命令',mcpToolCall:'MCP 工具',dynamicToolCall:'动态工具',webSearch:'搜索',fileChange:'文件修改'};
 const types=[...new Set(calls.map(call=>call.toolCall.type))];
 const rows=useMemo(()=>{
  if(!open)return [];
  const words=query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return calls.filter(call=>(status==='all'||call.toolStatus===status)&&(type==='all'||call.toolCall.type===type)&&(!words.length||words.every(word=>[call.toolTitle,call.toolCall.type,...toolSections(call.toolCall).map(section=>section.text)].join('\n').toLocaleLowerCase().includes(word))));
 },[calls,open,query,status,type]);
 useEffect(()=>setLimit(50),[query,status,type]);
 return <details className="tool-history" onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}}><summary>{label}（{calls.length}）</summary>{open&&<>
  <div className="tool-history-filters"><input aria-label="搜索工具调用" placeholder="搜索名称、命令、参数或输出…" value={query} onChange={event=>setQuery(event.target.value)}/><select aria-label="筛选工具类型" value={type} onChange={event=>setType(event.target.value)}><option value="all">全部类型</option>{types.map(type=><option key={type} value={type}>{names[type]||type}</option>)}</select><select aria-label="筛选调用状态" value={status} onChange={event=>setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statuses).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></div>
  <p className="tool-history-count">显示 {Math.min(limit,rows.length)} / {rows.length} 项</p>{rows.slice(0,limit).map(call=><HistoryRow key={call.id} call={call}/>)}{!rows.length&&<p>没有匹配的工具调用。</p>}{rows.length>limit&&<button type="button" className="tool-detail-more" onClick={()=>setLimit(value=>value+50)}>显示更多调用</button>}
 </>}</details>;
}

function ToolGroupPicker({calls,selected,onSelect}){
 const picker=useRef(null),trigger=useRef(null);
 function close(restoreFocus=false){
  picker.current.open=false;
  if(restoreFocus)trigger.current.focus();
 }
 return <details ref={picker} className="tool-group-picker" onBlur={event=>{
  if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget))close();
 }} onKeyDown={event=>{
  if(event.key==='Escape'&&picker.current.open){
   event.preventDefault();
   event.stopPropagation();
   close(true);
  }
 }}>
  <summary ref={trigger} aria-label="选择过程中的工具调用">
   <span>{calls.indexOf(selected)+1}. {selected.toolTitle}</span><ChevronDown size={14} aria-hidden="true"/>
  </summary>
  <ul className="tool-group-options" aria-label="工具调用">
   {calls.map((call,index)=><li key={call.id}>
    <button type="button" aria-current={call.id===selected.id||undefined} onClick={()=>{
     onSelect(call.id);
     close(true);
    }}><span>{index+1}. {call.toolTitle}</span></button>
   </li>)}
  </ul>
 </details>;
}

export function ToolActivity({title,detail,inline=false,groupCalls=null}){
 const [open,setOpen]=useState(false),anchor=useRef(),id=useId();
 const [selectedId,setSelectedId]=useState(null);
 const selected=groupCalls?.find(call=>call.id===selectedId)||detail;
 const identity=detail?.id;
 useEffect(()=>{if(!detail)setOpen(false);},[identity]);
 useEffect(()=>{
  if(!open)return;
  const other=event=>{if(event.detail!==id)setOpen(false);};window.addEventListener('tool-details-open',other);
  return()=>window.removeEventListener('tool-details-open',other);
 },[open,id]);
 if(!detail)return <div className="activity-tool-title" title={title}>{title}</div>;
 return <>
  <button type="button" ref={anchor} className={'activity-tool-title tool-activity-trigger'+(inline?' tool-timeline-trigger':'')+(groupCalls?' tool-process-completed':'')} data-tool-id={inline?detail.toolCall.id||detail.id:undefined} data-status={inline?detail.toolStatus:undefined} title={title} aria-label={`查看工具调用详情：${title}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{if(!open)window.dispatchEvent(new window.CustomEvent('tool-details-open',{detail:id}));setOpen(value=>!value);}}>{inline?<>{detail.toolStatus==='inProgress'?<LoaderCircle size={12} className="spin"/>:groupCalls?.some(call=>call.toolCall.type==='fileChange')?<Pencil size={14}/>:<Terminal size={14}/>}<span>{title}</span>{!groupCalls&&<small>{statuses[detail.toolStatus]||statuses.unknown}</small>}</>:title}</button>
  {open&&<PreviewDialog title="工具调用详情" onClose={()=>setOpen(false)} className="tool-details-popup"><div id={id}>{groupCalls?.length>1&&<ToolGroupPicker calls={groupCalls} selected={selected} onSelect={setSelectedId}/>}<ToolDetails key={selected.id} item={selected.toolCall} status={selected.toolStatus} title={groupCalls?selected.toolTitle:title}/></div></PreviewDialog>}
 </>;
}
