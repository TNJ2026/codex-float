import { useCallback, useEffect, useRef, useState, startTransition } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from './i18n.js';
import { applyChange } from './model';

export function useSessionConnection({ resetOptimistic }) {
  const [modelNames, setModelNames] = useState({});
  const [threads, setThreads] = useState([]),
    [selected, setSelected] = useState(''),
    [status, setStatusState] = useState('offline'),
    [error, setError] = useState(''),
    [conversation, setConversation] = useState(null);
  const [connectionPending, setConnectionPending] = useState(false);
  const [needsOpen, setNeedsOpen] = useState(false);
  const statusRef = useRef('offline');
  const setStatus = useCallback((next) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const live = useRef({ state: null, revision: null }),
    selectedRef = useRef(''),
    boundRef = useRef(''),
    connecting = useRef(false),
    schedule = useRef(null),
    resyncing = useRef(false);

  async function refresh() {
    try {
      const r = await invoke('list_threads');
      setThreads(r.threads);
      setModelNames(r.modelNames || {});
      return r;
    } catch (e) {
      setError(String(e));
    }
  }
  async function syncCurrentThread() {
    await refresh();
    await connect(selectedRef.current);
  }
  async function connect(id = selectedRef.current) {
    if (!id || connecting.current) return;
    if (id !== boundRef.current) resetOptimistic([]);
    connecting.current = true;
    setConnectionPending(true);
    boundRef.current = id;
    setStatus('connecting');
    setNeedsOpen(false);
    setError('');
    live.current = { state: null, revision: null };
    setConversation(null);
    try {
      await invoke('connect_thread', { threadId: id });
      setStatus('live');
      setError('');
      localStorage.setItem('codex-float-thread', id);
      return true;
    } catch (e) {
      setStatus('offline');
      const unloaded = String(e).replace(/^Error:\s*/, '') === 'chat-not-loaded';
      setNeedsOpen(unloaded);
      setError(unloaded ? '' : String(e));
      return false;
    } finally {
      connecting.current = false;
      setConnectionPending(false);
    }
  }
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) {
      setError(t('请使用 Tauri 启动此面板以连接桌面端'));
      return;
    }
    let disposed = false,
      off = [];
    (async () => {
      off.push(
        await listen('codex-stream', ({ payload }) => {
          if (payload.conversationId !== boundRef.current) return;
          try {
            live.current = applyChange(live.current.state, live.current.revision, payload.change);
            if (!connecting.current) {
              setStatus('live');
              setNeedsOpen(false);
            }
            if (!schedule.current)
              schedule.current = setTimeout(() => {
                startTransition(() => setConversation(live.current.state));
                schedule.current = null;
              }, 90);
          } catch (e) {
            setError(String(e.message));
            if (!resyncing.current) {
              resyncing.current = true;
              setTimeout(async () => {
                await connect(boundRef.current);
                resyncing.current = false;
              }, 500);
            }
          }
        }),
      );
      off.push(
        await listen('codex-disconnected', ({ payload }) => {
          setStatus('offline');
          setNeedsOpen(false);
          setError(payload);
        }),
      );
      if (disposed) {
        off.forEach((f) => f());
        return;
      }
      const r = await refresh();
      if (disposed || !r) return;
      const saved = localStorage.getItem('codex-float-thread');
      let id = r.currentThread || saved || r.threads[0]?.id || '';
      // Standalone builds do not inherit CODEX_THREAD_ID from a parent Codex chat.
      // Prefer a chat with a live owner over an arbitrary recent history entry.
      if (!r.currentThread && r.threads.length) {
        try {
          const running = await invoke('find_running_thread', {
            threadIds: [
              ...new Set([saved, ...r.threads.map((thread) => thread.id)].filter(Boolean)),
            ],
          });
          if (disposed || selectedRef.current) return;
          if (running) id = running;
        } catch (error) {
          if (disposed || selectedRef.current) return;
          selectedRef.current = id;
          setSelected(id);
          setError(String(error));
          return;
        }
      }
      selectedRef.current = id;
      setSelected(id);
      await connect(id);
    })();
    return () => {
      disposed = true;
      off.forEach((f) => f());
      clearTimeout(schedule.current);
    };
  }, []);

  return {
    modelNames,
    threads,
    setThreads,
    selected,
    setSelected,
    status,
    statusRef,
    error,
    setError,
    conversation,
    setConversation,
    connectionPending,
    needsOpen,
    live,
    selectedRef,
    boundRef,
    connecting,
    connect,
    syncCurrentThread,
  };
}
