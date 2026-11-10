import { t } from './i18n.js';
import { displayCommand } from './tool-details.js';

export function completedWorkEntries(items) {
  const entries = [];
  for (const item of items) {
    if (item.type !== 'toolDetails') {
      entries.push(item);
      continue;
    }
    const last = entries.at(-1);
    if (last?.type === 'toolGroup') last.calls.push(item);
    else
      entries.push({
        id: `tool-group:${item.id}`,
        type: 'toolGroup',
        role: 'assistant',
        calls: [item],
      });
  }
  return entries;
}
export function completedToolLabel(calls) {
  if (calls.length === 1 && calls[0].toolCall.type === 'commandExecution')
    return t('已运行 {0}', [displayCommand(calls[0].toolCall.command) || calls[0].toolTitle])
      .replace(/\s+/gu, ' ')
      .trim();
  const labels = {
    commandExecution: t('运行了命令'),
    fileChange: t('编辑了文件'),
    webSearch: t('搜索了网页'),
    mcpToolCall: t('调用了工具'),
    dynamicToolCall: t('调用了工具'),
    collabAgentToolCall: t('调用了子代理'),
    imageGeneration: t('生成了图片'),
  };
  const types = [...new Set(calls.map((call) => call.toolCall.type))];
  // Match the completed process wording in the supplied screenshot.
  if (types.includes('fileChange') && types.includes('commandExecution'))
    return [
      t('编辑了文件和运行了命令'),
      ...types
        .filter((type) => !['fileChange', 'commandExecution'].includes(type))
        .map((type) => labels[type] || t('调用了工具')),
    ].join('、');
  return [...new Set(types.map((type) => labels[type] || t('调用了工具')))].join(t('和'));
}
