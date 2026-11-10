import { t } from './i18n.js';
const cardCache = new WeakMap();
export function mcpAppMessage(item, turn, state) {
  if (item.type !== 'mcpToolCall' || item.status !== 'completed' || !item.server) return null;
  const resourceUri =
    item.mcpAppUi?.resourceUri ||
    item.mcpAppResourceUri ||
    item.appContext?.resourceUri ||
    item.result?._meta?.ui?.resourceUri ||
    item.result?._meta?.['openai/outputTemplate'];
  if (typeof resourceUri !== 'string' || !resourceUri.trim()) return null;
  const app = item.appContext,
    candidate = state.conversationId || state.threadId || state.id,
    threadId =
      typeof candidate === 'string' &&
      /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(candidate)
        ? candidate
        : undefined;
  const cwd = turn.params?.cwd || state.cwd || state.latestThreadSettings?.cwd || null,
    key = JSON.stringify([threadId, cwd]),
    cached = cardCache.get(item);
  if (cached?.key === key) return cached.message;
  let input = item.arguments;
  try {
    if (typeof input === 'string') input = JSON.parse(input);
  } catch {
    input = {};
  }
  const resource = {
    threadId,
    callId: item.id,
    server: item.server,
    resourceUri,
    connectorId: app?.connectorId || null,
    cwd,
  };
  if (app?.connectorId && Object.hasOwn(app, 'linkId'))
    resource.target = { connectorId: app.connectorId, linkId: app.linkId };
  const message = {
    id: `mcp-app:${item.id}`,
    type: 'mcpApp',
    role: 'assistant',
    text: '',
    images: [],
    appCard: {
      title: app?.appName || item.toolTitle || item.tool || 'MCP App',
      resource,
      input: input || {},
      result: item.result || { content: [] },
    },
  };
  cardCache.set(item, { key, message });
  return message;
}

