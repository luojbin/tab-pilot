import { addQuickRename, quickRenamePattern, quickRenameContext, hasQuickRenameEntry, removeQuickRename } from '../core/quick-rename.js';

const MENU_ID = 'tabpilot-quick-rename';
const PAGE = 'src/ui/popup.html';
const REQUESTS_KEY = 'tabpilot:quick-rename-requests';

/** 右键目标按窗口保存；popup 读取后消费请求，关闭后不影响普通图标动作。 */
export function registerQuickRename(api, store, onError = () => {}) {
  let queue = Promise.resolve();
  const serial = task => (queue = queue.catch(() => {}).then(task));
  const readRequests = async () => (await api.storage.local.get(REQUESTS_KEY))[REQUESTS_KEY] || {};
  const originalTitle = async tab => {
    try {
      const context = await api.tabs.sendMessage(tab.id, { type: 'tabpilot:title-context' });
      if (context?.url === tab.url && typeof context.title === 'string') return context.title;
    } catch { /* 重载或未注入的页面只能使用浏览器提供的当前标题。 */ }
    return tab.title || '';
  };
  const menus = api.menus || api.contextMenus;
  if (menus) {
    api.runtime.onInstalled.addListener(async () => {
      try {
        await menus.remove(MENU_ID).catch(() => {});
        menus.create({ id: MENU_ID, title: api.i18n.getMessage('quickRenameMenu'),
          contexts: ['tab'], documentUrlPatterns: ['http://*/*', 'https://*/*'] }, () => {
          if (api.runtime.lastError) onError(api.runtime.lastError.message);
        });
      } catch (err) { onError(String(err)); }
    });
    menus.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== MENU_ID || !Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) return;
      try { quickRenamePattern(tab.url); } catch { return; }
      return serial(async () => {
        const requests = await readRequests();
        requests[tab.windowId] = { tabId: tab.id, windowId: tab.windowId, url: tab.url };
        await api.storage.local.set({ [REQUESTS_KEY]: requests });
      }).then(() => api.action.openPopup({ windowId: tab.windowId })).catch(err => onError(String(err)));
      // 不支持后台 openPopup 的旧浏览器仍可点击图标读取已保存的请求。
    });
  }
  const pending = async windowId => {
    const requests = await readRequests();
    const request = requests[windowId];
    if (!request) return null;
    delete requests[windowId];
    await api.storage.local.set({ [REQUESTS_KEY]: requests });
    let tab;
    try { tab = await api.tabs.get(request.tabId); }
    catch { return { ...request, ok: false, reason: 'unavailable' }; }
    if (tab.url !== request.url) return { ...request, ok: false, reason: 'stale' };
    quickRenamePattern(tab.url);
    const { config, errors } = await store.loadConfig();
    if (errors?.length) return { ...request, ok: false, reason: 'invalid-config' };
    return { ...request, ok: true, ...quickRenameContext(config, tab, await originalTitle(tab)) };
  };
  const modify = async message => {
    const resetting = message.type === 'quick-rename-reset';
    if (typeof message.url !== 'string' || (!resetting &&
        (typeof message.title !== 'string' || !message.title.trim() || typeof message.ignoreQuery !== 'boolean'))) {
      return { ok: false, reason: 'invalid-input' };
    }
    const tab = await api.tabs.get(message.tabId);
    if (tab.url !== message.url) return { ok: false, reason: 'stale' };
    const { config, errors } = await store.loadConfig();
    if (errors?.length) return { ok: false, reason: 'invalid-config' };
    if (message.previousRule && !hasQuickRenameEntry(config, message.previousRule)) return { ok: false, reason: 'stale-rule' };
    const title = resetting ? await originalTitle(tab) : '';
    if (resetting && !message.previousRule) {
      return { ok: true, managedSource: quickRenameContext(config, tab, title).managedSource };
    }
    const preference = ['zh', 'en'].includes(config.language)
      ? config.language : api.i18n.getUILanguage?.() || 'en';
    const language = preference.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const next = resetting ? removeQuickRename(config, message.previousRule)
      : addQuickRename(config, tab.url, message.title, message.ignoreQuery, language, message.previousRule);
    const result = await store.saveConfig(next);
    if (!result.ok) return { ok: false, reason: 'save-failed' };
    let refreshFailed = false;
    try { await api.tabs.sendMessage(tab.id, { type: 'tabpilot:refresh' }); }
    catch { refreshFailed = true; }
    return { ok: true, refreshFailed,
      ...(resetting ? { managedSource: quickRenameContext(next, tab, title).managedSource } : {}) };
  };
  const handleMessage = (message, sender, respond) => {
    if (!['quick-rename-pending', 'quick-rename-active', 'quick-rename-save', 'quick-rename-reset'].includes(message?.type)) return;
    if (sender?.tab || sender?.url !== api.runtime.getURL(PAGE)) return;
    const isPending = message.type === 'quick-rename-pending';
    const isActive = message.type === 'quick-rename-active';
    const id = isPending || isActive ? message.windowId : message.tabId;
    if (!Number.isInteger(id) || id < 0) return;
    const active = async () => {
      const [tab] = await api.tabs.query({ active: true, windowId: id });
      if (!tab || !Number.isInteger(tab.id)) return { ok: false, reason: 'unavailable' };
      try { quickRenamePattern(tab.url); }
      catch { return { ok: false, reason: 'unsupported-url' }; }
      const { config, errors } = await store.loadConfig();
      if (errors?.length) return { ok: false, reason: 'invalid-config' };
      return { ok: true, tabId: tab.id, windowId: id, url: tab.url,
        ...quickRenameContext(config, tab, await originalTitle(tab)) };
    };
    serial(() => isPending ? pending(id) : isActive ? active() : modify(message)).then(respond).catch(err => {
      onError(String(err));
      respond({ ok: false, reason: 'unavailable' });
    });
    return true;
  };
  return { handleMessage };
}
