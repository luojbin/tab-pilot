import { normalizeTabGroup, tabGroupEnabled } from '../core/tab-group.js';
import { ruleMatchesUrl } from '../core/rules.js';

/** 仅处理导航事件中的规则分组；重新读取实际状态，避免过期事件移出错误的标签。 */
export async function enforceStrictGroup(api, config, eventTab) {
  if (!config.rules.some(rule => rule.enabled !== false && tabGroupEnabled(rule) && normalizeTabGroup(rule).strictMode === true) ||
      eventTab.pinned || !Number.isInteger(eventTab.groupId) || eventTab.groupId < 0) return false;
  const tab = await api.tabs.get(eventTab.id);
  if (tab.pinned || tab.groupId !== eventTab.groupId || tab.windowId !== eventTab.windowId) return false;
  const url = tab.pendingUrl || tab.url;
  // 不对导航中的临时空白页或浏览器内部页作网站归属判断。
  if (!/^https?:\/\//i.test(url || '')) return false;
  const group = await api.tabGroups.get(tab.groupId);
  const rules = config.rules.filter(rule => rule.name.trim() === (group.title || '').trim());
  if (rules.length !== 1 || rules[0].enabled === false || !tabGroupEnabled(rules[0]) || normalizeTabGroup(rules[0]).strictMode !== true || ruleMatchesUrl(rules[0], url)) return false;
  await api.tabs.ungroup(tab.id);
  return true;
}
