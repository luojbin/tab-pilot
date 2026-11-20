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
  let interacted = false;
  let fadeTimer;
  let closeTimer;
  const cancelClose = () => {
    interacted = true;
    view.clearTimeout(fadeTimer);
    view.clearTimeout(closeTimer);
    panel.classList.remove('fading');
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
    language = resolveLanguage(config.language);
    setLanguage(language);
    doc.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    doc.title = t('TabPilot 操作');
    settings.textContent = t('设置');
    status.textContent = t('正在执行…');
    const current = await api.windows.getCurrent();
    const response = await api.runtime.sendMessage({ type: 'toolbar-execute', windowId: current.id });
    if (!response || typeof response.text !== 'string') throw new Error('No result');
    status.textContent = response.text;
    status.className = response.ok ? '' : 'error';
  } catch {
    status.textContent = toolbarFeedback({}, language, true);
    status.className = 'error';
  }
  if (!interacted) {
    fadeTimer = view.setTimeout(() => {
      panel.classList.add('fading');
      closeTimer = view.setTimeout(() => view.close(), 300);
    }, 3000);
  }
}

if (typeof document !== 'undefined') startPopup();
