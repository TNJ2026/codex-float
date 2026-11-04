export function mediaKind(source='',mime=''){
 if(/^video\//iu.test(mime)||/^data:video\//iu.test(source))return 'video';
 if(/^audio\//iu.test(mime)||/^data:audio\//iu.test(source))return 'audio';
 return /\.(?:mp3|wav|m4a|aac|ogg|oga|flac|opus)(?:[?#].*)?$/iu.test(source)?'audio':/\.(?:mp4|webm|m4v|mov|ogv)(?:[?#].*)?$/iu.test(source)?'video':null;
}
export function localResourcePath(value,cwd=''){
 if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f]/u.test(value))return '';
 let path=value.trim();
 if(/^file:\/\//iu.test(path)){try{const url=new URL(path);if(url.hostname&&url.hostname!=='localhost')return '';path=decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/iu,'$1');}catch{return '';}}
 path=path.replace(/^\/([a-z]:[\\/])/iu,'$1');if(/^(?:\\\\|\/\/)/u.test(path))return '';
 if(/^[a-z]:[\\/]/iu.test(path)||/^\/(?!\/)/u.test(path))return path;
 if(/^[a-z][a-z\d+.-]*:/iu.test(path))return '';
 return cwd?cwd.replace(/[\\/]$/u,'')+'/'+path:'';
}
export function mediaSource(value,convertLocal=()=>'',cwd=''){
 if(typeof value!=='string'||/[\u0000-\u001f]/u.test(value))return '';
 const source=value.trim();
 if(/^https?:\/\//iu.test(source)){try{const url=new URL(source);return !url.username&&!url.password?url.href:'';}catch{return '';}}
 if(/^data:(?:audio|video)\/[a-z\d.+-]+;base64,[a-z\d+/=\s]+$/iu.test(source))return source;
 const path=localResourcePath(source,cwd);return path?convertLocal(path):'';
}
const fileTypes=new Set(['file','input_file','inputFile','localFile','local_file','fileAttachment','file_attachment','audio','input_audio','inputAudio','video','input_video','inputVideo']);
const cache=new WeakMap();
export function attachmentsOf(item){
 if(cache.has(item))return cache.get(item);
 const parts=[...(Array.isArray(item.content)?item.content:Array.isArray(item.input)?item.input:[]),...(Array.isArray(item.attachments)?item.attachments:[]),...(Array.isArray(item.fileAttachments)?item.fileAttachments:[])];
 const seen=new Set(),files=[];
 for(const part of parts){
  if(!part||!fileTypes.has(part.type||'file')||['image','input_image','localImage','local_image'].includes(part.type))continue;
  const detail=part.input_audio||part.inputAudio||part.file||part,url=part.path??part.url??part.file_url??part.audio_url??part.video_url??detail.path??detail.url;
  let src=typeof url==='string'?url:url?.url;const format=/audio/iu.test(part.type||'')&&(part.format||detail.format),mime=part.mimeType||part.mime_type||detail.mimeType||(format?`audio/${format}`:'');
  const data=part.data||detail.data;if(!src&&typeof data==='string'&&/^(audio|video)\//u.test(mime))src=`data:${mime};base64,${data}`;
  if(!src||seen.has(src))continue;seen.add(src);
  files.push({src,kind:mediaKind(src,mime)||(/video/iu.test(part.type||'')?'video':/audio/iu.test(part.type||'')?'audio':'file'),name:part.name||part.filename||part.file_name||detail.filename||(/^data:/iu.test(src)?'媒体附件':src.split(/[\\/]/u).at(-1)?.split('?')[0])||'附件',size:part.size||part.sizeBytes,mime});
 }
 cache.set(item,files);return files;
}
export function safeSource(value){
 if(typeof value!=='string'||/[\u0000-\u001f]/u.test(value))return '';
 if(/^https?:\/\//iu.test(value)){try{const url=new URL(value);return !url.username&&!url.password?url.href:'';}catch{return '';}}
 if(localResourcePath(value))return value;
 return '';
}
const referencesCache=new WeakMap();
const referenceLists=new WeakMap();
function sourcesIn(item){
 if(referencesCache.has(item))return referencesCache.get(item);
 const found=[];let visited=0;
 const visit=(value,depth=0)=>{
  if(!value||depth>6||visited++>500)return;
  if(Array.isArray(value)){value.slice(0,80).forEach(v=>visit(v,depth+1));return;}
  if(typeof value==='string'){if(value.length<200000&&/^[\[{]/u.test(value)){try{visit(JSON.parse(value),depth+1);}catch{}}return;}
  if(typeof value!=='object')return;
  const source=value.url_citation||value.file_citation||value;
  const url=safeSource(source.url||source.href||source.path||source.file_path),ref=source.ref_id||source.refId||source.reference_id||source.id||value.ref_id||value.id;
  if(url)found.push({ref:typeof ref==='string'?ref:url,url,title:String(source.title||source.name||source.filename||url).slice(0,300),description:String(source.snippet||source.description||'').slice(0,1000),kind:/^https?:/iu.test(url)?'web':'file',start:source.start_index??source.startIndex??value.start_index,end:source.end_index??source.endIndex??value.end_index});
  for(const key of ['annotations','citations','sources','results','content','structuredContent','result','text'])if(value[key]!=null)visit(value[key],depth+1);
 };
 visit(item);referencesCache.set(item,found);return found;
}
export function referencesOf(item,items){
 const relevant=items.filter(i=>i.type==='webSearch'||i.type==='mcpToolCall'&&/search|browse|fetch/iu.test(i.tool||'')),cached=referenceLists.get(item);
 if(cached&&cached.relevant.length===relevant.length&&cached.relevant.every((entry,index)=>entry===relevant[index]))return cached.result;
 const result=[],seen=new Set();
 for(const source of [...sourcesIn(item),...relevant.flatMap(sourcesIn)]){
  const key=source.ref+'\n'+source.url+'\n'+source.end;if(seen.has(key))continue;seen.add(key);result.push(source);if(result.length>=80)break;
 }
 referenceLists.set(item,{relevant,result});return result;
}
export const specialFence=lang=>({mermaid:'mermaid',echarts:'echarts',chart:'echarts','chart-json':'echarts',html:'html','html-preview':'html'})[String(lang||'').trim().split(/\s/u)[0].toLowerCase()]||null;
export function closedFence(raw){
 const open=/^ {0,3}(`{3,}|~{3,})[^\n]*\n/u.exec(raw);if(!open)return true;
 const last=raw.trimEnd().split('\n').at(-1).trim();return last.length>=open[1].length&&[...last].every(c=>c===open[1][0]);
}
export function annotateCitations(text,references){
 if(/(?:cite|filecite)/u.test(text))return text;
 const protectedRanges=[...text.matchAll(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?:\n|$)|$)|`[^`\n]+`/gu)].map(match=>[match.index,match.index+match[0].length]);
 const spans=[...new Map(references.filter(source=>Number.isInteger(source.end)&&source.end>0&&source.end<=text.length&&safeSource(source.url)&&!protectedRanges.some(([start,end])=>source.end>start&&source.end<end)).map(source=>[source.end,source])).values()].sort((a,b)=>b.end-a.end);
 for(const source of spans)text=text.slice(0,source.end)+`cite${source.ref}`+text.slice(source.end);return text;
}
