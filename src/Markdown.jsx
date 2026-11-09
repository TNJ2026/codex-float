import {t,useLanguage} from './i18n.js';
import React,{memo,useMemo,useState} from 'react';
import {convertFileSrc} from '@tauri-apps/api/core';
import {Marked} from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {imageSource} from './images';
import {useLinkAction,useLinkMenu} from './LinkPreview';
import {highlightCode} from './syntax';
import {copyText} from './message-actions';
import {mediaKind,mediaSource,specialFence,closedFence,safeSource,localResourcePath,annotateCitations} from './rich-content';
import {RichPreview} from './RichPreview';
import {AttachmentCards,MediaPlayer,SourceCards} from './MessageResources';

const purifier=DOMPurify(window),rawPurifier=DOMPurify(window);
const convert=path=>window.__TAURI_INTERNALS__?convertFileSrc(path):'';
const resolveImage=source=>imageSource(source,convert);
const escape=value=>String(value||'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
purifier.addHook('afterSanitizeAttributes',node=>{
 if(node.tagName==='A'){
  if(!node.hasAttribute('data-link-target')&&node.hasAttribute('href'))node.setAttribute('data-link-target',node.getAttribute('href'));
  node.setAttribute('href','#');node.removeAttribute('target');
 }
 if(['AUDIO','VIDEO','SOURCE'].includes(node.tagName)){
  const value=node.getAttribute('data-media-source')||node.getAttribute('src'),source=mediaSource(value,convert);
  node.removeAttribute('data-media-source');node.removeAttribute('autoplay');
  if(source)node.setAttribute('src',source);else node.removeAttribute('src');
  if(node.tagName!=='SOURCE'){node.setAttribute('controls','');node.setAttribute('preload','none');}return;
 }
 if(node.tagName!=='IMG')return;
 const original=node.getAttribute('data-image-source')||node.getAttribute('src'),source=resolveImage(original);
 if(source)node.setAttribute('data-link-target',original);else node.removeAttribute('data-link-target');
 node.removeAttribute('data-image-source');node.removeAttribute('srcset');
 if(source)node.setAttribute('src',source);else node.removeAttribute('src');
 node.setAttribute('loading','lazy');node.setAttribute('decoding','async');node.setAttribute('referrerpolicy','no-referrer');node.setAttribute('tabindex','0');node.setAttribute('role','button');
});
const math=(text,displayMode)=>{
 if(text.length>20000)return `<code>${escape(text)}</code>`;
 try{return katex.renderToString(text,{displayMode,throwOnError:false,trust:false,maxSize:10,maxExpand:1000,strict:'ignore',output:'htmlAndMathml'});}catch{return `<code>${escape(text)}</code>`;}
};
const normalCode=({text,lang})=>{const code=highlightCode(text,lang);return `<div class="markdown-code-block"><div class="code-toolbar"><span>${escape(code.language)}</span><button type="button" class="copy-code-button" data-copy-code="true" aria-label="${t('复制代码')}">${t('复制代码')}</button></div><pre><code class="syntax-code language-${code.language}">${code.html}</code></pre></div>\n`;};

export function markdownParts(text,references=[],streaming=false,cwd=''){
 text=annotateCitations(text,references);
 const sources=[...new Map(references.filter(source=>safeSource(source.url)).map(source=>[source.url,source])).values()],byRef=new Map();
 references.forEach(source=>{if(safeSource(source.url))byRef.set(source.ref,source);});
 const attachmentLinks=[];
 const renderer={
  code:token=>/^(math|latex|tex)$/iu.test(token.lang||'')?math(token.text,true):normalCode(token),
  image:({href,title,text})=>{
   const kind=mediaKind(href);
   if(kind){attachmentLinks.push(href);return `<span class="inline-media"><${kind} data-media-source="${escape(localResourcePath(href,cwd)||href)}" controls preload="none"${kind==='video'?' playsinline':''}></${kind}><a href="#" data-link-target="${escape(href)}">${escape(text||title||t("打开媒体文件"))}</a></span>`;}
   return `<img data-image-source="${escape(localResourcePath(href,cwd)||href)}" alt="${escape(text)}"${title?` title="${escape(title)}"`:''}>`;
  },
  link({href,title,tokens}){
   const label=this.parser.parseInline(tokens),attachment=/^(?:附件[：:]|attachment:)/iu.test(tokens.map(token=>token.text||'').join(''))||/\.(?:pdf|docx?|xlsx?|pptx?|csv|tsv|zip|7z|rar|tar|gz|odt|ods|odp)(?:[?#].*)?$/iu.test(href);
   const kind=mediaKind(href);if(kind){attachmentLinks.push(href);return `<span class="inline-media"><${kind} data-media-source="${escape(localResourcePath(href,cwd)||href)}" controls preload="none"></${kind}><a href="#" data-link-target="${escape(href)}">${label}</a></span>`;}
   if(attachment){attachmentLinks.push(href);return `<a class="attachment-card markdown-attachment" href="#" data-link-target="${escape(href)}"><span class="attachment-icon">▤</span><span><strong>${label}</strong><small>${t('文件附件')}</small></span><span aria-hidden="true">↗</span></a>`;}
   return `<a href="#" data-link-target="${escape(href)}"${title?` title="${escape(title)}"`:''}>${label}</a>`;
  },
  html:({text})=>rawPurifier.sanitize(text,{FORBID_TAGS:['script','iframe','svg','math','style','object','embed','form','input','button','textarea','select'],FORBID_ATTR:['style','autoplay','data-copy-code','data-image-source','data-media-source','data-link-target']})
 };
 const parser=new Marked({renderer});
 parser.use({extensions:[
  {name:'blockMath',level:'block',start:source=>source.search(/\$\$|\\\[/u),tokenizer(source){const match=/^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/u.exec(source);if(match)return {type:'blockMath',raw:match[0],text:match[1]??match[2]};},renderer:token=>math(token.text,true)},
  {name:'inlineMath',level:'inline',start:source=>source.search(/\$|\\\(/u),tokenizer(source){const match=/^(?:\\\(([\s\S]+?)\\\)|\$(?!\$|\s)((?:\\.|[^$\\\n])+?)\$(?!\d))/u.exec(source);if(match&&(match[1]||match[2])?.trim())return {type:'inlineMath',raw:match[0],text:match[1]??match[2]};},renderer:token=>math(token.text,false)},
  {name:'citation',level:'inline',start:source=>source.indexOf(''),tokenizer(source){const match=/^(cite|filecite|navlist)([^]+)/u.exec(source);if(match)return {type:'citation',raw:match[0],kind:match[1],refs:match[2].split('')[0].split('')};},renderer:token=>token.refs.filter(ref=>!/^L\d/u.test(ref)).map(ref=>{
   let source=byRef.get(ref);if(!source&&safeSource(ref)){source={ref,url:ref,title:ref};byRef.set(ref,source);if(!sources.some(s=>s.url===ref))sources.push(source);}
   if(!source)return `<span class="citation unavailable" title="${t('此引用的来源地址未同步')}">${t('[来源]')}</span>`;
   const index=sources.findIndex(s=>s.url===source.url)+1;
   return `<a class="citation" href="#" data-link-target="${escape(source.url)}" title="${escape(source.title)}" aria-label="${t('来源 {0}',[index])}">[${index}]</a>`;
  }).join('')}
 ]});
 const parts=[],tokens=parser.lexer(text);let group=[];
 // Raw SVG is removed by renderer.html; retain KaTeX's generated radical/accent paths.
 const flush=()=>{if(!group.length)return;const html=purifier.sanitize(parser.parser(group),{FORBID_TAGS:['iframe','style','object','embed'],ADD_TAGS:['audio','video','source'],ADD_ATTR:['data-image-source','data-media-source','data-link-target','data-copy-code','controls','preload','playsinline']});if(html.trim())parts.push({kind:'markdown',html});group=[];};
 if(/^\s*(?:<!doctype\s+html|<html(?:\s|>))/iu.test(text))return {parts:[{kind:'html',code:text,complete:!streaming}],sources,attachmentLinks};
 for(const token of tokens){const kind=token.type==='code'&&specialFence(token.lang);if(kind){flush();parts.push({kind,code:token.text,complete:closedFence(token.raw)||!streaming});}else group.push(token);}flush();
 return {parts,sources,attachmentLinks};
}

export const Markdown=memo(function Markdown({text='',images=[],attachments=[],references=[],streaming=false,cwd=''}){
 const language=useLanguage();
 const openLink=useLinkAction(),showLinkMenu=useLinkMenu(),[copyError,setCopyError]=useState(''),[mediaError,setMediaError]=useState('');
 const rendered=useMemo(()=>markdownParts(text,references,streaming,cwd),[text,references,streaming,cwd,language]);
 async function activate(event){
  const copy=event.target.closest('[data-copy-code]');if(copy){event.preventDefault();const code=copy.closest('.markdown-code-block')?.querySelector('pre > code');if(!code)return;try{await copyText(code.textContent);setCopyError('');copy.textContent=t("已复制");copy.setAttribute('aria-label',t("代码已复制"));setTimeout(()=>{if(copy.isConnected){copy.textContent=t("复制代码");copy.setAttribute('aria-label',t("复制代码"));}},1600);}catch(error){setCopyError(String(error.message||error));}return;}
  const anchor=event.target.closest('a');if(anchor){event.preventDefault();openLink(anchor.getAttribute('data-link-target')||'');}else if(event.target.tagName==='IMG'&&event.target.getAttribute('src')){event.preventDefault();openLink(event.target.getAttribute('data-link-target')||event.target.getAttribute('src'),true);}
 }
 return <div className="markdown" onClick={activate} onContextMenu={event=>{const anchor=event.target.closest('[data-link-target]');if(anchor)showLinkMenu(event,anchor.getAttribute('data-link-target'));}} onAuxClick={event=>{if(event.button===1)activate(event);}} onKeyDown={event=>{const anchor=event.target.closest('[data-link-target]');if(anchor)showLinkMenu(event,anchor.getAttribute('data-link-target'));if(event.target.tagName==='IMG'&&['Enter',' '].includes(event.key))activate(event);}} onErrorCapture={event=>{if(event.target.tagName==='IMG'){event.target.classList.add('image-error');event.target.alt=t('图片无法加载：')+(event.target.getAttribute('aria-label')||event.target.alt||t("图片"));}else if(['AUDIO','VIDEO'].includes(event.target.tagName))setMediaError(t("媒体无法播放，请检查文件、网络或编码格式"));}}>
  {rendered.parts.map((part,index)=>part.kind==='markdown'?<div key={index} dangerouslySetInnerHTML={{__html:part.html}}/>:<RichPreview key={`${index}:${part.kind}`} {...part}/>)}
  {copyError&&<small className="message-action-error" role="alert">{copyError}</small>}{mediaError&&<small className="message-action-error" role="alert">{mediaError}</small>}
  {images.length>0&&<div className="image-attachments">{images.map(image=>{const kind=mediaKind(image.src);if(kind)return <MediaPlayer key={image.id} kind={kind} src={image.src} name={image.alt} cwd={cwd}/>;const src=resolveImage(image.src);return src?<img key={image.id} src={src} data-link-target={localResourcePath(image.src,cwd)||image.src} alt={image.alt} aria-label={image.alt} role="button" tabIndex={0} loading="lazy" decoding="async" referrerPolicy="no-referrer"/>:<span className="image-error" key={image.id}>{t("图片无法加载：")}{image.alt}</span>;})}</div>}
  <AttachmentCards files={attachments} cwd={cwd} exclude={rendered.attachmentLinks}/><SourceCards sources={rendered.sources}/>
 </div>;
});
