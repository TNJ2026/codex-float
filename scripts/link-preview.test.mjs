import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('message links dispatch once, show image/text previews and preserve text as inert content',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const globals=['window','document','IS_REACT_ACT_ENVIRONMENT'];
 const previous=globals.map(key=>globalThis[key]);
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const calls=[];
 let finishRead;
 dom.window.__TAURI_INTERNALS__={convertFileSrc:path=>`http://asset.localhost/${encodeURIComponent(path)}`,invoke:async(cmd,args)=>{
  calls.push({cmd,args});
  if(cmd==='read_file_preview')return args.path.endsWith('slow.txt')?new Promise(resolve=>{finishRead=resolve;}):args.path.endsWith('.pdf')?{kind:'folder'}:{kind:'text',text:args.path.endsWith('.ts')?'const message: string = "<img src=x onerror=alert(1)>";':'<script>alert(1)</script>\n中文文本'};
 }};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {Markdown}=await vite.ssrLoadModule('/src/Markdown.jsx');
  const {LinkProvider}=await vite.ssrLoadModule('/src/LinkPreview.jsx');
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(LinkProvider,{cwd:'D:/project',scope:'thread'},React.createElement(Markdown,{text:'[网页](https://example.com/a.png) [图片](D:/a.png) [文本](README.md) [代码](src/app.ts) [其他文件](D:/report.pdf) [慢文件](slow.txt) [危险](javascript:alert)'}))));
  const click=async(label)=>act(async()=>[...document.querySelectorAll('a,button')].find(el=>el.textContent===label||el.querySelector('strong')?.textContent===label).click());
  await click('网页');
  assert.deepEqual(calls[0],{cmd:'open_url',args:{url:'https://example.com/a.png'}});
  assert.equal(document.querySelector('dialog'),null);
  await click('图片');
  assert.equal(document.querySelector('dialog img').getAttribute('src'),'http://asset.localhost/D%3A%2Fa.png');
  await click('关闭');
  await click('文本');
  assert.deepEqual(calls[1],{cmd:'read_file_preview',args:{path:'D:/project/README.md'}});
  assert.equal(document.querySelector('dialog pre').textContent,'<script>alert(1)</script>\n中文文本');
  assert.equal(document.querySelector('dialog script'),null);
  await click('关闭');
  await click('代码');
  assert.ok(document.querySelector('dialog .language-typescript .hljs-keyword'));
  assert.equal(document.querySelector('dialog code').textContent,'const message: string = "<img src=x onerror=alert(1)>";');
  assert.equal(document.querySelector('dialog img,dialog [onerror]'),null);
  await click('关闭');
  await click('其他文件');
  assert.deepEqual(calls.slice(-2),[{cmd:'read_file_preview',args:{path:'D:/report.pdf'}},{cmd:'reveal_file',args:{path:'D:/report.pdf'}}]);
  assert.equal(document.querySelector('dialog'),null);
  await click('慢文件');
  assert.match(document.querySelector('dialog').textContent,/正在读取/);
  await click('关闭');
  const callsBeforeLateResponse=calls.length;
  await act(async()=>finishRead({kind:'folder'}));
  assert.equal(document.querySelector('dialog'),null);
  assert.equal(calls.length,callsBeforeLateResponse);
  const before=calls.length;
  await click('危险');
  assert.match(document.querySelector('[role="alert"]').textContent,/不支持/);
  assert.equal(calls.length,before);
  await act(async()=>document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
  assert.equal(document.querySelector('dialog'),null);
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();
  globals.forEach((key,index)=>{globalThis[key]=previous[index];});dom.window.close();
 }
});
