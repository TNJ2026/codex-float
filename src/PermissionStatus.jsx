import React from 'react';
import { Shield } from 'lucide-react';
import { t, useLanguage } from './i18n';
import { permissionOptions, permissionDisplay } from './permissions';

export function PermissionStatus({ conversation, connected = true }) {
  useLanguage();
  const { current, execution } = permissionDisplay(conversation);
  const option = permissionOptions.find((item) => item.id === current);
  const label =
    option?.shortLabel || option?.label || (conversation ? t('自定义权限') : t('权限未知'));
  const executionOption = permissionOptions.find((item) => item.id === execution);
  const title = [
    t(label),
    !connected && t('权限状态未同步'),
    execution &&
      execution !== current &&
      t('执行权限记录：{0}', [
        t(executionOption?.shortLabel || executionOption?.label || '自定义权限'),
      ]),
    t('权限仅供查看，请在 Codex 主 App 中修改。'),
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span
      className="permission-status"
      data-permission={current || 'unknown'}
      data-connected={connected}
      role="status"
      aria-label={t('当前权限')}
      title={title}
    >
      <Shield size={12} aria-hidden="true" />
      <span>{t(label)}</span>
    </span>
  );
}
