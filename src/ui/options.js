import { COLOR_LABEL_SETS, customTheme } from '../core/color-themes.js';
import { BUILD_COLOR_LABEL_SET } from '../platform/build-target.js';
import { TOOLBAR_ACTIONS } from '../core/toolbar-actions.js';
import { invalidRuleIndexes } from '../core/validation-errors.js';
import { previewTitleRules } from '../core/quick-rename.js';
import { normalizeTabGroup } from '../core/tab-group.js';
import browser from '../platform/browser.js';
import { createIcon } from './icons.js';
import { rulesFromGroups } from '../core/rules-from-groups.js';
import { reorderRules } from '../core/reorder-rules.js';
import { createRuleDrag } from './rule-drag.js';
import packageInfo from '../../package.json' with { type: 'json' };
import { appendRules } from '../core/append-rules.js';
import { copyRule } from '../core/copy-rule.js';
import * as Store from '../app/store.js';
import * as Rules from '../core/rules.js';
import * as Highlight from '../core/highlight.js';
import * as TitleRule from '../core/title-rule.js';
import {
  applyI18n,
  resolveLanguage,
  setLanguage,
  t
} from './i18n.js';

/**
 * TabPilot 配置页逻辑（两栏：左侧规则组列表 + 右侧规则组详情）
 *
 * 左侧只负责「选哪个规则组、叫什么、什么颜色、是否启用」以及排序/删除；
 * 右侧负责选中规则组的详细配置（匹配路径、阈值、折叠、备注），
 * 也为后续的标签页重命名、页面内高亮预留了位置。
 */
const els = {
  globalList: document.getElementById('globalList'),
  list: document.getElementById('groupList'),
  detail: document.getElementById('detail'),
  status: document.getElementById('status'),
  version: document.getElementById('version'),
  save: document.getElementById('save'),
  reload: document.getElementById('reload'),
  addRule: document.getElementById('addRule'),
  addRuleMenu: document.getElementById('addRuleMenu'),
  addBlankRule: document.getElementById('addBlankRule'),
  rulesFromWindow: document.getElementById('rulesFromWindow')
};

/** 访问所有网站的 host 权限：content script 注入依赖它。 */
const HOST_PERMISSION = { origins: ['*://*/*'] };

/**
 * 是否由扩展自己管理 host 权限。只有 Firefox 需要：
 * Chromium 在安装时就把 content_scripts 的站点访问当作必需权限授予，
 * permissions.contains 查不到（会误报无权限），permissions.remove 也会报
 * "You cannot remove required permissions"。runtime.getBrowserInfo 是 Firefox 独有接口。
 */
const CAN_MANAGE_HOST_PERMISSION = Boolean(
  browser.runtime && typeof browser.runtime.getBrowserInfo === 'function'
);

/** 权限状态：默认按已授权处理，启动时用 permissions.contains 校正。 */
let permissionGranted = true;

const COLOR_LABEL = COLOR_LABEL_SETS[BUILD_COLOR_LABEL_SET] || COLOR_LABEL_SETS.standard;

const SELECTED_KEY = 'tabpilot:selected-rule-id';
const GLOBAL_ID = '__global__';
const GLOBAL_TITLE_ID = '__global-title__';
/** 有未保存修改时禁止导出，提示文案在按钮提示与状态栏共用。 */
const UNSAVED_EXPORT_HINT = '有未保存的修改，请先「保存并同步」或「放弃修改」再导出。';

let state = { clickAction: 'sync', language: 'auto', groupsFirst: false, autoUpdateGroupRules: true, showActionResult: true, rules: [], selectedId: null };
let savedSnapshot = '';
let externalConfigChanged = false;
let busy = false;
let previewRefresh = null;
const openMenus = new Set();
const bindRuleDrag = createRuleDrag(els.list, (sourceId, targetId, after) => {
  const next = reorderRules(state.rules, sourceId, targetId, after);
  if (next === state.rules) return;
  state.rules = next;
  renderList();
  renderDetail();
}, closeMenus, () => !busy);

function newRuleId() {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function colorHex(color) {
  return Store.colorHexOf({ color }, state.colorTheme, state.customColorThemes);
}

function snapshot() {
  return JSON.stringify({
    clickAction: state.clickAction,
    language: state.language,
    groupsFirst: state.groupsFirst,
    autoUpdateGroupRules: state.autoUpdateGroupRules,
    showActionResult: state.showActionResult,
    colorTheme: state.colorTheme,
    customColorThemes: state.customColorThemes,
    globalTitleRule: state.globalTitle?.titleRule,
    rules: state.rules
  });
}

function selectedRule() {
  return state.rules.find((rule) => rule.id === state.selectedId) || null;
}

function loadSelected() {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch (err) {
    return null;
  }
}

function persistSelected() {
  try {
    if (state.selectedId) localStorage.setItem(SELECTED_KEY, state.selectedId);
    else localStorage.removeItem(SELECTED_KEY);
  } catch (err) {
    // UI 状态存不住不影响使用
  }
}

function setStatus(kind, message, details) {
  els.status.className = `status ${kind}`;
  els.status.textContent = '';

  const line = document.createElement('p');
  line.textContent = message;
  els.status.appendChild(line);

  if (Array.isArray(details) && details.length > 0) {
    const list = document.createElement('ul');
    for (const detail of details) {
      const item = document.createElement('li');
      item.textContent = detail;
      list.appendChild(item);
    }
    els.status.appendChild(list);
  }
  applyI18n(els.status);
}

// ---------------- 左侧：规则组列表 ----------------

function menuButton(label, onClick, disabled, extraClass, icon) {
  const element = document.createElement('button');
  element.type = 'button';
  element.setAttribute('role', 'menuitem');
  element.tabIndex = -1;
  const text = document.createElement('span');
  text.textContent = label;
  if (icon) element.append(createIcon(icon));
  element.append(text);
  if (extraClass) element.classList.add(extraClass);
  element.disabled = Boolean(disabled);
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

function createGlobalListItem(id = GLOBAL_ID, title = '全局配置') {
  const item = document.createElement('li');
  item.className = 'group-item global-item';
  if (state.selectedId === id) item.classList.add('selected');

  const row = document.createElement('div');
  row.className = 'group-row';

  const name = document.createElement('span');
  name.className = 'group-name';
  name.textContent = t(title);

  row.append(name);
  item.append(row);
  item.addEventListener('click', () => selectGlobal(id));
  return item;
}

function selectGlobal(id = GLOBAL_ID) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  persistSelected();
  closeMenus();
  renderList();
  renderDetail();
}

function renderList() {
  els.globalList.textContent = '';
  els.globalList.append(createGlobalListItem(), createGlobalListItem(GLOBAL_TITLE_ID, '标签页名规则'));
  applyI18n(els.globalList);

  els.list.textContent = '';

  if (state.rules.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '还没有规则组，点右上角 ＋ 添加。';
    els.list.appendChild(empty);
    applyI18n(els.list);
    syncDirtyState();
    return;
  }

  state.rules.forEach((rule, index) => {
    const item = document.createElement('li');
    item.className = 'group-item';
    item.dataset.id = rule.id;
    if (rule.id === state.selectedId) item.classList.add('selected');
    if (rule.enabled === false) item.classList.add('disabled');

    const row = document.createElement('div');
    row.className = 'group-row';
    row.title = t('拖拽调整规则顺序，保存后生效');
    bindRuleDrag(row, item, rule.id);

    // 左栏只做展示与选中：名称、颜色、启用状态都只读
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = colorHex(rule.color);

    const name = document.createElement('span');
    name.className = 'group-name';
    name.setAttribute('data-i18n-skip', '');
    name.textContent = rule.name || t('未命名规则组');
    name.title = rule.name || t('未命名规则组');

    // 只读的 iOS 风格拨杆：表示启用状态，切换在右栏
    const stateSwitch = document.createElement('span');
    stateSwitch.className = 'switch-ui';
    stateSwitch.setAttribute('aria-hidden', 'true');
    stateSwitch.title = rule.enabled === false
      ? '已停用（在右侧启用）'
      : '已启用（在右侧停用）';
    if (rule.enabled !== false) stateSwitch.classList.add('on');

    const menuToggle = document.createElement('button');
    menuToggle.type = 'button';
    menuToggle.className = 'menu-toggle icon-button';
    menuToggle.append(createIcon('menu'));
    menuToggle.title = '复制、调整顺序或删除';
    menuToggle.setAttribute('aria-label', '规则组操作菜单');
    menuToggle.setAttribute('aria-haspopup', 'menu');
    menuToggle.setAttribute('aria-expanded', String(openMenus.has(rule.id)));
    menuToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu(rule.id);
    });

    row.append(swatch, name, stateSwitch, menuToggle);

    const menu = document.createElement('div');
    menu.className = 'group-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', event => event.stopPropagation());
    menu.setAttribute('aria-label', '规则组操作菜单');
    menu.hidden = !openMenus.has(rule.id);
    menu.append(
      menuButton('上移', () => moveRule(rule.id, -1), index === 0, '', 'arrow-up'),
      menuButton('下移', () => moveRule(rule.id, 1), index === state.rules.length - 1, '', 'arrow-down'),
      menuButton('复制', () => duplicateRule(rule.id), false, '', 'copy'),
      menuButton('删除', () => removeRule(rule.id), false, 'delete', 'close')
    );

    const focusMenuItem = (last = false) => {
      const items = menu.querySelectorAll('button:not(:disabled)');
      (last ? items[items.length - 1] : items[0])?.focus();
    };
    menuToggle.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      if (!openMenus.has(rule.id)) toggleMenu(rule.id);
      focusMenuItem(event.key === 'ArrowUp');
    });
    menu.addEventListener('keydown', event => {
      const items = [...menu.querySelectorAll('button:not(:disabled)')];
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
        closeMenus();
        menuToggle.focus();
      }
    });

    item.addEventListener('click', () => selectRule(rule.id));

    item.append(row, menu);
    els.list.appendChild(item);
  });
  applyI18n(els.list);
  syncDirtyState();
}

/**
 * 左栏选中态：全局配置条目与规则组条目互斥。
 * 点规则组时只改类、不重建列表（保住 操作菜单状态），所以两块列表都要手动同步。
 */
function syncSelection() {
  for (const item of els.list.querySelectorAll('.group-item')) {
    item.classList.toggle('selected', item.dataset.id === state.selectedId);
  }
  for (const item of els.globalList.querySelectorAll('.global-item')) {
    item.classList.toggle('selected', state.selectedId === GLOBAL_ID);
  }
}

