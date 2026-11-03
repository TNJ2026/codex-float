import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('conversation cards render forms inline without automatically submitting',async()=>{
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {InteractionMessages}=await vite.ssrLoadModule('/src/InteractionMessages.jsx');
  const requests=[
   {id:1,method:'item/commandExecution/requestApproval',params:{command:'echo <script>bad</script>',availableDecisions:['accept','decline']}},
   {id:2,method:'item/tool/requestUserInput',params:{questions:[{id:'choice',header:'方向',question:'选择一个',options:[{label:'A',description:'说明'}]},{id:'secret',question:'口令',isSecret:true}]}},
   {id:3,method:'mcpServer/elicitation/request',params:{mode:'form',requestedSchema:{type:'object',properties:{count:{type:'integer',minimum:1,default:2}}}}},
   {id:4,method:'mcpServer/elicitation/request',params:{mode:'url',message:'请登录'}}
  ];
  const html=renderToStaticMarkup(React.createElement(InteractionMessages,{requests,messages:[{id:'intro',text:'已有消息'}],MessageComponent:({text})=>React.createElement('p',null,text),threadId:'thread',disabled:false,onReply:()=>{throw Error('must never automatically reply')}}));
  assert.match(html,/已有消息/);
  assert.match(html,/允许一次/);
  assert.match(html,/type="radio"/);
  assert.match(html,/type="password"/);
  assert.match(html,/type="number"/);
  assert.match(html,/需要登录或网页授权/);
  assert.ok(!html.includes('<script>'));
  assert.equal((html.match(/<form/g)||[]).length,3);
  assert.ok(html.indexOf('已有消息')<html.indexOf('是否允许执行'));
 }finally{await vite.close();}
});
