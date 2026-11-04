import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {messagesOf} from '../src/model.js';
import {transcriptMessages} from '../src/transcript.js';
import {createAppBridge,mcpAppMessage} from '../src/mcp-apps.js';

const thread='01a1a396-76ee-7073-a74c-01f7dc0f4bcf';
const call={id:'call',type:'mcpToolCall',status:'completed',server:'example',tool:'show_map',mcpAppUi:{resourceUri:'ui://map',preferredModelDisplayMode:'inline'},arguments:'{"title":"Map"}',result:{content:[{type:'text',text:'map'}],structuredContent:{points:[1,2]},_meta:{privateData:'for widget'}},appContext:{connectorId:'app',linkId:'account',appName:'Map App'}};

test('MCP cards retain scoped results in the transcript alongside persistent tool history',()=>{
 const state={id:thread,cwd:'D:/repo',turns:[{id:'t',status:'completed',items:[{id:'cmd',type:'commandExecution',status:'completed',command:'echo'},call,{id:'a',type:'agentMessage',text:'Result'}]}]};
 const messages=messagesOf(state);assert.deepEqual(messages.map(m=>m.id),['mcp-app:call','a','tool-history:t']);assert.equal(transcriptMessages(messages)[0].type,'mcpApp');
 const card=messages[0].appCard;assert.equal(card.resource.threadId,thread);assert.deepEqual(card.resource.target,{connectorId:'app',linkId:'account'});assert.equal(card.input.title,'Map');assert.equal(card.result,call.result);
 assert.equal(messagesOf({...state})[0].appCard,card,'unrelated stream updates must preserve card inputs and interactive state');
 for(const status of ['failed','inProgress'])assert.equal(mcpAppMessage({...call,status},state.turns[0],state),null);
 const legacy=mcpAppMessage({...call,mcpAppUi:null,mcpAppResourceUri:'ui://legacy',appContext:{connectorId:'app',linkId:null}},state.turns[0],state);assert.equal(legacy.appCard.resource.resourceUri,'ui://legacy');assert.equal(legacy.appCard.resource.target.linkId,null);
 assert.equal(mcpAppMessage({...call,mcpAppUi:null,appContext:null},state.turns[0],state),null);
});

test('MCP bridge isolates peers, preserves metadata, validates actions and does not advertise tool execution',async()=>{
 const peer={},sent=[],messages=[],links=[],modes=[],sizes=[],resources=[];let enabled=true,initialized=0;
 const bridge=createAppBridge({frame:()=>peer,send:m=>sent.push(m),getData:()=>({enabled,input:{x:1},result:call.result}),getContext:()=>({theme:'dark',displayMode:'inline'}),onInitialized:()=>initialized++,onSize:h=>sizes.push(h),onDisplayMode:m=>modes.push(m),onMessage:text=>messages.push(text),onOpenLink:url=>links.push(url),onReadResource:uri=>{resources.push(uri);return {contents:[{uri,text:'chunk'}]};}});
 const request=(method,params={},id=1,source=peer,origin='null')=>bridge.handle({source,origin,data:{jsonrpc:'2.0',method,params,id}});
 await request('ui/initialize',{},1,{});await request('ui/initialize',{},1,peer,'http://untrusted');assert.equal(sent.length,0);
 await request('ui/initialize');assert.equal(sent[0].result.hostCapabilities.serverTools,undefined);assert.equal(sent[0].result.hostContext.theme,'dark');
 await bridge.handle({source:peer,origin:'null',data:{jsonrpc:'2.0',method:'ui/notifications/initialized'}});assert.equal(initialized,1);assert.equal(sent.at(-1).params._meta.privateData,'for widget');
 await request('ui/message',{role:'user',content:[{type:'text',text:'Continue'}]});assert.deepEqual(messages,['Continue']);
 await request('ui/message',{role:'assistant',content:[{type:'text',text:'bad'}]});assert.equal(sent.at(-1).error.code,-32602);
 await request('ui/open-link',{url:'javascript:alert(1)'});assert.equal(links.length,0);await request('ui/open-link',{url:'https://example.com'});assert.deepEqual(links,['https://example.com/']);
 await request('tools/call',{name:'delete'});assert.equal(sent.at(-1).error.code,-32601);assert.match(sent.at(-1).error.message,/连接尚不可用/);
 await request('resources/read',{uri:'app://map/chunks/0',server:'untrusted override'});assert.deepEqual(resources,['app://map/chunks/0']);assert.equal(sent.at(-1).result.contents[0].text,'chunk');
 await request('ui/request-display-mode',{mode:'fullscreen'});assert.deepEqual(modes,['fullscreen']);
 await bridge.handle({source:peer,origin:'null',data:{jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:999999}}});assert.deepEqual(sizes,[480]);
 enabled=false;await request('ui/message',{role:'user',content:[{type:'text',text:'stale'}]});assert.equal(messages.length,1);assert.equal(sent.at(-1).error.code,-32000);
});

