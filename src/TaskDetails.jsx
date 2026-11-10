import { t, useLanguage } from './i18n.js';
import React from 'react';
import { Brain, Check, ChevronRight, Circle, ListTodo, LoaderCircle, FileText } from 'lucide-react';
import { Markdown } from './Markdown';

export function TaskDetails({ type, text, active, steps = [], explanation, turnStatus }) {
  useLanguage();
  if (type === 'taskPlan') {
    const completed = steps.filter((step) => step.status === 'completed').length,
      ended = turnStatus !== 'inProgress',
      interrupted = ['interrupted', 'cancelled'].includes(turnStatus);
    const progress =
      completed === steps.length
        ? t('全部完成')
        : interrupted
          ? t('已中断')
          : turnStatus === 'failed'
            ? t('任务失败')
            : ended
              ? t('任务已结束')
              : t('进行中');
    return (
      <details className="task-details task-plan" open>
        <summary>
          <ListTodo size={14} />
          <strong>{t('计划步骤')}</strong>
          <span>
            {completed}/{steps.length}
          </span>
          <small>{progress}</small>
          <ChevronRight size={13} className="task-details-chevron" />
        </summary>
        <div className="task-details-body">
          {explanation && (
            <div className="task-plan-explanation">
              <Markdown text={explanation} />
            </div>
          )}
          <ol className="task-plan-steps" aria-label={t('计划步骤')}>
            {steps.map((step, index) => {
              const running = step.status === 'inProgress' && !ended,
                Icon = step.status === 'completed' ? Check : running ? LoaderCircle : Circle;
              const label =
                step.status === 'completed'
                  ? t('已完成')
                  : step.status === 'pending'
                    ? t('待处理')
                    : step.status === 'unknown'
                      ? t('状态未知')
                      : interrupted
                        ? t('已中断')
                        : ended
                          ? t('未完成')
                          : t('进行中');
              return (
                <li key={index} data-status={step.status} data-running={running || undefined}>
                  <Icon size={13} className={running ? 'spin' : ''} aria-hidden="true" />
                  <span>{step.text}</span>
                  <small>{label}</small>
                </li>
              );
            })}
          </ol>
        </div>
      </details>
    );
  }
  const reasoning = type === 'reasoningSummary',
    Icon = reasoning ? Brain : FileText;
  return (
    <details
      className={'task-details ' + (reasoning ? 'reasoning-summary' : 'proposed-plan')}
      open={active || undefined}
    >
      <summary>
        <Icon size={14} />
        <strong>{reasoning ? t('思考摘要') : t('计划草稿')}</strong>
        {active && <small>{reasoning ? t('更新中') : t('生成中')}</small>}
        <ChevronRight size={13} className="task-details-chevron" />
      </summary>
      <div className="task-details-body">
        <Markdown text={text} />
      </div>
    </details>
  );
}
