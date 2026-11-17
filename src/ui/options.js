import browser from '../platform/browser.js';
import * as Store from '../app/store.js';
import * as Rules from '../core/rules.js';
import * as Highlight from '../core/highlight.js';
import * as TitleRule from '../core/title-rule.js';
import {
  applyI18n,
  resolveLanguage,
  setLanguage,
  t,
  LANGUAGE_KEY
} from './i18n.js';

/**
 * TabPilot 配置页逻辑（两栏：左侧分组列表 + 右侧分组详情）
 *
 * 左侧只负责「选哪个分组、叫什么、什么颜色、是否启用」以及排序/删除；
 * 右侧负责选中分组的详细配置（匹配路径、阈值、折叠、备注），
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
  addRule: document.getElementById('addRule')
};

const COLOR_HEX = {
  grey: '#9aa0a6',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#1e8e3e',
  pink: '#d01884',
  purple: '#9334e6',
  cyan: '#007b83',
  orange: '#e8710a'
};

const COLOR_LABEL = {
  grey: '灰',
  blue: '蓝',
  red: '红',
  yellow: '黄',
  green: '绿',
  pink: '粉',
  purple: '紫',
  cyan: '青',
  orange: '橙'
};

const SELECTED_KEY = 'tabpilot:selected-rule-id';
const GLOBAL_ID = '__global__';
/** 有未保存修改时禁止导出，提示文案在按钮提示与状态栏共用。 */
const UNSAVED_EXPORT_HINT = '有未保存的修改，请先「保存并同步」或「放弃修改」再导出。';

let state = { globalEnabled: true, rules: [], selectedId: null };
let languagePreference = 'auto';
let savedSnapshot = '';
let busy = false;
let previewRefresh = null;
const openMenus = new Set();

function newRuleId() {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function colorHex(color) {
  return COLOR_HEX[color] || COLOR_HEX.grey;
}

function snapshot() {
  return JSON.stringify({ globalEnabled: state.globalEnabled, rules: state.rules });
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

// ---------------- 左侧：分组列表 ----------------

function menuButton(label, onClick, disabled, extraClass) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  if (extraClass) element.classList.add(extraClass);
  element.disabled = Boolean(disabled);
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

function createGlobalListItem() {
  const item = document.createElement('li');
  item.className = 'group-item global-item';
  if (state.selectedId === GLOBAL_ID) item.classList.add('selected');

  const row = document.createElement('div');
  row.className = 'group-row';

  const name = document.createElement('span');
  name.className = 'group-name';
  name.textContent = t('全局配置');

  const track = document.createElement('span');
  track.className = 'switch-ui';
  track.setAttribute('aria-hidden', 'true');
  if (state.globalEnabled) track.classList.add('on');
  track.title = state.globalEnabled ? '已启用（在右侧停用）' : '已停用（在右侧启用）';

  row.append(name, track);
  item.append(row);
  item.addEventListener('click', selectGlobal);
  return item;
}

function selectGlobal() {
  if (state.selectedId === GLOBAL_ID) return;
  state.selectedId = GLOBAL_ID;
  persistSelected();
  closeMenus();
  renderList();
  renderDetail();
}

function renderList() {
  els.globalList.textContent = '';
  els.globalList.appendChild(createGlobalListItem());
  applyI18n(els.globalList);

  els.list.textContent = '';

  if (state.rules.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '还没有分组，点右上角 ＋ 添加。';
    els.list.appendChild(empty);
    applyI18n(els.list);
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

    // 左栏只做展示与选中：名称、颜色、启用状态都只读
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = colorHex(rule.color);

    const name = document.createElement('span');
    name.className = 'group-name';
    name.setAttribute('data-i18n-skip', '');
    name.textContent = rule.name || t('未命名分组');
    name.title = rule.name || t('未命名分组');

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
    menuToggle.className = 'menu-toggle';
    menuToggle.textContent = '⋯';
    menuToggle.title = '调整顺序或删除';
    menuToggle.setAttribute('aria-label', '分组操作菜单');
    menuToggle.setAttribute('aria-expanded', String(openMenus.has(rule.id)));
    menuToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu(rule.id);
    });

    row.append(swatch, name, stateSwitch, menuToggle);

    const menu = document.createElement('div');
    menu.className = 'group-menu';
    menu.hidden = !openMenus.has(rule.id);
    menu.append(
      menuButton('↑ 上移', () => moveRule(rule.id, -1), index === 0),
      menuButton('↓ 下移', () => moveRule(rule.id, 1), index === state.rules.length - 1),
      menuButton('✕ 删除', () => removeRule(rule.id), false, 'delete')
    );

    item.addEventListener('click', () => selectRule(rule.id));

    item.append(row, menu);
    els.list.appendChild(item);
  });
  applyI18n(els.list);
}

