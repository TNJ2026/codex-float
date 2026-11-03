// Read-only integration check. No prompt is submitted and no chat is created.
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {applyChange,messagesOf,activityOf,turnsOf} from '../src/model.js';
import {asyncQuestionRequests} from '../src/async-questions.js';
import {ipcEndpoint} from './lib/platform.mjs';
const thread=process.argv[2]||process.env.CODEX_THREAD_ID;
if(!thread)throw Error('Usage: node scripts/live-smoke.mjs <thread UUID>');
const socket=net.connect(ipcEndpoint());
let client='initializing-client',owner,buffer=Buffer.alloc(0),live={state:null,revision:null},snapshots=0,patches=0,failures=0;
const pending=new Map();
function send(m){if(socket.destroyed||socket.writableEnded)return;const data=Buffer.from(JSON.stringify(m)),h=Buffer.alloc(4);h.writeUInt32LE(data.length);socket.write(Buffer.concat([h,data]));}
function rpc(method,params,version=0,targetClientId){return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Timeout: '+method));},6000);pending.set(requestId,m=>{clearTimeout(timer);m.resultType==='success'?resolve(m):reject(Error(m.error));});send({type:'request',requestId,sourceClientId:client,method,params,version,targetClientId});});}
function follow(following){if(owner)send({type:'broadcast',sourceClientId:client,method:'thread-stream-following-changed',version:1,params:{hostId:'local',conversationId:thread,following},targetClientIds:[owner]});}
socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);while(buffer.length>=4){const size=buffer.readUInt32LE();assert.ok(size>0&&size<64*1024*1024);if(buffer.length<4+size)return;const msg=JSON.parse(buffer.subarray(4,4+size));buffer=buffer.subarray(4+size);
 if(msg.type==='response'&&pending.has(msg.requestId)){pending.get(msg.requestId)(msg);pending.delete(msg.requestId);}
 else if(msg.type==='client-discovery-request')send({type:'client-discovery-response',requestId:msg.requestId,response:{canHandle:false}});
 else if(msg.params?.conversationId===thread&&msg.method==='thread-stream-state-changed'){
  try{live=applyChange(live.state,live.revision,msg.params.change);assert.equal(live.state.id,thread);activityOf(live.state);if(msg.params.change.type==='snapshot')snapshots++;else patches++;}
  catch(e){failures++;console.error('Patch validation failed:',e.message);console.error(JSON.stringify(msg.params.change.patches?.slice(0,1)));}
 }
}});
socket.on('connect',async()=>{try{
 client=(await rpc('initialize',{clientType:'codex-float-test'})).result.clientId;
 owner=(await rpc('thread-owner-discovery',{hostId:'local',conversationId:thread},1)).handledByClientId;
 follow(true);await rpc('thread-follower-load-complete-history',{conversationId:thread},1,owner);
 const settings=await rpc('thread-follower-read-model-settings',{conversationId:thread},1,owner);
 console.log(JSON.stringify({connected:true,snapshots,messageCount:messagesOf(live.state).length,model:settings.result.settings?.model,activity:activityOf(live.state)}));
 setTimeout(()=>{
  if(process.env.INSPECT_INTERACTIONS==='1'){
   const turns=turnsOf(live.state);
   console.log(JSON.stringify({pendingAsyncQuestions:asyncQuestionRequests(live.state).map(r=>({id:r.id,questions:r.params.questions.map(q=>({id:q.id}))})),turnCount:turns.length,lastTurns:turns.slice(-3).map(t=>({id:t.turnId||t.id,status:t.status,items:(Array.isArray(t.items)?t.items:Object.values(t.items?.entitiesByKey||{})).slice(-8).map(i=>({id:i.id,type:i.type,questionCount:i.questions?.length||0}))})),requests:(live.state?.requests||[]).map(r=>({id:r.id,method:r.method}))}));
  }
  follow(false);assert.ok(snapshots>0);assert.ok(messagesOf(live.state).length>0);console.log(JSON.stringify({snapshots,patches,failures,lastRevision:live.revision}));process.exitCode=failures?1:0;socket.end();
 },Number(process.env.SMOKE_DURATION_MS||15000));
}catch(e){console.error(e.message);process.exitCode=1;socket.destroy();}});
socket.on('error',e=>{console.error(e.message);process.exitCode=1;});
setTimeout(()=>socket.destroy(),30000).unref();
