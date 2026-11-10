import { t } from './i18n.js';
export function readBrowserLimit() {
  try {
    const value = Number(window.localStorage.getItem('codex-float-browser-limit'));
    return Number.isInteger(value) && value >= 1000 && value <= 100000 ? value : 32000;
  } catch {
    return 32000;
  }
}
export function saveBrowserLimit(value) {
  const limit = Math.max(1000, Math.min(100000, Math.round(Number(value) || 32000)));
  try {
    window.localStorage.setItem('codex-float-browser-limit', String(limit));
  } catch {}
  window.dispatchEvent(new window.Event('browser-context-limit-changed'));
  return limit;
}
export function browserReadStatus(item) {
  const count = Array.from(item.content || '').length.toLocaleString('zh-CN');
  return t('{0} 字符 · {1}', [
    count,
    item.browserUnavailable
      ? '不可用'
      : item.contentType !== 'body'
        ? '正文未读取'
        : item.truncated
          ? '已截断'
          : '未截断',
  ]);
}