/**
 * 左栏选中态：全局配置条目与分组条目互斥。
 * 点分组时只改类、不重建列表（保住 ⋯ 菜单状态），所以两块列表都要手动同步。
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
    name.textContent = rule.name || t('未命名分组');
    name.title = rule.name || t('未命名分组');
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
  openMenus.clear();
  for (const item of els.list.querySelectorAll('.group-item')) {
    const menu = item.querySelector('.group-menu');
    if (menu) menu.hidden = true;
    const toggle = item.querySelector('.menu-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
}

function toggleMenu(id) {
  if (openMenus.has(id)) openMenus.delete(id);
  else {
    openMenus.clear();
    openMenus.add(id);
  }
  for (const item of els.list.querySelectorAll('.group-item')) {
    const open = openMenus.has(item.dataset.id);
    const menu = item.querySelector('.group-menu');
    if (menu) menu.hidden = !open;
    const toggle = item.querySelector('.menu-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }
}

function addRule() {
  const rule = {
    id: newRuleId(),
    enabled: true,
    name: `新分组 ${state.rules.length + 1}`,
    color: Store.colorForIndex(state.rules.length),
    collapsed: false,
    minTabs: 1,
    note: '',
    patterns: ['']
  };
  state.rules.push(rule);
  state.selectedId = rule.id;
  persistSelected();
  closeMenus();
  renderList();
  renderDetail();

  const nameInput = els.list.querySelector('.group-item.selected .group-name');
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
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

// ---------------- 右栏：分组详情 ----------------

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

  const chevron = document.createElement('span');
  chevron.className = 'section-chevron';
  chevron.textContent = '▾';

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

function ensureTitleRule(rule) {
  rule.titleRule = TitleRule.normalizeTitleRule(rule);
  return rule.titleRule;
}

function titleField(labelText, className, value, placeholder, onInput) {
  const label = document.createElement('label');
  label.className = 'field';
  label.append(document.createTextNode(labelText));

  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener('input', () => onInput(input.value));

  label.append(input);
  return label;
}

function createTitleRuleCard(rule, spec, entry, index) {
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

  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'title-rule-move';
  up.textContent = '↑';
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
  down.className = 'title-rule-move';
  down.textContent = '↓';
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
  remove.className = 'title-rule-remove';
  remove.textContent = '✕';
  remove.title = '删除这条命名规则';
  remove.addEventListener('click', () => {
    spec.rules.splice(index, 1);
    rule.titleRule = spec;
    renderDetail();
  });

  head.append(order, description, up, down, remove);

  const patternField = titleField(
    '源文本（正则表达式）',
    'title-rule-pattern',
    entry.pattern,
    '^\\[(.*?)\\]\\s*(.*)$',
    (value) => {
      entry.pattern = value;
      rule.titleRule = spec;
    }
  );

  const replacementField = titleField(
    '目标文本（可用 $1/$2 引用匹配组）',
    'title-rule-replacement',
    entry.replacement,
    '$2 · $1',
    (value) => {
      entry.replacement = value;
      rule.titleRule = spec;
    }
  );

  card.append(head, patternField, replacementField);
  return card;
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

  const hint = document.createElement('p');
  hint.className = 'hint small';
  hint.textContent =
    '按从上到下的顺序匹配，命中第一条就停止；只替换第一个匹配。目标文本可用 $1/$2、$<name>、$&、$$；需要加前缀的话直接写在目标文本里，例如 "W· $1"。';

  const list = document.createElement('div');
  list.className = 'title-rule-list';
  spec.rules.forEach((entry, index) => {
    list.append(createTitleRuleCard(rule, spec, entry, index));
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
  addButton.textContent = '＋ 添加命名规则';
  addButton.addEventListener('click', () => {
    spec.rules.push({ pattern: '', replacement: '', description: '' });
    rule.titleRule = spec;
    renderDetail();
  });

  const testBox = document.createElement('div');
  testBox.className = 'title-test';
  const testLabel = document.createElement('label');
  testLabel.className = 'field';
  testLabel.append(document.createTextNode('测试文本（每行一个标题）'));
  const testInput = document.createElement('textarea');
  testInput.className = 'title-test-input';
  testInput.rows = 4;
  testInput.value = spec.testText;
  testInput.placeholder =
    '[工作] Jira - 看板\n[代码] GitHub - Pull requests\n普通页面标题';
  testInput.addEventListener('input', () => {
    spec.testText = testInput.value;
    rule.titleRule = spec;
  });
  testLabel.append(testInput);

  const testButton = document.createElement('button');
  testButton.type = 'button';
  testButton.className = 'title-test-run';
  testButton.textContent = '查看效果';

  const testOutput = document.createElement('div');
  testOutput.className = 'title-test-output';

  testButton.addEventListener('click', () => {
    const candidate = { enabled: true, rules: spec.rules, testText: spec.testText };
    const rows = TitleRule.applyTitleBatch({ titleRule: candidate }, testInput.value);

    testOutput.textContent = '';
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint small';
      empty.textContent = '测试文本为空，先输入几行标题。';
      testOutput.append(empty);
      return;
    }

    rows.forEach((row) => {
      const line = document.createElement('div');
      line.className = 'title-test-line';

      const source = document.createElement('span');
      source.className = 'title-test-src';
      source.setAttribute('data-i18n-skip', '');
      source.textContent = row.source;

      const arrow = document.createElement('span');
      arrow.className = 'title-test-arrow';
      arrow.textContent = '→';

      const target = document.createElement('span');
      target.className = 'title-test-dst';

      if (row.matched) {
        target.setAttribute('data-i18n-skip', '');
        target.textContent = row.result;
      } else if (row.reason === 'invalid-regex') {
        target.classList.add('warn');
        target.textContent = '正则有误，未应用';
      } else {
        target.classList.add('warn');
        target.textContent = '未匹配，保持原样';
      }

      line.append(source, arrow, target);
      testOutput.append(line);
    });
  });

  testBox.append(testLabel, testButton, testOutput);

  /** 规则没启用时把整块配置置灰禁用，省得配了半天不生效。 */
  function syncEnabledState() {
    const disabled = !spec.enabled;
    section.classList.toggle('disabled', disabled);
    section.querySelectorAll('input, button, textarea').forEach((element) => {
      if (element === toggleInput) return;
      element.disabled = disabled;
    });
  }

  toggleInput.addEventListener('change', () => {
    spec.enabled = toggleInput.checked;
    rule.titleRule = spec;
    syncEnabledState();
  });

  syncEnabledState();

  section.append(toggleLabel, hint, list, addButton, testBox);
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
    const color = Store.colorHexOf(rule);

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
  toggleLabel.append(document.createTextNode('在该分组的页面上显示标识'));
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

  const body = document.createElement('div');
  body.className = 'highlight-body';
  body.classList.toggle('disabled', !spec.enabled);

  toggleInput.addEventListener('change', () => {
    spec.enabled = toggleInput.checked;
    commit();
    body.classList.toggle('disabled', !spec.enabled);
  });

  // 边框
  const borderBlock = document.createElement('div');
  borderBlock.className = 'highlight-block';
  const borderLabel = document.createElement('span');
  borderLabel.className = 'block-label';
  borderLabel.textContent = '边框（颜色取自该分组）';
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
  bannerLabel.textContent = 'Banner（显示分组名，四个角为斜向）';
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
  section.append(preview.box, toggleLabel, body);
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
  button.setAttribute('aria-label', '分组颜色');

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = colorHex(rule.color);
  const label = document.createElement('span');
  label.className = 'color-name';
  label.textContent = COLOR_LABEL[rule.color] || COLOR_LABEL.grey;
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▾';
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
    text.textContent = COLOR_LABEL[value] || value;
    option.append(dot, text);

    option.addEventListener('click', (event) => {
      event.stopPropagation();
      rule.color = value;
      swatch.style.background = colorHex(value);
      label.textContent = COLOR_LABEL[value] || value;
      for (const item of menu.querySelectorAll('.color-option')) {
        item.setAttribute('aria-selected', String(item === option));
      }
      updateListItem(rule);
      close();
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
    if (state.selectedId === GLOBAL_ID) {
      renderGlobalDetail();
      return;
    }
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.rules.length === 0
      ? '左侧还没有分组。点「＋」新建一个分组，再把要匹配的地址填进来。'
      : '从左侧选择一个分组，查看并编辑它的详细配置。';
    els.detail.appendChild(empty);
    applyI18n(els.detail);
    return;
  }

  const index = state.rules.indexOf(rule);

  const head = document.createElement('div');
  head.className = 'detail-head';
  const title = document.createElement('h2');
  title.textContent = '分组详情';
  const meta = document.createElement('span');
  meta.className = 'muted';
  meta.textContent = `第 ${index + 1} 个 · 顺序即优先级`;
  head.append(title, meta);

  // 第一行：分组名 + 颜色 + 阈值
  const firstRow = document.createElement('div');
  firstRow.className = 'detail-row';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'field field-name';
  nameLabel.append(document.createTextNode('分组名'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'field-name-input';
  nameInput.value = rule.name || '';
  nameInput.placeholder = '例如「开发」';
  nameInput.setAttribute('aria-label', '分组名');
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
  thresholdLabel.append(document.createTextNode('阈值'));
  const threshold = document.createElement('input');
  threshold.type = 'number';
  threshold.className = 'min-tabs';
  threshold.min = '1';
  threshold.step = '1';
  threshold.value = String(rule.minTabs == null ? 1 : rule.minTabs);
  threshold.title = '同一窗口内命中该分组的标签数达到该值才归组（1 = 立刻归组）';
  threshold.setAttribute('aria-label', '分组阈值');
  threshold.addEventListener('input', () => {
    rule.minTabs = Number(threshold.value);
  });
  thresholdLabel.append(threshold);

  firstRow.append(nameLabel, colorLabel, thresholdLabel);

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

  // 启用 / 命中后折叠：文字在上、拨杆在下，与第一行其他字段同一套排布
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'field field-switch';
  enabledLabel.append(document.createTextNode('启用'));
  const enabledSlot = document.createElement('span');
  enabledSlot.className = 'switch-slot';
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledInput.className = 'field-enabled';
  enabledInput.checked = rule.enabled !== false;
  enabledInput.setAttribute('aria-label', '启用该分组');
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
  collapsedLabel.append(document.createTextNode('命中后折叠'));
  const collapsedSlot = document.createElement('span');
  collapsedSlot.className = 'switch-slot';
  const collapsedInput = document.createElement('input');
  collapsedInput.type = 'checkbox';
  collapsedInput.className = 'field-collapsed';
  collapsedInput.checked = rule.collapsed === true;
  collapsedInput.setAttribute('aria-label', '命中后折叠该分组');
  const collapsedSwitch = document.createElement('span');
  collapsedSwitch.className = 'switch-ui';
  collapsedSwitch.setAttribute('aria-hidden', 'true');
  collapsedInput.addEventListener('change', () => {
    rule.collapsed = collapsedInput.checked;
  });
  collapsedSlot.append(collapsedInput, collapsedSwitch);
  collapsedLabel.append(collapsedSlot);

  firstRow.append(enabledLabel, collapsedLabel);

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
    remove.className = 'icon';
    remove.textContent = '✕';
    remove.title = values.length === 1 ? '每条规则至少保留一条匹配路径' : '删除这条匹配路径';
    remove.disabled = values.length === 1;
    remove.addEventListener('click', () => removePattern(rule, patternIndex));

    row.append(input, remove);
    patterns.appendChild(row);
  });

  const addPattern = document.createElement('button');
  addPattern.type = 'button';
  addPattern.className = 'add-pattern';
  addPattern.textContent = '＋ 添加匹配路径';
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

  // 折叠时的状态提示：两个区块都用只读拨杆表示启停
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
    highlightSection,
    tabTitleSection
  );
  applyI18n(els.detail);
}

