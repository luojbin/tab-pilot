/**
 * TabPilot 配置页逻辑（两栏：左侧分组列表 + 右侧分组详情）
 *
 * 左侧只负责「选哪个分组、叫什么、什么颜色、是否启用」以及排序/删除；
 * 右侧负责选中分组的详细配置（匹配路径、阈值、折叠、备注），
 * 也为后续的标签页重命名、页面内高亮预留了位置。
 */
(function () {
  'use strict';

  const Store = globalThis.TabPilotStore;
  const Rules = globalThis.TabPilotRules;
  const Highlight = globalThis.TabPilotHighlight;

  const els = {
    list: document.getElementById('groupList'),
    detail: document.getElementById('detail'),
    status: document.getElementById('status'),
    version: document.getElementById('version'),
    globalEnabled: document.getElementById('globalEnabled'),
    save: document.getElementById('save'),
    reload: document.getElementById('reload'),
    reset: document.getElementById('reset'),
    addRule: document.getElementById('addRule'),
    exportFile: document.getElementById('exportFile'),
    importFile: document.getElementById('importFile'),
    importInput: document.getElementById('importInput')
  };

  if (!Store || !Rules || !Highlight) {
    els.status.className = 'status error';
    els.status.textContent = 'store.js / rules.js / highlight.js 未加载，无法读写配置。';
    return;
  }

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

  let state = { globalEnabled: true, rules: [], selectedId: null };
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

  function renderList() {
    els.list.textContent = '';

    if (state.rules.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '还没有分组，点右上角 ＋ 添加。';
      els.list.appendChild(empty);
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
      name.textContent = rule.name || '未命名分组';
      name.title = rule.name || '未命名分组';

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
  }

  function selectRule(id) {
    if (state.selectedId === id) return;
    state.selectedId = id;
    persistSelected();
    for (const item of els.list.querySelectorAll('.group-item')) {
      item.classList.toggle('selected', item.dataset.id === id);
    }
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
      name.textContent = rule.name || '未命名分组';
      name.title = rule.name || '未命名分组';
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
      patterns: ['*://*/*']
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
      state.selectedId = next ? next.id : null;
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
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = state.rules.length === 0
        ? '左侧还没有分组。点「＋」新建一个分组，再把要匹配的地址填进来。'
        : '从左侧选择一个分组，查看并编辑它的详细配置。';
      els.detail.appendChild(empty);
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
      input.placeholder = '192.168.3.213 或 *://localhost:*/*';
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
    tabTitleBody.append(futureRow('标签页重命名'));
    const tabTitleHint = document.createElement('p');
    tabTitleHint.className = 'hint small';
    tabTitleHint.textContent =
      '后续可按分组规则改写标签页标题（实验功能，页面导航后可能失效），当前仅占位。';
    tabTitleBody.append(tabTitleHint);

    // 折叠时的状态提示：页面内突出显示用只读拨杆，标签页名规则用「规划中」徽标
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
    tabTitleStatus.className = 'badge';
    tabTitleStatus.textContent = '规划中';

    const highlightSection = createSection('highlight', '页面内突出显示', highlightBody, {
      defaultOpen: false,
      status: highlightStatus
    });
    const highlightToggle = highlightSection.querySelector('.field-highlight');
    if (highlightToggle) {
      highlightToggle.addEventListener('change', syncHighlightStatus);
    }

    els.detail.append(
      head,
      createSection('basic', '基础配置', basicBody, { defaultOpen: true }),
      highlightSection,
      createSection('tabTitle', '标签页名规则', tabTitleBody, {
        defaultOpen: false,
        status: tabTitleStatus
      })
    );
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
      const found = /^rules\[(\d+)\]/.exec(String(error));
      if (found) indexes.add(Number(found[1]));
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

  /** 导出的是页面当前内容（含尚未保存的编辑）。 */
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
    els.globalEnabled.checked = state.globalEnabled;
    state.selectedId = state.rules[0] ? state.rules[0].id : null;
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
      `用导入的配置替换当前配置？\n\n来源：${label}\n分组数：${config.rules.length}`
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

  async function load() {
    const { config, source, errors, migrated } = await Store.loadConfig();

    state = {
      globalEnabled: config.globalEnabled !== false,
      rules: config.rules.map((rule) => ({
        ...rule,
        patterns: Array.isArray(rule.patterns) ? rule.patterns.slice() : ['']
      })),
      selectedId: null
    };
    els.globalEnabled.checked = state.globalEnabled;

    const remembered = loadSelected();
    state.selectedId = state.rules.some((rule) => rule.id === remembered)
      ? remembered
      : (state.rules[0] ? state.rules[0].id : null);
    persistSelected();

    closeMenus();
    renderList();
    renderDetail();
    savedSnapshot = snapshot();
    markInvalid([]);

    if (errors && errors.length > 0) {
      setStatus('warn', '存储中的配置校验失败，已回退到内置默认配置：', errors);
    } else if (migrated) {
      setStatus('warn', '检测到旧格式（v1）配置，已自动升级为新结构，请确认后保存。');
    } else {
      setStatus(
        'info',
        `当前配置：${source === 'storage' ? '来自 storage' : '内置默认'}，共 ${config.rules.length} 个分组`
      );
    }
  }

  async function reset() {
    if (!window.confirm('删除自定义配置并恢复内置默认规则？')) return;
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
  els.reset.addEventListener('click', () => {
    reset().catch((err) => setStatus('error', `恢复默认失败：${String(err)}`));
  });
  els.addRule.addEventListener('click', addRule);
  els.globalEnabled.addEventListener('change', () => {
    state.globalEnabled = els.globalEnabled.checked;
  });

  els.exportFile.addEventListener('click', () => {
    exportToFile();
  });
  els.importFile.addEventListener('click', () => {
    els.importInput.click();
  });
  els.importInput.addEventListener('change', () => {
    const file = els.importInput.files && els.importInput.files[0];
    els.importInput.value = '';
    if (!file) return;
    file
      .text()
      .then((text) => importFromText(text, file.name))
      .catch((err) => setStatus('error', `读取文件失败：${String(err)}`));
  });

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
  load().catch((err) => setStatus('error', `读取配置失败：${String(err)}`));
})();