function selectRule(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  persistSelected();
  syncSelection();
  renderDetail();
}

function listItemFor(id) {
  for (const item of els.list.querySelectorAll('.group-item')) {
    if (item.dataset.id === id) return item;
  }
  return null;
}

/** 右栏改完名称/颜色/启用后，同步左栏那一行的展示（左栏本身不可编辑）。 */
function updateListItem(rule) {
  const item = listItemFor(rule.id);
  if (!item) return;

  const name = item.querySelector('.group-name');
  if (name) {
    name.textContent = rule.name || t('未命名规则组');
    name.title = rule.name || t('未命名规则组');
  }

  const swatch = item.querySelector('.swatch');
  if (swatch) swatch.style.background = colorHex(rule.color);

  const stateSwitch = item.querySelector('.switch-ui');
  if (stateSwitch) {
    stateSwitch.classList.toggle('on', rule.enabled !== false);
    stateSwitch.title = rule.enabled === false
      ? '已停用（在右侧启用）'
      : '已启用（在右侧停用）';
  }

  item.classList.toggle('disabled', rule.enabled === false);
}

function closeMenus() {
  closeAddRuleMenu();
  openMenus.clear();
  for (const item of els.list.querySelectorAll('.group-item')) {
    const menu = item.querySelector('.group-menu');
    if (menu) menu.hidden = true;
    const toggle = item.querySelector('.menu-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
}

function toggleMenu(id) {
  closeAddRuleMenu();
  if (openMenus.has(id)) openMenus.delete(id);
  else {
    openMenus.clear();
    openMenus.add(id);
  }
  for (const item of els.list.querySelectorAll('.group-item')) {
    const open = openMenus.has(item.dataset.id);
    const menu = item.querySelector('.group-menu');
    if (menu) {
      menu.hidden = !open;
      if (open) {
        menu.classList.remove('open-up');
        const bounds = item.getBoundingClientRect();
        const height = menu.getBoundingClientRect().height;
        menu.classList.toggle('open-up', bounds.bottom + height + 6 > window.innerHeight && bounds.top > height + 6);
        menu.querySelector('button:not(:disabled)')?.focus();
      }
    }
    const toggle = item.querySelector('.menu-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }
}

function closeAddRuleMenu() {
  els.addRuleMenu.hidden = true;
  els.addRule.setAttribute('aria-expanded', 'false');
}

function openAddRuleMenu(last = false) {
  closeMenus();
  els.addRuleMenu.hidden = false;
  els.addRule.setAttribute('aria-expanded', 'true');
  (last ? els.rulesFromWindow : els.addBlankRule).focus();
}

async function addRulesFromWindow() {
  if (busy) return;
  closeMenus();
  busy = true;
  syncDirtyState();
  try {
    const currentWindow = await browser.windows.getCurrent();
    const [groups, tabs] = await Promise.all([
      browser.tabGroups.query({ windowId: currentWindow.id }),
      browser.tabs.query({ windowId: currentWindow.id })
    ]);
    const generated = rulesFromGroups(state.rules, groups, tabs, currentWindow.id, newRuleId);
    if (!generated.length) {
      setStatus('info', t('当前窗口没有可生成规则组的标签页群组：已有同名规则组，或组内没有可用的网站。'));
      return;
    }
    const checked = Store.validateConfig({ ...Store.DEFAULT_CONFIG, rules: generated });
    if (!checked.ok) {
      setStatus('error', t('从当前窗口创建规则组失败。'), checked.errors);
      return;
    }
    state.rules.push(...generated);
    state.selectedId = generated[0].id;
    persistSelected();
    renderList();
    renderDetail();
    setStatus('info', t('已从当前窗口创建 {count} 个规则组，请保存并同步后生效。').replace('{count}', String(generated.length)));
  } catch (err) {
    setStatus('error', t('从当前窗口创建规则组失败。'), [String(err)]);
  } finally {
    busy = false;
    syncDirtyState();
  }
}

function addRule() {
  if (busy) return;
  const rule = {
    id: newRuleId(),
    enabled: true,
    name: t(`新规则组 ${state.rules.length + 1}`),
    color: Store.colorForIndex(state.rules.length),
    tabGroup: { enabled: true, minTabs: 1, collapsed: false, strictMode: false },
    note: '',
    patterns: ['']
  };
  state.rules.push(rule);
  state.selectedId = rule.id;
  persistSelected();
  closeMenus();
  renderList();
  renderDetail();

  const nameInput = els.detail.querySelector('.field-name-input');
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
}

function duplicateRule(id) {
  const index = state.rules.findIndex(rule => rule.id === id);
  if (index === -1) return;
  let copyId;
  do { copyId = newRuleId(); } while (state.rules.some(rule => rule.id === copyId));
  const copy = copyRule(state.rules[index], state.rules, copyId, t('副本'), Store.colorForIndex(state.rules.length));
  state.rules.push(copy);
  state.selectedId = copy.id;
  persistSelected();
  closeMenus();
  renderList();
  renderDetail();
  setStatus('info', '已复制到末尾：请按需修改匹配路径，并启用后保存。');
  els.detail.querySelector('.field-name-input')?.focus();
}

function removeRule(id) {
  const index = state.rules.findIndex((rule) => rule.id === id);
  if (index === -1) return;

  state.rules.splice(index, 1);
  closeMenus();

  if (state.selectedId === id) {
    const next = state.rules[Math.min(index, state.rules.length - 1)];
    state.selectedId = next ? next.id : GLOBAL_ID;
    persistSelected();
  }
  renderList();
  renderDetail();
}

function moveRule(id, delta) {
  const index = state.rules.findIndex((rule) => rule.id === id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= state.rules.length) return;

  const [rule] = state.rules.splice(index, 1);
  state.rules.splice(target, 0, rule);
  closeMenus();
  renderList();
  renderDetail();
}

// ---------------- 右栏：规则组详情 ----------------

const SECTION_KEY = 'tabpilot:sections:v2';

function loadSectionState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SECTION_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function saveSectionState(state) {
  try {
    localStorage.setItem(SECTION_KEY, JSON.stringify(state));
  } catch (err) {
    // 折叠状态存不住不影响使用
  }
}

/**
 * 可独立折叠的配置区块：标题栏点击切换，状态记在 localStorage。
 * options.status 是一个元素，只在折叠时显示，用来快速看出该区块是否已配置。
 */
function createSection(id, title, body, options) {
  const opts = options || {};
  const section = document.createElement('section');
  section.className = 'config-section';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'section-head';

  const titleEl = document.createElement('span');
  titleEl.className = 'section-title';
  titleEl.textContent = title;

  const statusSlot = document.createElement('span');
  statusSlot.className = 'section-status';
  if (opts.status) statusSlot.append(opts.status);

  const chevron = createIcon('chevron-down', 'section-chevron');

  head.append(titleEl, statusSlot, chevron);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'section-body';
  bodyEl.append(body);

  const stored = loadSectionState();
  const open = stored[id] === undefined ? opts.defaultOpen !== false : stored[id] !== false;
  bodyEl.hidden = !open;
  statusSlot.hidden = open;
  head.setAttribute('aria-expanded', String(open));

  head.addEventListener('click', () => {
    const nextOpen = bodyEl.hidden;
    bodyEl.hidden = !nextOpen;
    statusSlot.hidden = nextOpen;
    head.setAttribute('aria-expanded', String(nextOpen));
    const current = loadSectionState();
    current[id] = nextOpen;
    saveSectionState(current);
  });

  section.append(head, bodyEl);
  return section;
}

// ---------------- 标签页名规则 ----------------

// 默认折叠，仅记录主动展开的卡片，不写入规则组。
const expandedTitleRules = new WeakSet();

function ensureTitleRule(rule) {
  const previous = rule.titleRule?.rules;
  const normalized = TitleRule.normalizeTitleRule(rule);
  normalized.rules.forEach((entry, index) => {
    if (previous?.[index] && expandedTitleRules.has(previous[index])) expandedTitleRules.add(entry);
  });
  rule.titleRule = normalized;
  return rule.titleRule;
}

function titleField(labelText, className, value, placeholder, onInput, showLabel = true, boundary = null) {
  const label = document.createElement('label');
  label.className = 'field';
  if (showLabel) {
    const caption = document.createElement('span');
    caption.className = 'title-field-label';
    caption.textContent = labelText;
    label.append(caption);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.setAttribute('aria-label', labelText);
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener('input', () => onInput(input.value));

  if (boundary) {
    const frame = document.createElement('span');
    frame.className = 'title-pattern-frame';
    const symbol = text => {
      const node = document.createElement('span');
      node.className = 'title-pattern-boundary';
      node.textContent = text;
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('data-i18n-skip', '');
      return node;
    };
    input.addEventListener('blur', () => {
      const body = TitleRule.stripPatternAnchors(input.value);
      // ^$ 等仅含边界的条件不能变成“留空不限制”。
      if (body.trim() || !input.value.trim()) {
        input.value = body;
        onInput(body);
      }
    });
    frame.append(symbol('^'), input, symbol(boundary));
    label.append(frame);
  } else {
    label.append(input);
  }
  return label;
}

function createTitleRuleCard(rule, spec, entry, index, foldControls) {
  const card = document.createElement('div');
  card.className = 'title-rule-card';

  const head = document.createElement('div');
  head.className = 'title-rule-head';

  const order = document.createElement('span');
  order.className = 'title-rule-order';
  order.textContent = String(index + 1);

  const description = document.createElement('input');
  description.type = 'text';
  description.className = 'title-rule-desc';
  description.value = entry.description;
  description.placeholder = '描述（可选，例如：Jira 标题）';
  description.addEventListener('input', () => {
    entry.description = description.value;
    rule.titleRule = spec;
  });

  const fold = document.createElement('button');
  fold.type = 'button';
  fold.className = 'title-rule-fold icon-button';

  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'title-rule-summary';
  summary.setAttribute('data-i18n-skip', '');

  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'title-rule-move icon-button';
  up.append(createIcon('arrow-up'));
  up.setAttribute('aria-label', '上移');
  up.title = '上移（靠前的规则先匹配）';
  up.disabled = index === 0;
  up.addEventListener('click', () => {
    if (index === 0) return;
    const rules = spec.rules;
    [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
    rule.titleRule = spec;
    renderDetail();
  });

  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'title-rule-move icon-button';
  down.append(createIcon('arrow-down'));
  down.setAttribute('aria-label', '下移');
  down.title = '下移';
  down.disabled = index === spec.rules.length - 1;
  down.addEventListener('click', () => {
    if (index >= spec.rules.length - 1) return;
    const rules = spec.rules;
    [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
    rule.titleRule = spec;
    renderDetail();
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'title-rule-remove icon-button icon-button-danger';
  remove.append(createIcon('close'));
  remove.title = '删除这条命名规则';
  remove.setAttribute('aria-label', remove.title);
  remove.addEventListener('click', () => {
    spec.rules.splice(index, 1);
    rule.titleRule = spec;
    renderDetail();
  });

  head.append(order, description, summary, fold, up, down, remove);

  const patternField = titleField(
    '标题条件',
    'title-rule-pattern',
    entry.titlePattern,
    '正则主体，留空表示不限制',
    (value) => {
      entry.titlePattern = value;
      rule.titleRule = spec;
    }, true, '$'
  );

  const replacementField = titleField(
    '目标文本',
    'title-rule-replacement',
    entry.replacement,
    '支持 ${title.1}、${url.1} 等捕获组',
    (value) => {
      entry.replacement = value;
      rule.titleRule = spec;
    }
  );

  const urlField = titleField('URL 条件', 'title-rule-url-pattern',
    entry.urlPattern, '留空表示不限制；如需匹配后续路径、参数等变体，请加 .*', value => {
      entry.urlPattern = value;
      rule.titleRule = spec;
    }, true, '$');
  const fields = [patternField, urlField, replacementField];
  const syncFoldState = () => {
    const folded = !expandedTitleRules.has(entry);
    fields.forEach(field => { field.hidden = folded; });
    description.hidden = folded;
    summary.hidden = !folded;
    summary.textContent = entry.description.trim() ? entry.description : t('未命名规则');
    summary.title = summary.textContent;
    summary.setAttribute('aria-expanded', String(!folded));
    fold.replaceChildren(createIcon(folded ? 'chevron-right' : 'chevron-down'));
    fold.title = t(folded ? '展开重命名规则' : '折叠重命名规则');
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!folded));
  };
  const toggleFold = () => {
    if (expandedTitleRules.has(entry)) expandedTitleRules.delete(entry);
    else expandedTitleRules.add(entry);
    syncFoldState();
  };
  fold.addEventListener('click', toggleFold);
  summary.addEventListener('click', toggleFold);
  card.append(head, ...fields);
  foldControls?.push(syncFoldState);
  syncFoldState();
  return card;
}

/** 缺少 host 权限时的红色提醒；显示时机由调用方控制。 */
function permissionWarning(text) {
  const warning = document.createElement('p');
  warning.className = 'hint small permission-warning';
  warning.textContent = text;
  return warning;
}

function createTitleRuleSection(rule) {
  const spec = ensureTitleRule(rule);

  const section = document.createElement('div');
  section.className = 'title-rule-controls';

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'field field-switch';
  toggleLabel.append(document.createTextNode('按顺序匹配并改写标签页标题'));
  const toggleSlot = document.createElement('span');
  toggleSlot.className = 'switch-slot';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.className = 'field-title-enabled';
  toggleInput.checked = spec.enabled;
  const toggleTrack = document.createElement('span');
  toggleTrack.className = 'switch-ui';
  toggleTrack.setAttribute('aria-hidden', 'true');
  toggleSlot.append(toggleInput, toggleTrack);
  toggleLabel.append(toggleSlot);

  // 没有 host 权限时，标题改写不会生效；只在规则启用时提示
  const warning = permissionGranted
    ? null
    : permissionWarning('没有访问网站的权限，标签页标题不会被改写。请到全局配置中按提示申请权限。');

  const hint = document.createElement('p');
  hint.className = 'hint small';
  hint.textContent =
    '按顺序使用首条命中的规则。标题和 URL 条件至少填写一个，同时填写时须同时命中。用 ${title.1}、${url.1} 引用捕获组，命名组用 ${title.name}、${url.name}；$$ 表示美元符号。目标文本是完整的新标题。标题和 URL 条件均默认完整匹配，无需填写 ^ 和 $；如需匹配后续路径、参数等变体，请显式添加 .*。';

  const foldControls = [];
  const listToolbar = document.createElement('div');
  listToolbar.className = 'title-rule-list-toolbar';
  const bulkFoldButton = (label, icon, folded) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(createIcon(icon));
    button.addEventListener('click', () => {
      spec.rules.forEach(entry => {
        if (folded) expandedTitleRules.delete(entry);
        else expandedTitleRules.add(entry);
      });
      foldControls.forEach(sync => sync());
    });
    return button;
  };
  const expandAll = bulkFoldButton('展开全部规则', 'expand-all', false);
  const collapseAll = bulkFoldButton('折叠全部规则', 'collapse-all', true);
  listToolbar.append(expandAll, collapseAll);

  const list = document.createElement('div');
  list.className = 'title-rule-list';
  spec.rules.forEach((entry, index) => {
    list.append(createTitleRuleCard(rule, spec, entry, index, foldControls));
  });
  if (spec.rules.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint small';
    empty.textContent = '还没有命名规则，点下方按钮添加。';
    list.append(empty);
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'add-title-rule';
  addButton.classList.add('icon-label');
  addButton.append(createIcon('plus'), document.createTextNode('添加命名规则'));
  addButton.addEventListener('click', () => {
    spec.rules.push({ titlePattern: '', urlPattern: '', replacement: '', description: '' });
    rule.titleRule = spec;
    renderDetail();
  });

  const testBox = document.createElement('div');
  testBox.className = 'title-test';
  const testLabel = document.createElement('p');
  testLabel.textContent = '测试用例（每条填写标题和 URL）';
  const testInputs = document.createElement('div');
  const renderTestCases = () => {
    testInputs.replaceChildren();
    spec.testCases.forEach((row, index) => {
      const line = document.createElement('div');
      line.className = 'title-test-case';
      const title = titleField('标题', 'title-test-title', row.title, '标题', value => { row.title = value; }, false);
      const url = titleField('URL', 'title-test-url', row.url, 'URL', value => { row.url = value; }, false);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'title-test-remove row-delete-button icon-button icon-button-danger';
      remove.append(createIcon('close'));
      remove.title = '删除测试用例';
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => {
        spec.testCases.splice(index, 1);
        renderTestCases();
        applyI18n(testInputs);
      });
      line.append(title, url, remove);
      testInputs.append(line);
    });
  };
  renderTestCases();
  const addTest = document.createElement('button');
  addTest.type = 'button';
  addTest.className = 'icon-label';
  addTest.append(createIcon('plus'), document.createTextNode('添加测试用例'));
  addTest.addEventListener('click', () => {
    spec.testCases.push({ title: '', url: '' });
    renderTestCases();
    applyI18n(testInputs);
  });

  const testButton = document.createElement('button');
  testButton.type = 'button';
  testButton.className = 'title-test-run';
  testButton.textContent = '查看效果';

  const testOutput = document.createElement('div');
  testOutput.className = 'title-test-output';

  testButton.addEventListener('click', () => {
    const candidate = { enabled: true, rules: spec.rules, testCases: spec.testCases };
    const isGlobal = rule === state.globalTitle;
    const rows = previewTitleRules(
      isGlobal ? candidate : state.globalTitle?.titleRule,
      isGlobal ? undefined : candidate,
      spec.testCases,
      isGlobal ? undefined : rule
    );

    testOutput.textContent = '';
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint small';
      empty.textContent = '暂无测试用例，请先添加。';
      testOutput.append(empty);
      applyI18n(testOutput);
      return;
    }

    rows.forEach((row) => {
      const line = document.createElement('div');
      line.className = 'title-test-line';

      const source = document.createElement('span');
      source.className = 'title-test-src';
      source.setAttribute('data-i18n-skip', '');
      source.textContent = `${row.title}(${row.url})`;

      const arrow = document.createElement('span');
      arrow.className = 'title-test-arrow';
      arrow.setAttribute('data-i18n-skip', '');
      let status = row.matched
        ? t(row.ruleScope === 'global' ? '全局规则{index}' : '规则{index}').replace('{index}', String(row.ruleIndex + 1))
        : t(row.reason === 'invalid-regex' ? '正则有误' : '未匹配');
      if (row.groupMatched === false) {
        const warning = t('未匹配当前组');
        status = row.matched ? `${status}；${warning}` : warning;
      }
      arrow.textContent = ' -> ';

      const target = document.createElement('span');
      target.className = 'title-test-dst';
      target.setAttribute('data-i18n-skip', '');
      target.textContent = `${row.result}(${status})`;
      if (!row.matched || row.groupMatched === false) target.classList.add('warn');

      line.append(source, arrow, target);
      testOutput.append(line);
    });
    applyI18n(testOutput);
  });

  testBox.append(testLabel, testInputs, addTest, testButton, testOutput);

  /** 规则没启用时把整块配置置灰禁用，省得配了半天不生效。 */
  function syncEnabledState() {
    const disabled = !spec.enabled;
    section.classList.toggle('disabled', disabled);
    if (warning) warning.hidden = disabled;
    section.querySelectorAll('input, button, textarea').forEach((element) => {
      if (element === toggleInput) return;
      element.disabled = disabled || (spec.rules.length === 0 && (element === expandAll || element === collapseAll));
    });
  }

  toggleInput.addEventListener('change', () => {
    spec.enabled = toggleInput.checked;
    rule.titleRule = spec;
    syncEnabledState();
  });

  const parts = [toggleLabel];
  if (rule === state.globalTitle) {
    const globalHint = document.createElement('p');
    globalHint.className = 'hint';
    globalHint.textContent = '此处是全局的标签页名规则，优先于规则组内重命名，不影响页面归属。';
    parts.push(globalHint);
  }
  if (warning) parts.push(warning);
  parts.push(hint, listToolbar, list, addButton, testBox);
  section.append(...parts);
  syncEnabledState();
  return section;
}

function futureRow(label) {
  const row = document.createElement('div');
  row.className = 'future-row';
  const text = document.createElement('span');
  text.textContent = label;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = '规划中';
  row.append(text, badge);
  return row;
}

// ---------------- 页面内标识 ----------------

/** 把规则上的 highlight 规范化后写回，保证 UI 与存储结构一致。 */
function ensureHighlight(rule) {
  rule.highlight = Highlight.normalizeHighlight(rule);
  return rule.highlight;
}

function checkOption(text, checked, onChange) {
  const label = document.createElement('label');
  label.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = text;
  label.append(input, span);
  return label;
}

function numberField(text, value, min, max, onChange) {
  const label = document.createElement('label');
  label.className = 'field';
  label.append(document.createTextNode(text));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  input.addEventListener('input', () => onChange(Number(input.value)));
  label.append(input);
  return label;
}

function toggleInList(list, value, checked) {
  const index = list.indexOf(value);
  if (checked && index === -1) list.push(value);
  if (!checked && index !== -1) list.splice(index, 1);
}

/**
 * 配置页里的效果预览：只做示意，不按真实尺寸渲染。
 * 边框固定画成细条，banner 固定画成一小段横线/竖线/斜线，颜色与透明度跟随配置。
 */
function createHighlightPreview(rule) {
  const box = document.createElement('div');
  box.className = 'preview-box';

  const page = document.createElement('div');
  page.className = 'preview-page';
  const pageTitle = document.createElement('span');
  pageTitle.className = 'preview-page-title';
  pageTitle.textContent = '页面预览（示意）';
  page.appendChild(pageTitle);
  for (const width of ['62%', '84%', '46%']) {
    const line = document.createElement('span');
    line.className = 'preview-line';
    line.style.width = width;
    page.appendChild(line);
  }
  box.appendChild(page);

  const layer = document.createElement('div');
  layer.className = 'preview-layer';
  box.appendChild(layer);

  const empty = document.createElement('p');
  empty.className = 'preview-empty';
  empty.textContent = '标识已关闭';
  box.appendChild(empty);

  // 示意图固定尺寸，不跟随配置里的 px 值；banner 用 XXX 占位
  const schematicBorder = 4;
  const schematicBannerSize = 12;
  const schematicFontSize = 5;
  const schematicText = 'XXX';
  // 小预览里把斜带的长度下限调小，让四角标签更贴近角部
  const schematicCornerLimits = { minLength: 60, maxLength: 120 };

  function refresh() {
    const spec = Highlight.normalizeHighlight(rule);
    const color = Store.colorHexOf(rule, state.colorTheme, state.customColorThemes);

    layer.textContent = '';
    box.classList.toggle('off', !spec.enabled);
    empty.hidden = spec.enabled;
    if (!spec.enabled) return;

    for (const side of spec.border.sides) {
      const element = document.createElement('div');
      Object.assign(element.style, {
        position: 'absolute',
        background: color,
        pointerEvents: 'none'
      });
      Object.assign(element.style, Highlight.borderStyle(side, schematicBorder));
      element.style.opacity = String(spec.border.opacity / 100);
      layer.appendChild(element);
    }

    for (const position of spec.banner.positions) {
      const element = document.createElement('div');
      Object.assign(element.style, {
        position: 'absolute',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color,
        color: Highlight.textColorFor(color),
        font: `600 ${schematicFontSize}px/1 system-ui, -apple-system, "Segoe UI", sans-serif`,
        letterSpacing: '0.04em',
        overflow: 'hidden',
        boxSizing: 'border-box',
        pointerEvents: 'none'
      });
      Object.assign(
        element.style,
        Highlight.bannerStyle(
          position,
          schematicText,
          schematicBannerSize,
          schematicFontSize,
          schematicCornerLimits
        )
      );
      element.style.opacity = String(spec.banner.opacity / 100);
      element.textContent = schematicText;
      layer.appendChild(element);
    }
  }

  refresh();
  return { box, refresh };
}

function createHighlightSection(rule) {
  const spec = ensureHighlight(rule);

  const section = document.createElement('div');
  section.className = 'highlight-controls';

  const preview = createHighlightPreview(rule);
  previewRefresh = preview.refresh;
  const commit = () => {
    rule.highlight = spec;
    preview.refresh();
  };

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'field field-switch';
  toggleLabel.append(document.createTextNode('在该规则组的页面上显示标识'));
  const slot = document.createElement('span');
  slot.className = 'switch-slot';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.className = 'field-highlight';
  toggleInput.checked = spec.enabled;
  const track = document.createElement('span');
  track.className = 'switch-ui';
  track.setAttribute('aria-hidden', 'true');
  slot.append(toggleInput, track);
  toggleLabel.append(slot);

  // 没有 host 权限时，页面内标识不会绘制；只在开关打开时提示
  const warning = permissionGranted
    ? null
    : permissionWarning('没有访问网站的权限，页面内标识不会生效。请到全局配置中按提示申请权限。');
  if (warning) warning.hidden = !spec.enabled;

  const body = document.createElement('div');
  body.className = 'highlight-body';
  body.classList.toggle('disabled', !spec.enabled);

  toggleInput.addEventListener('change', () => {
    spec.enabled = toggleInput.checked;
    commit();
    body.classList.toggle('disabled', !spec.enabled);
    if (warning) warning.hidden = !spec.enabled;
  });

  // 边框
  const borderBlock = document.createElement('div');
  borderBlock.className = 'highlight-block';
  const borderLabel = document.createElement('span');
  borderLabel.className = 'block-label';
  borderLabel.textContent = '边框（颜色取自该规则组）';
  const borderChecks = document.createElement('div');
  borderChecks.className = 'checks';
  const sideNames = { top: '上', right: '右', bottom: '下', left: '左' };
  for (const side of Highlight.BORDER_SIDES) {
    borderChecks.append(
      checkOption(sideNames[side], spec.border.sides.includes(side), (checked) => {
        toggleInList(spec.border.sides, side, checked);
        commit();
      })
    );
  }
  const widthField = numberField(
    '宽度 px',
    spec.border.width,
    Highlight.LIMITS.borderWidth.min,
    Highlight.LIMITS.borderWidth.max,
    (value) => {
      spec.border.width = value;
      commit();
    }
  );
  const borderOpacity = numberField(
    '不透明度 %',
    spec.border.opacity,
    Highlight.LIMITS.borderOpacity.min,
    Highlight.LIMITS.borderOpacity.max,
    (value) => {
      spec.border.opacity = value;
      commit();
    }
  );
  borderBlock.append(borderLabel, borderChecks, widthField, borderOpacity);

  // banner
  const bannerBlock = document.createElement('div');
  bannerBlock.className = 'highlight-block';
  const bannerLabel = document.createElement('span');
  bannerLabel.className = 'block-label';
  bannerLabel.textContent = 'Banner（显示规则组名，四个角为斜向）';
  const bannerChecks = document.createElement('div');
  bannerChecks.className = 'checks';
  const positionNames = {
    top: '上',
    right: '右',
    bottom: '下',
    left: '左',
    topLeft: '左上',
    topRight: '右上',
    bottomRight: '右下',
    bottomLeft: '左下'
  };
  for (const position of Highlight.BANNER_POSITIONS) {
    bannerChecks.append(
      checkOption(positionNames[position], spec.banner.positions.includes(position), (checked) => {
        toggleInList(spec.banner.positions, position, checked);
        commit();
      })
    );
  }
  const bannerNums = document.createElement('div');
  bannerNums.className = 'highlight-nums';
  bannerNums.append(
    numberField(
      '尺寸 px',
      spec.banner.size,
      Highlight.LIMITS.bannerSize.min,
      Highlight.LIMITS.bannerSize.max,
      (value) => {
        spec.banner.size = value;
        commit();
      }
    ),
    numberField(
      '字号 px',
      spec.banner.fontSize,
      Highlight.LIMITS.fontSize.min,
      Highlight.LIMITS.fontSize.max,
      (value) => {
        spec.banner.fontSize = value;
        commit();
      }
    ),
    numberField(
      '不透明度 %',
      spec.banner.opacity,
      Highlight.LIMITS.bannerOpacity.min,
      Highlight.LIMITS.bannerOpacity.max,
      (value) => {
        spec.banner.opacity = value;
        commit();
      }
    )
  );
  bannerBlock.append(bannerLabel, bannerChecks, bannerNums);

  body.append(borderBlock, bannerBlock);
  const parts = [preview.box, toggleLabel];
  if (warning) parts.push(warning);
  parts.push(body);
  section.append(...parts);
  return section;
}

/** 同一时刻只允许一个颜色面板打开。 */
let closeColorMenu = null;  /**
 * 颜色选择：自己实现而不是 <select>，因为原生 option 无法同时显示色块。
 * 收起态与展开项都带色块 + 名称。
 */
function createColorPicker(rule) {
  const wrap = document.createElement('div');
  wrap.className = 'color-picker';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'color-select';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', '规则组颜色');

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = colorHex(rule.color);
  const label = document.createElement('span');
  label.className = 'color-name';
  label.textContent = t(COLOR_LABEL[rule.color] || COLOR_LABEL.grey);
  const caret = createIcon('chevron-down', 'caret');
  button.append(swatch, label, caret);

  const menu = document.createElement('div');
  menu.className = 'color-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');

  function close() {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (closeColorMenu === close) closeColorMenu = null;
  }

  for (const value of Store.GROUP_COLORS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'color-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(value === (rule.color || Store.DEFAULT_COLOR)));

    const dot = document.createElement('span');
    dot.className = 'swatch';
    dot.style.background = colorHex(value);
    const text = document.createElement('span');
    text.textContent = t(COLOR_LABEL[value] || value);
    option.append(dot, text);

    option.addEventListener('click', (event) => {
      event.stopPropagation();
      rule.color = value;
      swatch.style.background = colorHex(value);
      label.textContent = t(COLOR_LABEL[value] || value);
      for (const item of menu.querySelectorAll('.color-option')) {
        item.setAttribute('aria-selected', String(item === option));
      }
      updateListItem(rule);
      close();
      syncDirtyState();
    });

    menu.appendChild(option);
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!menu.hidden) {
      close();
      return;
    }
    if (closeColorMenu) closeColorMenu();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    closeColorMenu = close;
  });

  wrap.append(button, menu);
  return wrap;
}

function renderDetail() {
  els.detail.textContent = '';
  previewRefresh = null;
  const rule = selectedRule();

  if (!rule) {
    if (state.selectedId === GLOBAL_TITLE_ID) {
      const heading = document.createElement('h2');
      heading.textContent = '标签页名规则';
      els.detail.append(heading, createTitleRuleSection(state.globalTitle));
      applyI18n(els.detail);
      syncDirtyState();
      return;
    }
    if (state.selectedId === GLOBAL_ID) {
      renderGlobalDetail();
      return;
    }
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.rules.length === 0
      ? '左侧还没有规则组。点「＋」新建一个规则组，再把要匹配的地址填进来。'
      : '从左侧选择一个规则组，查看并编辑它的详细配置。';
    els.detail.appendChild(empty);
    applyI18n(els.detail);
    syncDirtyState();
    return;
  }

  rule.tabGroup = normalizeTabGroup(rule);
  const index = state.rules.indexOf(rule);

  const head = document.createElement('div');
  head.className = 'detail-head';
  const title = document.createElement('h2');
  title.textContent = '规则组详情';
  const meta = document.createElement('span');
  meta.className = 'muted';
  meta.textContent = `第 ${index + 1} 个 · 顺序即优先级`;
  head.append(title, meta);

  // 第一行：规则名、颜色及总开关
  const firstRow = document.createElement('div');
  firstRow.className = 'detail-row';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'field field-name';
  nameLabel.append(document.createTextNode('规则组名'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'field-name-input';
  nameInput.value = rule.name || '';
  nameInput.placeholder = '例如「开发」';
  nameInput.setAttribute('aria-label', '规则组名');
  nameInput.addEventListener('input', () => {
    rule.name = nameInput.value;
    updateListItem(rule);
    if (previewRefresh) previewRefresh();
  });
  nameLabel.append(nameInput);

  const colorLabel = document.createElement('label');
  colorLabel.className = 'field field-color';
  colorLabel.append(document.createTextNode('颜色'));
  colorLabel.append(createColorPicker(rule));

  const thresholdLabel = document.createElement('label');
  thresholdLabel.className = 'field field-threshold';
  const thresholdTitle = document.createElement('span');
  thresholdTitle.className = 'threshold-title';
  thresholdTitle.textContent = '阈值';
  thresholdLabel.append(thresholdTitle);
  const threshold = document.createElement('input');
  threshold.type = 'number';
  threshold.className = 'min-tabs';
  threshold.min = '1';
  threshold.step = '1';
  threshold.value = String(rule.tabGroup.minTabs == null ? 1 : rule.tabGroup.minTabs);
  threshold.title = '同一窗口内命中该规则组的标签数达到该值才归组（1 = 立刻归组）';
  threshold.setAttribute('aria-label', '标签页群组阈值');
  threshold.addEventListener('input', () => {
    rule.tabGroup.minTabs = Number(threshold.value);
  });
  thresholdLabel.append(threshold);

  firstRow.append(nameLabel, colorLabel);

  // 第二行：备注（可拖动缩放的文本域）
  const noteRow = document.createElement('div');
  noteRow.className = 'detail-row note-row';
  const noteLabel = document.createElement('label');
  noteLabel.className = 'field';
  noteLabel.append(document.createTextNode('备注'));
  const note = document.createElement('textarea');
  note.className = 'note';
  note.rows = 3;
  note.value = rule.note || '';
  note.placeholder = '可选，例如「开发环境」';
  note.setAttribute('aria-label', '备注');
  note.addEventListener('input', () => {
    rule.note = note.value;
  });
  noteLabel.append(note);
  noteRow.append(noteLabel);

  // 启用开关保留在基础字段行，行为开关放入下方卡片。
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'field field-switch';
  enabledLabel.append(document.createTextNode('启用'));
  const enabledSlot = document.createElement('span');
  enabledSlot.className = 'switch-slot';
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledInput.className = 'field-enabled';
  enabledInput.checked = rule.enabled !== false;
  enabledInput.setAttribute('aria-label', '启用该规则组');
  const enabledSwitch = document.createElement('span');
  enabledSwitch.className = 'switch-ui';
  enabledSwitch.setAttribute('aria-hidden', 'true');
  enabledInput.addEventListener('change', () => {
    rule.enabled = enabledInput.checked;
    updateListItem(rule);
  });
  enabledSlot.append(enabledInput, enabledSwitch);
  enabledLabel.append(enabledSlot);

  const collapsedLabel = document.createElement('label');
  collapsedLabel.className = 'field field-switch';
  collapsedLabel.title = '仅在新建标签页群组或有标签从组外移入时自动折叠，组内跳转不改变折叠状态。';
  collapsedLabel.append(document.createTextNode('自动折叠'));
  const collapsedSlot = document.createElement('span');
  collapsedSlot.className = 'switch-slot';
  const collapsedInput = document.createElement('input');
  collapsedInput.type = 'checkbox';
  collapsedInput.className = 'field-collapsed';
  collapsedInput.checked = rule.tabGroup.collapsed === true;
  collapsedInput.setAttribute('aria-label', '自动折叠该标签页群组');
  const collapsedSwitch = document.createElement('span');
  collapsedSwitch.className = 'switch-ui';
  collapsedSwitch.setAttribute('aria-hidden', 'true');
  collapsedInput.addEventListener('change', () => {
    rule.tabGroup.collapsed = collapsedInput.checked;
  });
  collapsedSlot.append(collapsedInput, collapsedSwitch);
  collapsedLabel.append(collapsedSlot);

  const strictLabel = createGlobalSwitch('严格模式', rule.tabGroup.strictMode === true, checked => {
    rule.tabGroup.strictMode = checked;
  });
  strictLabel.title = '页面跳转到不匹配本规则组的网站时，自动移出当前标签页群组。';
  firstRow.append(enabledLabel);
  const groupLabel = createGlobalSwitch('标签页群组', rule.tabGroup.enabled !== false, checked => {
    rule.tabGroup.enabled = checked;
    syncTabGroupControls();
  });
  const groupBlock = document.createElement('div');
  groupBlock.className = 'tab-group-controls';
  const ruleSwitchCards = document.createElement('div');
  ruleSwitchCards.className = 'global-switch-cards';
  for (const [field, description, id] of [
    [groupLabel, '是否需要创建标签页群组', 'rule-tab-group-description'],
    [thresholdLabel, '窗口内符合规则的标签页数达到阈值才创建群组', 'rule-threshold-description'],
    [collapsedLabel, '新建标签页群组或有标签从组外移入时自动折叠；组内跳转或刷新保持当前状态。', 'rule-collapse-description'],
    [strictLabel, '页面跳转到不匹配本规则组的网站时，自动移出当前标签页群组。', 'rule-strict-description']
  ]) {
    const card = document.createElement('div');
    card.className = 'global-switch-card';
    const hint = document.createElement('p');
    hint.className = 'hint small';
    hint.id = id;
    hint.textContent = description;
    field.querySelector('input').setAttribute('aria-describedby', id);
    card.append(field, hint);
    ruleSwitchCards.append(card);
  }

  function syncTabGroupControls() {
    const disabled = rule.tabGroup.enabled === false;
    [threshold, collapsedInput, strictLabel.querySelector('input')].forEach(input => { input.disabled = disabled; });
    [...ruleSwitchCards.children].slice(1).forEach(card => card.classList.toggle('disabled', disabled));
  }
  groupBlock.append(ruleSwitchCards);
  syncTabGroupControls();

  const patternsSection = document.createElement('div');
  patternsSection.className = 'fieldset';
  const patternsTitle = document.createElement('h3');
  patternsTitle.textContent = '匹配路径';

  const patterns = document.createElement('div');
  patterns.className = 'patterns';
  const values = Array.isArray(rule.patterns) && rule.patterns.length > 0 ? rule.patterns : [''];

  values.forEach((pattern, patternIndex) => {
    const row = document.createElement('div');
    row.className = 'pattern-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pattern';
    input.value = pattern;
    input.placeholder = '192.168.0.123 或 *://localhost:*/*';
    input.setAttribute('aria-label', `匹配路径 ${patternIndex + 1}`);
    input.addEventListener('input', () => {
      rule.patterns[patternIndex] = input.value;
    });
    input.addEventListener('focusout', () => expandPatternAt(rule, patternIndex, input));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'row-delete-button icon-button icon-button-danger';
    remove.append(createIcon('close'));
    remove.title = values.length === 1 ? '每条规则至少保留一条匹配路径' : '删除这条匹配路径';
    remove.setAttribute('aria-label', '删除这条匹配路径');
    remove.disabled = values.length === 1;
    remove.addEventListener('click', () => removePattern(rule, patternIndex));

    row.append(input, remove);
    patterns.appendChild(row);
  });

  const addPattern = document.createElement('button');
  addPattern.type = 'button';
  addPattern.className = 'add-pattern';
  addPattern.classList.add('icon-label');
  addPattern.append(createIcon('plus'), document.createTextNode('添加匹配路径'));
  addPattern.addEventListener('click', () => addPatternRow(rule));

  const patternHint = document.createElement('p');
  patternHint.className = 'hint small';
  patternHint.textContent =
    '可以只写域名或 IP：离开输入框或保存时会自动补全——不带协议按 http/https 匹配；没有路径时同时匹配任意端口与无端口；结尾自动补 /*。';

  patternsSection.append(patternsTitle, patterns, addPattern, patternHint);

  const basicBody = document.createElement('div');
  basicBody.append(firstRow, noteRow, patternsSection);

  const highlightBody = document.createElement('div');
  highlightBody.append(createHighlightSection(rule));

  const tabTitleBody = document.createElement('div');
  tabTitleBody.append(createTitleRuleSection(rule));

  const groupStatus = document.createElement('span');
  groupStatus.className = 'switch-ui';
  groupStatus.setAttribute('aria-hidden', 'true');
  const syncGroupStatus = () => {
    const enabled = rule.tabGroup.enabled !== false;
    groupStatus.classList.toggle('on', enabled);
    groupStatus.title = t(enabled ? '标签页群组：已启用' : '标签页群组：未启用');
  };
  syncGroupStatus();
  groupLabel.querySelector('input').addEventListener('change', syncGroupStatus);
  const groupSection = createSection('tabGroup', '标签页群组', groupBlock, {
    defaultOpen: false,
    status: groupStatus
  });

  // 折叠时的状态提示：功能区块用只读拨杆表示启停
  const highlightStatus = document.createElement('span');
  highlightStatus.className = 'switch-ui';
  highlightStatus.setAttribute('aria-hidden', 'true');
  const syncHighlightStatus = () => {
    const on = Boolean(rule.highlight && rule.highlight.enabled);
    highlightStatus.classList.toggle('on', on);
    highlightStatus.title = on ? '页面内突出显示：已启用' : '页面内突出显示：未启用';
  };
  syncHighlightStatus();

  const tabTitleStatus = document.createElement('span');
  tabTitleStatus.className = 'switch-ui';
  tabTitleStatus.setAttribute('aria-hidden', 'true');
  const syncTabTitleStatus = () => {
    const on = Boolean(rule.titleRule && rule.titleRule.enabled);
    tabTitleStatus.classList.toggle('on', on);
    tabTitleStatus.title = on ? '标签页名规则：已启用' : '标签页名规则：未启用';
  };
  syncTabTitleStatus();

  const highlightSection = createSection('highlight', '页面内突出显示', highlightBody, {
    defaultOpen: false,
    status: highlightStatus
  });
  const highlightToggle = highlightSection.querySelector('.field-highlight');
  if (highlightToggle) {
    highlightToggle.addEventListener('change', syncHighlightStatus);
  }

  const tabTitleSection = createSection('tabTitle', '标签页名规则', tabTitleBody, {
    defaultOpen: false,
    status: tabTitleStatus
  });
  const titleToggle = tabTitleSection.querySelector('.field-title-enabled');
  if (titleToggle) {
    titleToggle.addEventListener('change', syncTabTitleStatus);
  }

  els.detail.append(
    head,
    createSection('basic', '基础配置', basicBody, { defaultOpen: true }),
    groupSection,
    highlightSection,
    tabTitleSection
  );
  applyI18n(els.detail);
  syncDirtyState();
}

/** 设置项复用已有拨杆 DOM 与 input:checked 样式。 */
function createGlobalSwitch(text, checked, onChange) {
  const field = document.createElement('label');
  field.className = 'field field-switch';
  field.append(document.createTextNode(text));
  const slot = document.createElement('span');
  slot.className = 'switch-slot';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.setAttribute('aria-label', text);
  input.addEventListener('change', () => {
    onChange(input.checked);
    syncDirtyState();
  });
  const track = document.createElement('span');
  track.className = 'switch-ui';
  track.setAttribute('aria-hidden', 'true');
  slot.append(input, track);
  field.append(slot);
  return field;
}

function createColorThemeBlock() {
  const block = document.createElement('div');
  block.className = 'fieldset color-theme-config';
  const heading = document.createElement('h3');
  heading.textContent = '色彩主题';
  const label = document.createElement('label');
  label.className = 'field';
  label.append(document.createTextNode('页内标识主题'));
  const select = document.createElement('select');
  select.className = 'color-theme-select';
  select.setAttribute('aria-describedby', 'color-theme-description');
  for (const [value, theme] of Object.entries(Store.COLOR_THEMES)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(theme.label);
    select.append(option);
  }
  for (const theme of state.customColorThemes || []) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = `${t('[自定义]')} ${theme.name}`;
    option.setAttribute('data-i18n-skip', '');
    select.append(option);
  }
  select.value = Store.normalizeColorTheme(state.colorTheme, state.customColorThemes);
  label.append(select);
  const hint = document.createElement('p');
  hint.id = 'color-theme-description';
  hint.className = 'hint small';
  hint.textContent = '仅影响页内边框、标识和配置页预览，不改变浏览器标签页群组的颜色。主题明暗由此处固定选择，不随网页或系统主题自动切换。';
  const note = document.createElement('p');
  note.className = 'hint small';
  note.textContent = '增强对比主题以 Edge 色相为基础，其中粉色槽位调整为警示红；经典保留原有配色。原生色板是采样参考，无法保证与所有浏览器主题精确一致。';
  const swatches = document.createElement('div');
  swatches.className = 'theme-swatches';
  const activeCustom = customTheme(state.colorTheme, state.customColorThemes);
  const controls = document.createElement('div');
  controls.className = 'theme-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = t('复制为自定义主题');
  copy.addEventListener('click', () => {
    const source = customTheme(state.colorTheme, state.customColorThemes) || Store.COLOR_THEMES[state.colorTheme];
    const name = source.name || t(source.label);
    const theme = { id: `theme-${newRuleId()}`, name: `${name} (${t('副本')})`,
      colors: Object.fromEntries(Store.GROUP_COLORS.map(color => [color, colorHex(color)])) };
    state.customColorThemes = [...(state.customColorThemes || []), theme];
    state.colorTheme = theme.id;
    renderList();
    renderGlobalDetail();
  });
  const selectorRow = document.createElement('div');
  selectorRow.className = 'theme-selector-row';
  selectorRow.append(label, copy);
  if (activeCustom) {
    const nameLabel = document.createElement('label');
    nameLabel.className = 'field';
    nameLabel.append(document.createTextNode(t('自定义主题名')));
    const name = document.createElement('input');
    name.type = 'text';
    name.value = activeCustom.name;
    name.required = true;
    name.addEventListener('input', () => {
      activeCustom.name = name.value;
      select.options[select.selectedIndex].textContent = `${t('[自定义]')} ${name.value}`;
      syncDirtyState();
    });
    nameLabel.append(name);
    controls.append(nameLabel);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = t('删除自定义主题');
    remove.addEventListener('click', () => {
      if (!window.confirm(t('删除当前自定义主题？将恢复浏览器默认主题。'))) return;
      state.customColorThemes = state.customColorThemes.filter(theme => theme.id !== activeCustom.id);
      state.colorTheme = Store.DEFAULT_COLOR_THEME;
      renderList();
      renderGlobalDetail();
    });
    controls.append(remove);
  }
  const refreshSwatches = () => {
    swatches.replaceChildren();
    for (const color of Store.GROUP_COLORS) {
      const item = document.createElement('div');
      item.className = 'theme-swatch';
      const dot = document.createElement(activeCustom ? 'input' : 'span');
      dot.className = 'swatch';
      dot.style.background = colorHex(color);
      const text = document.createElement('span');
      if (activeCustom) {
        item.className += ' theme-swatch-editable';
        text.className = 'theme-color-label';
        text.textContent = t(COLOR_LABEL[color]);
        dot.type = 'color';
        dot.value = colorHex(color);
        dot.setAttribute('aria-label', t(COLOR_LABEL[color]));
        dot.title = t('点击编辑颜色');
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.className = 'theme-hex';
        hex.value = dot.value.slice(1);
        hex.placeholder = 'RRGGBB';
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.setAttribute('aria-label', `${t(COLOR_LABEL[color])} HEX`);
        hex.setAttribute('aria-invalid', 'false');
        const updateColor = value => {
          activeCustom.colors[color] = value;
          dot.value = value;
          dot.style.background = value;
          hex.setAttribute('aria-invalid', 'false');
          renderList();
          syncDirtyState();
        };
        dot.addEventListener('input', () => {
          updateColor(dot.value);
          hex.value = dot.value.slice(1);
        });
        hex.addEventListener('input', () => {
          const value = hex.value.trim();
          if (/^#?[0-9a-f]{6}$/i.test(value)) updateColor(`#${value.replace(/^#/, '').toLowerCase()}`);
          else hex.setAttribute('aria-invalid', 'true');
        });
        hex.addEventListener('blur', () => {
          hex.value = activeCustom.colors[color].slice(1);
          hex.setAttribute('aria-invalid', 'false');
        });
        item.append(dot, text, hex);
      } else {
        dot.setAttribute('aria-hidden', 'true');
        text.textContent = `${t(COLOR_LABEL[color])} ${colorHex(color)}`;
        item.append(dot, text);
      }
      item.title = color;
      swatches.append(item);
    }
  };
  select.addEventListener('change', () => {
    state.colorTheme = select.value;
    renderList();
    renderGlobalDetail();
  });
  refreshSwatches();
  block.append(heading, selectorRow);
  if (activeCustom) block.append(controls);
  block.append(hint, note);
  block.append(swatches);
  return block;
}

function renderGlobalDetail() {
  els.detail.textContent = '';

  const head = document.createElement('div');
  head.className = 'detail-head';
  const title = document.createElement('h2');
  title.textContent = '全局配置';
  head.append(title);

  const body = document.createElement('div');
  // 语言
  const languageField = document.createElement('label');
  languageField.className = 'field field-language';
  languageField.append(document.createTextNode('语言'));
  const languageSelect = document.createElement('select');
  languageSelect.className = 'language-select';
  for (const [value, label] of [
    ['auto', '自动（跟随浏览器）'],
    ['zh', '中文'],
    ['en', 'English']
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    languageSelect.append(option);
  }
  languageSelect.value = state.language;
  languageSelect.addEventListener('change', () => changeLanguage(languageSelect.value));
  languageField.append(languageSelect);

  // 网站访问权限（host 权限）：只有 Firefox 需要/可以管理。
  // Chromium 在安装时把 content_scripts 的站点访问当作必需权限授予，
  // permissions.contains/remove 对它无意义（remove 会报 required permissions）。
  let permissionBlock = null;
  if (CAN_MANAGE_HOST_PERMISSION) {
    permissionBlock = document.createElement('div');
    permissionBlock.className = 'fieldset permission-config';
    const permissionTitle = document.createElement('h3');
    permissionTitle.textContent = '网站访问权限';
    const permissionHint = document.createElement('p');
    permissionHint.className = 'hint small';
    permissionHint.textContent = '页面内标识和标签页改名需要「访问所有网站」的权限。';

    const permissionStatus = document.createElement('p');
    permissionStatus.className = permissionGranted
      ? 'hint small'
      : 'hint small permission-warning';
    permissionStatus.textContent = permissionGranted
      ? '已获得访问所有网站的权限。'
      : '当前没有该权限，这两项功能不会生效。';

    const permissionActions = document.createElement('div');
    permissionActions.className = 'global-actions';

    const grantButton = document.createElement('button');
    grantButton.type = 'button';
    grantButton.textContent = '申请授权';
    grantButton.disabled = permissionGranted;
    grantButton.addEventListener('click', requestHostPermission);

    const revokeButton = document.createElement('button');
    revokeButton.type = 'button';
    revokeButton.textContent = '取消授权';
    revokeButton.disabled = !permissionGranted;
    revokeButton.addEventListener('click', revokeHostPermission);

    permissionActions.append(grantButton, revokeButton);
    permissionBlock.append(permissionTitle, permissionHint, permissionStatus, permissionActions);
  }


  // 点击插件图标的行为
  const actionField = document.createElement('label');
  actionField.className = 'field field-click-action';
  actionField.append(document.createTextNode('点击插件图标'));
  const actionSelect = document.createElement('select');
  actionSelect.className = 'click-action-select';
  for (const [value, label] of TOOLBAR_ACTIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    actionSelect.append(option);
  }
  actionSelect.value = state.clickAction;
  actionSelect.addEventListener('change', () => {
    state.clickAction = actionSelect.value;
    syncDirtyState();
  });
  actionField.append(actionSelect);

  const actionHint = document.createElement('p');
  actionHint.className = 'hint small';
  actionHint.textContent = '选择直接执行同步 / 折叠、重命名当前标签页，或打开动作菜单；折叠只影响当前窗口。';
  const orderField = createGlobalSwitch('标签页群组前置', state.groupsFirst, (checked) => {
    state.groupsFirst = checked;
    syncDirtyState();
  });
  const orderHint = document.createElement('p');
  orderHint.className = 'hint small';
  orderHint.textContent = '将标签页群组移到前面，保留各自顺序；手动新建或改名后，点击页面或切换标签时再整理。';
  const resultField = createGlobalSwitch('操作结果提示', state.showActionResult, checked => {
    state.showActionResult = checked;
  });
  const resultHint = document.createElement('p');
  resultHint.className = 'hint small';
  resultHint.textContent = '使用插件图标快捷功能或保存、删除快捷重命名规则后显示操作结果；关闭时执行完成后直接关闭弹出面板。';
  const updateField = createGlobalSwitch('自动更新规则组匹配规则', state.autoUpdateGroupRules, checked => {
    state.autoUpdateGroupRules = checked;
  });
  const updateHint = document.createElement('p');
  updateHint.className = 'hint small';
  updateHint.textContent = '手动将标签页拖入已有规则组的标签页群组时，提示是否添加该网站的匹配规则。';
  const languageHint = document.createElement('p');
  languageHint.className = 'hint small';
  languageHint.textContent = '选择设置页和弹出面板的显示语言，也可跟随浏览器。';
  const switchCards = document.createElement('div');
  switchCards.className = 'global-switch-cards';
  for (const [field, hint, id] of [
    [languageField, languageHint, 'language'],
    [actionField, actionHint, 'click-action'],
    [updateField, updateHint, 'auto-update-group-rules'],
    [resultField, resultHint, 'show-action-result'],
    [orderField, orderHint, 'groups-first']
  ]) {
    const card = document.createElement('div');
    card.className = 'global-switch-card';
    hint.id = `${id}-description`;
    field.querySelector('input, select').setAttribute('aria-describedby', hint.id);
    card.append(field, hint);
    switchCards.append(card);
  }
  body.append(switchCards, createColorThemeBlock());
  if (permissionBlock) body.append(permissionBlock);

  // 配置管理
  const configBlock = document.createElement('div');
  configBlock.className = 'fieldset global-config';
  const configTitle = document.createElement('h3');
  configTitle.textContent = '配置管理';
  const configHint = document.createElement('p');
  configHint.className = 'hint small';
  configHint.textContent = '导出已保存的配置，或选择替换导入、仅追加规则组。';
  const actions = document.createElement('div');
  actions.className = 'global-actions';

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'export-config';
  exportButton.textContent = '导出 JSON';
  exportButton.title = '把已保存的配置导出为 JSON 文件';
  exportButton.addEventListener('click', exportToFile);

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.textContent = '导入 JSON…';
  importButton.title = '从 JSON 文件导入配置，校验通过后替换当前配置并同步';

  const appendButton = document.createElement('button');
  appendButton.type = 'button';
  appendButton.textContent = '追加导入…';
  appendButton.title = '仅追加文件中的规则组，保留当前全局设置';
  let importMode = 'replace';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file || busy) return;
    const mode = importMode;
    file
      .text()
      .then((value) => mode === 'append' ? appendFromText(value, file.name) : importFromText(value, file.name))
      .catch((err) => setStatus('error', `读取文件失败：${String(err)}`));
  });
  importButton.addEventListener('click', () => { importMode = 'replace'; fileInput.click(); });
  appendButton.addEventListener('click', () => { importMode = 'append'; fileInput.click(); });

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = '恢复默认';
  resetButton.title = '删除已保存的配置，回到内置默认规则';
  resetButton.addEventListener('click', () => {
    reset().catch((err) => setStatus('error', `恢复默认失败：${String(err)}`));
  });

  actions.append(exportButton, importButton, appendButton, resetButton, fileInput);

  // 有未保存的修改时导出不可用，提示先保存或放弃
  const exportBlocked = document.createElement('p');
  exportBlocked.className = 'hint small export-blocked';
  exportBlocked.textContent = UNSAVED_EXPORT_HINT;
  exportBlocked.hidden = true;

  configBlock.append(configTitle, configHint, actions, exportBlocked);

  const future = document.createElement('p');
  future.className = 'hint small';
  future.textContent = '以后可以在这里增加更多全局选项。';
  configBlock.append(future);

  body.append(configBlock);

  els.detail.append(head, body);
  applyI18n(els.detail);
  syncDirtyState();
}

function addPatternRow(rule) {
  rule.patterns.push('');
  renderDetail();
  const inputs = els.detail.querySelectorAll('.pattern');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

function removePattern(rule, index) {
  if (rule.patterns.length <= 1) return;
  rule.patterns.splice(index, 1);
  renderDetail();
}

/** 失焦时把简写展开：`192.168.3.213` → 任意端口 + 无端口两条。 */
function expandPatternAt(rule, index, input) {
  const value = input.value.trim();
  if (value === '') return;

  const expanded = Rules.expandPattern(value);
  if (expanded.length === 0) return;
  if (expanded.length === 1 && expanded[0] === value) return;

  const others = rule.patterns
    .filter((_, itemIndex) => itemIndex !== index)
    .map((pattern) => String(pattern).trim())
    .filter((pattern) => pattern !== '');
  const additions = expanded.filter((pattern) => !others.includes(pattern));

  rule.patterns.splice(index, 1, ...additions);
  renderDetail();
}

function normalizeAllPatterns() {
  let changed = false;
  for (const rule of state.rules) {
    const before = rule.patterns;
    const expanded = Rules.expandPatterns(before);
    if (JSON.stringify(before) !== JSON.stringify(expanded)) changed = true;
    rule.patterns = expanded.length > 0 ? expanded : [''];
  }
  if (changed && selectedRule()) renderDetail();
  return changed;
}

function buildConfig() {
  return Store.buildConfigFromRules(
    state.rules,
    state.clickAction,
    state.language,
    state.groupsFirst,
    { autoUpdateGroupRules: state.autoUpdateGroupRules, showActionResult: state.showActionResult, colorTheme: state.colorTheme, customColorThemes: state.customColorThemes, globalTitleRule: state.globalTitle?.titleRule }
  );
}

// ---------------- 保存 / 载入 ----------------

function markInvalid(errors) {
  for (const item of els.list.querySelectorAll('.group-item')) {
    item.classList.remove('invalid');
  }
  if (!Array.isArray(errors)) return;

  if (errors.some(error => typeof error === 'object' && error?.path?.startsWith('globalTitleRule'))) {
    selectGlobal(GLOBAL_TITLE_ID);
  }
  const indexes = invalidRuleIndexes(errors);
  if (indexes.length === 0) return;

  const firstIndex = indexes[0];
  const firstRule = state.rules[firstIndex];
  if (firstRule && state.selectedId !== firstRule.id) selectRule(firstRule.id);

  for (const index of indexes) {
    const rule = state.rules[index];
    if (!rule) continue;
    for (const item of els.list.querySelectorAll('.group-item')) {
      if (item.dataset.id === rule.id) item.classList.add('invalid');
    }
  }

  const firstItem = els.list.querySelector('.group-item.invalid');
  if (firstItem) firstItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function sendSync() {
  try {
    return await browser.runtime.sendMessage({ type: 'sync-all' });
  } catch (err) {
    setStatus('warn', `配置已保存，但同步已打开的标签页失败：${String(err)}`);
    return null;
  }
}

async function persist(label) {
  if (externalConfigChanged) {
    setStatus('warn', '配置已在其他窗口更新，请先放弃修改并重新读取，再进行保存。');
    return false;
  }
  // 写入前统一展开简写，保证落盘内容与页面显示一致
  normalizeAllPatterns();

  const config = buildConfig();
  const checked = Store.validateConfig(config);
  if (checked.ok !== true) {
    setStatus('error', `${label}失败，请修正以下问题：`, checked.errors);
    markInvalid(checked.errorDetails || checked.errors);
    return false;
  }

  const result = await Store.saveConfig(config);
  if (result.ok !== true) {
    setStatus('error', `${label}失败，请修正以下问题：`, result.errors);
    markInvalid(result.errorDetails || result.errors);
    return false;
  }

  markInvalid([]);
  savedSnapshot = snapshot();
  // 保存后回到“无未保存修改”：保存 / 放弃修改 / 导出都应变回不可用
  syncDirtyState();

  const stats = await sendSync();
  const summary = stats && typeof stats.grouped === 'number'
    ? `；同步完成：归组 ${stats.grouped} 个，跳过 ${stats.skipped} 个，失败 ${stats.failed} 个`
    : '';
  setStatus('ok', `${label}成功，共 ${config.rules.length} 个规则组${summary}`);
  return true;
}

async function save() {
  if (busy) return;
  // 没有未保存修改时按钮本就是禁用态，键盘快捷键也按同样规则处理
  if (snapshot() === savedSnapshot) return;
  busy = true;
  syncDirtyState();
  try {
    await persist('保存');
  } finally {
    busy = false;
    syncDirtyState();
  }
}

// ---------------- 备份与迁移 ----------------

/**
 * 保存 / 放弃修改 / 导出的可用状态都由「当前状态 vs 已保存状态」决定：
 * 没有未保存的修改时三个按钮都不可用，避免空点；保存过程中也保持禁用防重复提交。
 */
function syncDirtyState() {
  const dirty = snapshot() !== savedSnapshot;
  els.addRule.disabled = busy;
  els.save.disabled = busy || !dirty;
  els.reload.disabled = busy || !dirty;
  syncExportState();
}

/**
 * 导出只针对**已保存**的配置：页面上有未保存修改时禁用导出按钮，并显示提示。
 * 配置页不会因为每次输入就重绘，所以由 syncDirtyState 统一驱动。
 */
function syncExportState() {
  const block = els.detail.querySelector('.global-config');
  if (!block) return;

  const blocked = snapshot() !== savedSnapshot;
  const button = block.querySelector('.export-config');
  if (button) button.disabled = blocked;
  const hint = block.querySelector('.export-blocked');
  if (hint) hint.hidden = !blocked;
}

/** 导出内容：调用前已确认没有未保存的修改，所以与存储里的配置一致。 */
function exportableConfig() {
  normalizeAllPatterns();
  return buildConfig();
}

function exportFileName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `tabpilot-config-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}

function exportToFile() {
  // 双保险：按钮已禁用，但状态可能因键盘操作变化，这里再拦一次
  if (snapshot() !== savedSnapshot) {
    setStatus('error', UNSAVED_EXPORT_HINT);
    syncExportState();
    return;
  }

  const config = exportableConfig();
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const name = exportFileName();

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  setStatus('ok', `已导出 ${config.rules.length} 个规则组到 ${name}`);
}

// 在建立快照前补齐编辑器默认值，避免渲染本身产生“未保存修改”。
function editableRule(rule) {
  return {
    ...rule,
    patterns: Array.isArray(rule.patterns) ? rule.patterns.slice() : [''],
    tabGroup: normalizeTabGroup(rule),
    highlight: Highlight.normalizeHighlight(rule),
    titleRule: TitleRule.normalizeTitleRule(rule)
  };
}

function applyConfig(config) {
  externalConfigChanged = false;
  state.groupsFirst = config.groupsFirst === true;
  state.autoUpdateGroupRules = config.autoUpdateGroupRules !== false;
  state.showActionResult = config.showActionResult !== false;
  state.customColorThemes = Store.clone(config.customColorThemes || []);
  state.colorTheme = Store.normalizeColorTheme(config.colorTheme, state.customColorThemes);
  state.clickAction = Store.normalizeClickAction(config.clickAction);
  state.language = Store.normalizeLanguage(config.language);
  setLanguage(resolveLanguage(state.language));
  applyI18n(document);
  state.globalTitle = { titleRule: TitleRule.normalizeTitleRule({ titleRule: config.globalTitleRule }) };
  state.rules = config.rules.map(editableRule);
  state.selectedId = state.rules[0] ? state.rules[0].id : GLOBAL_ID;
  persistSelected();
  closeMenus();
  renderList();
  renderDetail();
}

async function appendFromText(text, label) {
  if (busy) return;
  if (externalConfigChanged) {
    setStatus('warn', '配置已在其他窗口更新，请先放弃修改并重新读取，再进行保存。');
    return;
  }
  const parsed = Store.parseConfigText(text, { rulesOnly: true });
  if (!parsed.ok) {
    setStatus('error', t('追加导入失败，文件中的规则组不合法。'), parsed.errors);
    return;
  }
  if (!parsed.config.rules.length) {
    setStatus('info', t('文件中没有可追加的规则组。'));
    return;
  }
  const count = state.rules.length;
  const merged = appendRules(buildConfig(), parsed.config.rules, newRuleId);
  const checked = Store.validateConfig(merged);
  if (!checked.ok) {
    setStatus('error', t('追加导入失败，请先修正当前配置。'), checked.errors);
    return;
  }
  const confirmation = t('将文件中的规则组追加到末尾并保存当前配置？文件中的全局设置将被忽略，同名规则组将添加“-导入”后缀。');
  if (!window.confirm(`${confirmation}\n\n${label}`)) {
    setStatus('info', '已取消导入');
    return;
  }
  busy = true;
  syncDirtyState();
  try {
    const result = await Store.saveConfig(checked.config);
    if (!result.ok) {
      setStatus('error', t('追加导入失败，当前配置未改变。'), result.errors);
      return;
    }
    applyConfig(result.config);
    state.selectedId = state.rules[count].id;
    persistSelected();
    renderList();
    renderDetail();
    savedSnapshot = snapshot();
    const stats = await sendSync();
    if (stats) setStatus('ok', t('追加导入成功，已保存并同步。'));
    else setStatus('warn', t('追加导入已保存，但同步失败，请稍后重试。'));
  } catch (err) {
    setStatus('error', t('追加导入失败。'), [String(err)]);
  } finally {
    busy = false;
    syncDirtyState();
  }
}

async function importFromText(text, label) {
  const parsed = Store.parseConfigText(text);
  if (parsed.ok !== true) {
    setStatus('error', `导入失败：${label} 不是合法的 TabPilot 配置`, parsed.errors);
    return;
  }

  const config = parsed.config;
  const confirmed = window.confirm(
    t(`用导入的配置替换当前配置？\n\n来源：${label}\n规则组数：${config.rules.length}`)
  );
  if (!confirmed) {
    setStatus('info', '已取消导入');
    return;
  }

  applyConfig(config);
  if (busy) return;
  busy = true;
  syncDirtyState();
  try {
    await persist('导入');
  } finally {
    busy = false;
    syncDirtyState();
  }
}

function changeLanguage(preference) {
  if (preference !== 'auto' && preference !== 'zh' && preference !== 'en') return;
  // 只改内存状态并立即生效，随「保存并同步」一起落盘
  state.language = preference;
  setLanguage(resolveLanguage(preference));
  applyI18n(document);
  renderList();
  renderDetail();
  syncDirtyState();
}

async function load() {
  const { config, source, errors } = await Store.loadConfig();
  externalConfigChanged = false;

  state = {
    groupsFirst: config.groupsFirst === true,
    autoUpdateGroupRules: config.autoUpdateGroupRules !== false,
    showActionResult: config.showActionResult !== false,
    customColorThemes: Store.clone(config.customColorThemes || []),
    colorTheme: Store.normalizeColorTheme(config.colorTheme, config.customColorThemes),
    clickAction: Store.normalizeClickAction(config.clickAction),
    globalTitle: { titleRule: TitleRule.normalizeTitleRule({ titleRule: config.globalTitleRule }) },
    rules: config.rules.map(editableRule),
    selectedId: null
  };
  const remembered = loadSelected();
  state.selectedId = remembered === GLOBAL_ID || remembered === GLOBAL_TITLE_ID || state.rules.some((rule) => rule.id === remembered)
    ? remembered
    : (state.rules[0] ? state.rules[0].id : GLOBAL_ID);
  persistSelected();

  // 语言属于配置，直接取 config.language（缺省或未知值回退 auto）
  const language = Store.normalizeLanguage(config.language);
  state.language = language;
  setLanguage(resolveLanguage(language));
  applyI18n(document);

  closeMenus();
  // 先更新快照再渲染：导出按钮的可用状态取决于“当前状态 vs 已保存状态”
  savedSnapshot = snapshot();
  renderList();
  renderDetail();
  markInvalid([]);

  if (errors && errors.length > 0) {
    setStatus('warn', '存储中的配置校验失败，已回退到内置默认配置：', errors);
  } else {
    setStatus(
      'info',
      `当前配置：${source === 'storage' ? '来自 storage' : '内置默认'}，共 ${config.rules.length} 个规则组`
    );
  }
  syncDirtyState();
}

async function reset() {
  if (!window.confirm(t('删除自定义配置并恢复内置默认规则？'))) return;
  await Store.resetConfig();
  await load();
  await sendSync();
  setStatus('ok', '已恢复默认配置，并同步了已打开的标签页');
}

// ---------------- host 权限 ----------------

/**
 * 没有「访问所有网站」的 host 权限时，content script 不会注入，
 * 页面内标识和标签页改名会静默失效。权限状态变化后重绘当前详情面板：
 * 全局配置里显示授权入口，规则组详情里按开关显示红色提醒。
 */
async function syncPermissionState() {
  if (!CAN_MANAGE_HOST_PERMISSION) return;
  let granted = true;
  try {
    granted = await browser.permissions.contains(HOST_PERMISSION);
  } catch (err) {
    // 没有 permissions API 时不打扰用户
    granted = true;
  }
  if (granted === permissionGranted) return;
  permissionGranted = granted;
  renderDetail();
}

function requestHostPermission() {
  browser.permissions
    .request(HOST_PERMISSION)
    .then(async (granted) => {
      await syncPermissionState();
      setStatus(
        granted ? 'ok' : 'warn',
        granted
          ? '已获得访问网站的权限，请刷新已打开的页面让页面内标识生效'
          : '未获得访问网站的权限，页面内标识和标签页改名暂时不会生效'
      );
    })
    .catch((err) => setStatus('error', `权限请求失败：${String(err)}`));
}

function revokeHostPermission() {
  browser.permissions
    .remove(HOST_PERMISSION)
    .then(async (removed) => {
      await syncPermissionState();
      setStatus(
        removed ? 'ok' : 'warn',
        removed
          ? '已撤销访问网站的权限，页面内标识和标签页改名将停用（刷新已打开的页面后完全停止）'
          : '访问网站的权限未被撤销'
      );
    })
    .catch((err) => setStatus('error', `撤销权限失败：${String(err)}`));
}

// ---------------- 事件绑定 ----------------

els.addRule.replaceChildren(createIcon('plus'), createIcon('chevron-down', 'add-rule-chevron'));

els.save.addEventListener('click', () => {
  save().catch((err) => setStatus('error', `保存失败：${String(err)}`));
});
els.reload.addEventListener('click', () => {
  load().catch((err) => setStatus('error', `读取失败：${String(err)}`));
});
els.addRule.addEventListener('click', (event) => {
  event.stopPropagation();
  if (busy) return;
  if (els.addRuleMenu.hidden) openAddRuleMenu();
  else closeAddRuleMenu();
});
els.addBlankRule.addEventListener('click', addRule);
els.rulesFromWindow.addEventListener('click', addRulesFromWindow);
els.addRule.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!busy) openAddRuleMenu(event.key === 'ArrowUp');
  }
});
els.addRuleMenu.addEventListener('keydown', event => {
  const items = [els.addBlankRule, els.rulesFromWindow];
  const index = items.indexOf(document.activeElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeAddRuleMenu();
    els.addRule.focus();
  } else if (event.key === 'Tab') closeAddRuleMenu();
});


// 用户在浏览器设置里手动授予 / 撤销权限时同步界面提示
if (browser.permissions) {
  if (browser.permissions.onAdded) browser.permissions.onAdded.addListener(syncPermissionState);
  if (browser.permissions.onRemoved) browser.permissions.onRemoved.addListener(syncPermissionState);
}

// 快捷重命名可能在设置页之外写入配置，避免旧编辑状态覆盖新规则。
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[Store.CONFIG_KEY] || busy) return;
  if (snapshot() === savedSnapshot) {
    load().catch(err => setStatus('error', `读取失败：${String(err)}`));
  } else {
    externalConfigChanged = true;
    setStatus('warn', '配置已在其他窗口更新，请先放弃修改并重新读取，再进行保存。');
  }
});

// 任意输入变化后由冒泡阶段统一更新按钮状态。
document.addEventListener('input', syncDirtyState);
document.addEventListener('change', syncDirtyState);


// 点空白处或按 Esc 收起菜单和颜色面板
document.addEventListener('click', event => {
  if (!event.target.closest('.group-menu, .menu-toggle')) closeMenus();
  if (!els.addRuleMenu.contains(event.target) && !els.addRule.contains(event.target)) closeAddRuleMenu();
  if (closeColorMenu) closeColorMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenus();
    if (closeColorMenu) closeColorMenu();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (snapshot() !== savedSnapshot) {
    event.preventDefault();
    event.returnValue = '';
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save().catch((err) => setStatus('error', `保存失败：${String(err)}`));
  }
});

els.version.textContent = `v${packageInfo.version}`;
load()
  .then(() => syncPermissionState())
  .catch((err) => setStatus('error', `读取配置失败：${String(err)}`));
