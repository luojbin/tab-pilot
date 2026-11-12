/**
 * TabPilot 页面内标识（content script）
 *
 * 只做一件事：向 background 询问「当前页面属于哪个分组、要不要显示标识」，
 * 需要时在页面上叠一层 fixed 覆盖层（边框 + banner），不需要时移除。
 *
 * 所有元素都是 pointer-events: none，不影响页面交互。
 */
(function () {
  'use strict';

  const Highlight = globalThis.TabPilotHighlight;
  const ROOT_ID = 'tabpilot-highlight-root';
  const MESSAGE_REFRESH = 'tabpilot:refresh';
  const Z_INDEX = '2147483647';

  let root = null;
  let signature = '';

  /**
   * 在 <html> 上留一个可检查的标记，便于排查「为什么页面上没有标识」：
   *   loaded  —— content script 已注入，但查询还没返回
   *   on      —— 已根据分组配置绘制标识
   *   off     —— 已查询，但没有命中分组 / 分组未开启标识
   */
  function mark(state) {
    try {
      document.documentElement.setAttribute('data-tabpilot', state);
    } catch (err) {
      // 极少数页面可能限制属性写入，忽略即可
    }
  }

  function removeRoot() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    signature = '';
  }

  function createRoot() {
    removeRoot();
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: Z_INDEX
    });
    (document.body || document.documentElement).appendChild(root);
    return root;
  }

  function createBorder(side, width, color) {
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'fixed',
      background: color,
      pointerEvents: 'none'
    });
    Object.assign(element.style, Highlight.borderStyle(side, width));
    return element;
  }

  function createBanner(position, text, options) {
    const { color, size, fontSize } = options;
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'fixed',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: color,
      color: Highlight.textColorFor(color),
      font: `600 ${fontSize}px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif`,
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
      boxSizing: 'border-box',
      pointerEvents: 'none'
    });
    Object.assign(element.style, Highlight.bannerStyle(position, text, size, fontSize));
    element.textContent = text;
    return element;
  }

  function render(style) {
    const spec = style.highlight;
    const color = style.colorHex || '#1a73e8';
    const nextSignature = JSON.stringify({
      ruleId: style.ruleId,
      name: style.name,
      color,
      spec
    });

    if (root && signature === nextSignature) return;
    signature = nextSignature;

    const container = createRoot();
    const width = spec.border.width;

    for (const side of spec.border.sides) {
      const border = createBorder(side, width, color);
      border.style.opacity = String(spec.border.opacity / 100);
      container.appendChild(border);
    }

    for (const position of spec.banner.positions) {
      const banner = createBanner(position, style.name, {
        color,
        size: spec.banner.size,
        fontSize: spec.banner.fontSize
      });
      banner.style.opacity = String(spec.banner.opacity / 100);
      container.appendChild(banner);
    }
  }

  async function refresh() {
    let style = null;
    try {
      style = await browser.runtime.sendMessage({ type: 'page-style', url: location.href });
    } catch (err) {
      mark('off');
      console.warn('[TabPilot] 页面标识查询失败', err);
      removeRoot();
      return;
    }
    if (!style || !style.highlight) {
      mark('off');
      removeRoot();
      return;
    }
    mark('on');
    render(style);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === MESSAGE_REFRESH) refresh();
  });

  // 单页应用切换路由时重新判断
  window.addEventListener('popstate', () => refresh());
  window.addEventListener('hashchange', () => refresh());

  mark('loaded');
  refresh();
})();
