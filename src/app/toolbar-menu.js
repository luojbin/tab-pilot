const OPTIONS_MENU_ID = 'tabpilot-options';

/** Firefox 图标右键菜单；菜单持久化，后台唤醒时只重挂事件监听。 */
export function registerToolbarMenu(api, onError = () => {}) {
  if (!api.menus) return;
  api.runtime.onInstalled.addListener(async () => {
    try {
      // 更新或开发重载时替换已有项，避免重复 id。
      await api.menus.remove(OPTIONS_MENU_ID).catch(() => {});
      api.menus.create({
        id: OPTIONS_MENU_ID,
        title: api.i18n.getMessage('optionsMenu'),
        contexts: ['action']
      }, () => {
        if (api.runtime.lastError) onError(api.runtime.lastError.message);
      });
    } catch (err) {
      onError(String(err));
    }
  });
  api.menus.onClicked.addListener((info) => {
    if (info.menuItemId === OPTIONS_MENU_ID) {
      return api.runtime.openOptionsPage().catch(err => onError(String(err)));
    }
  });
}
