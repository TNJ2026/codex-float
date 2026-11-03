import jsonpatch from 'fast-json-patch';
import {imagesOf,generatedImagesOf} from './images.js';
import {changedFilesOf} from './changed-files.js';
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
  if (!previous || change.baseRevision !== revision) throw new Error('消息版本已变化，正在重新同步');
  const patches = (change.patches || []).map(p => ({...p, path: Array.isArray(p.path) ? (p.path.length ? '/' + p.path.map(x=>String(x).replaceAll('~','~0').replaceAll('/','~1')).join('/') : '') : p.path}));
  return { state: patches.reduce(applySharedPatch, previous), revision: change.revision };
}
function applySharedPatch(previous, patch) {
  // Keep untouched history and tool outputs shared rather than cloning the whole conversation.
  if (!['add','remove','replace'].includes(patch.op) || patch.path === '') {
    return jsonpatch.applyOperation(previous, patch, true, false).newDocument;
  }
  const keys = patch.path.split('/').slice(1).map(k => k.replaceAll('~1','/').replaceAll('~0','~'));
  if (keys.some(k => ['__proto__','constructor','prototype'].includes(k))) throw new Error('不安全的消息更新路径');
  const copy = value => Array.isArray(value) ? value.slice() : {...value};
  const next = copy(previous);
  let source = previous, target = next;
  for (const key of keys.slice(0,-1)) {
    if (!source || typeof source !== 'object' || !Object.hasOwn(source,key) || !source[key] || typeof source[key] !== 'object') {
      throw new Error('消息更新路径不存在，正在重新同步');
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
export function messagesOf(state) {
  return turnsOf(state).flatMap(t => {
    const items = Array.isArray(t.items) ? t.items : Object.values(t.items?.entitiesByKey || {});
    const messages=items.filter(i=>['userMessage','agentMessage','steeringUserMessage','imageGeneration'].includes(i.type)).map(i=>i.type==='imageGeneration'?{
      id:i.id,role:'assistant',text:'',images:generatedImagesOf(i)
    }:({
      id:i.id, clientMessageId:i.clientUserMessageId||i.clientId, role:i.type==='agentMessage'?'assistant':'user', phase:i.phase,
      text:i.type==='agentMessage'?i.text:(i.content||i.input||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'),
      images:imagesOf(i.content||i.input),
      pending:i.status==='pending'
    })).filter(m=>(m.text?.trim()||m.images.length) && !m.text?.trim().startsWith('<external_codex_apps_open_page>'));
    const files=changedFilesOf(t);
    if(files.length)messages.push({id:`changed-files:${t.turnId||t.id||items[0]?.id}`,type:'changedFiles',role:'assistant',text:'',files,cwd:t.params?.cwd||state.cwd});
    return messages;
  });
}

const toolLabels = {
  commandExecution: '正在执行命令', fileChange: '正在修改文件',
  mcpToolCall: '正在调用工具', dynamicToolCall: '正在调用工具',
  webSearch: '正在搜索网页', imageGeneration: '正在生成图片',
  collabAgentToolCall: '正在调用子代理', subAgentActivity: '子代理正在工作'
};
export function activityOf(state) {
  const activeTurns = turnsOf(state).filter(t => t.status === 'inProgress');
  if (!activeTurns.length && state?.threadRuntimeStatus?.type !== 'active') return null;
  if (state?.requests?.length) return { kind: 'waiting', label: '等待审批 / 回复' };
  const activeItems = activeTurns.flatMap(t => {
    const completed = new Set(Array.isArray(t.completedItemIds) ? t.completedItemIds : Object.entries(t.completedItemIds || {}).filter(([,done]) => done === true).map(([id]) => id));
    const items = Array.isArray(t.items) ? t.items : Object.values(t.items?.entitiesByKey || {});
    return items.filter(i => !completed.has(i.id));
  });
  if (activeItems.some(i => i.type === 'contextCompaction' && i.completed === false)) {
    return { kind: 'compacting', label: '正在压缩上下文' };
  }
  const running = activeItems.filter(i => toolLabels[i.type] && i.status === 'inProgress');
  if (running.length) {
    const latest = running.at(-1);
    const tool = typeof latest.tool === 'string' ? latest.tool : '';
    return { kind: 'tool', label: toolLabels[latest.type] + (tool ? ` · ${tool}` : '') + (running.length > 1 ? `（${running.length} 项）` : '') };
  }
  // A running turn without an active tool does not prove that reasoning is happening.
  return { kind: 'thinking', label: '思考' };
}
