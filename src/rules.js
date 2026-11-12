/**
 * TabPilot 规则引擎（纯函数层）
 *
 * 设计约束：本文件不依赖任何 browser.* API，可以在 Node 下直接单测。
 * 浏览器侧由 background.js 传入 tab / rules / context。
 */
(function (global) {
  'use strict';

  /** 分组阈值的兜底值：1 表示命中即归组，不做数量门槛。 */
  const DEFAULT_MIN_TABS = 1;

  const patternCache = new Map();

  function escapeRegExpChar(ch) {
    return /[.*+?^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch;
  }

  /**
   * 把 URL 通配模式（如 `*://localhost:*​/*`）转成正则。
   * 只支持 `*` 通配，其余字符按字面量处理。
   *
   * 与浏览器 match pattern 对齐的一处特例：主机名以 `*.` 开头时
   * （如 `*://*.github.com/*`），按规范同时匹配裸域名与所有子域名，
   * 所以 `https://github.com/` 也能命中。
   */
  function globToRegExp(pattern) {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      throw new TypeError('urlPattern 必须是非空字符串');
    }
    const cached = patternCache.get(pattern);
    if (cached) return cached;

    const schemeEnd = pattern.indexOf('://');
    const hostBegin = schemeEnd === -1 ? -1 : schemeEnd + 3;

    let source = '^';
    for (let i = 0; i < pattern.length; i += 1) {
      // 主机名开头的 "*." 视为“可选子域名”，与 match pattern 语义一致
      if (i === hostBegin && pattern.startsWith('*.', i)) {
        source += '(?:.*\\.)?';
        i += 1; // 连同后面的 '.' 一起跳过，循环再自增一次
        continue;
      }
      const ch = pattern[i];
      source += ch === '*' ? '.*' : escapeRegExpChar(ch);
    }
    source += '$';

    const regexp = new RegExp(source);
    patternCache.set(pattern, regexp);
    return regexp;
  }

  function tabUrl(tab) {
    if (!tab) return '';
    return tab.url || tab.pendingUrl || '';
  }

  function ruleUrlPattern(rule) {
    return rule && rule.match && typeof rule.match.urlPattern === 'string'
      ? rule.match.urlPattern
      : '';
  }

  function ruleMatchesUrl(rule, url) {
    const pattern = ruleUrlPattern(rule);
    if (pattern === '' || typeof url !== 'string' || url === '') return false;
    try {
      return globToRegExp(pattern).test(url);
    } catch (err) {
      // 非法模式只让这一条规则失效，不影响其他规则（可靠性要求）
      return false;
    }
  }

  function rulePriority(rule) {
    const value = Number(rule && rule.priority);
    return Number.isFinite(value) ? value : 0;
  }

  /**
   * 过滤出可用规则并按优先级排序：高优先级在前；
   * 同优先级按 id 字典序，保证同一份配置的匹配结果始终一致。
   */
  function sortRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules
      .filter(
        (rule) => rule && rule.enabled !== false && ruleUrlPattern(rule) !== ''
      )
      .slice()
      .sort((a, b) => {
        const diff = rulePriority(b) - rulePriority(a);
        if (diff !== 0) return diff;
        const idA = a.id === undefined || a.id === null ? '' : String(a.id);
        const idB = b.id === undefined || b.id === null ? '' : String(b.id);
        return idA.localeCompare(idB);
      });
  }

  /** 读取规则自身定义的阈值 `match.minTabs`，非法值回退到 1。 */
  function minTabsOf(rule) {
    const raw = rule && rule.match ? rule.match.minTabs : undefined;
    if (raw === undefined || raw === null) return DEFAULT_MIN_TABS;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return DEFAULT_MIN_TABS;
    return Math.floor(value);
  }

  /**
   * 统计同一窗口内命中该规则的标签页数量（含目标标签自身）。
   * 阈值按规则独立计算，所以这里必须以“这条规则”为单位过滤。
   */
  function countMatchingTabs(tabs, rule, windowId) {
    if (!Array.isArray(tabs)) return 1;
    let count = 0;
    for (const tab of tabs) {
      if (!tab) continue;
      if (windowId !== undefined && windowId !== null && tab.windowId !== windowId) {
        continue;
      }
      if (ruleMatchesUrl(rule, tabUrl(tab))) count += 1;
    }
    return count;
  }

  /**
   * 逐条走完规则并输出判断过程，供日志排查“为什么这个 tab 没进组”。
   *
   * 语义要点：
   * - 一个 tab 最多命中一条分组规则（PRD F3 默认策略）。
   * - 命中 URL 但数量未达阈值的规则不生效，继续尝试下一条规则，
   *   这样“攒够 3 个再归组”的规则不会挡住更宽泛的兜底规则。
   *
   * @param {object} tab 标签页（需要 id / url / windowId）
   * @param {Array} rules 配置中的规则数组
   * @param {{tabs?: Array, windowId?: number, globalEnabled?: boolean}} [context]
   * @returns {{matched: null | {ruleId: string, rule: object, actions: Array}, steps: Array}}
   */
  function explain(tab, rules, context) {
    const ctx = context || {};
    const steps = [];

    if (ctx.globalEnabled === false) {
      steps.push({ ruleId: null, note: '全局暂停，未执行任何规则' });
      return { matched: null, steps };
    }
    if (!tab) {
      steps.push({ ruleId: null, note: '缺少标签页信息' });
      return { matched: null, steps };
    }

    const url = tabUrl(tab);
    if (url === '') {
      steps.push({ ruleId: null, note: '标签页尚无 URL（可能仍在加载）' });
      return { matched: null, steps };
    }

    const windowId = ctx.windowId !== undefined && ctx.windowId !== null
      ? ctx.windowId
      : tab.windowId;
    const tabs = Array.isArray(ctx.tabs) ? ctx.tabs : null;

    for (const rule of sortRules(rules)) {
      const urlMatched = ruleMatchesUrl(rule, url);
      if (!urlMatched) {
        steps.push({ ruleId: rule.id, urlMatched: false, hit: false });
        continue;
      }

      const minTabs = minTabsOf(rule);
      // 目标 tab 自身已经命中 URL，所以数量至少为 1；
      // 取 max 是为了兼容调用方传入的标签页列表不含自身的情况。
      const counted = tabs ? countMatchingTabs(tabs, rule, windowId) : 1;
      const count = Math.max(1, counted);
      const thresholdMet = count >= minTabs;

      steps.push({
        ruleId: rule.id,
        urlMatched: true,
        count,
        minTabs,
        thresholdMet,
        hit: thresholdMet
      });

      if (thresholdMet) {
        // 达成阈值时，同窗口内命中该规则的标签都算“该进这一组”的候选，
        // 由调用方决定哪些真的需要移动（已在别的组里的不该被动）。
        const candidateIds = tabs
          ? Array.from(
              new Set(
                tabs
                  .filter(
                    (item) =>
                      item &&
                      (windowId === undefined || windowId === null || item.windowId === windowId) &&
                      ruleMatchesUrl(rule, tabUrl(item))
                  )
                  .map((item) => item.id)
                  .concat([tab.id])
              )
            )
          : [tab.id];

        return {
          matched: {
            ruleId: rule.id,
            rule,
            minTabs,
            tabIds: candidateIds,
            actions: Array.isArray(rule.actions) ? rule.actions : []
          },
          steps
        };
      }
    }

    return { matched: null, steps };
  }

  /** 便捷入口：只关心命中结果时用它。 */
  function match(tab, rules, context) {
    return explain(tab, rules, context).matched;
  }

  const api = {
    DEFAULT_MIN_TABS,
    globToRegExp,
    ruleMatchesUrl,
    sortRules,
    minTabsOf,
    countMatchingTabs,
    explain,
    match
  };

  global.TabPilotRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
