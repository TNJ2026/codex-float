// App-server fixture: no external connections, model requests, files or tool side effects.
import {createInterface} from 'node:readline';
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
let pending;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 const result=value=>send({id:m.id,result:value});
 if(m.method==='initialize')return result({});
 if(m.method==='thread/start'){
  if(m.params.ephemeral!==true||m.params.permissions!==':read-only'||m.params.approvalsReviewer!=='user')return send({id:m.id,error:{code:-32602,message:'Expected an ephemeral read-only tool host with user approvals'}});
  return result({thread:{id:'ephemeral-test'},received:m.params});
 }
 if(m.method==='mcpServerStatus/list')return result({data:[{name:'example',tools:{read:{name:'read',inputSchema:{type:'object'},_meta:{ui:{visibility:['app']}}},hidden:{name:'hidden',_meta:{ui:{visibility:['model']}}}}}],nextCursor:null});
 if(m.method==='mcpServer/tool/call'){
  if(m.params.arguments.hang)return;
  pending=m;return send({id:'elicitation-1',method:'mcpServer/elicitation/request',params:{mode:'form',message:'Confirm',requestedSchema:{type:'object',properties:{confirm:{type:'boolean'}}}}});
 }
 if(m.id==='elicitation-1')return send({id:pending.id,result:{content:[{type:'text',text:'complete'}],structuredContent:{approval:m.result,call:pending.params},_meta:{receipt:'test'}}});
 send({id:m.id,error:{code:-32601,message:'Unexpected fixture method'}});
});
