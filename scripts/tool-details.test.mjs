import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {messagesOf,applyChange,latestToolDetailOf,activityOf} from '../src/model.js';
import {transcriptMessages} from '../src/transcript.js';
import {displayCommand,toolDetailMessage,toolSections,toolValueText} from '../src/tool-details.js';
import {completedToolLabel} from '../src/completed-work.js';

test('command displays omit the PowerShell launcher while preserving the script and original call',()=>{
 const script='Get-Content "D:/project notes/readme.md"\nWrite-Output "done"';
 const wrapped=String.raw`"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -Command '`+script+"'";
 const item={id:'wrapped',type:'commandExecution',command:wrapped,status:'inProgress'};
 const turn={status:'inProgress',items:[item]};
 const detail=toolDetailMessage(item,turn,0,'turn');
 assert.equal(toolSections(item)[0].text,script);
 assert.equal(detail.toolTitle,script.replace('\n',' '));
 assert.equal(activityOf({turns:[turn]}).toolTitle,detail.toolTitle);
 assert.equal(completedToolLabel([detail]),`已运行 ${detail.toolTitle}`);
 assert.equal(detail.toolCall.command,wrapped);
 assert.equal(displayCommand('echo "-Command literal"'),'echo "-Command literal"');
 assert.equal(displayCommand('pwsh -NonInteractive -Command Get-Date'),'Get-Date');
});

test('tool history survives completion and reflects canonical streaming updates',()=>{
 const tool={id:'cmd',type:'commandExecution',command:'rg --files',cwd:'D:/repo',status:'inProgress',aggregatedOutput:'one'};
 const state={turns:[{turnId:'t',status:'inProgress',items:{entitiesByKey:{answer:{id:'a',type:'agentMessage',text:'检查结果'},cmd:tool},islands:[{entries:[{value:'cmd'},{value:'answer'}]}]}}]};
 let messages=messagesOf(state);assert.deepEqual(messages.map(m=>m.id),['a','tool-history:t']);assert.equal(latestToolDetailOf(state).toolStatus,'inProgress');assert.equal(latestToolDetailOf(state).toolCall,tool);
 const next=applyChange(state,1,{type:'patch',baseRevision:1,revision:2,patches:[{op:'replace',path:'/turns/0/items/entitiesByKey/cmd/aggregatedOutput',value:'one\ntwo'},{op:'replace',path:'/turns/0/items/entitiesByKey/cmd/status',value:'completed'}]}).state;
 messages=messagesOf(next);assert.deepEqual(messages.map(m=>m.id),['a','tool-history:t']);assert.equal(latestToolDetailOf(next).toolStatus,'completed');assert.equal(toolSections(latestToolDetailOf(next).toolCall).find(s=>s.label==='输出').text,'one\ntwo');assert.equal(tool.aggregatedOutput,'one');
 assert.equal(activityOf(next).toolTitle,'rg --files');
 next.turns[0].status='completed';assert.equal(latestToolDetailOf(next),null);assert.equal(activityOf(next),null);
 const older={id:'old',type:'commandExecution',command:'old',status:'inProgress'},latest={id:'new',type:'mcpToolCall',tool:'new',status:'completed'};
 const ordered={turns:[{status:'inProgress',items:{entitiesByKey:{latest,older},islands:[{entries:[{value:'older'},{value:'latest'}]}]}}]};
 assert.equal(latestToolDetailOf(ordered).id,'new');assert.equal(activityOf(ordered).toolTitle,'new');
 ordered.turns[0].items=[older,{id:'child',type:'subAgentActivity',kind:'started'}];assert.equal(latestToolDetailOf(ordered),null,'never show an older command under a newer unsupported tool title');
});

test('tool status honors failures and completion markers without inventing success after a turn ends',()=>{
 const call={id:'x',type:'dynamicToolCall',tool:'search',arguments:{title:'读取\n文件'},status:'inProgress'};
 const detail=(item=call,turn={status:'inProgress'})=>toolDetailMessage(item,turn,0,'t');
 assert.equal(detail().toolTitle,'读取 文件');
 assert.equal(detail(call,{status:'completed'}).toolStatus,'ended');
 assert.equal(detail(call,{status:'interrupted'}).toolStatus,'interrupted');
 assert.equal(detail(call,{status:'inProgress',completedItemIds:{x:true}}).toolStatus,'completed');
 for(const extra of [{success:false},{error:{message:'bad'}},{exitCode:1},{result:{isError:true}}])assert.equal(detail({...call,...extra},{status:'completed',completedItemIds:['x']}).toolStatus,'failed');
 const list=messagesOf({turns:[{id:'t',status:'completed',items:[{...call,status:'completed'},{...call,id:'bad',success:false}]}]});
 assert.deepEqual(transcriptMessages(list),[]);assert.equal(list[0].calls.length,2,'terminal history is hidden without deleting synchronized calls');
});

