import { t, useLanguage } from './i18n.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { predictionTarget } from './predictions';

export function useComposerPrediction({
  threadId,
  conversation,
  enabled,
  available,
  draft,
  hasAttachments,
}) {
  const [prediction, setPrediction] = useState(null),
    [failure, setFailure] = useState('');
  const session = useRef(null),
    seen = useRef(new Set()),
    latest = useRef(null);
  const target = useMemo(
      () => predictionTarget(conversation),
      [conversation?.turnHistory?.history, conversation?.turns],
    ),
    turnId = target?.turnId;
  const scope = threadId + ':' + (conversation?.latestModel || '');
  const eligible = enabled && available && !draft && !hasAttachments;
  latest.current = { scope, turnId, eligible };
  useEffect(() => {
    setPrediction(null);
    setFailure('');
    if (session.current !== scope) {
      session.current = scope;
      seen.current = new Set();
      if (turnId) seen.current.add(turnId);
    }
    if (!eligible || !turnId || seen.current.has(turnId) || !window.__TAURI_INTERNALS__) return;
    seen.current.add(turnId);
    if (seen.current.size > 64) seen.current.delete(seen.current.values().next().value);
    const requestId = crypto.randomUUID();
    let cancelled = false;
    const timer = setTimeout(() => {
      invoke('predict_message', { threadId, turnId, requestId, context: target.context })
        .then((result) => {
          if (
            cancelled ||
            latest.current.scope !== scope ||
            latest.current.turnId !== turnId ||
            !latest.current.eligible
          )
            return;
          const text = typeof result?.text === 'string' ? result.text.trim() : '';
          if (text) setPrediction({ scope, turnId, text });
        })
        .catch((error) => {
          if (!cancelled) setFailure(String(error));
        });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      invoke('cancel_prediction', { requestId }).catch(() => {});
    };
  }, [scope, turnId, eligible]);
  const text =
    eligible && prediction?.scope === scope && prediction?.turnId === turnId ? prediction.text : '';
  return {
    text,
    failure,
    dismiss: () => {
      setPrediction(null);
      setFailure('');
    },
  };
}

export function ComposerPrediction({ text }) {
  useLanguage();
  return text ? (
    <div id="composer-prediction" className="composer-prediction" aria-live="polite">
      <span>{text}</span>
      <small>{t('Tab 接受 · Esc 忽略')}</small>
    </div>
  ) : null;
}
