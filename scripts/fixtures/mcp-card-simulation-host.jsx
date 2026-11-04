import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {McpAppCard,McpAppsContext} from '../../src/McpAppCard';
import '../../src/fluent.css';

// The production card component and bridge run unchanged. Only native commands are mocked.
const thread='00000000-0000-4000-8000-000000000001';
const callbacks=new Map(),events=new Map(),scopes=new Map(),pending=new Map();
let callbackSeq=0,eventSeq=0,requestSeq=0,currentThread=thread;
const calls=[];
const emit=payload=>{for(const entry of events.values())if(entry.event==='mcp-app-interaction')callbacks.get(entry.handler)?.({payload});};
const result=(token,status='success',extra={})=>({content:[{type:'text',text:`${token}: ${status}`}],structuredContent:{card:token==='aa'?'A':'B',token,status,...extra},_meta:{receipt:`receipt-${token}`},isError:status==='declined'});
function defer(token,kind){return new Promise((resolve,reject)=>{const id=`request-${++requestSeq}`;pending.set(id,{token,kind,resolve,reject});if(kind==='confirm'||kind==='authorize')emit({token,threadId:thread,request:{id,method:'mcpServer/elicitation/request',params:kind==='confirm'?{mode:'form',message:`确认模拟卡片 ${token==='aa'?'A':'B'} 的操作`,requestedSchema:{type:'object',properties:{confirm:{type:'boolean',title:'确认执行'}},required:['confirm']}}:{mode:'url',message:'模拟网页授权，不访问真实服务',url:'https://example.com/simulated-authorization'}}});});}
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(_event,id){events.delete(id);}};
window.__TAURI_INTERNALS__={
 transformCallback(callback){const id=++callbackSeq;callbacks.set(id,callback);return id;},
 async invoke(cmd,args){
  calls.push({cmd,args});
  if(cmd==='plugin:event|listen'){const id=++eventSeq;events.set(id,{event:args.event,handler:args.handler});return id;}
  if(cmd==='plugin:event|unlisten'){events.delete(args.eventId);return;}
  if(cmd==='load_mcp_app'){const token=args.resource.server==='mock-a'?'aa':'bb';scopes.set(token,{...args.resource,closed:false});return {token,url:`${location.origin}/mcp-app/${token}/index.html`};}
  if(cmd==='release_mcp_app'){const scope=scopes.get(args.token);if(scope)scope.closed=true;for(const [id,entry] of pending)if(entry.token===args.token){entry.reject(Error('卡片已关闭'));pending.delete(id);}return;}
  if(cmd==='mcp_app_tool'){
   const scope=scopes.get(args.token);if(!scope||scope.closed||scope.threadId!==currentThread)throw Error('模拟连接已失效');
   if(args.action==='list')return {tools:[{name:'get_status',inputSchema:{type:'object'}},{name:'confirm',inputSchema:{type:'object'}}]};
   if(args.name==='get_status')return result(args.token,'success',{value:42,arguments:args.arguments});
   if(args.name==='fail')throw Error(`模拟卡片 ${args.token} 执行失败`);
   if(['slow','confirm','authorize'].includes(args.name))return defer(args.token,args.name);
   throw Error('模拟服务没有这个工具');
  }
  if(cmd==='reply_mcp_app_request'){
   const entry=pending.get(args.requestId);if(!entry||entry.token!==args.token||scopes.get(args.token)?.closed)throw Error('模拟请求不属于此卡片');
   const response=args.payload.response;
   pending.delete(args.requestId);emit({token:args.token,threadId:thread,resolvedId:args.requestId});
   entry.resolve(result(args.token,response.action==='accept'?'approved':'declined',{approval:response}));return;
  }
  if(cmd==='open_url')return; // Record only. The simulation never opens an external website.
  throw Error(`Unexpected simulation command: ${cmd}`);
 }
};
window.sim={calls,emit,pending:()=>[...pending].map(([id,entry])=>({id,token:entry.token,kind:entry.kind})),finish(token){for(const [id,entry] of pending)if(entry.token===token&&entry.kind==='slow'){pending.delete(id);entry.resolve(result(token));return true;}return false;}};
function Demo(){
 const [selected,setSelected]=useState(thread);
 window.sim.switchChat=()=>{currentThread='00000000-0000-4000-8000-000000000002';setSelected(currentThread);};
 return <main style={{padding:20,maxWidth:1000,margin:'auto'}}><h2>模拟 MCP 卡片验证</h2><p>生产卡片组件 · 模拟工具响应 · 不连接真实 MCP 服务</p><McpAppsContext.Provider value={{enabled:true,threadId:selected,onFollowUp:async()=>{}}}><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>{['A','B'].map(label=><section key={label} data-sim-card={label}><McpAppCard card={{title:`模拟卡片 ${label}`,resource:{threadId:thread,callId:'same-call-id',server:label==='A'?'mock-a':'mock-b',resourceUri:'ui://simulation'},input:{label},result:{content:[],structuredContent:{label}}}}/></section>)}</div></McpAppsContext.Provider></main>;
}
createRoot(document.getElementById('root')).render(<Demo/>);
