import { websitePattern, expandWebsiteInput, consumeAutomaticGrouping } from '../core/manual-group-rule.js';
import { ruleMatchesUrl } from '../core/rules.js';

const PENDING_KEY = 'tabpilot:manual-group-requests';

/** 持久化待确认项，后台休眠或 popup 意外关闭后仍可再次处理。 */
export function createManualGroupController(api, store, onSaved = async () => {}) {
  let chain = Promise.resolve();
  const serial = fn => {
    const task = chain.then(fn);
    chain = task.catch(() => {});
    return task;
  };
  const read = async () => (await api.storage.local.get(PENDING_KEY))[PENDING_KEY] || [];
  const write = async items => {
    await api.storage.local.set({ [PENDING_KEY]: items });
    // 角标只作用于对应窗口的标签，避免其他窗口显示无关请求。
    const tabs = await api.tabs.query({});
    for (const tab of tabs) {
      const count = items.filter(item => item.windowId === tab.windowId).length;
      await api.action?.setBadgeText?.({ tabId: tab.id, text: count ? String(count) : '' }).catch(() => {});
    }
  };
  const valid = async item => {
    try {
      const tab = await api.tabs.get(item.tabId);
      const group = await api.tabGroups.get(item.groupId);
      const { config, errors } = await store.loadConfig();
      const rule = config.rules.find(rule => rule.id === item.ruleId);
      if (errors || config.autoUpdateGroupRules === false || !rule || rule.name.trim() !== group.title.trim()) return false;
      return tab.groupId === item.groupId && tab.windowId === item.windowId &&
        group.windowId === item.windowId && websitePattern(tab.url) === item.pattern;
    } catch { return false; }
  };
  async function pending(windowId) {
    const { config } = await store.loadConfig();
    if (config.autoUpdateGroupRules === false) {
      await write([]);
      return null;
    }
    const items = await read();
    const kept = [];
    for (const item of items) if (await valid(item)) kept.push(item);
    if (kept.length !== items.length) await write(kept);
    const item = kept.find(item => item.windowId === windowId);
    if (!item) return null;
    const group = await api.tabGroups.get(item.groupId);
    return { ...item, name: group.title };
  }
  return {
    capture(tabId, change, tab) {
      if (!Number.isInteger(change.groupId) || change.groupId < 0 || tab?.pinned ||
          consumeAutomaticGrouping(tabId, change.groupId)) return Promise.resolve();
      const pattern = websitePattern(tab?.url);
      if (!pattern) return Promise.resolve();
      return serial(async () => {
        const { config, errors } = await store.loadConfig();
        if (errors || config.autoUpdateGroupRules === false) return;
        const group = await api.tabGroups.get(change.groupId);
        if (!group.title?.trim()) return;
        const rules = config.rules.filter(rule => rule.name.trim() === group.title.trim());
        if (rules.length !== 1 || rules.some(rule => ruleMatchesUrl(rule, tab.url))) return;
        // 仅现有 TabPilot 规则对应的分组参与提示。
        const item = { id: `${tabId}-${change.groupId}-${Date.now()}`, tabId,
          groupId: change.groupId, windowId: tab.windowId, pattern, name: group.title,
          ruleId: rules[0].id };
        const previous = (await read()).filter(old => old.tabId !== tabId);
        previous.push(item);
        await write(previous.slice(-50));
        try { await api.action?.openPopup?.({ windowId: tab.windowId }); } catch { /* 旧版浏览器由角标引导点击。 */ }
      });
    },
    settingsChanged: () => serial(async () => {
      const { config } = await store.loadConfig();
      if (config.autoUpdateGroupRules === false) await write([]);
    }),
    pending: windowId => serial(() => pending(windowId)),
    cancel: (windowId, id) => serial(async () => {
      await write((await read()).filter(item => item.windowId !== windowId || item.id !== id));
      return { ok: true };
    }),
    add: (windowId, id, input) => serial(async () => {
      const item = (await read()).find(item => item.windowId === windowId && item.id === id);
      if (!item || !await valid(item)) return { ok: false, reason: 'stale' };
      const patterns = expandWebsiteInput(input);
      if (!patterns.length) return { ok: false, reason: 'invalid-pattern' };
      const { config, errors } = await store.loadConfig();
      if (errors) return { ok: false, reason: 'save-failed' };
      const group = await api.tabGroups.get(item.groupId);
      const rules = config.rules.filter(rule => rule.name.trim() === group.title.trim());
      if (rules.length > 1) return { ok: false, reason: 'stale' };
      const rule = config.rules.find(rule => rule.id === item.ruleId);
      if (!rule || rule.name.trim() !== group.title.trim()) return { ok: false, reason: 'stale' };
      rule.patterns = [...new Set([...rule.patterns, ...patterns])];
      const saved = await store.saveConfig(config);
      if (!saved.ok) return { ok: false, reason: 'save-failed' };
      await write((await read()).filter(old => old.id !== id));
      let syncFailed = false;
      try { await onSaved(); } catch { syncFailed = true; }
      return { ok: true, patterns, syncFailed };
    })
  };
}
