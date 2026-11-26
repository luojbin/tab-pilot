import { normalizeTitleRule, compilePattern, stripPatternAnchors, applyTitleBatch, applyTitleRules } from './title-rule.js';
import { ruleMatchesUrl, match } from './rules.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 快捷入口只接受可注入内容脚本的 HTTP(S) 页面。 */
export function quickRenamePattern(address, ignoreQuery = false) {
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported-url');
  if (!ignoreQuery) return escapeRegex(url.href);
  const hash = url.href.includes('#') ? url.href.slice(url.href.indexOf('#')) : '';
  url.hash = '';
  url.search = '';
  return `${escapeRegex(url.href)}(?:\\?[^#]*)?${escapeRegex(hash)}`;
}

/** 快捷输入为字面标题，美元符号需转义，避免被当作捕获模板。 */
export function addQuickRename(config, address, title, ignoreQuery, language = 'zh', previousRule = null) {
  const urlPattern = quickRenamePattern(address, ignoreQuery);
  const spec = normalizeTitleRule({ titleRule: config.globalTitleRule });
  const entry = { titlePattern: '', urlPattern,
    replacement: title.replace(/\$/g, () => '$$'),
    description: `${language === 'en' ? 'Global title' : '全局标题'} | ${title}` };
  // 同一个快捷 URL 条件更新已有项，并提升至最前；保留其他手写规则。
  spec.rules = spec.rules.filter(rule =>
    JSON.stringify(rule) !== JSON.stringify(previousRule) &&
    (rule.titlePattern !== '' || stripPatternAnchors(rule.urlPattern) !== urlPattern));
  spec.rules.unshift(entry);
  spec.enabled = true;
  return { ...config, globalTitleRule: spec };
}

/** 只识别当前页面的快捷精确条件，不把通用手写全局规则当作单页规则修改。 */
export function findQuickRename(config, address, title = '') {
  const patterns = [quickRenamePattern(address), quickRenamePattern(address, true)];
  const spec = normalizeTitleRule({ titleRule: config.globalTitleRule });
  const entry = spec.rules.find(rule => !rule.titlePattern.trim() && patterns.includes(stripPatternAnchors(rule.urlPattern)));
  if (!entry) return null;
  const outcome = applyTitleRules({ titleRule: { enabled: true, rules: [entry] } }, title, address);
  return { entry, title: outcome.result };
}

/** 区分当前生效的单页快捷规则与需要在配置页维护的通用规则。 */
export function quickRenameContext(config, tab, originalTitle) {
  const global = normalizeTitleRule({ titleRule: config.globalTitleRule });
  const globalResult = applyTitleRules({ titleRule: global }, originalTitle, tab.url);
  if (globalResult.matched) {
    const entry = global.rules[globalResult.ruleIndex];
    const patterns = [quickRenamePattern(tab.url), quickRenamePattern(tab.url, true)];
    const quick = !entry.titlePattern.trim() && patterns.includes(stripPatternAnchors(entry.urlPattern));
    return { title: quick ? globalResult.result : '', previousRule: quick ? entry : null,
      managedSource: quick ? null : 'global' };
  }
  const group = match(tab, config.rules)?.rule;
  const groupResult = applyTitleRules(group, originalTitle, tab.url);
  if (groupResult.matched) return { title: '', previousRule: null, managedSource: 'group' };
  const existing = findQuickRename(config, tab.url, originalTitle);
  return { title: existing?.title || '', previousRule: existing?.entry || null, managedSource: null };
}

export function hasQuickRenameEntry(config, entry) {
  return normalizeTitleRule({ titleRule: config.globalTitleRule }).rules
    .some(rule => JSON.stringify(rule) === JSON.stringify(entry));
}

export function removeQuickRename(config, entry) {
  const spec = normalizeTitleRule({ titleRule: config.globalTitleRule });
  const index = spec.rules.findIndex(rule => JSON.stringify(rule) === JSON.stringify(entry));
  if (index >= 0) spec.rules.splice(index, 1);
  return { ...config, globalTitleRule: spec };
}

/** 全局先匹配，未命中才检查规则组；原标题和 URL 都由内容脚本实时取值。 */
export function effectiveTitleRule(globalRule, groupRule, url) {
  const global = normalizeTitleRule({ titleRule: globalRule });
  const group = normalizeTitleRule({ titleRule: groupRule });
  if (!global.enabled) return group;
  if (typeof url === 'string') {
    global.rules = global.rules.filter(entry => {
      if (!entry.urlPattern.trim()) return true;
      try { return compilePattern(entry.urlPattern).test(url); }
      catch { return false; }
    });
  }
  if (!global.rules.length) return group;
  return { enabled: global.enabled || group.enabled,
    rules: [...(global.enabled ? global.rules : []), ...(group.enabled ? group.rules : [])], testCases: [] };
}

/** 预览与运行时使用相同优先级，同时保留来源及各自列表中的原始序号。 */
export function previewTitleRules(globalRule, groupRule, rows, currentGroup) {
  const global = normalizeTitleRule({ titleRule: globalRule });
  const globalCount = global.enabled ? global.rules.length : 0;
  const titleRule = effectiveTitleRule(globalRule, groupRule);
  const globalOnly = effectiveTitleRule(globalRule);
  return (Array.isArray(rows) ? rows : []).map(input => {
    const groupMatched = currentGroup ? ruleMatchesUrl(currentGroup, input?.url) : null;
    // 未命中当前组的页面仍可应用全局规则，但不能应用该组的重命名。
    const [row] = applyTitleBatch({ titleRule: groupMatched === false ? globalOnly : titleRule }, [input]);
    if (!row.matched) return { ...row, ruleScope: null, groupMatched };
    const isGlobal = row.ruleIndex < globalCount;
    return { ...row, ruleScope: isGlobal ? 'global' : 'group', groupMatched,
      ruleIndex: isGlobal ? row.ruleIndex : row.ruleIndex - globalCount };
  });
}
