/**
 * TabPilot 后台调度
 *
 * 职责：监听 tab 事件 → 防抖合并 → 读配置 → 纯函数匹配 → 执行动作 → 记日志。
 * 判定逻辑全部在 rules.js，这里只做编排，方便单测其余部分。
 */
(function (global) {
  'use strict';

  const DEBOUNCE_MS = 50;
  const IGNORED_PREFIXES = ['about:', 'moz-extension:', 'chrome:', 'resource:', 'view-source:'];

  /** tabId -> tab，同一标签在防抖窗口内的多次事件只处理最后一次状态。 */
  const pending = new Map();
  let flushTimer = null;
  let configLogged = false;

  const Rules = global.TabPilotRules;
  const Store = global.TabPilotStore;
  const Actions = global.TabPilotActions;
  const Logger = global.TabPilotLogger;
  const Highlight = global.TabPilotHighlight;

  /**
   * 把 explain() 的判断过程压成一句人话，直接写进日志消息里，
   * 免得排查时还要展开 detail 才知道“为什么没进组”。
   */
  function describeSteps(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return '没有可用规则';

    const note = steps.find((step) => step.note);
    if (note) return note.note;

    const belowThreshold = steps.find(
      (step) => step.urlMatched && step.thresholdMet === false
    );
    if (belowThreshold) {
      return `${belowThreshold.ruleId} 数量不足（${belowThreshold.count}/${belowThreshold.minTabs}）`;
    }

    const urlMissed = steps.filter((step) => step.urlMatched === false);
    if (urlMissed.length > 0) {
      return `${urlMissed.map((step) => step.ruleId).join('、')} 的匹配路径都没命中`;
    }
    return '没有可用规则';
  }

  function isIgnorable(url) {
    if (typeof url !== 'string' || url === '') return true;
    return IGNORED_PREFIXES.some((prefix) => url.startsWith(prefix));
  }

  function schedule(tab) {
    if (!tab || typeof tab.id !== 'number') return;
    pending.set(tab.id, tab);
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch((err) => Logger.error('批量处理失败', String(err)));
    }, DEBOUNCE_MS);
  }

  /** 同一窗口只查一次标签页列表：阈值需要窗口内的全量标签。 */
  async function tabsInWindow(windowId) {
    try {
      return await browser.tabs.query({ windowId });
    } catch (err) {
      Logger.warn('读取窗口标签页列表失败，阈值判断降级为单标签', String(err));
      return null;
    }
  }

  async function processTab(tab, rules, allTabs) {
    const { matched, steps } = Rules.explain(tab, rules, {
      tabs: allTabs,
      windowId: tab.windowId
    });

    if (!matched) {
      Logger.info(`无规则命中：${describeSteps(steps)}`, {
        tabId: tab.id,
        url: tab.url,
        steps
      });
      return;
    }

    // 配了阈值的规则：达成时把同窗口内命中该规则的标签一起归组，
    // 否则“攒够 3 个再归组”会退化成“只归组第 3 个”。
    const tabIds = matched.minTabs > 1 ? matched.tabIds : [tab.id];
    const results = await Actions.apply(matched.rule, tab, { tabs: allTabs, tabIds });
    const failed = results.filter((r) => r.ok === false);

    if (failed.length > 0) {
      Logger.error('动作执行失败', { tabId: tab.id, ruleId: matched.ruleId, results });
    } else {
      Logger.info('命中规则并执行动作', {
        tabId: tab.id,
        url: tab.url,
        ruleId: matched.ruleId,
        results
      });
    }
  }

  async function flush() {
    const batch = Array.from(pending.values());
    pending.clear();
    if (batch.length === 0) return;

    const { config, source, errors } = await Store.loadConfig();
    if (errors) {
      Logger.warn('配置校验失败，已回退到内置默认配置', { source, errors });
    }
    if (!configLogged) {
      configLogged = true;
      Logger.info(
        `生效配置：${source === 'storage' ? '来自 storage' : '内置默认'}，规则 ${config.rules.length} 条`,
        { rules: config.rules.map((rule) => rule.id) }
      );
    }
    if (config.globalEnabled === false) {
      Logger.info('全局暂停，忽略本次事件', { count: batch.length });
      return;
    }

    const byWindow = new Map();
    for (const tab of batch) {
      if (isIgnorable(tab.url || tab.pendingUrl)) continue;
      const list = byWindow.get(tab.windowId);
      if (list) list.push(tab);
      else byWindow.set(tab.windowId, [tab]);
    }

    for (const [windowId, tabs] of byWindow) {
      const allTabs = await tabsInWindow(windowId);
      for (const tab of tabs) {
        try {
          await processTab(tab, config.rules, allTabs);
        } catch (err) {
          // 单个标签出错不影响同批次的其他标签（可靠性要求）
          Logger.error('处理标签页异常', { tabId: tab.id, error: String(err) });
        }
      }
    }
  }

  /**
   * 全量同步：把当前已打开的标签页按规则过一遍。
   *
   * 事件监听只能覆盖“之后新发生的变化”，已经开着的标签永远不会被处理，
   * 所以改配置后、或想立刻整理现有窗口时，走这里。
   *
   * 默认跳过已经在分组里的标签，避免把用户手动整理过的标签重新拽回规则组；
   * 需要强制全部重排时传 { includeGrouped: true }。
   */
  async function syncAll(options) {
    const opts = options || {};
    const includeGrouped = opts.includeGrouped === true;

    const { config, errors } = await Store.loadConfig();
    if (errors) {
      Logger.warn('配置校验失败，已回退到内置默认配置', { errors });
    }
    if (config.globalEnabled === false) {
      Logger.info('全局暂停，未同步任何标签页');
      return { checked: 0, grouped: 0, skipped: 0, failed: 0 };
    }

    const allTabs = await browser.tabs.query({});
    const byWindow = new Map();
    for (const tab of allTabs) {
      const list = byWindow.get(tab.windowId);
      if (list) list.push(tab);
      else byWindow.set(tab.windowId, [tab]);
    }

    const stats = { checked: 0, grouped: 0, skipped: 0, failed: 0 };

    for (const [windowId, windowTabs] of byWindow) {
      for (const tab of windowTabs) {
        if (isIgnorable(tab.url || tab.pendingUrl)) continue;
        stats.checked += 1;

        if (!includeGrouped && tab.groupId !== -1) {
          stats.skipped += 1;
          continue;
        }

        try {
          const { matched } = Rules.explain(tab, config.rules, {
            tabs: windowTabs,
            windowId
          });
          if (!matched) {
            stats.skipped += 1;
            continue;
          }
          const results = await Actions.apply(matched.rule, tab, {
            tabs: windowTabs,
            tabIds: matched.minTabs > 1 ? matched.tabIds : [tab.id]
          });
          if (results.some((result) => result.ok === false)) {
            stats.failed += 1;
          } else if (results.some((result) => result.skipped !== true)) {
            stats.grouped += 1;
          } else {
            stats.skipped += 1;
          }
        } catch (err) {
          stats.failed += 1;
          Logger.error('同步标签页异常', { tabId: tab.id, error: String(err) });
        }
      }
    }

    Logger.info(
      `同步完成：检查 ${stats.checked} 个，归组 ${stats.grouped} 个，跳过 ${stats.skipped} 个，失败 ${stats.failed} 个`,
      stats
    );
    return stats;
  }

  browser.tabs.onCreated.addListener((tab) => {
    schedule(tab);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 只在“加载完成”或“URL 变化”时处理，避免每个子资源事件都触发
    if (changeInfo.status !== 'complete' && !changeInfo.url) return;
    schedule(tab);
  });

  browser.runtime.onInstalled.addListener((details) => {
    Logger.info('插件已安装/更新', { version: browser.runtime.getManifest().version, reason: details.reason });
  });

  browser.runtime.onStartup.addListener(() => {
    Logger.info('浏览器启动', { version: browser.runtime.getManifest().version });
  });

  /**
   * 页面内标识：给定 URL，返回该页面应渲染的分组标识（没有则 null）。
   * 与规则引擎共用一套匹配逻辑，阈值也照常生效。
   */
  async function resolvePageStyle(tab, url) {
    const { config } = await Store.loadConfig();
    if (config.globalEnabled === false) return null;

    const targetUrl = typeof url === 'string' && url !== '' ? url : (tab && tab.url) || '';
    if (targetUrl === '' || isIgnorable(targetUrl)) return null;

    const windowId = tab && typeof tab.windowId === 'number' ? tab.windowId : undefined;
    const allTabs = windowId === undefined ? null : await tabsInWindow(windowId);
    const pseudoTab = { id: -1, windowId, url: targetUrl, groupId: -1 };

    const { matched } = Rules.explain(pseudoTab, config.rules, { tabs: allTabs, windowId });
    if (!matched) {
      Logger.info('页面标识查询：未命中分组', { url: targetUrl });
      return null;
    }

    const highlight = Highlight.normalizeHighlight(matched.rule);
    if (!highlight.enabled) {
      Logger.info('页面标识查询：分组未开启标识', { url: targetUrl, ruleId: matched.ruleId });
      return null;
    }

    Logger.info('页面标识查询：返回标识', {
      url: targetUrl,
      ruleId: matched.ruleId,
      border: highlight.border,
      banner: highlight.banner
    });

    return {
      ruleId: matched.ruleId,
      name: matched.rule.name || '未命名分组',
      colorHex: Store.colorHexOf(matched.rule),
      highlight
    };
  }

  /** 配置变化后通知所有页面重绘标识。 */
  async function refreshPages() {
    let tabs = [];
    try {
      tabs = await browser.tabs.query({});
    } catch (err) {
      return;
    }
    for (const tab of tabs) {
      if (!tab || typeof tab.id !== 'number') continue;
      browser.tabs.sendMessage(tab.id, { type: 'tabpilot:refresh' }).catch(() => {});
    }
  }

  // 配置页是独立上下文，保存后通过消息请求一次全量同步
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message !== 'object') return undefined;
    if (message.type === 'sync-all') return syncAll();
    if (message.type === 'page-style') return resolvePageStyle(sender && sender.tab, message.url);
    return undefined;
  });

  // 无论从配置页、控制台还是导入修改配置，都让已打开的页面刷新标识
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[Store.CONFIG_KEY]) return;
    refreshPages().catch((err) => Logger.error('刷新页面标识失败', String(err)));
  });

  // 工具栏按钮：点一下就把当前窗口/所有窗口的标签页按规则同步一遍
  if (browser.action && browser.action.onClicked) {
    browser.action.onClicked.addListener(() => {
      syncAll().catch((err) => Logger.error('手动同步失败', String(err)));
    });
  }

  // 便于在 about:debugging 的控制台里手动检查
  global.TabPilotBackground = { flush, schedule, syncAll };

  /**
   * v0.1.0 还没有配置界面，用它在扩展控制台里改配置：
   * 走的是和将来 UI 相同的校验路径，非法配置不会被写入，错误会直接打印。
   * 保存成功后立即同步已打开的标签页——事件监听管不到它们。
   *
   * 注意：setConfig 是**整份替换**，不会与已有规则合并；
   * 想保留现有规则请在 addRule / removeRule 上操作。
   */
  const Debug = {
    async setConfig(config) {
      const result = await Store.saveConfig(config);
      if (result.ok !== true) {
        Logger.error('配置未保存：校验失败', result.errors);
        return result;
      }
      Logger.info('配置已保存', { rules: config.rules.map((rule) => rule.id) });
      const sync = await syncAll();
      return { ...result, sync };
    },

    getConfig() {
      return Store.loadConfig();
    },

    async resetConfig() {
      await Store.resetConfig();
      Logger.info('已恢复内置默认配置');
      await syncAll();
      return Store.loadConfig();
    },

    /** 在现有配置上新增/覆盖一条规则（按 id 去重），其余规则保持不变。 */
    async addRule(rule) {
      if (!rule || typeof rule.id !== 'string' || rule.id === '') {
        const result = { ok: false, errors: ['rule.id 必须是非空字符串'] };
        Logger.error('配置未保存：校验失败', result.errors);
        return result;
      }
      const { config } = await Store.loadConfig();
      const rules = config.rules.filter((existing) => existing.id !== rule.id);
      rules.push(rule);
      return Debug.setConfig({ ...config, rules });
    },

    /** 按 id 删除一条规则，其余规则保持不变。 */
    async removeRule(id) {
      const { config } = await Store.loadConfig();
      const rules = config.rules.filter((rule) => rule.id !== id);
      if (rules.length === config.rules.length) {
        Logger.warn('没有找到要删除的规则', { id });
        return { ok: false, errors: [`规则不存在：${id}`] };
      }
      return Debug.setConfig({ ...config, rules });
    },

    syncAll
  };

  Debug.openOptions = () => browser.runtime.openOptionsPage();

  global.TabPilotDebug = Debug;
})(typeof globalThis !== 'undefined' ? globalThis : this);
