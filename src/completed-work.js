import {displayCommand} from './tool-details.js';

export function completedWorkEntries(items){
 const entries=[];
 for(const item of items){
  if(item.type!=='toolDetails'){entries.push(item);continue;}
  const last=entries.at(-1);
  if(last?.type==='toolGroup')last.calls.push(item);
  else entries.push({id:`tool-group:${item.id}`,type:'toolGroup',role:'assistant',calls:[item]});
 }
 return entries;
}
export function completedToolLabel(calls){
 if(calls.length===1&&calls[0].toolCall.type==='commandExecution')return `已运行 ${displayCommand(calls[0].toolCall.command)||calls[0].toolTitle}`.replace(/\s+/gu,' ').trim();
 const labels={commandExecution:'运行了命令',fileChange:'编辑了文件',webSearch:'搜索了网页',mcpToolCall:'调用了工具',dynamicToolCall:'调用了工具',collabAgentToolCall:'调用了子代理',imageGeneration:'生成了图片'};
 const types=[...new Set(calls.map(call=>call.toolCall.type))];
 // Match the completed process wording in the supplied screenshot.
 if(types.includes('fileChange')&&types.includes('commandExecution'))return ['编辑了文件和运行了命令',...types.filter(type=>!['fileChange','commandExecution'].includes(type)).map(type=>labels[type]||'调用了工具')].join('、');
 return [...new Set(types.map(type=>labels[type]||'调用了工具'))].join('和');
}
