import { websitePattern } from './manual-group-rule.js';

/** 从指定窗口的原生分组生成草稿；已有同名规则（含停用规则）保持不变。 */
export function rulesFromGroups(existing, groups, tabs, windowId, createId) {
  const existingNames = new Set(existing.map(rule => rule.name.trim()));
  const ids = new Set(existing.map(rule => rule.id));
  const members = new Map();
  for (const tab of tabs.filter(tab => tab.windowId === windowId).slice().sort((a,b) => a.index-b.index)) {
    if (tab.pinned || !Number.isInteger(tab.groupId) || tab.groupId < 0) continue;
    if (!members.has(tab.groupId)) members.set(tab.groupId, []);
    members.get(tab.groupId).push(tab);
  }
  const drafts = new Map();
  const scoped = groups.filter(group => group.windowId === windowId)
    .slice().sort((a,b) => (members.get(a.id)?.[0]?.index ?? Infinity) - (members.get(b.id)?.[0]?.index ?? Infinity));
  for (const group of scoped) {
    const name = (group.title || '').trim();
    if (!name || existingNames.has(name)) continue;
    const patterns = [...new Set((members.get(group.id) || []).map(tab => websitePattern(tab.url)).filter(Boolean))];
    if (!patterns.length) continue;
    if (drafts.has(name)) {
      const rule = drafts.get(name);
      rule.patterns = [...new Set([...rule.patterns, ...patterns])];
      continue;
    }
    let id;
    let attempts = 0;
    do {
      if (++attempts > 100) throw new Error('无法生成唯一的规则 id');
      id = createId();
    } while (typeof id !== 'string' || !id.trim() || ids.has(id));
    ids.add(id);
    drafts.set(name, { id, name, enabled: true, color: group.color || 'grey',
      collapsed: group.collapsed === true, minTabs: 1, note: '', patterns });
  }
  return [...drafts.values()];
}
