import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {mediaKind,mediaSource,attachmentsOf,referencesOf,annotateCitations,closedFence} from '../src/rich-content.js';
import {messagesOf} from '../src/model.js';

test('media paths and MIME types distinguish players and reject executable or shared paths',()=>{
 assert.equal(mediaKind('https://example.com/a.MP4?token=x'),'video');assert.equal(mediaKind('clip.ogg','video/ogg'),'video');assert.equal(mediaKind('data:audio/wav;base64,AAAA'),'audio');
 const convert=path=>'asset:'+path;
 assert.equal(mediaSource('file:///C:/a%20b.mp3',convert),'asset:C:/a b.mp3');assert.equal(mediaSource('clip.webm',convert,'D:/project'),'asset:D:/project/clip.webm');
 for(const value of ['javascript:alert(1)','data:text/html;base64,AAAA','file://server/share/a.mp3','\\\\server\\a.mp4','https://example.com/\na.mp4'])assert.equal(mediaSource(value,convert),'');
});
test('file and media-only messages survive parsing with stable attachment identities',()=>{
 const item={id:'files',type:'userMessage',content:[{type:'file',path:'D:/report.pdf',name:'report.pdf',size:1234},{type:'audio',path:'D:/voice.wav'},{type:'video',url:'https://example.com/clip.webm'}]};
 const messages=messagesOf({cwd:'D:/',turns:[{id:'turn',items:[item]}]});assert.equal(messages.length,1);assert.deepEqual(messages[0].attachments.map(file=>file.kind),['file','audio','video']);assert.equal(attachmentsOf(item),attachmentsOf(item));
});
test('citations retain actual source IDs, cache stable references and protect code from annotation inserts',()=>{
 const item={id:'reply',type:'agentMessage',text:'Fact.',annotations:[{type:'url_citation',ref_id:'source1',url:'https://example.com/fact',title:'Fact',start_index:0,end_index:5}]},items=[item];
 const refs=referencesOf(item,items);assert.equal(refs[0].ref,'source1');assert.equal(referencesOf(item,[...items]),refs);assert.match(annotateCitations(item.text,refs),/Fact\.citesource1/);
 const code='```js\nlet x=1;\n```';assert.equal(annotateCitations(code,[{...refs[0],end:10}]),code);assert.equal(annotateCitations('`const x=1`',[{...refs[0],end:5}]),'`const x=1`');
 assert.equal(closedFence('```mermaid\ngraph TD\nA-->B'),false);assert.equal(closedFence('```mermaid\ngraph TD\nA-->B\n```'),true);
});

test('Markdown renders formulas, citations, media and attachments while rich blocks remain isolated',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>'),keys=['window','document'],previous=keys.map(k=>globalThis[k]);Object.assign(globalThis,{window:dom.window,document:dom.window.document});
 window.__TAURI_INTERNALS__={convertFileSrc:path=>'http://asset.localhost/'+encodeURIComponent(path)};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 try{
  const {Markdown,markdownParts}=await vite.ssrLoadModule('/src/Markdown.jsx');
  const text='公式 $E=mc^2$\n\n$$\\frac{1}{2}$$\n\n价格 $20 和 $30。\n\n事实citeref1 未知citeunknown\n\n![音频](D:/voice.mp3)\n\n![视频](https://example.com/clip.mp4)\n\n[附件：报告](D:/report.pdf)';
  const refs=[{ref:'ref1',url:'https://example.com/docs',title:'真实来源'}];
  const html=renderToStaticMarkup(React.createElement(Markdown,{text,references:refs})),doc=new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll('.katex').length,2);assert.match(doc.body.textContent,/价格 \$20 和 \$30/);assert.equal(doc.querySelector('audio').getAttribute('src'),'http://asset.localhost/'+encodeURIComponent('D:/voice.mp3'));assert.equal(doc.querySelector('video').getAttribute('preload'),'none');assert.equal(doc.querySelector('video').hasAttribute('autoplay'),false);
  assert.equal(doc.querySelector('.citation[data-link-target]').getAttribute('data-link-target'),'https://example.com/docs');assert.equal(doc.querySelector('.citation.unavailable').textContent,'[来源]');assert.ok(doc.querySelector('.source-card'));assert.ok(doc.querySelector('.attachment-card'));
  const radical=new JSDOM(renderToStaticMarkup(React.createElement(Markdown,{text:'$\\sqrt{4}$ <svg onload="alert(1)"><circle/></svg>'}))).window.document;assert.ok(radical.querySelector('.katex svg path'),'radical geometry must survive sanitization');assert.equal(radical.querySelector('svg[onload],circle'),null);
  const parts=markdownParts('前文\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```echarts\n{"series":[]}\n```\n\n```html\n<button onclick="alert(1)">button</button>\n```');assert.deepEqual(parts.parts.map(part=>part.kind),['markdown','mermaid','echarts','html']);
  assert.equal(markdownParts('```mermaid\ngraph TD\nA-->B',[],true).parts[0].complete,false);
  const unsafe=new JSDOM(renderToStaticMarkup(React.createElement(Markdown,{text:'<video autoplay src="javascript:alert(1)"></video><script>bad()</script>\n\n$\\href{javascript:alert(1)}{x}$'}))).window.document;assert.equal(unsafe.querySelector('script,[autoplay],[href^="javascript:"]'),null);assert.equal(unsafe.querySelector('video').hasAttribute('src'),false);
  const code=new JSDOM(renderToStaticMarkup(React.createElement(Markdown,{text:'```js\nconst price="$5";\n```'}))).window.document;assert.equal(code.querySelector('code').textContent,'const price="$5";');assert.equal(code.querySelector('.katex'),null);
 }finally{await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
});

test('rich previews run HTML on demand, reject other frames and retain the iframe when expanded',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost'}),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>globalThis[k]);Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};const calls=[];
 window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{calls.push({cmd,args});if(cmd==='load_rich_preview')return {token:'abc',url:'http://127.0.0.1:1234/mcp-app/abc/index.html'};}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let root;
 try{
  const {createRoot}=await import('react-dom/client'),{RichPreview}=await vite.ssrLoadModule('/src/RichPreview.jsx');root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(RichPreview,{kind:'html',code:'<button>demo</button>'})));
  assert.equal(calls.length,0);await act(async()=>document.querySelector('.rich-run').click());const frame=document.querySelector('iframe');assert.equal(frame.getAttribute('sandbox'),'allow-scripts');
  await act(async()=>window.dispatchEvent(new dom.window.MessageEvent('message',{source:window,origin:'null',data:{type:'rich/error',message:'spoofed'}})));assert.equal(document.querySelector('[role="alert"]'),null);
  await act(async()=>window.dispatchEvent(new dom.window.MessageEvent('message',{source:frame.contentWindow,origin:'null',data:{type:'rich/ready'}})));
  await act(async()=>document.querySelector('[aria-label="放大预览"]').click());assert.equal(document.querySelector('iframe'),frame);await act(async()=>document.querySelector('[aria-label="收起预览"]').click());assert.equal(document.querySelector('iframe'),frame);
  await act(async()=>window.dispatchEvent(new dom.window.MessageEvent('message',{source:frame.contentWindow,origin:'null',data:{type:'rich/error',message:'syntax error'}})));assert.match(document.querySelector('[role="alert"]').textContent,/syntax error/);assert.equal(document.querySelector('.rich-source').open,true);
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});}
 assert.ok(calls.some(call=>call.cmd==='release_mcp_app'&&call.args.token==='abc'));
});
