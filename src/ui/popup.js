import { TOOLBAR_ACTIONS } from '../core/toolbar-actions.js';
import { startQuickRename } from './quick-rename.js';
import browser from '../platform/browser.js';
import { loadConfig } from '../app/store.js';
import { resolveLanguage, setLanguage, t } from './i18n.js';
import { toolbarFeedback } from '../core/toolbar-feedback.js';

/** popup 负责展示，耗时动作由后台执行；后续可在面板内扩展操作。 */
export async function startPopup(api = browser, doc = document, view = window, readConfig = loadConfig) {
  const panel = doc.getElementById('panel');
  const status = doc.getElementById('status');
  const settings = doc.getElementById('settings');
  let language = 'en';
  let showActionResult = true;
  let interacted = false;
  let fadeTimer;
  let closeTimer;
  const cancelClose = () => {
    interacted = true;
    view.clearTimeout(fadeTimer);
    view.clearTimeout(closeTimer);
    panel.classList.remove('fading');
  };
  const closeAfterResult = () => {
    if (interacted) return;
    fadeTimer = view.setTimeout(() => {
      panel.classList.add('fading');
      closeTimer = view.setTimeout(() => view.close(), 300);
    }, 3000);
  };
  const showFailure = () => {
    if (!showActionResult) { view.close(); return; }
    status.hidden = false;
    status.textContent = toolbarFeedback({}, language, true);
    status.className = 'error';
    closeAfterResult();
  };
  // 用户操作面板时保持打开，为设置入口和后续交互留出时间。
  settings.addEventListener('pointerenter', cancelClose);
  panel.addEventListener('keydown', cancelClose);
  settings.addEventListener('click', async () => {
    cancelClose();
    try {
      await api.runtime.openOptionsPage();
      view.close();
    } catch {
      status.textContent = t('无法打开设置，请重试。');
      status.className = 'error';
    }
  });
  try {
    const { config } = await readConfig();
    showActionResult = config.showActionResult !== false;
    status.hidden = !showActionResult;
    language = resolveLanguage(config.language);
    setLanguage(language);
    doc.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    doc.title = t('TabPilot 操作');
    settings.textContent = t('设置');
    status.textContent = t('正在执行…');
    const current = await api.windows.getCurrent();
    const rename = await api.runtime.sendMessage({ type: 'quick-rename-pending', windowId: current.id });
    if (rename?.tabId !== undefined) {
      cancelClose();
      await startQuickRename(api, doc, view, rename, config);
      return;
    }
    if (rename?.ok === false) throw new Error('Rename request failed');
    const pending = await api.runtime.sendMessage({ type: 'manual-group-pending', windowId: current.id });
    if (pending?.id) {
      cancelClose();
      status.hidden = false;
      const form = doc.getElementById('ruleForm');
      const input = doc.getElementById('pattern');
      const add = doc.getElementById('addPattern');
      const cancel = doc.getElementById('cancelPattern');
      form.hidden = false;
      doc.getElementById('question').textContent = t('是否将该网站加入“{name}”的匹配规则？').replace('{name}', () => pending.name);
      // 名称通过 textContent 写入，避免用户规则组名被当作 HTML。
      doc.getElementById('patternLabel').textContent = t('匹配地址');
      input.value = pending.pattern;
      input.setAttribute('aria-describedby', 'question');
      add.textContent = t('加入规则组');
      cancel.textContent = t('取消');
      status.textContent = '';
      let busy = false;
      const submit = async (event, adding) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        add.disabled = cancel.disabled = true;
        try {
          const response = await api.runtime.sendMessage({
            type: adding ? 'manual-group-add' : 'manual-group-cancel',
            windowId: current.id, id: pending.id, input: input.value
          });
          if (!response?.ok) {
            const messages = {
              'invalid-pattern': '请输入有效的匹配地址。',
              stale: '页面或标签页群组已变化，请关闭后重新操作。'
            };
            status.textContent = t(messages[response?.reason] || '保存失败，请重试。');
            status.className = 'error';
            return;
          }
          if (!adding) { view.close(); return; }
          form.hidden = true;
          status.textContent = t(response.syncFailed ? '规则已保存，但同步失败，请稍后重试同步。' : '已加入匹配规则。');
          status.className = '';
          fadeTimer = view.setTimeout(() => {
            panel.classList.add('fading');
            closeTimer = view.setTimeout(() => view.close(), 300);
          }, 3000);
        } catch {
          status.textContent = t('保存失败，请重试。');
          status.className = 'error';
        } finally {
          busy = false;
          add.disabled = cancel.disabled = false;
        }
      };
      form.addEventListener('submit', event => submit(event, true));
      cancel.addEventListener('click', event => submit(event, false));
      input.focus();
      return;
    }
    if (pending?.ok === false) throw new Error('Pending request failed');
    const execute = async action => {
      if (action === 'renameTab') {
        cancelClose();
        const request = await api.runtime.sendMessage({ type: 'quick-rename-active', windowId: current.id });
        if (!request?.ok) {
          // 无法重命名的页面保留错误信息和关闭入口，不误执行同步。
          await startQuickRename(api, doc, view, { ok: false }, config);
          return;
        }
        await startQuickRename(api, doc, view, request, config);
        return;
      }
      status.hidden = !showActionResult;
      status.textContent = t('正在执行…');
      const response = await api.runtime.sendMessage({ type: 'toolbar-execute', windowId: current.id,
        ...(action === undefined ? {} : { action }) });
      if (!showActionResult) { view.close(); return; }
      if (!response || typeof response.text !== 'string') throw new Error('No result');
      status.textContent = response.text;
      status.className = response.ok ? '' : 'error';
      closeAfterResult();
    };
    if (config.clickAction === 'actionMenu') {
      cancelClose();
      status.hidden = true;
      const menu = doc.getElementById('actionMenu');
      menu.hidden = false;
      let busy = false;
      for (const [action, label] of TOOLBAR_ACTIONS) {
        if (action === 'actionMenu') continue;
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = t(label);
        button.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          menu.hidden = true;
          interacted = false;
          try { await execute(action); }
          catch { showFailure(); }
        });
        menu.appendChild(button);
      }
      return;
    }
    await execute(config.clickAction === 'renameTab' ? 'renameTab' : undefined);
  } catch {
    showFailure();
  }
}

if (typeof document !== 'undefined') startPopup();
