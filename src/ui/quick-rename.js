import browser from '../platform/browser.js';
import { t } from './i18n.js';

/** 编辑时保持打开；完成操作后的结果提示遵循全局设置。 */
export async function startQuickRename(api = browser, doc = document, view = window, request, preferences = {}) {
  const showActionResult = preferences.showActionResult !== false;
  const form = doc.getElementById('renameForm');
  const input = doc.getElementById('renameTitle');
  const ignore = doc.getElementById('ignoreQuery');
  const save = doc.getElementById('confirmRename');
  const cancel = doc.getElementById('cancelRename');
  const reset = doc.getElementById('resetRename');
  const status = doc.getElementById('status');
  const options = doc.getElementById('renameOptions');
  options.hidden = true;
  options.textContent = t('前往配置页');
  doc.getElementById('popupHeader').hidden = true;
  form.hidden = false;
  status.hidden = true;
  input.placeholder = t('目标标题');
  input.setAttribute('aria-label', t('目标标题'));
  doc.getElementById('ignoreQueryLabel').textContent = t('忽略查询参数');
  save.textContent = t('确认');
  cancel.textContent = t('取消');
  reset.textContent = t('重置');
  input.value = request.previousRule ? request.title || '' : '';
  ignore.checked = false;
  const showError = text => {
    status.hidden = false;
    status.className = 'error';
    status.textContent = t(text);
  };
  let busy = false;
  let deletedTitle = null;
  const finish = (text, warning = false) => {
    if (!showActionResult) { view.close(); return; }
    form.hidden = true;
    options.hidden = true;
    status.hidden = false;
    status.className = warning ? 'error' : 'success';
    status.textContent = text;
    view.setTimeout(() => {
      doc.getElementById('panel').classList.add('fading');
      view.setTimeout(() => view.close(), 300);
    }, 3000);
  };
  const showManagedRule = source => {
    status.hidden = false;
    status.className = 'success';
    status.textContent = deletedTitle !== null
      ? t(source === 'global'
        ? '已删除重命名规则“{title}”，当前标签页名由全局通配规则控制，如需修改请前往配置页。'
        : '已删除重命名规则“{title}”，当前标签页名由组内规则控制，如需修改请前往配置页。')
        .replace('{title}', () => deletedTitle)
      : t(source === 'global'
        ? '当前标题由全局通配规则生成，请前往插件配置页维护。'
        : '当前标题由组内重命名规则生成，请前往插件配置页维护。');
    options.hidden = false;
  };
  options.addEventListener('click', async () => {
    try { await api.runtime.openOptionsPage(); view.close(); }
    catch { showError('无法打开设置，请重试。'); }
  });
  cancel.addEventListener('click', () => view.close());
  if (!request.ok) {
    save.disabled = reset.disabled = true;
    showError('无法读取目标页面，请关闭面板后重新操作。');
    return;
  }
  const modify = async resetting => {
    if (busy) return;
    if (resetting && !request.previousRule) {
      if (request.managedSource) showManagedRule(request.managedSource);
      else view.close();
      return;
    }
    if (!resetting && !input.value.trim()) { showError('请输入目标标题。'); return; }
    busy = true;
    save.disabled = reset.disabled = true;
    const targetTitle = input.value;
    try {
      const result = await api.runtime.sendMessage({
        type: resetting ? 'quick-rename-reset' : 'quick-rename-save',
        tabId: request.tabId, url: request.url, previousRule: request.previousRule,
        title: targetTitle, ignoreQuery: ignore.checked
      });
      if (!result?.ok) {
        showError(['stale', 'stale-rule'].includes(result?.reason)
          ? '页面或规则已变化，请关闭面板后重新操作。' : '保存失败，请重试。');
        return;
      }
      if (resetting && result.managedSource) {
        deletedTitle = showActionResult ? request.title : null;
        request.previousRule = null;
        request.managedSource = result.managedSource;
        showManagedRule(result.managedSource);
      } else if (result.refreshFailed) {
        finish(t(resetting
          ? '规则已删除；页面暂时无法更新，请确认网站访问权限并刷新页面。'
          : '规则已保存；页面暂时无法应用，请确认网站访问权限并刷新页面。'), true);
      } else {
        finish(t(resetting ? '已删除重命名规则“{title}”。' : '已保存重命名规则“{title}”。')
          .replace('{title}', () => resetting ? request.title : targetTitle));
      }
    } catch { showError('保存失败，请重试。'); }
    finally { busy = false; save.disabled = reset.disabled = false; }
  };
  form.addEventListener('submit', event => { event.preventDefault(); return modify(false); });
  reset.addEventListener('click', () => modify(true));
  input.focus();
  input.select();
}
