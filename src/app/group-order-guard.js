/** 原生命名框没有关闭事件：新建 / 改名期间保护整个窗口，避免移动群组打断输入。 */
export function createGroupOrderGuard(onReady) {
  const titles = new Map();
  const editing = new Map();
  const deferred = new Set();
  const automaticGroups = new Set();
  const observedUpdates = new Set();
  const clear = id => {
    const state = editing.get(id);
    editing.delete(id);
    return state;
  };
  const blocked = windowId => [...editing.values()].some(group => group.windowId === windowId);
  const notify = windowId => {
    if (blocked(windowId)) return;
    deferred.delete(windowId);
    onReady(windowId);
  };
  const protect = group => {
    clear(group.id);
    const state = { windowId: group.windowId, title: group.title || '' };
    editing.set(group.id, state);
    deferred.add(group.windowId);
  };
  return {
    snapshot() {
      return [...editing].map(([id, group]) => ({ id, windowId: group.windowId })).sort((a, b) => a.id - b.id);
    },
    restore(entries, groups) {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        const group = groups.find(group => group.id === entry?.id && group.windowId === entry.windowId);
        if (group) {
          editing.set(group.id, { windowId: group.windowId, title: group.title || '' });
          deferred.add(group.windowId);
        }
      }
    },
    prime(groups) {
      for (const group of groups) if (!titles.has(group.id)) titles.set(group.id, group.title || '');
    },
    isEditing(windowId) { return blocked(windowId); },
    activationCanFinish(tab) {
      const group = editing.get(tab.groupId);
      // 新建组时浏览器可能自动激活其标签，这不代表用户已结束命名。
      return !group || Boolean(group.title.trim());
    },
    created(group) {
      if (automaticGroups.has(group.id)) return;
      titles.set(group.id, group.title || '');
      protect(group);
    },
    updated(group) {
      const previous = titles.get(group.id);
      titles.set(group.id, group.title || '');
      // 后台被原生编辑事件唤醒时，查询基线可能已经是新名称；首次原生更新保守等待交互。
      const firstNativeUpdate = !observedUpdates.has(group.id) && !automaticGroups.has(group.id);
      observedUpdates.add(group.id);
      if (firstNativeUpdate || (previous !== undefined && previous !== (group.title || ''))) protect(group);
    },
    removed(group) {
      automaticGroups.delete(group.id);
      observedUpdates.delete(group.id);
      titles.delete(group.id);
      const state = clear(group.id);
      if (state || deferred.has(group.windowId)) notify(group.windowId);
    },
    automatic(groupId, windowId, title) {
      automaticGroups.add(groupId);
      titles.set(groupId, title);
      clear(groupId);
      // 自动规则已完成命名；由当前归组批次负责整理，不另开一个重复任务。
      if (!blocked(windowId)) deferred.delete(windowId);
    },
    shouldDefer(windowId) {
      if (!blocked(windowId)) return false;
      deferred.add(windowId);
      return true;
    },
    interaction(windowId) {
      if (!deferred.has(windowId)) return;
      for (const [id, state] of editing) if (state.windowId === windowId) clear(id);
      notify(windowId);
    }
  };
}
