/** 浏览器标签页群组配置；规则归属、页面标识和标题规则不依赖这些开关。 */
export const DEFAULT_TAB_GROUP = { enabled: true, minTabs: 1, collapsed: false, strictMode: false };
export function normalizeTabGroup(rule) {
  const raw = rule?.tabGroup;
  return { ...DEFAULT_TAB_GROUP, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) };
}
export function tabGroupEnabled(rule) {
  return rule?.tabGroup?.enabled !== false;
}
