import { t } from './i18n.js';
export const subagentItem = (item) =>
  ['collabAgentToolCall', 'subAgentActivity'].includes(item?.type);
export const subagentStatusLabels = {
  pendingInit: '等待启动',
  running: '运行中',
  completed: '已完成',
  interrupted: '已中断',
  shutdown: '已关闭',
  errored: '失败',
  notFound: '未找到',
  unknown: '状态未知',
};
export const subagentWorking = (status) => ['pendingInit', 'running'].includes(status);
export const subagentFinished = (status) =>
  ['completed', 'interrupted', 'shutdown', 'errored', 'notFound'].includes(status);
const string = (value) => (typeof value === 'string' ? value : '');
const pathName = (path) =>
  string(path)
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== 'root')
    .at(-1)
    ?.replace(/[_-]+/gu, ' ') || '';
const actions = {
  spawnAgent: '创建子代理',
  sendInput: '发送指令',
  resumeAgent: '恢复子代理',
  wait: '等待子代理',
  closeAgent: '关闭子代理',
};

export function subagentMessage(turn, items, turnKey, history = new Map()) {
  const anchorIndex = items.findIndex(subagentItem);
  if (anchorIndex < 0) return null;
  const agents = new Map(),
    errors = [];
  const get = (id) => {
    if (!string(id).trim()) return null;
    if (!agents.has(id))
      agents.set(id, {
        threadId: id,
        name: '',
        task: '',
        model: '',
        role: '',
        status: 'unknown',
        result: '',
        actionError: '',
        ...history.get(id),
      });
    return agents.get(id);
  };
  for (const item of items) {
    if (item.type === 'subAgentActivity') {
      const agent = get(item.agentThreadId);
      if (!agent) continue;
      const name = pathName(item.agentPath);
      if (name) agent.name = name;
      if (['started', 'interacted'].includes(item.kind)) {
        agent.status = 'running';
        agent.result = '';
        agent.actionError = '';
      } else if (['completed', 'interrupted'].includes(item.kind)) agent.status = item.kind;
      continue;
    }
    if (item.type !== 'collabAgentToolCall') continue;
    const receivers = Array.isArray(item.receiverThreads) ? item.receiverThreads : [];
    const states =
      item.agentsStates && typeof item.agentsStates === 'object' ? item.agentsStates : {};
    const ids = [
      ...new Set([
        ...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []),
        ...receivers.map((receiver) => receiver?.threadId),
        ...Object.keys(states),
      ]),
    ].filter((id) => typeof id === 'string' && id && id !== item.senderThreadId);
    if (item.status === 'failed' && !ids.length)
      errors.push({
        id: item.id || `error:${errors.length}`,
        text: t('{0}失败', [actions[item.tool] || '子代理操作']),
      });
    for (const id of ids) {
      const agent = get(id),
        thread = receivers.find((receiver) => receiver?.threadId === id)?.thread;
      const name = string(thread?.agentNickname) || pathName(thread?.agentPath);
      if (name) agent.name = name;
      if (string(thread?.agentRole)) agent.role = thread.agentRole;
      if (item.status === 'failed')
        agent.actionError = t('{0}失败', [actions[item.tool] || '子代理操作']);
      else if (['spawnAgent', 'sendInput', 'resumeAgent'].includes(item.tool)) {
        agent.status = 'running';
        agent.result = '';
        agent.actionError = '';
        if (string(item.prompt).trim()) agent.task = item.prompt;
        if (string(item.model)) agent.model = item.model;
      } else if (item.tool === 'closeAgent' && item.status === 'completed') {
        agent.status = 'shutdown';
        agent.actionError = '';
      }
      const state = states[id];
      if (state && typeof state === 'object') {
        agent.status = Object.hasOwn(subagentStatusLabels, state.status) ? state.status : 'unknown';
        agent.result = string(state.message);
      }
    }
  }
  const entries = [...agents.values()].map((agent, index) => ({
    ...agent,
    name: agent.name || t('子代理 {0}', [index + 1]),
  }));
  for (const agent of entries) history.set(agent.threadId, { ...agent });
  if (!entries.length && !errors.length) return null;
  return {
    id: `subagents:${turnKey}`,
    type: 'subagentProgress',
    role: 'assistant',
    text: '',
    images: [],
    agents: entries,
    errors,
    turnStatus: turn.status,
    anchorIndex,
  };
}
