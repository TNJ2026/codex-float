import {t,useLanguage} from './i18n.js';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Plus,X,File,Folder,Code,Globe,Monitor,Cpu,Blocks,RefreshCw,MessageSquare,Pause,Play} from 'lucide-react';
import {browserReadStatus} from './browser-settings';
import {readBrowserContexts,subscribeBrowserContexts,updateBrowserContexts} from './browser-context';
import {PreviewDialog} from './PreviewDialog';
import {useSettingsGlass} from './useSettingsGlass';
import {contextKey,contextLabels,contextMatches,mergeContexts} from './context';

const icons={file:File,folder:Folder,snippet:Code,browser:Globe,ide:Monitor,skill:Cpu,plugin:Blocks,thread:MessageSquare};
const detail=item=>item.kind==='browser'?[item.url,item.description].filter(Boolean).join(' · '):item.kind==='thread'?[item.source,item.description?new Date(item.description).toLocaleString('zh-CN'):null].filter(Boolean).join(' · '):item.path||item.url||item.description||item.source;
export function useContextDraft(scope){
 const [items,setItems]=useState([]);const current=useRef([]);
 const scopeRef=useRef(scope);scopeRef.current=scope;
 const update=useCallback(next=>{current.current=next;setItems(next);},[]);
 useEffect(()=>{update([]);},[scope,update]);
 const following=items.some(item=>item.kind==='browser'&&item.autoUpdate&&item.browserWindowId);
 useEffect(()=>{
  if(!following)return;
  const target=scope;
  const apply=pages=>{if(scopeRef.current===target){const next=updateBrowserContexts(current.current,pages);if(next!==current.current)update(next);}};
  return subscribeBrowserContexts(apply,()=>apply([]));
 },[following,scope,update]);
 return {items,add:added=>update(mergeContexts(current.current,added)),remove:key=>update(current.current.filter(item=>contextKey(item)!==key)),clear:()=>update([]),consume:()=>update(current.current.filter(item=>item.kind==='browser'&&item.browserWindowId)),restore:old=>update(mergeContexts(old,current.current,Infinity)),toggleBrowser:key=>update(current.current.map(item=>contextKey(item)===key?{...item,autoUpdate:!item.autoUpdate}:item))};
}
export function ContextChips({items,onRemove,onToggleBrowser}){
 useLanguage();
 return !!items.length&&<div className="context-chips" aria-label={t("待发送上下文")}>{items.map(item=>{const Icon=icons[item.kind]||File;return <div className="context-chip" key={contextKey(item)} title={[item.source,item.path||item.url,item.description,item.content?.slice(0,500)].filter(Boolean).join('\n')}><Icon size={13}/><span>{item.label}</span><small>{item.browserUnavailable?t("网页不可用"):item.kind==='browser'?browserReadStatus(item)+(item.autoUpdate?t(" · 跟随"):''):t(contextLabels[item.kind])}</small>{item.browserWindowId&&onToggleBrowser&&<button type="button" aria-label={item.autoUpdate?t("暂停网页自动更新"):t("恢复网页自动更新")} title={item.autoUpdate?t("固定当前网页内容"):t("跟随此窗口当前标签页")} onClick={()=>onToggleBrowser(contextKey(item))}>{item.autoUpdate?<Pause size={12}/>:<Play size={12}/>}</button>}<button type="button" aria-label={t("移除上下文 {0}",[item.label])} onClick={()=>onRemove(contextKey(item))}><X size={12}/></button></div>;})}</div>;
}
export function ContextButton({onClick,disabled,open}){
 useLanguage();
 return <button type="button" className="icon-button attachment-button context-button" title={t("添加上下文（@ 搜索上下文，$ 搜索技能）")} aria-label={t("添加上下文")} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={onClick}><Plus size={16}/></button>;
}
function SnippetEditor({initial='',onAdd,onClose}){
 useLanguage();
 const [label,setLabel]=useState(t("代码片段")),[content,setContent]=useState(initial),[path,setPath]=useState(''),[language,setLanguage]=useState(''),[line,setLine]=useState('');
 return <PreviewDialog title={t("添加代码片段")} className="snippet-dialog" onClose={onClose}><form className="snippet-form" onSubmit={event=>{event.preventDefault();if(!content.trim())return;onAdd({kind:'snippet',label:label.trim()||t("代码片段"),content,path:path.trim(),language,startLine:line?Number(line):null,source:t("手动添加")});onClose();}}>
  <label>{t("标题")}<input value={label} onChange={event=>setLabel(event.target.value)} maxLength={100}/></label>
  <label>{t("内容")}<textarea autoFocus aria-label={t("代码片段内容")} required value={content} maxLength={32000} onChange={event=>setContent(event.target.value)} placeholder={t("粘贴代码或选中文字…")}/></label>
  <label>{t("来源路径（可选）")}<input value={path} onChange={event=>setPath(event.target.value)} placeholder={t("本地文件的绝对路径")}/></label>
  <div className="snippet-options"><label>{t("语言")}<input value={language} onChange={event=>setLanguage(event.target.value)} placeholder={t("如 js、python")} maxLength={32}/></label><label>{t("起始行")}<input type="number" min="1" max="10000000" step="1" value={line} onChange={event=>setLine(event.target.value)}/></label></div>
  <button type="submit" disabled={!content.trim()}>{t("添加片段")}</button>
 </form></PreviewDialog>;
}
function BrowserEditor({onAdd,onClose}){
 useLanguage();
 const [url,setUrl]=useState(''),[label,setLabel]=useState(''),[content,setContent]=useState('');
 return <PreviewDialog title={t("添加网页上下文")} className="snippet-dialog" onClose={onClose}><form className="snippet-form" onSubmit={event=>{event.preventDefault();let parsed;try{parsed=new URL(url);}catch{return;}if(!['http:','https:'].includes(parsed.protocol))return;onAdd({kind:'browser',label:label.trim()||parsed.hostname,url:parsed.href,content,source:t("手动添加")});onClose();}}><label>{t("网页地址")}<input type="url" required autoFocus value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://…" pattern="https?://.*"/></label><label>{t("标题（可选）")}<input value={label} onChange={event=>setLabel(event.target.value)} maxLength={200}/></label><label>{t("选中文字（可选）")}<textarea aria-label={t("网页选中文字")} value={content} onChange={event=>setContent(event.target.value)} maxLength={32000} placeholder={t("粘贴从网页选中的内容…")}/></label><button type="submit">{t("添加网页")}</button></form></PreviewDialog>;
}