const error = (message, code = -32602) => Object.assign(Error(message), { code });
export function createAppBridge({
  frame,
  send,
  getData,
  getContext,
  onInitialized,
  onSize,
  onDisplayMode,
  onMessage,
  onOpenLink,
  onReadResource,
  onCallTool,
  onListTools,
  onError,
}) {
  const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
  const pushData = () => {
    const data = getData();
    notify('ui/notifications/tool-input', { arguments: data.input });
    notify('ui/notifications/tool-result', data.result);
  };
  let windowStart = 0,
    count = 0,
    resourceCount = 0,
    activeResources = 0,
    activeTools = 0;
  const toolRequests = new Map();
  const handle = async (event) => {
    const source = frame();
    if (!source || event.source !== source || event.origin !== 'null') return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
    const { method, params = {}, id } = message,
      request = id !== undefined;
    if (
      request &&
      !(
        (typeof id === 'string' && id.length <= 128) ||
        (typeof id === 'number' && Number.isFinite(id))
      )
    )
      return;
    const respond = (response) => {
      if (request) send(response);
    };
    const reply = (result) => respond({ jsonrpc: '2.0', id, result });
    try {
      if (JSON.stringify(message).length > 65536) throw error(t('卡片请求过大'));
      if (!getData().enabled) throw error(t('聊天连接已变化，请重新打开卡片'), -32000);
      if (!request) {
        if (method === 'ui/notifications/initialized') {
          onInitialized();
          notify('ui/notifications/host-context-changed', getContext());
          pushData();
        }
        if (
          method === 'ui/notifications/size-changed' &&
          Number.isFinite(params.height) &&
          params.height > 0
        )
          onSize(Math.max(120, Math.min(480, Math.ceil(params.height))));
        return;
      }
      if (Date.now() - windowStart > 10000) {
        windowStart = Date.now();
        count = 0;
        resourceCount = 0;
      }
      if (method === 'resources/read' ? ++resourceCount > 8192 : ++count > 30)
        throw error(t('卡片请求过于频繁，请稍后重试'), -32000);
      if (method === 'ping') {
        reply({});
        return;
      }
      if (method === 'ui/initialize') {
        reply({
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'CodexFloat', version: '0.1.0' },
          hostCapabilities: {
            openLinks: {},
            message: { text: {} },
            ...(onReadResource ? { serverResources: {} } : {}),
            ...(onCallTool ? { serverTools: { listChanged: false } } : {}),
          },
          hostContext: getContext(),
        });
        return;
      }
      if (method === 'ui/request-display-mode') {
        if (!['inline', 'fullscreen'].includes(params.mode)) throw error(t('不支持此显示模式'));
        onDisplayMode(params.mode);
        reply({ mode: params.mode });
        return;
      }
      if (method === 'ui/message') {
        if (
          params.role !== 'user' ||
          !Array.isArray(params.content) ||
          !params.content.length ||
          params.content.length > 20 ||
          params.content.some((part) => part.type !== 'text' || typeof part.text !== 'string')
        )
          throw error(t('仅支持用户文本消息'));
        const text = params.content
          .map((part) => part.text)
          .join('\n\n')
          .trim();
        if (!text || text.length > 20000) throw error(t('卡片消息为空或过长'));
        await onMessage(text);
        reply({});
        return;
      }
      if (method === 'ui/open-link') {
        let url;
        try {
          url = new URL(params.url);
        } catch {
          throw error(t('链接地址无效'));
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw error(t('仅支持 HTTP/HTTPS 网页链接'));
        await onOpenLink(url.href);
        reply({});
        return;
      }
      if (method === 'resources/read' && onReadResource) {
        if (
          typeof params.uri !== 'string' ||
          !params.uri.includes('://') ||
          params.uri.length > 4096
        )
          throw error(t('卡片资源地址无效'));
        if (activeResources >= 8) throw error(t('卡片同时请求的资源过多，请稍后重试'), -32000);
        activeResources++;
        try {
          reply(await onReadResource(params.uri));
        } finally {
          activeResources--;
        }
        return;
      }
      if (method === 'tools/list' && onListTools) {
        if (params.cursor != null) throw error(t('此工具列表不需要分页'));
        const result = await onListTools();
        if (!getData().enabled) throw error(t('聊天连接已变化'), -32000);
        reply(result);
        return;
      }
      if (method === 'tools/call' && onCallTool) {
        if (
          typeof params.name !== 'string' ||
          !params.name.trim() ||
          params.name.length > 512 ||
          /[\u0000-\u001f\u007f]/u.test(params.name) ||
          (params.arguments !== undefined &&
            (!params.arguments ||
              typeof params.arguments !== 'object' ||
              Array.isArray(params.arguments)))
        )
          throw error(t('工具名称或参数无效'));
        const key = `${typeof id}:${id}`,
          signature = JSON.stringify([params.name, params.arguments || {}]),
          previous = toolRequests.get(key);
        if (previous) {
          if (previous.signature !== signature) throw error(t('工具请求 ID 已被其他参数使用'));
          return;
        }
        if (activeTools >= 4) throw error(t('卡片同时调用的工具过多，请等待当前操作完成'), -32000);
        toolRequests.set(key, { signature });
        activeTools++;
        try {
          const result = await onCallTool(params.name, params.arguments || {});
          if (!getData().enabled)
            throw error(t('聊天已切换，请检查操作状态，避免重复提交'), -32000);
          reply(result);
        } finally {
          activeTools--;
          toolRequests.delete(key);
        }
        return;
      }
      if (method === 'tools/call') throw error(t('此卡片的工具连接尚不可用'), -32601);
      throw error(t('悬浮窗暂不支持此卡片操作，请在主 App 操作'), -32601);
    } catch (failure) {
      const message = String(failure.message || failure);
      if (request) {
        respond({ jsonrpc: '2.0', id, error: { code: failure.code || -32000, message } });
        onError?.(message);
      }
    }
  };
  return { handle, pushData, notify };
}
