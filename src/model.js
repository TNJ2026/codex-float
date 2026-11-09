import {t} from './i18n.js';
import jsonpatch from 'fast-json-patch';
import {imagesOf,generatedImagesOf} from './images.js';
import {changedFilesOf} from './changed-files.js';
import {orderedItems,taskDetailMessage} from './task-details.js';
import {subagentItem,subagentMessage} from './subagents.js';
import {toolDetailMessage,toolTitleText} from './tool-details.js';
import {mcpAppMessage} from './mcp-apps.js';
import {attachmentsOf,referencesOf} from './rich-content.js';
import {turnDurationMs} from './work-timing.js';
// Match the desktop app's model label formatter, retaining the GPT prefix.
export function modelDisplayName(model, names = {}) {
  const name = names[model] || model || '';
  if (!name.trimStart().toLowerCase().startsWith('gpt')) return name;
  const separator = /^gpt-\d/iu.test(name.trimStart()) ? ' ' : '-';
  return name.split(/(\s+)/).map(part => part.trim().length === 0 ? part : part.split('-').map((word, index) =>
    word.toLowerCase() === 'gpt' ? 'GPT' : word.toLowerCase() === 'oai' ? 'OAI' : index > 0 && word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word
  ).join(separator).replace(/^GPT (?=\d)/u, 'GPT-')).join('');
}
export function applyChange(previous, revision, change) {
  if (change.type === 'snapshot') return { state: change.conversationState, revision: change.revision };
  if (!previous || change.baseRevision !== revision) throw new Error(t("消息版本已变化，正在重新同步"));
  const patches = (change.patches || []).map(p => ({...p, path: Array.isArray(p.path) ? (p.path.length ? '/' + p.path.map(x=>String(x).replaceAll('~','~0').replaceAll('/','~1')).join('/') : '') : p.path}));
  return { state: patches.reduce(applySharedPatch, previous), revision: change.revision };
}
function applySharedPatch(previous, patch) {
  // Keep untouched history and tool outputs shared rather than cloning the whole conversation.
  if (!['add','remove','replace'].includes(patch.op) || patch.path === '') {
    return jsonpatch.applyOperation(previous, patch, true, false).newDocument;
  }
  const keys = patch.path.split('/').slice(1).map(k => k.replaceAll('~1','/').replaceAll('~0','~'));
  if (keys.some(k => ['__proto__','constructor','prototype'].includes(k))) throw new Error(t("不安全的消息更新路径"));
  const copy = value => Array.isArray(value) ? value.slice() : {...value};
  const next = copy(previous);
  let source = previous, target = next;
  for (const key of keys.slice(0,-1)) {
    if (!source || typeof source !== 'object' || !Object.hasOwn(source,key) || !source[key] || typeof source[key] !== 'object') {
      throw new Error(t("消息更新路径不存在，正在重新同步"));
    }
    target[key] = copy(source[key]);
    source = source[key]; target = target[key];
  }
  return jsonpatch.applyOperation(next, patch, true, true).newDocument;
}
export function turnsOf(state) {
  if (!state) return [];
  const history = state.turnHistory?.history;
  if (history?.entitiesByKey) {
    const keys = history.islands?.flatMap(i=>i.entries.map(e=>e.value)) || Object.keys(history.entitiesByKey);
    return [...new Set(keys)].map(k=>history.entitiesByKey[k]).filter(Boolean);
  }
  return state.turns || [];
}
export function messagesOf(state,{toolTimeline=false}={}) {
  const agentHistory=new Map();
  return turnsOf(state).flatMap((entry,turnIndex) => {
    const items = orderedItems(entry),turnKey=entry.turnId||entry.id||turnIndex;
    const subagents=subagentMessage(entry,items,turnKey,agentHistory);
    const messages=items.flatMap((i,index)=>{
     const detail=toolTimeline?toolDetailMessage(i,entry,index,turnKey):null;
     const rendered=(()=>{
     if(subagentItem(i))return subagents&&index===subagents.anchorIndex?[subagents]:[];
     const app=mcpAppMessage(i,entry,state);if(app)return [app];
     if(['reasoning','todo-list','plan'].includes(i.type)){const message=taskDetailMessage(i,entry,items,index,turnKey);return message?[message]:[];}
     if(!['userMessage','agentMessage','steeringUserMessage','imageGeneration'].includes(i.type))return [];
     const message=i.type==='imageGeneration'?{
      id:i.id,role:'assistant',text:'',images:generatedImagesOf(i)
    }:({
      id:i.id, clientMessageId:i.clientUserMessageId||i.clientId, role:i.type==='agentMessage'?'assistant':'user', phase:i.phase,
      delivery:i.delivery,aeonSentMessage:i.aeonSentMessage,hasStructuredOutput:i.structuredOutput!=null,
      deliveryStatus:i.deliveryStatus,steeringStatus:i.steeringStatus,hookFeedback:i.hookFeedback,heartbeatTrigger:i.heartbeatTrigger,codexDelegation:i.codexDelegation,
      turnId:entry.turnId||entry.id,editable:i.type==='userMessage'&&!!(entry.turnId||entry.id)&&items.find(item=>item.type==='userMessage')===i,
      forkable:entry.status==='completed'&&!!(entry.turnId||entry.id)&&(i.type==='userMessage'&&items.find(item=>item.type==='userMessage')===i||i.type==='agentMessage'&&items.filter(item=>item.type==='agentMessage').at(-1)===i),
      text:i.type==='agentMessage'?i.text:(i.content||i.input||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'),
      images:imagesOf(i.content||i.input),
      attachments:attachmentsOf(i),references:i.type==='agentMessage'?referencesOf(i,items):undefined,cwd:entry.params?.cwd||state.cwd||state.latestThreadSettings?.cwd,
      pending:i.status==='pending'
    });return (message.text?.trim()||message.images.length||message.attachments?.length)&&!message.text?.trim().startsWith('<external_codex_apps_open_page>')?[message]:[];
     })();
     return detail?[{...detail,id:`tool-call:${turnKey}:${detail.id}`},...rendered]:rendered;
    });
    const files=changedFilesOf(entry);
    const calls=items.map((item,index)=>toolDetailMessage(item,entry,index,turnKey)).filter(Boolean);
    if(calls.length&&!toolTimeline)messages.push({id:`tool-history:${turnKey}`,type:'toolHistory',role:'assistant',text:'',images:[],calls});
    if(files.length)messages.push({id:`changed-files:${entry.turnId||entry.id||items[0]?.id}`,type:'changedFiles',role:'assistant',text:'',files,cwd:entry.params?.cwd||state.cwd});
    const duration=turnDurationMs(entry);
    return messages.map(message=>({...message,turnId:message.turnId||entry.turnId||entry.id||`turn:${turnIndex}`,turnStatus:entry.status,...(duration!==null?{turnDurationMs:duration}:{})}));
  });
}

const toolLabels = {
  commandExecution: '正在执行命令', fileChange: '正在修改文件',
  mcpToolCall: '正在调用工具', dynamicToolCall: '正在调用工具',
  webSearch: '正在搜索网页', imageGeneration: '正在生成图片',
  collabAgentToolCall: '正在调用子代理', subAgentActivity: '子代理正在工作'
};
export function activeTurnsOf(state){
  // Old restored history can retain inProgress after newer turns have finished.
  // Only the latest turn describes the current task; unloaded history is not live.
  if(state?.resumeState==='needs_resume')return [];
  const latest=turnsOf(state).at(-1);
  return latest?.status==='inProgress'?[latest]:[];
}
export function latestToolDetailOf(state){
  const turns=activeTurnsOf(state);
  for(let turnIndex=turns.length-1;turnIndex>=0;turnIndex--){
    const turn=turns[turnIndex],items=orderedItems(turn);
    for(let index=items.length-1;index>=0;index--){
      if(toolLabels[items[index].type])return toolDetailMessage(items[index],turn,index,turn.turnId||turn.id||turnIndex);
    }
  }
  return null;
}
export function activityOf(state) {
  const activeTurns = activeTurnsOf(state);
  const runtimeActive=state?.threadRuntimeStatus?.type==='active'&&
    (state?.resumeState==='needs_resume'||turnsOf(state).length===0);
  if (!activeTurns.length && !runtimeActive) return null;
  if (state?.requests?.length) return { kind: 'waiting', label: t("等待审批 / 回复") };
  const turnItems = activeTurns.flatMap(entry => {
    if (Array.isArray(entry.items)) return entry.items;
    const entities = entry.items?.entitiesByKey || {};
    const keys = entry.items?.islands?.flatMap(island => island.entries.map(entry => entry.value));
    return keys ? [...new Set(keys)].map(key => entities[key]).filter(Boolean) : Object.values(entities);
  });
  const latestTool = turnItems.filter(item => toolLabels[item.type]).at(-1);
  const toolTitle = latestTool ? toolTitleText(latestTool,toolLabels[latestTool.type]) : undefined;
  const activeItems = activeTurns.flatMap(entry => {
    const completed = new Set(Array.isArray(entry.completedItemIds) ? entry.completedItemIds : Object.entries(entry.completedItemIds || {}).filter(([,done]) => done === true).map(([id]) => id));
    const items = Array.isArray(entry.items) ? entry.items : Object.values(entry.items?.entitiesByKey || {});
    return items.filter(i => !completed.has(i.id));
  });
  if (activeItems.some(i => i.type === 'contextCompaction' && i.completed === false)) {
    return { kind: 'compacting', label: t("正在压缩上下文") };
  }
  const running = activeItems.filter(i => toolLabels[i.type] && i.status === 'inProgress');
  if (running.length) {
    const latest = running.at(-1);
    return { kind: 'tool', label: toolLabels[latest.type], toolTitle };
  }
  // A running turn without an active tool does not prove that reasoning is happening.
  return { kind: 'thinking', label: t("思考"), ...(toolTitle ? {toolTitle} : {}) };
}
