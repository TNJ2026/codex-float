import React,{memo,useMemo} from 'react';
import {convertFileSrc} from '@tauri-apps/api/core';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {imageSource} from './images';
import {useLinkAction} from './LinkPreview';
import {highlightCode} from './syntax';

const purifier=DOMPurify(window);
const resolveImage=source=>imageSource(source,path=>window.__TAURI_INTERNALS__?convertFileSrc(path):'');
purifier.addHook('afterSanitizeAttributes',node=>{
 if(node.tagName==='A'){
  if(!node.hasAttribute('data-link-target')&&node.hasAttribute('href'))node.setAttribute('data-link-target',node.getAttribute('href'));
  node.setAttribute('href','#');
  node.removeAttribute('target');
 }
 if(node.tagName!=='IMG')return;
 const source=resolveImage(node.getAttribute('data-image-source')||node.getAttribute('src'));
 node.removeAttribute('data-image-source');
 node.removeAttribute('srcset');
 if(source)node.setAttribute('src',source);else node.removeAttribute('src');
 node.setAttribute('loading','lazy');
 node.setAttribute('decoding','async');
 node.setAttribute('referrerpolicy','no-referrer');
 node.setAttribute('tabindex','0');
 node.setAttribute('role','button');
});
// Preserve local paths until the sanitizer hook converts them to Tauri asset URLs.
const escapeAttribute=value=>String(value||'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const renderer=new marked.Renderer();
renderer.code=({text,lang})=>{
 const code=highlightCode(text,lang);
 return `<pre><code class="syntax-code language-${code.language}">${code.html}</code></pre>\n`;
};
renderer.image=({href,title,text})=>`<img data-image-source="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${title?` title="${escapeAttribute(title)}"`:''}>`;
renderer.link=function({href,title,tokens}){return `<a href="#" data-link-target="${escapeAttribute(href)}"${title?` title="${escapeAttribute(title)}"`:''}>${this.parser.parseInline(tokens)}</a>`;};

export const Markdown=memo(function Markdown({text='',images=[]}){
 const openLink=useLinkAction();
 const html=useMemo(()=>purifier.sanitize(marked.parse(text,{renderer}),{FORBID_TAGS:['iframe','video','audio','svg','math','style'],ADD_ATTR:['data-image-source','data-link-target']}),[text]);
 function activate(e){
  const anchor=e.target.closest('a');
  if(anchor){e.preventDefault();openLink(anchor.getAttribute('data-link-target')||'');}
  else if(e.target.tagName==='IMG'&&e.target.getAttribute('src')){e.preventDefault();openLink(e.target.getAttribute('src'),true);}
 }
 return <div className="markdown" onClick={activate} onAuxClick={e=>{if(e.button===1)activate(e);}} onKeyDown={e=>{if(e.target.tagName==='IMG'&&['Enter',' '].includes(e.key))activate(e);}} onErrorCapture={e=>{if(e.target.tagName==='IMG'){e.target.classList.add('image-error');e.target.alt='图片无法加载：'+(e.target.getAttribute('aria-label')||e.target.alt||'图片');}}}>
  <div dangerouslySetInnerHTML={{__html:html}}/>
  {images.length>0&&<div className="image-attachments">{images.map(image=>{
   const src=resolveImage(image.src);
   return src?<img key={image.id} src={src} alt={image.alt} aria-label={image.alt} role="button" tabIndex={0} loading="lazy" decoding="async" referrerPolicy="no-referrer"/>:<span className="image-error" key={image.id}>图片无法加载：{image.alt}</span>;
  })}</div>}
 </div>;
});
