// Executed only inside the sandboxed card document, before its application scripts.
(() => {
  if (window.openai) return;
  let seq = 0;
  const pending = new Map(),
    globals = {
      toolInput: {},
      toolOutput: null,
      toolResponseMetadata: {},
      theme: 'light',
      displayMode: 'inline',
      widgetState: null,
    };
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `float-compat-${++seq}`;
      const timer = setTimeout(
        () => {
          pending.delete(id);
          reject(
            Error(
              method === 'tools/call'
                ? '卡片操作等待超时，请检查执行状态，避免重复提交'
                : '卡片请求超时',
            ),
          );
        },
        method === 'tools/call' ? 240000 : 30000,
      );
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  const update = (values) => {
    Object.assign(globals, values);
    if (values.theme) {
      document.documentElement.dataset.theme = values.theme;
      document.documentElement.style.colorScheme = values.theme;
    }
    for (const [key, value] of Object.entries(values.styles?.variables || {}))
      if (/^--[a-z\d-]+$/iu.test(key) && typeof value === 'string')
        document.documentElement.style.setProperty(key, value);
    window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: values } }));
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message?.jsonrpc !== '2.0') return;
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error ? entry.reject(Error(message.error.message)) : entry.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/tool-input')
      update({ toolInput: message.params?.arguments || {} });
    if (message.method === 'ui/notifications/tool-result')
      update({
        toolOutput: message.params?.structuredContent ?? message.params?.content ?? null,
        toolResponseMetadata: message.params?._meta || {},
      });
    if (message.method === 'ui/notifications/host-context-changed') update(message.params || {});
  });
  window.openai = {
    ...Object.fromEntries(Object.keys(globals).map((key) => [key, undefined])),
    callTool: (name, args = {}) => request('tools/call', { name, arguments: args }),
    sendFollowUpMessage: ({ prompt }) =>
      request('ui/message', { role: 'user', content: [{ type: 'text', text: prompt }] }),
    openExternal: ({ href }) => request('ui/open-link', { url: href }),
    requestDisplayMode: ({ mode }) => request('ui/request-display-mode', { mode }),
    setWidgetState: (state) => {
      update({ widgetState: state });
    },
    notifyIntrinsicHeight: (height) =>
      window.parent.postMessage(
        { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height } },
        '*',
      ),
  };
  for (const key of Object.keys(globals))
    Object.defineProperty(window.openai, key, { enumerable: true, get: () => globals[key] });
  request('ui/initialize', {
    appInfo: { name: 'codex-float-compat', version: '0.1.0' },
    appCapabilities: {},
    protocolVersion: '2026-01-26',
  })
    .then((result) => {
      update(result.hostContext || {});
      window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
    })
    .catch(() => {});
})();
