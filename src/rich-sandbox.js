// Runs only in an opaque-origin iframe. No native commands or chat data are exposed.
(() => {
  const payload = window.__RICH_PAYLOAD__ || {},
    send = (type, data = {}) => parent.postMessage({ type, ...data }, '*');
  let chart = null,
    theme = payload.theme || 'light',
    scale = 1,
    resize;
  const report = () => {
    const body = document.body;
    if (!body) return;
    const style = getComputedStyle(body),
      margin = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    send('rich/size', {
      height: Math.max(
        160,
        Math.min(
          560,
          Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height) + margin),
        ),
      ),
    });
  };
  const fail = (error) =>
    send('rich/error', { message: String(error?.message || error).slice(0, 500) });
  const applyTheme = () => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (payload.kind !== 'html') {
      document.body.style.background = theme === 'dark' ? '#181a20' : '#fff';
      document.body.style.color = theme === 'dark' ? '#eee' : '#222';
    }
  };
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'rich/context') return;
    theme = event.data.theme === 'dark' ? 'dark' : 'light';
    applyTheme();
    if (chart) {
      document.getElementById('content').style.height = event.data.expanded ? '100vh' : '360px';
      chart.resize();
    }
  });
  window.addEventListener('error', (event) => {
    if (event.message) fail(event.message);
  });
  window.addEventListener('unhandledrejection', (event) => fail(event.reason));
  async function start() {
    applyTheme();
    if (payload.kind === 'mermaid') {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'default',
        maxTextSize: 50000,
        maxEdges: 1000,
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false },
        secure: [
          'secure',
          'securityLevel',
          'startOnLoad',
          'maxTextSize',
          'maxEdges',
          'suppressErrorRendering',
          'themeCSS',
        ],
      });
      const { svg } = await mermaid.render('rich-diagram', payload.code);
      const root = document.getElementById('content');
      root.innerHTML = svg;
      const drawing = root.querySelector('svg');
      if (drawing) {
        drawing.style.maxWidth = 'none';
        drawing.style.width = '100%';
        drawing.style.height = 'auto';
      }
      document.getElementById('zoom-in').onclick = () => {
        scale = Math.min(5, scale + 0.25);
        if (drawing) drawing.style.width = scale * 100 + '%';
      };
      document.getElementById('zoom-out').onclick = () => {
        scale = Math.max(0.25, scale - 0.25);
        if (drawing) drawing.style.width = scale * 100 + '%';
      };
      document.getElementById('zoom-reset').onclick = () => {
        scale = 1;
        if (drawing) drawing.style.width = '100%';
      };
    } else if (payload.kind === 'echarts') {
      const option = JSON.parse(payload.code);
      if (!option || typeof option !== 'object' || Array.isArray(option))
        throw Error('图表配置必须是 JSON 对象');
      option.tooltip = { trigger: 'item', ...option.tooltip, renderMode: 'richText' };
      chart = echarts.init(document.getElementById('content'), theme === 'dark' ? 'dark' : null);
      chart.setOption(option);
      resize = () => chart.resize();
      window.addEventListener('resize', resize);
    }
    report();
    send('rich/ready');
    if ('ResizeObserver' in window) new ResizeObserver(report).observe(document.body);
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => start().catch(fail), { once: true });
  else start().catch(fail);
})();