export function ContextPicker({scope,cwd,roots=[],mention,open,onClose,onAdd,onError,initialSelection='',onRows,onSelectRef,activeIndex=0}){
 useLanguage();
 const [category,setCategory]=useState('file'),[query,setQuery]=useState(''),[files,setFiles]=useState([]),[catalog,setCatalog]=useState({skills:[],plugins:[]}),[pages,setPages]=useState([]),[ide,setIde]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[snippet,setSnippet]=useState(false),[revision,setRevision]=useState(0),[catalogLoading,setCatalogLoading]=useState(false);
 const [browserEditor,setBrowserEditor]=useState(false);
 const [threads,setThreads]=useState([]);
 const root=useRef(),generation=useRef(0),catalogGeneration=useRef(0),scopeRef=useRef(scope),cachedCatalog=useRef(null),onAddRef=useRef(onAdd),onErrorRef=useRef(onError);
 scopeRef.current=scope;onAddRef.current=onAdd;onErrorRef.current=onError;
 const visible=open||!!mention;
 const mode=document.documentElement.dataset.windowPlatform==='macos'?document.documentElement.dataset.nativeBackground:undefined;
 const nativeGlass=useSettingsGlass(root,visible&&!snippet&&!browserEditor,mode);
 const activeQuery=mention?mention.query:query;
 const activeCategory=mention?(mention.trigger==='$'?'skill':category==='file'?'all':category):category;
 const rootsKey=JSON.stringify(roots.length?roots:cwd?[cwd]:[]);
 useEffect(()=>{if(mention)setCategory('file');},[mention?.start,mention?.trigger]);
 useEffect(()=>{
  if(!visible||!root.current)return;
  const parent=root.current.parentElement;
  const update=()=>root.current?.style.setProperty('--context-max-height',`${Math.max(120,parent.getBoundingClientRect().top-50)}px`);
  update();
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(update);observer.observe(parent);window.addEventListener('resize',update);
  return()=>{observer.disconnect();window.removeEventListener('resize',update);};
 },[visible]);
 useEffect(()=>{setQuery('');setCategory('file');setSnippet(false);setBrowserEditor(false);setFiles([]);setPages([]);setIde([]);setThreads([]);setLoading(false);setCatalogLoading(false);setCatalog({skills:[],plugins:[]});cachedCatalog.current=null;catalogGeneration.current++;generation.current++;},[scope,cwd]);
 useEffect(()=>{
  if(!visible)return;
  const onPointer=event=>{if(!root.current?.contains(event.target)&&!event.target.closest('.context-button,#prompt-input'))onClose();};
  const onKey=event=>{if(event.key==='Escape'){event.preventDefault();onClose();}};
  const onFocus=event=>{if(event.target.closest?.('.settings-panel'))onClose();};
  document.addEventListener('focusin',onFocus);document.addEventListener('pointerdown',onPointer);document.addEventListener('keydown',onKey);
  return()=>{document.removeEventListener('focusin',onFocus);document.removeEventListener('pointerdown',onPointer);document.removeEventListener('keydown',onKey);};
 },[visible,onClose]);
 useEffect(()=>{
  if(!visible||!['all','skill','plugin'].includes(activeCategory)||cachedCatalog.current===cwd)return;
  const id=++catalogGeneration.current,target=scope;
  setCatalogLoading(true);setError('');
  invoke('context_catalog',{cwd:cwd||''}).then(result=>{if(id!==catalogGeneration.current||target!==scopeRef.current)return;setCatalog(result);cachedCatalog.current=cwd;}).catch(error=>{if(id===catalogGeneration.current)setError(String(error));}).finally(()=>{if(id===catalogGeneration.current)setCatalogLoading(false);});
 },[visible,activeCategory,cwd,scope,revision]);
 useEffect(()=>{
  if(!visible)return;
  const id=++generation.current,target=scope;
  let timer;
  const load=async()=>{
   if(id!==generation.current)return;
   if(['skill','plugin'].includes(activeCategory)){setLoading(false);return;}
   setLoading(true);setError('');
   try{
    let result;
    if(activeCategory==='browser')result=await readBrowserContexts();
    else if(activeCategory==='ide')result=await invoke('read_ide_context',{cwd:cwd||''});
    else if(activeCategory==='thread')result=await invoke('search_context_threads',{query:activeQuery,excludeThreadId:scope});
    else if(activeCategory==='all'){
     const [fileResult,threadResult]=await Promise.allSettled([invoke('search_context_files',{roots:JSON.parse(rootsKey),query:activeQuery}),invoke('search_context_threads',{query:activeQuery,excludeThreadId:scope})]);
     if(id!==generation.current||target!==scopeRef.current)return;
     setFiles(fileResult.status==='fulfilled'?fileResult.value:[]);setThreads(threadResult.status==='fulfilled'?threadResult.value:[]);
     if(fileResult.status==='rejected'||threadResult.status==='rejected')setError(t("部分上下文暂时无法读取，请刷新或切换分类。"));
     return;
    }
    else result=await invoke('search_context_files',{roots:JSON.parse(rootsKey),query:activeQuery});
    if(id!==generation.current||target!==scopeRef.current)return;
    if(activeCategory==='browser')setPages(result);else if(activeCategory==='ide')setIde(result);else if(activeCategory==='thread')setThreads(result);else setFiles(result);
   }catch(error){if(id===generation.current&&target===scopeRef.current)setError(String(error));}
   finally{if(id===generation.current)setLoading(false);}
  };
  timer=setTimeout(load,['browser','ide'].includes(activeCategory)?0:160);
  return()=>{clearTimeout(timer);if(generation.current===id)generation.current++;};
 },[visible,activeCategory,activeQuery,rootsKey,cwd,scope,revision]);
 useEffect(()=>{
  if(!visible||activeCategory!=='browser')return;
  let active=true;
  const dispose=subscribeBrowserContexts(pages=>{if(active){setPages(pages);setError('');}},reason=>{if(active){setPages([]);setError(String(reason));}});
  return()=>{active=false;dispose();};
 },[visible,activeCategory,scope]);
 const rows=useMemo(()=>{
  let source;
  if(activeCategory==='all')source=[files,threads,catalog.skills,catalog.plugins].flatMap(group=>group.filter(item=>contextMatches(item,activeQuery)).slice(0,20));
  else if(activeCategory==='skill')source=catalog.skills;
  else if(activeCategory==='plugin')source=catalog.plugins;
  else if(activeCategory==='browser')source=pages;
  else if(activeCategory==='ide')source=ide;
  else if(activeCategory==='thread')source=threads;
  else source=files.filter(item=>item.kind===activeCategory);
  return source.filter(item=>contextMatches(item,activeQuery)).slice(0,80);
 },[activeCategory,activeQuery,files,catalog,pages,ide,threads]);
 const add=useCallback(items=>{try{onAddRef.current(items);}catch(error){onErrorRef.current(String(error.message||error));}},[]);
 useEffect(()=>{root.current?.querySelector(`[data-context-index="${activeIndex}"]`)?.scrollIntoView?.({block:'nearest'});},[activeIndex]);
 useEffect(()=>{onRows?.(visible?rows:[]);},[visible,rows,onRows]);
 useEffect(()=>{if(onSelectRef)onSelectRef.current=index=>{if(rows[index])add([rows[index]]);};return()=>{if(onSelectRef)onSelectRef.current=null;};},[rows,add,onSelectRef]);
 const refresh=()=>{cachedCatalog.current=null;setRevision(value=>value+1);};
 return <>
  {visible&&<div className="context-picker" data-native-glass={nativeGlass||undefined} role="dialog" aria-label={t("添加上下文")} ref={root}>
   <div className="context-picker-heading"><strong>{mention?.trigger==='$'?t("选择技能"):mention?t("选择上下文"):t("添加上下文")}</strong><button type="button" aria-label={t("刷新上下文")} onClick={refresh}><RefreshCw size={13}/></button><button type="button" aria-label={t("关闭上下文菜单")} onClick={onClose}><X size={14}/></button></div>
   {mention?.trigger!=='$'&&<div className="context-categories" aria-label={t("上下文类型")}>{Object.entries(contextLabels).map(([kind,name])=><button key={kind} type="button" aria-pressed={category===kind} onClick={()=>{setError('');if(kind==='snippet')setSnippet(true);else{setQuery('');setCategory(kind);}}}>{t(name)}</button>)}</div>}
   {!mention&&<input className="context-search" aria-label={t("搜索上下文")} placeholder={t("搜索名称或路径…")} value={query} onChange={event=>setQuery(event.target.value)}/>}
   {activeCategory==='browser'&&<><p className="context-note">{t("自动读取各窗口当前网页正文。添加后跟随该窗口切换的标签页，约每 2 秒更新；可在上下文标签上暂停。正文上限可在设置中调整；未加载的内容无法读取。")}</p><button type="button" className="context-manual" onClick={()=>setBrowserEditor(true)}>{t("手动添加网页与选中文字")}</button></>}
   {activeCategory==='ide'&&<p className="context-note">{t("从已连接的 Codex IDE 扩展读取当前文件、打开文件及选中代码。")}</p>}
   {activeCategory==='thread'&&<p className="context-note">{t("选择其他对话作为参考，不会切换当前聊天。发送后由 Codex 按需读取对话内容。")}</p>}
   {error&&<p className="context-error" role="alert">{t(error)}</p>}
   {(loading||catalogLoading)&&<p className="context-note" role="status">{t("正在读取上下文…")}</p>}
   <div className="context-results" id="context-suggestions" role="listbox" aria-label={t("上下文候选项")}>{rows.map((item,index)=>{const Icon=icons[item.kind]||File;return <button type="button" id={`context-option-${index}`} role="option" aria-selected={!!mention&&index===activeIndex} key={contextKey(item)} data-context-index={index} onClick={()=>add([item])} title={[detail(item),item.content?.slice(0,700)].filter(Boolean).join('\n')}><Icon size={14}/><span><strong>{item.label}</strong><small>{detail(item)}</small></span><em>{item.kind==='browser'?browserReadStatus(item):t(contextLabels[item.kind])}</em></button>;})}</div>
   {!rows.length&&!loading&&!catalogLoading&&!error&&<p className="context-note">{activeCategory==='browser'?t("未读取到网页。请在 Chrome、Edge、Brave 或 Firefox 中打开网页后刷新，也可手动添加网址与选中文字。"):activeCategory==='file'||activeCategory==='folder'||activeCategory==='all'?t("没有匹配项。"):t("没有可添加的上下文。")}</p>}
   {catalog.warnings?.map(warning=><p className="context-note" key={warning}>{warning}</p>)}
  </div>}
  {snippet&&<SnippetEditor initial={initialSelection} onAdd={item=>add([item])} onClose={()=>setSnippet(false)}/>}
  {browserEditor&&<BrowserEditor onAdd={item=>add([item])} onClose={()=>setBrowserEditor(false)}/>}
 </>;
}
