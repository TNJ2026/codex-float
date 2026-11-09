import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
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

test('resolved approvals disappear and folded anchors never push requests below newer messages',async()=>{
 const dom=new JSDOM('<div id="root"></div>');
 const keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>globalThis[key]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
 let root;
 try{
  const {createRoot}=await import('react-dom/client');
  const {InteractionMessages}=await vite.ssrLoadModule('/src/InteractionMessages.jsx');
  root=createRoot(document.getElementById('root'));
  const request={id:'approval',method:'item/commandExecution/requestApproval',params:{command:'echo old command'}};
  const form={id:'form',method:'mcpServer/elicitation/request',params:{mode:'form',message:'old form',requestedSchema:{type:'object',properties:{answer:{type:'string'}}}}};
  const tool={id:'tool',turnId:'old',text:'正在执行工具'};
  const latest={id:'latest',turnId:'new',text:'最新消息'};
  let requests=[request,form],messages=[tool],disabled=false,replies=0;
  const MessageComponent=({text})=>React.createElement('p',{'data-message':true},text);
  const render=()=>act(async()=>root.render(React.createElement(InteractionMessages,{requests,messages,disabled,MessageComponent,threadId:'thread',onReply:async()=>{replies++;}})));
  await render();
  assert.equal(document.querySelectorAll('.interaction-card').length,2);
  await act(async()=>document.querySelector('details').open=true);
  messages=[{id:'work',turnId:'old',text:'工作过程',workMessages:[tool]},latest];
  await render();
  const history=document.getElementById('root');
  assert.equal(history.lastElementChild.textContent,'最新消息','a folded tool anchor retains the original position of active requests');
  requests=[];await render();
  assert.equal(document.querySelector('.interaction-card'),null,'owner-resolved requests must disappear without local submission');
  assert.equal(history.lastElementChild.textContent,'最新消息');
  disabled=true;await render();
  assert.equal(document.querySelector('.interaction-card'),null,'disconnecting must not resurrect completed forms');
  assert.equal(replies,0,'reconciliation must never submit or approve a request');
 }finally{
  if(root)await act(async()=>root.unmount());
  await vite.close();dom.window.close();
  keys.forEach((key,index)=>{if(previous[index]===undefined)delete globalThis[key];else globalThis[key]=previous[index];});
 }
});