function renderGlobalDetail() {
  els.detail.textContent = '';

  const head = document.createElement('div');
  head.className = 'detail-head';
  const title = document.createElement('h2');
  title.textContent = '全局配置';
  head.append(title);

  const body = document.createElement('div');
  const firstRow = document.createElement('div');
  firstRow.className = 'detail-row global-first-row';

  // 全局开关
  const switchField = document.createElement('label');
  switchField.className = 'field field-switch';
  switchField.append(document.createTextNode('全局开关'));
  const switchSlot = document.createElement('span');
  switchSlot.className = 'switch-slot';
  const switchInput = document.createElement('input');
  switchInput.type = 'checkbox';
  switchInput.checked = state.globalEnabled;
  switchInput.setAttribute('aria-label', t('全局开关'));
  const switchTrack = document.createElement('span');
  switchTrack.className = 'switch-ui';
  // 外观交给 CSS 的 `input:checked + .switch-ui`，不要再挂静态 .on：
  // .on 一旦写死在初始状态上就不会随点击移除，关闭时拨杆会一直停在启用色。
  switchInput.addEventListener('change', () => {
    state.globalEnabled = switchInput.checked;
    renderList();
    // 全局开关也是配置的一部分：改动后导出应立即变为不可用
    syncExportState();
  });
  switchSlot.append(switchInput, switchTrack);
  switchField.append(switchSlot);

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
  languageSelect.value = languagePreference;
  languageSelect.addEventListener('change', () => changeLanguage(languageSelect.value));
  languageField.append(languageSelect);
  firstRow.append(switchField, languageField);
  body.append(firstRow);

  // 配置管理
  const configBlock = document.createElement('div');
  configBlock.className = 'fieldset global-config';
  const configTitle = document.createElement('h3');
  configTitle.textContent = '配置管理';
  const configHint = document.createElement('p');
  configHint.className = 'hint small';
  configHint.textContent = '导出已保存的配置，或从 JSON 文件导入并替换配置。';
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

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    file
      .text()
      .then((value) => importFromText(value, file.name))
      .catch((err) => setStatus('error', `读取文件失败：${String(err)}`));
  });
  importButton.addEventListener('click', () => fileInput.click());

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = '恢复默认';
  resetButton.title = '删除已保存的配置，回到内置默认规则';
  resetButton.addEventListener('click', () => {
    reset().catch((err) => setStatus('error', `恢复默认失败：${String(err)}`));
  });

  actions.append(exportButton, importButton, resetButton, fileInput);

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

  const section = createSection('global', '全局选项', body, { defaultOpen: true });
  els.detail.append(head, section);
  applyI18n(els.detail);
  syncExportState();
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
  return Store.buildConfigFromRules(state.globalEnabled, state.rules);
}

