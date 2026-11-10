import { t } from './i18n.js';
export const MAX_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export function mergeAttachments(current, added, limit = MAX_ATTACHMENTS) {
  const result = [...current],
    seen = new Set(current.map((file) => file.path.replaceAll('\\', '/')));
  for (const file of added) {
    const key = file.path.replaceAll('\\', '/');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  if (result.length > limit) throw Error(t('一次最多添加 20 个附件'));
  return result;
}
export function fileData(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) return Promise.reject(Error(t('单个附件不能超过 25 MB')));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(Error(t('无法读取附件：{0}', [file.name])));
    reader.readAsDataURL(file);
  });
}
export function attachmentMessage(text, attachments) {
  return (
    text.trim() +
    attachments
      .filter((file) => !file.image)
      .map((file) => {
        const label = file.name
          .replaceAll('\\', '\\\\')
          .replaceAll('[', '\\[')
          .replaceAll(']', '\\]');
        const path = file.path
          .replaceAll('\\', '/')
          .replaceAll('%', '%25')
          .replaceAll('<', '%3C')
          .replaceAll('>', '%3E')
          .replaceAll('\n', '%0A')
          .replaceAll('\r', '%0D');
        return `\n\n[附件：${label}](<${path}>)`;
      })
      .join('')
  );
}
