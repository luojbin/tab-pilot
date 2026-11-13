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
  const TitleRule = globalThis.TabPilotTitleRule;
  const ROOT_ID = 'tabpilot-highlight-root';
  const MESSAGE_REFRESH = 'tabpilot:refresh';
  const Z_INDEX = '2147483647';

  let root = null;
  let signature = '';

  /**
   * 在 <html> 上留一个可检查的标记，便于排查「为什么页面上没有标识」：
   *   loaded  —— content script 已注入，但查询还没返回
   *   on      —— 已按分组配置绘制标识
   *   title   —— 只应用了标签页标题规则（没有页面内标识）
   *   off     —— 已查询，但没有命中分组 / 分组什么都没开启
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

  const titleState = { input: null, applied: null };
  let watchedTitleRule = null;
  let lastTriedTitle = null;
  let titleObserver = null;
  let titleWatchdog = null;

  /** 停止监听并清掉改写状态（分组不再匹配时用）。 */
  function stopTitleWatch() {
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }
    if (titleWatchdog) {
      clearInterval(titleWatchdog);
      titleWatchdog = null;
    }
    watchedTitleRule = null;
    lastTriedTitle = null;
  }

  /** 恢复被我们改过的标题。 */
  function restoreTitle() {
    if (titleState.applied !== null && document.title === titleState.applied) {
      document.title = titleState.input;
    }
    titleState.input = null;
    titleState.applied = null;
    stopTitleWatch();
  }

  /**
   * 尝试用当前标题匹配规则。
   * 不要求必须命中：页面可能在加载后才把标题改成最终值，
   * 所以只要规则开着就持续尝试，直到某个标题命中。
   */
  function attemptTitle() {
    const rule = watchedTitleRule;
    if (!TitleRule || !rule || rule.enabled !== true) return false;

    const current = document.title;
    if (titleState.applied !== null && current === titleState.applied) return true;
    // 同一个标题只尝试一次，避免轮询反复打印「未命中」
    if (titleState.applied === null && current === lastTriedTitle) return false;
    lastTriedTitle = current;

    const outcome = TitleRule.applyTitleRules({ titleRule: rule }, current);
    if (!outcome.ok || !outcome.matched) {
      if (!outcome.ok) console.warn('[TabPilot] 标题规则无效', outcome.error || outcome.reason);
      else console.info('[TabPilot] 标题规则未命中：', outcome.reason, '（等页面设置标题后会重试）');
      return false;
    }

    titleState.input = current;
    titleState.applied = outcome.result;
    if (current !== outcome.result) {
      document.title = outcome.result;
      console.info('[TabPilot] 标题已改写：', current, '→', outcome.result);
    }
    return true;
  }

  /**
   * 监听标题变化并持续尝试。
   * 只要分组开启了标题规则就启动，不管当前标题是否命中——
   * 页面常在加载后才把标题改成最终值。
   */
  function watchTitleChanges(titleRule) {
    watchedTitleRule = titleRule;
    lastTriedTitle = null;

    if (!titleObserver && document.documentElement) {
      titleObserver = new MutationObserver(() => attemptTitle());
      titleObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }

    if (!titleWatchdog) {
      titleWatchdog = setInterval(() => attemptTitle(), 1500);
    }

    attemptTitle();
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
    if (!style) {
      restoreTitle();
      mark('off');
      removeRoot();
      return;
    }

    if (style.titleRule && style.titleRule.enabled === true) {
      watchTitleChanges(style.titleRule);
    } else {
      restoreTitle();
    }
    const titleWatched = style.titleRule && style.titleRule.enabled === true;

    if (style.highlight && style.highlight.enabled) {
      mark('on');
      render(style);
      return;
    }

    removeRoot();
    mark(titleWatched ? 'title' : 'off');
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
