export const contextLabels = {
  file: '文件',
  folder: '目录',
  snippet: '片段',
  browser: '网页',
  ide: 'IDE',
  skill: '技能',
  plugin: '插件',
  thread: '对话',
};
export const contextKey = (item) =>
  item.kind === 'browser' && item.browserWindowId
    ? ['browser', item.browserWindowId].join('\0')
    : [
        item.kind,
        item.path || item.url || item.label,
        item.content || '',
        item.startLine || '',
      ].join('\0');
export function mergeContexts(current, added, limit = 20) {
  const next = [...current],
    seen = new Set(current.map(contextKey));
  for (const item of added) {
    if (!Object.hasOwn(contextLabels, item.kind)) throw Error('不支持的上下文类型');
    const key = contextKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      next.push(item);
    } else if (item.kind === 'browser' && item.browserWindowId) {
      next[next.findIndex((old) => contextKey(old) === key)] = item;
    }
  }
  if (next.length > limit) throw Error('一次最多添加 20 项上下文');
  return next;
}
export function mentionAt(text, caret = text.length) {
  const match = /(?:^|\s)([@$])([^\n@$]*)$/u.exec(text.slice(0, caret));
  return match
    ? { start: caret - match[2].length - 1, end: caret, query: match[2], trigger: match[1] }
    : null;
}
const label = (text) =>
  text
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replace(/[\r\n]/gu, ' ');
const link = (name, path = '') =>
  `[${label(name)}](<${path.replaceAll('\\', '/').replaceAll('%', '%25').replaceAll('<', '%3C').replaceAll('>', '%3E').replaceAll('\n', '%0A').replaceAll('\r', '%0D')}>)`;
function codeBlock(item) {
  const longest = Math.max(0, ...(item.content.match(/`+/gu) || []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1)),
    language = (item.language || '').replace(/[^a-z\d_+-]/giu, '').slice(0, 32);
  return `\n\n${fence}${language}\n${item.content}\n${fence}`;
}
export function contextMessage(text, items) {
  return [
    text.trim(),
    ...items.map((item) => {
      const reference = link(item.label, item.path);
      switch (item.kind) {
        case 'file':
          return `上下文文件：${reference}`;
        case 'folder':
          return `上下文目录：${reference}`;
        case 'ide':
          return `IDE 文件：${reference}`;
        case 'skill':
          return `使用技能：${reference}`;
        case 'plugin':
          return `使用插件：[${label(item.label)}](${item.path})`;
        case 'thread':
          return `参考对话：[${label(item.label)}](${item.path})`;
        case 'browser':
          return (
            `网页上下文：[${label(item.label)}](<${item.url.replaceAll('<', '%3C').replaceAll('>', '%3E')}>)` +
            (item.content
              ? (item.contentType === 'body' ? '\n\n网页正文：\n' : '\n\n网页选中内容：\n') +
                item.content
                  .replace(/\n$/u, '')
                  .split(/\r?\n/u)
                  .map((line) => `> ${line}`)
                  .join('\n')
              : '') +
            (item.truncated
              ? `\n\n（正文已截断，当前包含 ${Array.from(item.content || '').length} 字符。）`
              : '')
          );
        case 'snippet':
          return (
            `代码片段：${item.label}` +
            (item.path ? `\n来源：${reference}` : '') +
            (item.startLine ? `（从第 ${item.startLine} 行开始）` : '') +
            codeBlock(item)
          );
        default:
          throw Error('不支持的上下文类型');
      }
    }),
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function contextMatches(item, query) {
  const haystack = [item.label, item.path, item.url, item.description, item.source]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/u)
    .every((word) => haystack.includes(word));
}
