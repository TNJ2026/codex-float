import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('file list opens recorded diffs, current content and deleted-file diffs using one visible modal',async()=>{
 const dom=new JSDOM('<div id="root"></div>');
 const globals=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(key=>globalThis[key]);
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const calls=[];
 dom.window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{calls.push({cmd,args});return {kind:'text',text:'const current = 1;'};}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {ChangedFiles}=await vite.ssrLoadModule('/src/ChangedFiles.jsx');
  const {LinkProvider}=await vite.ssrLoadModule('/src/LinkPreview.jsx');
  const files=[
   {path:'D:/app.js',kind:'update',diffs:[{kind:'update',text:'@@ -1 +1 @@\n-old\n+<script>text</script>\n'},{kind:'update',text:'@@ -3 +3 @@\n-a\n+b\n'}]},
   {path:'D:/deleted.txt',kind:'delete',diffs:[{kind:'delete',text:Array.from({length:512},(_,i)=>`line ${i+1}`).join('\n')}]},
   {path:'D:/other.js',kind:'update'},
   {path:'D:/extra.js',kind:'update'}
  ];
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(LinkProvider,{cwd:'D:/',scope:'thread'},React.createElement(ChangedFiles,{files}))));
  const directFile=document.querySelector('.changed-files-summary .changed-file-row');
  directFile.focus();
  await act(async()=>directFile.click());
  assert.equal(document.querySelector('.changed-files-dialog'),null);
  assert.equal(document.querySelectorAll('dialog').length,1);
  assert.equal(document.querySelector('.diff-dialog .diff-section').getAttribute('aria-label'),'第 1 次修改');
  await act(async()=>document.querySelector('dialog header button').click());
  assert.equal(document.querySelector('dialog'),null);
  assert.equal(document.activeElement,directFile);
  await act(async()=>document.querySelector('.changed-files-more').click());
  const list=document.querySelector('.changed-files-dialog');
  assert.equal(list.querySelectorAll('button:disabled').length,0);
  await act(async()=>list.querySelector('.changed-file-row').click());
  const diff=document.querySelector('.diff-dialog');
  assert.equal(calls.length,0);
  assert.equal(document.querySelectorAll('dialog[open]').length,1);
  assert.equal(diff.querySelectorAll('.diff-section').length,2);
  assert.match(diff.textContent,/按发生顺序/);
  assert.equal(diff.querySelector('.diff-row.add .diff-content').textContent,'<script>text</script>');
  assert.equal(diff.querySelector('script'),null);
  await act(async()=>diff.querySelector('.diff-toolbar button').click());
  assert.equal(document.querySelectorAll('dialog[open]').length,1);
  assert.deepEqual(calls,[{cmd:'read_file_preview',args:{path:'D:/app.js'}}]);
  assert.match(document.querySelector('dialog[open] pre').textContent,/const current/);
  await act(async()=>document.querySelector('dialog[open]').dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
  assert.equal(diff.hasAttribute('open'),true);
  await act(async()=>diff.dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
  assert.equal(list.hasAttribute('open'),true);
  await act(async()=>list.querySelectorAll('.changed-file-row')[1].click());
  assert.equal(document.querySelectorAll('dialog[open] .diff-row.delete').length,500);
  assert.equal(document.querySelector('dialog[open] .diff-toolbar button'),null);
  await act(async()=>document.querySelector('.diff-load-more').click());
  assert.equal(document.querySelectorAll('dialog[open] .diff-row.delete').length,512);
  assert.equal(document.querySelector('.diff-load-more'),null);
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();globals.forEach((key,index)=>{globalThis[key]=previous[index];});dom.window.close();
 }
});
