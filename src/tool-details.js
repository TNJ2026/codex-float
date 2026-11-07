import {t} from './i18n.js';
const labels={commandExecution:'执行命令',mcpToolCall:'调用工具',dynamicToolCall:'调用工具',webSearch:'搜索网页',fileChange:'修改文件',collabAgentToolCall:'子代理调用',imageGeneration:'生成图片'};
export const toolDetailItem=item=>Object.hasOwn(labels,item.type);
const nonempty=value=>typeof value==='string'&&value.trim();

const powershellCommand=/^\s*(?:&\s+)?(?:"(?:[^"\r\n]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"|'(?:[^'\r\n]*[\\/])?(?:powershell|pwsh)(?:\.exe)?'|(?:[^\s'"\\/]+[\\/])*(?:powershell|pwsh)(?:\.exe)?)(?:\s+-(?:NoLogo|NoProfile|NonInteractive|STA|MTA|NoExit)|\s+-ExecutionPolicy\s+\w+)*\s+-(?:Command|c)\s+([\s\S]+)$/iu;

export function displayCommand(command){
 if(typeof command!=='string')return command;
 const match=powershellCommand.exec(command);
 if(!match)return command;
 const script=match[1].trim();
 const quote=script[0];
 return (quote==='"'||quote==="'")&&script.length>1&&script.endsWith(quote)?script.slice(1,-1):script;
}

export function toolTitleText(item,fallback){
 let args=item.arguments;if(typeof args==='string'){try{args=JSON.parse(args);}catch{args=null;}}
 const title=[item.title,item.toolTitle,args?.title,item.command,item.tool,item.query].map(displayCommand).find(nonempty)||t(fallback);
 return title.replace(/\s+/gu,' ').trim();
}
export function toolDetailMessage(item,turn,index,turnKey){
 if(!toolDetailItem(item))return null;
 const marked=Array.isArray(turn.completedItemIds)?turn.completedItemIds.includes(item.id):turn.completedItemIds?.[item.id]===true;
 const failed=['failed','errored','error'].includes(item.status)||item.success===false||item.result?.isError===true||item.error!=null||Number.isInteger(item.exitCode)&&item.exitCode!==0;
 const status=failed?'failed':['declined','denied'].includes(item.status)?'declined':['cancelled','canceled','interrupted'].includes(item.status)?'interrupted':item.status==='completed'||marked?'completed':turn.status==='inProgress'&&['inProgress','in_progress','running'].includes(item.status)?'inProgress':['interrupted','cancelled'].includes(turn.status)?'interrupted':turn.status==='failed'?'stopped':turn.status==='completed'?'ended':'unknown';
 return {id:item.id||`tool:${turnKey}:${index}`,type:'toolDetails',role:'assistant',text:'',images:[],toolCall:item,toolStatus:status,toolTitle:toolTitleText(item,labels[item.type])};
}
// Tool output is displayed as inert text. Avoid dumping encoded image/audio payloads.
export function toolValueText(value){
 if(typeof value==='string'){
  if(/^data:[^,]*;base64,/iu.test(value))return t("[媒体数据，未展开]");
  try{value=JSON.parse(value);}catch{return value||t("（空）");}
 }
 return JSON.stringify(value,(_key,entry)=>{
  if(typeof entry==='string'&&/^data:[^,]*;base64,/iu.test(entry))return t("[媒体数据，未展开]");
  if(entry&&typeof entry==='object'&&['image','audio','input_image','input_audio'].includes(entry.type)&&typeof entry.data==='string')return {...entry,data:t("[媒体数据，{0} 字符]",[entry.data.length])};
  return entry;
 },2)??t("（空）");
}
export function toolSections(item){
 const rows=[],add=(label,value)=>{if(value!=null)rows.push({label,text:toolValueText(value)});};
 if(item.type==='commandExecution'){add("命令",displayCommand(item.command));add("工作目录",item.cwd);add("输出",item.aggregatedOutput);}
 else if(item.type==='fileChange')add("文件变更",item.changes);
 else if(item.type==='collabAgentToolCall'){add("操作",item.tool);add("参数",item.prompt??item.arguments);add("接收子代理",item.receiverThreadIds??item.receiverThreads);add("结果",item.agentsStates);}
 else if(item.type==='imageGeneration'){add("参数",item.prompt??item.revisedPrompt);add("结果",item.outputFile??item.savedPath??item.path??item.src??item.imageUrl??t("[图片结果请查看消息中的图片]"));}
 else if(item.type==='webSearch'){add("查询",item.query);add("操作",item.action);add("结果",item.results);}
 else{add("工具",[item.server||item.namespace,item.tool].filter(Boolean).join(' / '));add("参数",item.arguments);add("结果",item.result??item.contentItems??item.output);}
 add("错误",item.error);return rows;
}
