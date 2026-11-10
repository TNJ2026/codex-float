import { t, useLanguage } from './i18n.js';
import React, { memo, useMemo, useState } from 'react';
import { diffLines } from './diff';

const PAGE = 500;
function DiffSection({ patch, index, total }) {
  useLanguage();
  const rows = useMemo(() => diffLines(patch.text, patch.kind), [patch]);
  const [visible, setVisible] = useState(PAGE);
  const added = rows.filter((row) => row.type === 'add').length,
    removed = rows.filter((row) => row.type === 'delete').length;
  return (
    <section className="diff-section" aria-label={t('第 {0} 次修改', [index + 1])}>
      <div className="diff-section-heading">
        <span>{total > 1 ? t('第 {0} 次修改', [index + 1]) : t('文本差异')}</span>
        <span>
          <span className="diff-added-count">+{added}</span>{' '}
          <span className="diff-removed-count">−{removed}</span>
        </span>
      </div>
      {!rows.length ? (
        <p>{t('此项没有文本差异。')}</p>
      ) : (
        <div className="diff-lines">
          <div className="diff-code">
            {rows.slice(0, visible).map((row, i) =>
              row.type === 'meta' || row.type === 'hunk' ? (
                <div key={i} className={`diff-meta ${row.type}`}>
                  {row.text}
                </div>
              ) : (
                <div key={i} className={`diff-row ${row.type}`}>
                  <span className="diff-gutter" aria-hidden="true">
                    {row.oldLine ?? ''}
                  </span>
                  <span className="diff-gutter" aria-hidden="true">
                    {row.newLine ?? ''}
                  </span>
                  <span className="diff-prefix" aria-hidden="true">
                    {row.type === 'add' ? '+' : row.type === 'delete' ? '-' : ' '}
                  </span>
                  <span className="diff-content">{row.text}</span>
                </div>
              ),
            )}
          </div>
        </div>
      )}
      {visible < rows.length && (
        <button
          type="button"
          className="diff-load-more"
          onClick={() => setVisible((current) => current + PAGE)}
        >
          {t('继续显示')}
          {Math.min(PAGE, rows.length - visible)}
          {t('行（剩余')}
          {rows.length - visible}
          {t('行）')}
        </button>
      )}
    </section>
  );
}
export const DiffPreview = memo(function DiffPreview({ file, onOpenFile }) {
  useLanguage();
  return (
    <div className="diff-preview">
      <div className="diff-toolbar">
        <span title={file.path}>{file.path}</span>
        {file.kind !== 'delete' && (
          <button type="button" onClick={onOpenFile}>
            {t('查看当前文件')}
          </button>
        )}
      </div>
      {file.diffs.length > 1 && (
        <p className="diff-note">
          {t('该轮任务有')}
          {file.diffs.length}
          {t('次修改，按发生顺序展示。')}
        </p>
      )}
      {file.diffs.map((patch, index) => (
        <DiffSection key={index} patch={patch} index={index} total={file.diffs.length} />
      ))}
    </div>
  );
});
