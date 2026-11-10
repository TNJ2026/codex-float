import { t, useLanguage } from './i18n.js';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { describeInteraction, initialValues, buildInteractionReply } from './interactions';
import { QuestionAnswer } from './QuestionAnswer';

const keyOf = (request) => `${typeof request.id}:${request.id}:${request.method}`;
function Field({ field, value, onChange, disabled }) {
  useLanguage();
  const common = { disabled, required: field.required, 'aria-label': field.label };
  if (field.type === 'array')
    return (
      <div className="interaction-options">
        {field.options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={(value || []).includes(option.value)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...(value || []), option.value]
                    : (value || []).filter((v) => v !== option.value),
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  if (field.type === 'boolean')
    return (
      <select
        {...common}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
      >
        <option value="">{t('请选择')}</option>
        <option value="true">{t('是')}</option>
        <option value="false">{t('否')}</option>
      </select>
    );
  if (field.options)
    return (
      <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('请选择')}</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  return (
    <input
      {...common}
      type={
        field.type === 'number' || field.type === 'integer'
          ? 'number'
          : field.format === 'email'
            ? 'email'
            : field.format === 'uri'
              ? 'url'
              : field.format === 'date'
                ? 'date'
                : field.format === 'date-time'
                  ? 'datetime-local'
                  : 'text'
      }
      min={field.minimum}
      max={field.maximum}
      step={field.type === 'integer' ? 1 : 'any'}
      minLength={field.minLength}
      maxLength={field.maxLength}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
export const InteractionCard = memo(function InteractionCard({
  request,
  active,
  disabled,
  onReply,
}) {
  const language = useLanguage();
  const card = useMemo(() => describeInteraction(request), [request, language]);
  const [values, setValues] = useState(() => initialValues(card)),
    [state, setState] = useState('idle'),
    [summary, setSummary] = useState(''),
    [error, setError] = useState('');
  const [replyAnswers, setReplyAnswers] = useState([]);
  const lock = useRef(false);
  const unavailable = disabled || !active || state !== 'idle';
  const change = (id, value) => setValues((current) => ({ ...current, [id]: value }));
  async function submit(decision) {
    if (unavailable || lock.current) return;
    let result;
    try {
      result = buildInteractionReply(card, values, decision);
    } catch (e) {
      setError(e.message);
      return;
    }
    lock.current = true;
    setState('sending');
    setError('');
    try {
      await onReply(request, result.payload);
      setSummary(result.summary);
      if (card.kind === 'questions')
        setReplyAnswers(
          card.questions.map((q) => ({
            questionItemId: q.id,
            question: q.question,
            answer: q.isSecret
              ? t('[已填写]')
              : result.payload.response.answers[q.id].answers.join('、'),
          })),
        );
      setValues({});
      setState('submitted');
    } catch (e) {
      setError(String(e));
      setState('idle');
    } finally {
      lock.current = false;
    }
  }
  const completed = !active;
  if (card.kind === 'questions' && (completed || state === 'submitted')) {
    // Async replies are already echoed as regular messages by the owner.
    return replyAnswers.length && request.method !== 'local/asyncQuestions' ? (
      <article className="message user">
        <QuestionAnswer answers={replyAnswers} />
      </article>
    ) : null;
  }
  // Resolved approvals and forms belong to tool history, not the end of the chat.
  // Keep the component mounted for an in-flight reply, but remove its stale UI.
  if (completed) return null;
  return (
    <div className="interaction-exchange">
      <article className="interaction-card">
        <strong>{t(card.title)}</strong>
        {card.body && <p>{card.body}</p>}
        {card.details && Object.keys(card.details).length > 0 && (
          <details>
            <summary>{t('查看操作详情')}</summary>
            <pre>
              {Object.entries(card.details)
                .map(
                  ([key, value]) =>
                    `${t(key)}: ${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`,
                )
                .join('\n\n')}
            </pre>
          </details>
        )}
        <>
          {card.kind === 'unsupported' ? (
            <p className="interaction-status">
              {t('请在 Codex 主窗口完成，结果会继续同步到这里。')}
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {card.kind === 'questions' &&
                card.questions.map((q) => (
                  <fieldset key={q.id} disabled={unavailable}>
                    <legend>{q.header || t('问题')}</legend>
                    <p>{q.question}</p>
                    {q.options?.length > 0 && (
                      <div className="interaction-options">
                        {q.options.map((option) => (
                          <label key={option.label}>
                            <input
                              type="radio"
                              name={`${keyOf(request)}-${q.id}`}
                              checked={values[q.id] === option.label}
                              onChange={() => change(q.id, option.label)}
                            />
                            <span>
                              {option.label}
                              {option.description && <small>{option.description}</small>}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    {(!q.options?.length || q.isOther) && (
                      <input
                        type={q.isSecret ? 'password' : 'text'}
                        aria-label={q.question}
                        placeholder={
                          q.options?.length ? t('也可以输入其他回答') : t('输入你的回答')
                        }
                        value={values[q.id] ?? ''}
                        onChange={(e) => change(q.id, e.target.value)}
                        autoComplete="off"
                      />
                    )}
                  </fieldset>
                ))}
              {card.kind === 'form' &&
                card.fields.map((field) => (
                  <fieldset key={field.id} disabled={unavailable}>
                    <legend>
                      {field.label}
                      {field.required ? ' *' : ''}
                    </legend>
                    {field.description && <p>{field.description}</p>}
                    <Field
                      field={field}
                      value={values[field.id]}
                      onChange={(value) => change(field.id, value)}
                      disabled={unavailable}
                    />
                  </fieldset>
                ))}
              <div className="interaction-actions">
                {card.decisions ? (
                  card.decisions.map((decision) => (
                    <button
                      type="button"
                      key={decision.value}
                      disabled={unavailable}
                      onClick={() => submit(decision.value)}
                    >
                      {t(decision.label)}
                    </button>
                  ))
                ) : (
                  <button type="submit" disabled={unavailable}>
                    {t('提交回答')}
                  </button>
                )}
                {card.kind === 'form' && (
                  <button type="button" disabled={unavailable} onClick={() => submit('decline')}>
                    {t('拒绝')}
                  </button>
                )}
              </div>
            </form>
          )}
          {state === 'sending' && (
            <p className="interaction-status" role="status">
              {t('正在提交…')}
            </p>
          )}
          {state === 'submitted' && (
            <p className="interaction-status" role="status">
              {t('已提交，等待会话确认…')}
            </p>
          )}
          {error && (
            <p className="interaction-error" role="alert">
              {t(error)}
            </p>
          )}
        </>
      </article>
      {summary && (
        <article className="message user">
          <div className="markdown interaction-answer">{summary}</div>
        </article>
      )}
    </div>
  );
});

export function InteractionMessages({
  requests,
  messages,
  MessageComponent,
  threadId,
  disabled,
  onReply,
  onEditMessage,
  editDisabled,
  onForkMessage,
  forkDisabled,
}) {
  useLanguage();
  const [history, setHistory] = useState([]);
  useEffect(() => {
    setHistory((current) => {
      const seen = new Set(current.map((entry) => keyOf(entry.request)));
      const added = requests
        .filter((request) => !seen.has(keyOf(request)))
        .map((request) => ({
          request,
          afterMessageId: messages.at(-1)?.id,
          turnId: messages.at(-1)?.turnId,
        }));
      return added.length ? [...current, ...added] : current;
    });
  }, [requests]);
  const active = new Map(requests.map((request) => [keyOf(request), request]));
  const seen = new Set(history.map((entry) => keyOf(entry.request)));
  const entries = [
    ...history,
    ...requests
      .filter((request) => !seen.has(keyOf(request)))
      .map((request) => ({
        request,
        afterMessageId: messages.at(-1)?.id,
        turnId: messages.at(-1)?.turnId,
      })),
  ];
  const renderCard = ({ request }) => {
    const id = keyOf(request);
    return (
      <InteractionCard
        key={`${threadId}:${id}`}
        request={active.get(id) || request}
        active={active.has(id)}
        disabled={disabled}
        onReply={onReply}
      />
    );
  };
  const includesMessage = (message, id) =>
    message.id === id || message.workMessages?.some((item) => includesMessage(item, id));
  const anchor = (entry) =>
    messages.find((message) => includesMessage(message, entry.afterMessageId))?.id ||
    (entry.turnId && messages.findLast((message) => message.turnId === entry.turnId)?.id);
  const located = entries.map((entry) => ({ ...entry, anchor: anchor(entry) }));
  return (
    <>
      {messages.map((message) => (
        <React.Fragment key={message.id}>
          <MessageComponent
            {...message}
            onEdit={onEditMessage}
            editDisabled={editDisabled}
            onFork={onForkMessage}
            forkDisabled={forkDisabled}
          />
          {located.filter((entry) => entry.anchor === message.id).map(renderCard)}
        </React.Fragment>
      ))}
      {located.filter((entry) => !entry.anchor && active.has(keyOf(entry.request))).map(renderCard)}
    </>
  );
}