test('MCP card loads lazily, keeps its iframe through expansion and releases resources on disconnect',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:1420'}),keys=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls=[],followups=[],callbacks=new Map(),events=new Map();let enabled=true,resolve;const deferred=new Promise(done=>resolve=done);
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={transformCallback(callback){const id=callbacks.size+1;callbacks.set(id,callback);return id;},invoke:async(cmd,args)=>{calls.push({cmd,args});if(cmd==='load_mcp_app')return deferred;if(cmd==='plugin:event|listen'){events.set(args.event,callbacks.get(args.handler));return events.size;}if(cmd==='mcp_app_tool')return args.action==='list'?{tools:[{name:'refresh'}]}:{content:[{type:'text',text:'refreshed'}],structuredContent:{count:2},_meta:{receipt:'ok'}};}};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let root;
 try{
  const {createRoot}=await import('react-dom/client'),{McpAppCard,McpAppsContext}=await vite.ssrLoadModule('/src/McpAppCard.jsx');root=createRoot(document.getElementById('root'));
  const card=mcpAppMessage(call,{params:{cwd:'D:/repo'}},{id:thread}).appCard;
  const render=()=>act(async()=>root.render(React.createElement(McpAppsContext.Provider,{value:{enabled,threadId:thread,onFollowUp:(id,text)=>followups.push({id,text})}},React.createElement(McpAppCard,{card}))));
  await render();assert.match(document.body.textContent,/正在加载卡片/);assert.equal(calls[0].args.resource.resourceUri,'ui://map');
  await act(async()=>resolve({token:'abc',url:'http://127.0.0.1:1234/mcp-app/abc/index.html'}));
  const iframe=document.querySelector('iframe');assert.equal(iframe.getAttribute('sandbox'),'allow-scripts');assert.equal(iframe.getAttribute('srcdoc'),null);
  const replies=[];iframe.contentWindow.postMessage=message=>replies.push(message);
  const send=(method,params={},request=true)=>act(async()=>window.dispatchEvent(new dom.window.MessageEvent('message',{source:iframe.contentWindow,origin:'null',data:{jsonrpc:'2.0',method,params,...request?{id:1}:{}}})));
  await send('ui/notifications/initialized',{},false);assert.equal(document.querySelector('.mcp-app-status'),null);assert.equal(replies.find(reply=>reply.method==='ui/notifications/tool-result').params.structuredContent.points.length,2);
  await send('ui/request-display-mode',{mode:'fullscreen'});assert.ok(document.querySelector('.expanded'));assert.equal(document.querySelector('iframe'),iframe);
  await act(async()=>document.querySelector('[aria-label="收起卡片"]').click());assert.equal(document.querySelector('iframe'),iframe);
  await act(async()=>{document.documentElement.dataset.theme='dark';});assert.ok(replies.some(reply=>reply.method==='ui/notifications/host-context-changed'&&reply.params.theme==='dark'));
  await send('ui/message',{role:'user',content:[{type:'text',text:'Continue'}]});assert.deepEqual(followups,[{id:thread,text:'Continue'}]);
  await send('ui/initialize');assert.ok(replies.at(-1).result.hostCapabilities.serverTools);
  await send('tools/list');assert.equal(replies.at(-1).result.tools[0].name,'refresh');
  await send('tools/call',{name:'refresh',arguments:{page:2},server:'do-not-use'});assert.equal(replies.at(-1).result.structuredContent.count,2);assert.equal(replies.at(-1).result._meta.receipt,'ok');const invoked=calls.find(call=>call.cmd==='mcp_app_tool'&&call.args.action==='call');assert.deepEqual(invoked.args,{token:'abc',action:'call',name:'refresh',arguments:{page:2}});
  const interaction={id:'approval-one',method:'mcpServer/elicitation/request',params:{mode:'form',message:'确认操作',requestedSchema:{type:'object',properties:{confirm:{type:'boolean',title:'确认'}},required:['confirm']}}};
  await act(async()=>events.get('mcp-app-interaction')({payload:{token:'wrong',threadId:thread,request:interaction}}));assert.equal(document.querySelector('.interaction-card'),null);
  await act(async()=>events.get('mcp-app-interaction')({payload:{token:'abc',threadId:thread,request:interaction}}));assert.match(document.querySelector('.interaction-card').textContent,/确认操作/);
  await act(async()=>{const field=document.querySelector('[aria-label="确认"]');Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(field,'true');field.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await act(async()=>document.querySelector('.interaction-card form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.ok(calls.some(call=>call.cmd==='reply_mcp_app_request'&&call.args.token==='abc'&&call.args.requestId==='approval-one'&&call.args.payload.response.content.confirm===true));
  enabled=false;await render();assert.equal(document.querySelector('iframe'),null);assert.ok(calls.some(call=>call.cmd==='release_mcp_app'&&call.args.token==='abc'));
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
});
