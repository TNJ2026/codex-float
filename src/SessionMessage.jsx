import React, { memo, useMemo } from 'react';
import { t, useLanguage } from './i18n.js';
import { Markdown } from './Markdown';
import { ChangedFiles } from './ChangedFiles';
import { TaskDetails } from './TaskDetails';
import { SubagentProgress } from './SubagentProgress';
import { MessageActions } from './MessageActions';
import { completedWorkEntries } from './completed-work';
import { WorkDetails } from './WorkDetails';
import { ToolTimelineRow, ToolProcessGroup } from './ToolDetails';
import { McpAppCard } from './McpAppCard';
import { parseQuestionReply } from './async-questions';
import { QuestionAnswer } from './QuestionAnswer';

export const SessionMessage = memo(function Message({
  id,
  type,
  role,
  phase,
  text = '',
  images,
  files,
  cwd,
  pending,
  failed,
  active,
  steps,
  explanation,
  turnStatus,
  turnDurationMs,
  agents,
  errors,
  turnId,
  copyable,
  calls,
  toolCall,
  toolStatus,
  toolTitle,
  editable,
  onEdit,
  editDisabled,
  workMessages,
  appCard,
  attachments,
  references,
  forkable,
  onFork,
  forkDisabled,
}) {
  useLanguage();
  const answers = useMemo(() => (role === 'user' ? parseQuestionReply(text) : []), [text, role]);
  return (
    <article
      className={'message ' + role + (phase === 'commentary' ? ' commentary' : '')}
      data-message-id={id}
    >
      {type === 'toolGroup' ? (
        <ToolProcessGroup calls={calls} />
      ) : type === 'toolDetails' ? (
        <ToolTimelineRow call={{ id, toolCall, toolStatus, toolTitle }} />
      ) : type === 'mcpApp' ? (
        <McpAppCard card={appCard} threadId={appCard.resource.threadId} />
      ) : type === 'workSummary' ? (
        <WorkDetails items={workMessages} durationMs={turnDurationMs}>
          {completedWorkEntries(workMessages).map((message) => (
            <SessionMessage
              key={message.id}
              {...message}
              onEdit={onEdit}
              editDisabled={editDisabled}
              onFork={onFork}
              forkDisabled={forkDisabled}
            />
          ))}
        </WorkDetails>
      ) : type === 'subagentProgress' ? (
        <SubagentProgress agents={agents} errors={errors} turnStatus={turnStatus} />
      ) : ['reasoningSummary', 'taskPlan', 'proposedPlan'].includes(type) ? (
        <TaskDetails
          type={type}
          text={text}
          active={active}
          steps={steps}
          explanation={explanation}
          turnStatus={turnStatus}
        />
      ) : type === 'changedFiles' ? (
        <ChangedFiles files={files} cwd={cwd} />
      ) : answers.length ? (
        <QuestionAnswer answers={answers} />
      ) : (
        <Markdown
          text={text}
          images={images}
          attachments={attachments}
          references={references}
          cwd={cwd}
          streaming={role === 'assistant' && turnStatus === 'inProgress'}
        />
      )}
      {pending && <small>{t('正在发送…')}</small>}
      {failed && <small>{t('发送未确认，请检查错误提示后重试。')}</small>}
      {!type && (
        <MessageActions
          text={copyable ? text : ''}
          persistentCopy={!!copyable}
          editable={editable}
          editDisabled={editDisabled || pending || failed}
          onEdit={() => onEdit?.({ id, turnId, text })}
          forkable={forkable}
          forkDisabled={forkDisabled || pending || failed}
          onFork={() => onFork?.({ id, turnId, text })}
        />
      )}
    </article>
  );
});
