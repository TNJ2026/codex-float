import test from 'node:test';import assert from 'node:assert/strict';
import {createAppBridge} from '../src/mcp-apps.js';

function setup(call){
 const peer={},sent=[],calls=[];let enabled=true;
 const bridge=createAppBridge({frame:()=>peer,send:message=>sent.push(message),getData:()=>({enabled,input:{},result:{content:[]}}),getContext:()=>({}),onCallTool:async(name,args)=>{calls.push({name,args});return call(name,args);},onListTools:async()=>({tools:[{name:'refresh'}]})});
 return {sent,calls,disable:()=>{enabled=false;},request:(method,params,id=1)=>bridge.handle({source:peer,origin:'null',data:{jsonrpc:'2.0',method,params,id}})};
}
test('card calls preserve complete results, suppress duplicate pending IDs and allow IDs to be reused after completion',async()=>{
 let done;const result={content:[{type:'text',text:'done'}],structuredContent:{value:2},_meta:{private:'for widget'},isError:false};
 let count=0;const host=setup(()=>++count===1?new Promise(resolve=>done=resolve):Promise.resolve(result));
 await host.request('ui/initialize',{});assert.ok(host.sent.at(-1).result.hostCapabilities.serverTools);
 await host.request('tools/list',{});assert.equal(host.sent.at(-1).result.tools[0].name,'refresh');
 const running=host.request('tools/call',{name:'refresh',arguments:{page:2},server:'wrong',threadId:'wrong'},'call');
 await host.request('tools/call',{name:'refresh',arguments:{page:2}},'call');assert.equal(host.calls.length,1);
 done(result);await running;assert.deepEqual(host.sent.at(-1).result,result);assert.deepEqual(host.calls[0],{name:'refresh',args:{page:2}});
 await host.request('tools/call',{name:'refresh',arguments:{page:3}},'call');assert.equal(host.calls.length,2);assert.deepEqual(host.sent.at(-1).result,result);
});
test('tool errors, bad parameters and disconnected cards never trigger automatic retries',async()=>{
 const host=setup(async()=>{throw Error('execution result unknown');});
 for(const params of [{name:''},{name:'x',arguments:[]},{name:'x',arguments:null}]){await host.request('tools/call',params);assert.equal(host.sent.at(-1).error.code,-32602);}assert.equal(host.calls.length,0);
 await host.request('tools/call',{name:'run'},'failed');assert.match(host.sent.at(-1).error.message,/result unknown/);
 host.disable();await host.request('tools/call',{name:'run'},'next');assert.equal(host.calls.length,1);assert.equal(host.sent.at(-1).error.code,-32000);
});
test('concurrent card requests keep results isolated and suppress stale results after switching chats',async()=>{
 const finish=new Map(),host=setup(name=>new Promise(resolve=>finish.set(name,resolve)));
 const a=host.request('tools/call',{name:'a'},'a'),b=host.request('tools/call',{name:'b'},'b');
 finish.get('b')({content:[{type:'text',text:'B'}]});await b;assert.equal(host.sent.at(-1).id,'b');
 host.disable();finish.get('a')({content:[{type:'text',text:'A'}]});await a;assert.equal(host.sent.at(-1).id,'a');assert.equal(host.sent.at(-1).result,undefined);assert.match(host.sent.at(-1).error.message,/聊天已切换/);
});