// ---------------- 保存 / 载入 ----------------

function markInvalid(errors) {
  for (const item of els.list.querySelectorAll('.group-item')) {
    item.classList.remove('invalid');
  }
  if (!Array.isArray(errors)) return;

  const indexes = new Set();
  for (const error of errors) {
    // 一条错误可能同时点名两个分组（例如重名：`rules[1].name 重复：…（与 rules[0] 同名）`），
    // 把这些分组都高亮出来。
    for (const found of String(error).matchAll(/rules\[(\d+)\]/g)) {
      indexes.add(Number(found[1]));
    }
  }
  if (indexes.size === 0) return;

  const firstIndex = Math.min(...indexes);
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
  // 写入前统一展开简写，保证落盘内容与页面显示一致
  normalizeAllPatterns();

  const config = buildConfig();
  const checked = Store.validateConfig(config);
  if (checked.ok !== true) {
    setStatus('error', `${label}失败，请修正以下问题：`, checked.errors);
    markInvalid(checked.errors);
    return false;
  }

  const result = await Store.saveConfig(config);
  if (result.ok !== true) {
    setStatus('error', `${label}失败，请修正以下问题：`, result.errors);
    markInvalid(result.errors);
    return false;
  }

  markInvalid([]);
  savedSnapshot = snapshot();
  // 保存后回到“无未保存修改”，导出按钮应恢复可用
  syncExportState();
  const stats = await sendSync();
  const summary = stats && typeof stats.grouped === 'number'
    ? `；同步完成：归组 ${stats.grouped} 个，跳过 ${stats.skipped} 个，失败 ${stats.failed} 个`
    : '';
  setStatus('ok', `${label}成功，共 ${config.rules.length} 个分组${summary}`);
  return true;
}

