import browser from '../platform/browser.js';

/** 整组前移，不调用 tabs.move，避免 Firefox 将游离标签并入相邻分组。 */
export async function groupsFirst(options = {}) {
  const scope = Number.isInteger(options.windowId) ? { windowId: options.windowId } : {};
  const tabs = await browser.tabs.query(scope);
  const windows = new Map();
  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) windows.set(tab.windowId, []);
    windows.get(tab.windowId).push(tab);
  }
  const result = { moved: 0, failed: 0 };
  for (const [windowId, windowTabs] of windows) {
    if (options.shouldDeferWindow?.(windowId)) continue;
    const sorted = windowTabs.slice().sort((a, b) => a.index - b.index);
    const groups = new Map();
    for (const tab of sorted) {
      if (tab.pinned || !Number.isInteger(tab.groupId) || tab.groupId < 0) continue;
      if (!groups.has(tab.groupId)) groups.set(tab.groupId, []);
      groups.get(tab.groupId).push(tab);
    }
    let index = sorted.filter(tab => tab.pinned).length;
    for (const [groupId, members] of groups) {
      if (options.shouldDeferWindow?.(windowId)) break;
      // 前面的组只会向左移动，不影响后面尚未处理的组的起始位置。
      if (members[0].index !== index) {
        try {
          await browser.tabGroups.move(groupId, { windowId, index });
          result.moved += members.length;
        } catch {
          result.failed += members.length;
          // 前一个组没有到达目标位置，停止本窗口，避免拆乱组的顺序。
          break;
        }
      }
      index += members.length;
    }
  }
  return result;
}
