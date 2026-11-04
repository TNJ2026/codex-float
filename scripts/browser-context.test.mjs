import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('browser context follows only its window, can be frozen, survives sending, and stops after chat changes',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const globals=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=globals.map(k=>globalThis[k]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const page=(label,id='window-one')=>({kind:'browser',label,url:'https://example.com/'+label,content:'正文 '+label,contentType:'body',browserWindowId:id,autoUpdate:true});
 let pages=[page('A'),page('Other','window-two')],reads=0,fail=false,defer=false,finish;
 window.__TAURI_INTERNALS__={invoke:async (cmd,args)=>{assert.equal(cmd,'read_browser_contexts');assert.ok(args.maxChars>=1000&&args.maxChars<=100000);reads++;if(fail)throw 'browser unavailable';if(defer)return new Promise(resolve=>{finish=resolve;});return pages;}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {useContextDraft,ContextChips}=await vite.ssrLoadModule('/src/ContextPicker.jsx');
  const {contextKey,contextMessage,mergeContexts}=await vite.ssrLoadModule('/src/context.js');
  const {readBrowserLimit,saveBrowserLimit,browserReadStatus}=await vite.ssrLoadModule('/src/browser-settings.js');
  const {updateBrowserContexts}=await vite.ssrLoadModule('/src/browser-context.js');
  let scope='one',api;
  function Harness(){api=useContextDraft(scope);return React.createElement(ContextChips,{items:api.items,onRemove:api.remove,onToggleBrowser:api.toggleBrowser});}
  const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));
  const render=()=>act(async()=>root.render(React.createElement(Harness)));
  const tick=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,2100)));
  await render();await act(async()=>api.add([page('A'),{kind:'file',label:'file',path:'C:/file'}]));
  assert.equal(reads,1);assert.match(document.body.textContent,/跟随/);
  pages=[page('B'),page('Other changed','window-two')];await tick();assert.equal(api.items[0].label,'B');assert.equal(api.items[0].content,'正文 B');
  assert.equal(contextKey(page('A')),contextKey(page('B')));assert.equal(mergeContexts([page('A')],[page('B')]).length,1);
  await act(async()=>document.querySelector('[aria-label="暂停网页自动更新"]').click());const count=reads;
  pages=[page('C')];await tick();assert.equal(reads,count);assert.equal(api.items[0].label,'B');
  await act(async()=>document.querySelector('[aria-label="恢复网页自动更新"]').click());assert.equal(api.items[0].label,'C');
  await act(async()=>api.consume());assert.equal(api.items.length,1,'live browser remains attached for later messages');
  pages=[];await tick();assert.equal(api.items[0].browserUnavailable,true);assert.equal(api.items[0].content,'');assert.match(document.body.textContent,/网页不可用/);
  pages=[page('D')];await tick();assert.equal(api.items[0].browserUnavailable,false);assert.equal(api.items[0].label,'D');
  fail=true;await tick();assert.equal(api.items[0].browserUnavailable,true);fail=false;
  defer=true;await tick();assert.ok(finish);scope='two';await render();await act(async()=>finish([page('Old')]));assert.equal(api.items.length,0,'late browser scans cannot leak into another chat');
  const idleReads=reads;await tick();assert.equal(reads,idleReads);
  const frozen={...page('A'),autoUpdate:false},manual={kind:'browser',label:'manual',url:'https://manual',content:'selected'};
  assert.deepEqual(updateBrowserContexts([frozen,manual],[page('B')]),[frozen,manual]);
  assert.match(contextMessage('',[{...page('A'),truncated:true}]),/网页正文：[\s\S]*已截断/);
  assert.equal(readBrowserLimit(),32000);saveBrowserLimit(64000);assert.equal(readBrowserLimit(),64000);
  assert.match(browserReadStatus({...page('A'),content:'中😀文',truncated:true}),/3 字符 · 已截断/);
  defer=false;await act(async()=>api.add([page('Configured')]));assert.equal(api.items[0].label,'D');
  assert.equal(dom.window.localStorage.getItem('codex-float-browser-limit'),'64000');
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();globals.forEach((k,i)=>{if(previous[i]===undefined)delete globalThis[k];else globalThis[k]=previous[i];});}
});