async function save() {
  if (busy) return;
  busy = true;
  els.save.disabled = true;
  try {
    await persist('保存');
  } finally {
    busy = false;
    els.save.disabled = false;
  }
}

// ---------------- 备份与迁移 ----------------

/**
 * 导出只针对**已保存**的配置：页面上有未保存修改时禁用导出按钮，并显示提示。
 * 配置页不会因为每次输入就重绘，所以在渲染全局面板、切全局开关、保存成功后主动同步状态。
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

  setStatus('ok', `已导出 ${config.rules.length} 个分组到 ${name}`);
}

function applyConfig(config) {
  state.globalEnabled = config.globalEnabled !== false;
  state.rules = config.rules.map((rule) => ({
    ...rule,
    patterns: Array.isArray(rule.patterns) ? rule.patterns.slice() : ['']
  }));
  state.selectedId = state.rules[0] ? state.rules[0].id : GLOBAL_ID;
  persistSelected();
  closeMenus();
  renderList();
  renderDetail();
}

async function importFromText(text, label) {
  const parsed = Store.parseConfigText(text);
  if (parsed.ok !== true) {
    setStatus('error', `导入失败：${label} 不是合法的 TabPilot 配置`, parsed.errors);
    return;
  }

  const config = parsed.config;
  const confirmed = window.confirm(
    t(`用导入的配置替换当前配置？\n\n来源：${label}\n分组数：${config.rules.length}`)
  );
  if (!confirmed) {
    setStatus('info', '已取消导入');
    return;
  }

  applyConfig(config);
  if (busy) return;
  busy = true;
  els.save.disabled = true;
  try {
    await persist('导入');
  } finally {
    busy = false;
    els.save.disabled = false;
  }
}

async function initLanguage() {
  let preference = 'auto';
  try {
    const stored = await browser.storage.local.get(LANGUAGE_KEY);
    const value = stored && stored[LANGUAGE_KEY];
    if (value === 'auto' || value === 'zh' || value === 'en') preference = value;
  } catch (err) {
    // 读取失败时按系统语言显示
  }

  languagePreference = preference;
  setLanguage(resolveLanguage(preference));
  applyI18n(document);
}

function changeLanguage(preference) {
  if (preference !== 'auto' && preference !== 'zh' && preference !== 'en') return;
  languagePreference = preference;
  setLanguage(resolveLanguage(preference));
  browser.storage.local
    .set({ [LANGUAGE_KEY]: preference })
    .catch((err) => setStatus('warn', String(err)));
  applyI18n(document);
  renderList();
  renderDetail();
}

async function load() {
  const { config, source, errors } = await Store.loadConfig();

  state = {
    globalEnabled: config.globalEnabled !== false,
    rules: config.rules.map((rule) => ({
      ...rule,
      patterns: Array.isArray(rule.patterns) ? rule.patterns.slice() : ['']
    })),
    selectedId: null
  };
  const remembered = loadSelected();
  state.selectedId = remembered === GLOBAL_ID || state.rules.some((rule) => rule.id === remembered)
    ? remembered
    : (state.rules[0] ? state.rules[0].id : GLOBAL_ID);
  persistSelected();

  closeMenus();
  renderList();
  renderDetail();
  savedSnapshot = snapshot();
  markInvalid([]);

  if (errors && errors.length > 0) {
    setStatus('warn', '存储中的配置校验失败，已回退到内置默认配置：', errors);
  } else {
    setStatus(
      'info',
      `当前配置：${source === 'storage' ? '来自 storage' : '内置默认'}，共 ${config.rules.length} 个分组`
    );
  }
}

async function reset() {
  if (!window.confirm(t('删除自定义配置并恢复内置默认规则？'))) return;
  await Store.resetConfig();
  await load();
  await sendSync();
  setStatus('ok', '已恢复默认配置，并同步了已打开的标签页');
}

// ---------------- 事件绑定 ----------------

els.save.addEventListener('click', () => {
  save().catch((err) => setStatus('error', `保存失败：${String(err)}`));
});
els.reload.addEventListener('click', () => {
  load().catch((err) => setStatus('error', `读取失败：${String(err)}`));
});
els.addRule.addEventListener('click', addRule);


// 点空白处或按 Esc 收起颜色面板
document.addEventListener('click', () => {
  if (closeColorMenu) closeColorMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && closeColorMenu) closeColorMenu();
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

els.version.textContent = `v${browser.runtime.getManifest().version}`;
initLanguage()
  .then(() => load())
  .catch((err) => setStatus('error', `读取配置失败：${String(err)}`));