test('tool sections support MCP, dynamic, web, patch and safe media descriptions',()=>{
 assert.match(toolSections({type:'mcpToolCall',server:'server',tool:'read',arguments:'{"path":"a"}',result:{content:[{type:'text',text:'<script>bad()</script>'}]}})[2].text,/<script>/);
 assert.equal(toolSections({type:'dynamicToolCall',namespace:'fn',tool:'read',arguments:'partial {',contentItems:[{type:'inputText',text:'result'}]})[1].text,'partial {');
 assert.equal(toolSections({type:'commandExecution',command:'echo',aggregatedOutput:'',exitCode:0}).at(-1).text,'（空）');
 assert.ok(toolSections({type:'webSearch',query:'q',action:{type:'search'},results:[{title:'hit'}]}).some(s=>s.label==='结果'));
 assert.match(toolSections({type:'fileChange',changes:[{path:'a',diff:'@@\n+x'}]})[0].text,/diff/);
 const encoded='SECRET'.repeat(500);const safe=toolValueText({content:[{type:'image',mimeType:'image/png',data:encoded},{type:'audio',data:encoded}],uri:'data:image/png;base64,'+encoded});
 assert.ok(!safe.includes('SECRET'));assert.match(safe,/媒体数据/);
});

test('activity click toggles live details while hovering, leaving and focusing never open or dismiss them',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>globalThis[k]);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});let root;
 try{
  const {createRoot}=await import('react-dom/client'),{ToolActivity}=await vite.ssrLoadModule('/src/ToolDetails.jsx');root=createRoot(document.getElementById('root'));
  let item={id:'c',type:'commandExecution',command:'echo hello',cwd:'D:/repo',status:'inProgress',aggregatedOutput:'<script>unsafe()</script>'};
  const render=async(status='inProgress')=>act(async()=>root.render(React.createElement(ToolActivity,{detail:{id:item.id,toolCall:item,toolStatus:status},title:'执行命令'})));
  const hover=element=>act(async()=>element.dispatchEvent(new dom.window.MouseEvent('mouseover',{bubbles:true,relatedTarget:null})));
  const leave=(element,relatedTarget=null)=>act(async()=>element.dispatchEvent(new dom.window.MouseEvent('mouseout',{bubbles:true,relatedTarget})));
  const delay=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,180)));
  await render();assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.querySelector('pre'),null);
  await hover(document.querySelector('.tool-activity-trigger'));assert.equal(document.querySelector('[role="dialog"]'),null);
  await act(async()=>document.querySelector('.tool-activity-trigger').focus());assert.equal(document.querySelector('[role="dialog"]'),null);
  await act(async()=>document.querySelector('.tool-activity-trigger').click());assert.match(document.querySelector('.tool-details > header').textContent,/运行中/);
  assert.equal(document.querySelectorAll('script').length,0);assert.ok(document.body.textContent.includes('<script>unsafe()</script>'));
  const popup=document.querySelector('[role="dialog"]');await leave(document.querySelector('.tool-activity-trigger'),popup);await hover(popup);await delay();assert.ok(document.querySelector('[role="dialog"]'));
  item={...item,status:'completed',aggregatedOutput:'a'.repeat(17000)+'THE END',exitCode:0,durationMs:1200};await render('completed');
  assert.match(document.querySelector('.tool-detail-meta').textContent,/1.20 秒.*退出码 0/);assert.equal(document.querySelector('.spin'),null);
  const output=document.querySelectorAll('.tool-detail-section')[2];assert.ok(document.body.textContent.includes('THE END'),'full output is rendered without pagination');assert.ok(output.open);await act(async()=>{output.open=false;});assert.equal(output.open,false);await act(async()=>{output.open=true;});assert.ok(output.querySelector('pre').textContent.endsWith('THE END'));
  item={...item,error:{message:'failed'}};await render('failed');assert.match(document.querySelector('.tool-details > header').textContent,/失败/);assert.ok(document.body.textContent.includes('failed'));
  await leave(document.querySelector('[role="dialog"]'));await delay();assert.ok(document.querySelector('[role="dialog"]'));
  await act(async()=>document.querySelector('.tool-activity-trigger').click());assert.equal(document.querySelector('[role="dialog"]'),null);
  await act(async()=>document.querySelector('.tool-activity-trigger').click());assert.ok(document.querySelector('[role="dialog"]'));
  await act(async()=>document.querySelector('[aria-label="关闭预览"]').click());assert.equal(document.querySelector('[role="dialog"]'),null);
  await act(async()=>document.querySelector('.tool-activity-trigger').click());
  await act(async()=>document.querySelector('[role="dialog"]').dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));assert.equal(document.querySelector('[role="dialog"]'),null);
  await act(async()=>document.querySelector('.tool-activity-trigger').click());item={...item,id:'new',command:'next command'};await render();assert.ok(document.querySelector('[role="dialog"]'));assert.ok(document.body.textContent.includes('next command'));
 }finally{if(root)await act(async()=>root.unmount());await vite.close();dom.window.close();keys.forEach((k,i)=>{if(previous[i]===undefined)delete globalThis[k];else globalThis[k]=previous[i];});}
});
