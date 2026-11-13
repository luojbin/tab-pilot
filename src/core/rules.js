/**
 * TabPilot 规则引擎（纯函数层）
 *
 * 设计约束：本文件不依赖任何 browser.* API，可以在 Node 下直接单测。
 * 浏览器侧由 background.js 传入 tab / rules / context。
 *
 * 规则模型（schemaVersion 1）：
 *   一条规则 = 一个标签页分组
 *   { id, enabled, name, color, collapsed, minTabs, note, patterns[] }
 *   `patterns` 可包含多个匹配路径，任一命中即视为该规则的 URL 命中；
 *   规则在数组中的顺序就是优先级，靠前的先匹配。
 */
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

/** 规则配置的匹配路径列表（忽略非法项）。 */
function rulePatterns(rule) {
  if (!rule || !Array.isArray(rule.patterns)) return [];
  return rule.patterns.filter((pattern) => typeof pattern === 'string' && pattern.trim() !== '');
}

/** 返回命中的那条路径，未命中返回 null（用于日志展示是哪条路径命中的）。 */
function matchedPatternOf(rule, url) {
  if (typeof url !== 'string' || url === '') return null;
  for (const pattern of rulePatterns(rule)) {
    try {
      if (globToRegExp(pattern).test(url)) return pattern;
    } catch (err) {
      // 非法模式只让这一条失效，不影响同规则的其他路径
    }
  }
  return null;
}

function ruleMatchesUrl(rule, url) {
  return matchedPatternOf(rule, url) !== null;
}

/** 主机是否已经显式带了端口（支持 IPv6 的 [::1]:3000 形式）。 */
function hostHasPort(host) {
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return close !== -1 && host.slice(close + 1).includes(':');
  }
  return host.includes(':');
}

/**
 * 把用户输入的简写展开成完整的 URL 通配模式。
 *
 * 规则：
 * 1. 不含 `://` 时补上 `*://`（同时匹配 http 与 https）
 * 2. 只写了主机（域名 / IP）且没有路径时，同时展开“任意端口”和“无端口”两种形式
 * 3. 结尾不是 `/*` 时自动补全
 *
 * 例：`192.168.3.213`
 *   → `*://192.168.3.213:*​/*`、`*://192.168.3.213/*`
 *
 * 对已经展开过的完整模式是幂等的，可以反复调用。
 * @param {string} input
 * @returns {string[]} 展开结果；输入为空或只有协议时返回 []
 */
function expandPattern(input) {
  if (typeof input !== 'string') return [];
  let text = input.trim();
  if (text === '') return [];

  let scheme = '*://';
  const schemeIndex = text.indexOf('://');
  if (schemeIndex !== -1) {
    scheme = text.slice(0, schemeIndex + 3);
    text = text.slice(schemeIndex + 3);
  } else if (text.startsWith('//')) {
    text = text.slice(2);
  }
  if (text === '') return [];

  const slashIndex = text.indexOf('/');
  const host = slashIndex === -1 ? text : text.slice(0, slashIndex);
  const path = slashIndex === -1 ? '' : text.slice(slashIndex);
  if (host === '') return [];

  const withSuffix = (prefix) => {
    if (prefix.endsWith('/*')) return prefix;
    if (prefix.endsWith('/')) return `${prefix}*`;
    return `${prefix}/*`;
  };

  if (path === '' && !hostHasPort(host)) {
    return [withSuffix(`${scheme}${host}:*`), withSuffix(`${scheme}${host}`)];
  }
  return [withSuffix(`${scheme}${host}${path}`)];
}

/** 批量展开并去重，保持输入顺序。 */
function expandPatterns(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    for (const pattern of expandPattern(item)) {
      if (!out.includes(pattern)) out.push(pattern);
    }
  }
  return out;
}

/**
 * 过滤出可用规则。**保持配置中的数组顺序**——顺序即优先级，
 * 与配置页里卡片的上下顺序一致。
 */
function normalizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.filter((rule) => rule && rule.enabled !== false && rulePatterns(rule).length > 0);
}

/** 读取规则自身定义的阈值 `minTabs`，非法值回退到 1。 */
function minTabsOf(rule) {
  const raw = rule ? rule.minTabs : undefined;
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
 * - 规则按配置顺序匹配，靠前的优先；一个 tab 最多命中一条规则。
 * - 命中 URL 但数量未达阈值的规则不生效，继续尝试下一条规则，
 *   这样“攒够 3 个再归组”的规则不会挡住后面的兜底规则。
 *
 * @param {object} tab 标签页（需要 id / url / windowId）
 * @param {Array} rules 配置中的规则数组
 * @param {{tabs?: Array, windowId?: number, globalEnabled?: boolean}} [context]
 * @returns {{matched: null | {ruleId: string, rule: object, minTabs: number, tabIds: number[]}, steps: Array}}
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

  for (const rule of normalizeRules(rules)) {
    const pattern = matchedPatternOf(rule, url);
    if (pattern === null) {
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
      pattern,
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
        matched: { ruleId: rule.id, rule, minTabs, tabIds: candidateIds },
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

export {
  DEFAULT_MIN_TABS,
  globToRegExp,
  rulePatterns,
  matchedPatternOf,
  ruleMatchesUrl,
  hostHasPort,
  expandPattern,
  expandPatterns,
  normalizeRules,
  minTabsOf,
  countMatchingTabs,
  explain,
  match
};
