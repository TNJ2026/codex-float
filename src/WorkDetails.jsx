import { t, useLanguage } from './i18n.js';
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { workDurationLabel } from './work-timing';

export function WorkDetails({ items, children, durationMs }) {
  useLanguage();
  return (
    <details className="work-details">
      <summary aria-label={t('展开或收起工作过程')}>
        <span>{t('上 {0} 条消息', [items.length])}</span>
        <ChevronRight size={14} />
        <small className="work-duration" title={t('本轮任务从开始到结束的总耗时')}>
          {t('用时 {0}', [workDurationLabel(durationMs)])}
        </small>
      </summary>
      <div className="work-details-body">{children}</div>
    </details>
  );
}
