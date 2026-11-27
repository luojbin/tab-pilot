/**
 * background 编排层测试
 *
 * 用一个极简 browser 桩模拟浏览器环境，验证“事件 → 防抖合并 → 读配置 →
 * 匹配 → 执行动作 → 记日志”这条链路，以及幂等、同步与配置回退行为。
 * 真实 tabGroups API 的形态已在 Firefox 实机验证。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// 先安装 browser 桩，再动态导入后台及其依赖。

const state = {
  tabsByWindow: {},
  existingGroups: [],
  storedConfig: null,
  groupCalls: [],
  updateCalls: [],
  ungroupCalls: [],
  moveCalls: [],
  pageMessages: []
};

const listeners = { created: [], updated: [], actionClicked: [], message: [], configChanged: [], groupCreated: [], groupUpdated: [], groupRemoved: [], groupMoved: [], moved: [], activated: [] };

/** 按浏览器消息协议调用监听器：支持 sendResponse + return true 的异步回复。 */
function sendMessage(message, sender) {
  return new Promise((resolve) => {
    const returned = listeners.message[0](message, sender, resolve);
    if (returned !== true) resolve(returned);
  });
}

globalThis.browser = {
  storage: {
    local: {
      async get() {
        return state.storedConfig ? { 'tabpilot:config': state.storedConfig } : {};
      },
      async set(data) {
        if (data['tabpilot:config']) state.storedConfig = data['tabpilot:config'];
      },
      async remove() {
        state.storedConfig = null;
      }
    },
    onChanged: { addListener(fn) { listeners.configChanged.push(fn); } }
  },
  tabs: {
    async get(id) { return { ...Object.values(state.tabsByWindow).flat().find(tab => tab.id === id) }; },
    async ungroup(id) { state.ungroupCalls.push(id); },
    async move(ids, options) { state.moveCalls.push({ ids, ...options }); return ids.map(id => ({ id })); },
    async query(queryInfo) {
      const info = queryInfo || {};
      const tabs = info.windowId === undefined
        ? Object.keys(state.tabsByWindow).flatMap((key) => state.tabsByWindow[key])
        : (state.tabsByWindow[info.windowId] || []);
      if (info.active === true) return tabs.filter((tab) => tab.active === true);
      return tabs;
    },
    async group(options) {
      state.groupCalls.push(options);
      return options.createProperties ? 42 : options.groupId;
    },
    onMoved: { addListener(fn) { listeners.moved.push(fn); } },
    onActivated: { addListener(fn) { listeners.activated.push(fn); } },
    onCreated: { addListener(fn) { listeners.created.push(fn); } },
    onUpdated: { addListener(fn) { listeners.updated.push(fn); } },
    async sendMessage(tabId, message) {
      state.pageMessages.push({ tabId, message });
    }
  },
  tabGroups: {
    onCreated: { addListener(fn) { listeners.groupCreated.push(fn); } },
    onUpdated: { addListener(fn) { listeners.groupUpdated.push(fn); } },
    onRemoved: { addListener(fn) { listeners.groupRemoved.push(fn); } },
    onMoved: { addListener(fn) { listeners.groupMoved.push(fn); } },
    async get(id) { return state.existingGroups.find(group => group.id === id); },
    async move(groupId, options) { state.moveCalls.push({ groupId, ...options }); return { id: groupId }; },
    async query(queryInfo) {
      const info = queryInfo || {};
      if (info.windowId === undefined) return state.existingGroups;
      return state.existingGroups.filter(
        (group) => group.windowId === undefined || group.windowId === info.windowId
      );
    },
    async update(id, patch) {
      state.updateCalls.push({ id, patch });
    }
  },
  action: {
    onClicked: { addListener(fn) { listeners.actionClicked.push(fn); } }
  },
  runtime: {
    getURL(path) { return `moz-extension://test/${path}`; },
    getManifest() {
      return { version: '0.2.0' };
    },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(fn) { listeners.message.push(fn); } }
  }
};

const Background = await import('../src/app/background.js');
const { Debug } = Background;
const Logger = await import('../src/core/logger.js');

function reset() {
  state.tabsByWindow = {};
  state.existingGroups = [];
  state.storedConfig = null;
  state.groupCalls = [];
  state.updateCalls = [];
  state.pageMessages = [];
  state.moveCalls = [];
  state.ungroupCalls = [];
  Logger.clear();
}

function rule(overrides) {
  const source = {
    id: 'dev-localhost',
    enabled: true,
    name: '开发',
    color: 'green',
    collapsed: false,
    minTabs: 1,
    note: '',
    patterns: ['*://localhost:*/*'],
    ...(overrides || {})
  };
  const { minTabs, collapsed, strictMode, ...rest } = source;
  return { ...rest, tabGroup: { enabled: true, minTabs, collapsed,
    ...(strictMode === undefined ? {} : { strictMode }), ...source.tabGroup } };
}

function configWith(rules, globalEnabled) {
  return {
    schemaVersion: 1,
    globalEnabled: globalEnabled !== false,
    rules
  };
}

function githubConfig(minTabs) {
  return configWith([
    rule({
      id: 'code-github',
      name: '代码',
      color: 'blue',
      minTabs,
      patterns: ['*://*.github.com/*']
    })
  ]);
}

function localhostTab(id, windowId, url) {
  return {
    id,
    windowId,
    url: url || `http://localhost:${3000 + id}/`,
    groupId: -1
  };
}

test('background 注册事件与消息监听，工具栏由 popup 驱动', () => {
  assert.equal(listeners.created.length, 1);
  assert.equal(listeners.updated.length, 1);
  assert.equal(listeners.actionClicked.length, 0);
  assert.equal(listeners.message.length, 1);
});

test('自定义主题保存重读后，后台页面标识使用自定义颜色', async () => {
  reset();
  const store = await import('../src/app/store.js');
  const themes = [{ id: 'theme-custom', name: '自定义', colors: { ...store.COLOR_THEMES.classic.colors, green: '#123456' } }];
  const config = { ...store.clone(store.DEFAULT_CONFIG), colorTheme: 'theme-custom', customColorThemes: themes };
  config.rules[0].highlight = { enabled: true, border: { sides: ['top'] } };
  await store.saveConfig(config);
  const loaded = await store.loadConfig();
  assert.equal(loaded.config.colorTheme, 'theme-custom');
  assert.deepEqual(loaded.config.customColorThemes, themes);
  const style = await sendMessage({ type: 'page-style', url: 'http://localhost:3000/' }, { tab: { id: 1, windowId: 7 } });
  assert.equal(style.colorHex, '#123456');
});

test('动作层对未知颜色兜底，新建和已有群组均只向 API 发送合法颜色', async () => {
  const { applyRule } = await import('../src/app/actions.js');
  for (const existing of [false, true]) {
    reset();
    const tab = localhostTab(1, 7);
    state.tabsByWindow[7] = [tab];
    if (existing) state.existingGroups = [{ id: 42, windowId: 7, title: '颜色兜底', color: 'blue' }];
    const result = await applyRule({ name: '颜色兜底', color: 'future-color', tabGroup: { enabled: true } }, tab);
    assert.equal(result.ok, true);
    assert.equal(state.updateCalls.at(-1).patch.color, 'grey');
  }
});

test('命中内置默认规则时创建分组并记日志', async () => {
  reset();
  const tab = localhostTab(1, 7);
  state.tabsByWindow[7] = [tab];

  Background.schedule(tab);
  await Background.flush();

  assert.equal(state.groupCalls.length, 1);
  assert.deepEqual(state.groupCalls[0].tabIds, [1]);
  assert.deepEqual(state.groupCalls[0].createProperties, { windowId: 7 });
  // 建组后统一通过 tabGroups.update 设置标题/颜色/折叠
  assert.deepEqual(state.updateCalls, [
    { id: 42, patch: { title: '开发', color: 'green', collapsed: false } }
  ]);

  const hit = Logger.recent().find((entry) => entry.message === '命中规则并执行动作');
  assert.ok(hit);
  assert.equal(hit.detail.ruleId, 'dev-localhost');
  assert.equal(hit.detail.results[0].groupId, 42);
});

test('不匹配的 URL 不执行动作，但留下判断过程', async () => {
  reset();
  const tab = { id: 2, windowId: 7, url: 'https://example.com/', groupId: -1 };
  state.tabsByWindow[7] = [tab];

  Background.schedule(tab);
  await Background.flush();

  assert.equal(state.groupCalls.length, 0);
  const miss = Logger.recent().find((entry) => entry.message.startsWith('无规则命中'));
  assert.ok(miss);
  assert.match(miss.message, /匹配路径都没命中/);
  assert.equal(miss.detail.steps.length, 1);
});

test('已在目标分组内时不重复调用分组 API', async () => {
  reset();
  state.existingGroups = [{ id: 42, title: '开发', color: 'green', collapsed: false }];
  const tab = { id: 3, windowId: 8, url: 'http://localhost:4000/', groupId: 42 };
  state.tabsByWindow[8] = [tab];

  Background.schedule(tab);
  await Background.flush();

  assert.equal(state.groupCalls.length, 0, '幂等：不应再次分组');
  assert.equal(state.updateCalls.length, 0, '属性一致时不应更新分组');
});

test('已有分组但属性不同时更新分组属性', async () => {
  reset();
  state.existingGroups = [{ id: 42, title: '开发', color: 'grey', collapsed: false }];
  const tab = { id: 4, windowId: 9, url: 'http://localhost:5000/', groupId: 42 };
  state.tabsByWindow[9] = [tab];

  Background.schedule(tab);
  await Background.flush();

  assert.deepEqual(state.updateCalls, [{ id: 42, patch: { color: 'green' } }]);
});

test('存储中的配置非法时回退默认配置并告警', async () => {
  reset();
  state.storedConfig = { schemaVersion: 99, rules: [] };
  const tab = localhostTab(5, 10);
  state.tabsByWindow[10] = [tab];

  Background.schedule(tab);
  await Background.flush();

  const warning = Logger.recent().find((entry) => /配置校验失败/.test(entry.message));
  assert.ok(warning, '应记录配置回退告警');
  assert.equal(state.groupCalls.length, 1, '回退后仍应按默认规则归组');
});

test('旧配置 globalEnabled=false 不再阻止自动归组', async () => {
  reset();
  state.storedConfig = configWith([rule({})], false);
  const tab = localhostTab(6, 11);
  state.tabsByWindow[11] = [tab];

  Background.schedule(tab);
  await Background.flush();

  assert.equal(state.groupCalls.length, 1);
});

test('阈值未达成时按窗口内标签数判断，不归组', async () => {
  reset();
  state.storedConfig = githubConfig(3);
  const tab = { id: 7, windowId: 12, url: 'https://www.github.com/a', groupId: -1 };
  state.tabsByWindow[12] = [tab, { id: 8, windowId: 12, url: 'https://gist.github.com/b' }];

  Background.schedule(tab);
  await Background.flush();

  assert.equal(state.groupCalls.length, 0, '只有 2 个 github 标签，未达阈值 3');
  const miss = Logger.recent().find((entry) => entry.message.startsWith('已确定规则归属'));
  assert.equal(miss.detail.ruleId, 'code-github');
  assert.equal(miss.detail.steps[0].count, 2);
  assert.equal(miss.detail.steps[0].thresholdMet, false);
});

test('阈值达成时把同窗口内未分组的命中标签一起归组', async () => {
  reset();
  state.storedConfig = githubConfig(3);
  const tabs = [
    { id: 1, windowId: 2, url: 'https://gist.github.com/a', groupId: -1 },
    { id: 2, windowId: 2, url: 'https://gist.github.com/b', groupId: -1 },
    { id: 3, windowId: 2, url: 'https://gist.github.com/c', groupId: -1 }
  ];
  state.tabsByWindow[2] = tabs;

  Background.schedule(tabs[2]);
  await Background.flush();

  assert.equal(state.groupCalls.length, 1);
  assert.deepEqual(
    state.groupCalls[0].tabIds.slice().sort((a, b) => a - b),
    [1, 2, 3],
    '第三个标签触发时，前两个也要一起进组'
  );
});

test('阈值达成时不移动已在其他分组内的标签', async () => {
  reset();
  state.storedConfig = githubConfig(3);
  const tabs = [
    { id: 1, windowId: 2, url: 'https://gist.github.com/a', groupId: -1 },
    { id: 2, windowId: 2, url: 'https://gist.github.com/b', groupId: 99 },
    { id: 3, windowId: 2, url: 'https://gist.github.com/c', groupId: -1 }
  ];
  state.tabsByWindow[2] = tabs;

  Background.schedule(tabs[2]);
  await Background.flush();

  assert.deepEqual(
    state.groupCalls[0].tabIds.slice().sort((a, b) => a - b),
    [1, 3],
    '已在别组（99）的标签保持不动'
  );
});

test('syncAll：已存在但未分组的标签会被同步进组', async () => {
  reset();
  state.storedConfig = configWith([rule({})]);
  const ungrouped = { id: 1, windowId: 3, url: 'http://localhost:3000/', groupId: -1 };
  const alreadyGrouped = { id: 2, windowId: 3, url: 'http://localhost:3001/', groupId: 99 };
  state.tabsByWindow[3] = [ungrouped, alreadyGrouped];

  const stats = await Background.syncAll();

  assert.equal(stats.checked, 2);
  assert.equal(stats.grouped, 1);
  assert.equal(stats.skipped, 1);
  assert.deepEqual(state.groupCalls[0].tabIds, [1]);
  assert.ok(Logger.recent().some((entry) => entry.message.startsWith('同步完成')));
});

test('syncAll：includeGrouped 时把已有分组的标签也重排', async () => {
  reset();
  state.storedConfig = configWith([rule({})]);
  state.existingGroups = [{ id: 42, title: '开发', color: 'green', collapsed: false }];
  state.tabsByWindow[3] = [{ id: 5, windowId: 3, url: 'http://localhost:3000/', groupId: 99 }];

  const stats = await Background.syncAll({ includeGrouped: true });

  assert.equal(stats.grouped, 1);
  assert.deepEqual(state.groupCalls[0], { tabIds: [5], groupId: 42 });
});

test('setConfig 保存后自动同步已打开的标签页', async () => {
  reset();
  state.tabsByWindow[4] = [{ id: 9, windowId: 4, url: 'http://localhost:3000/', groupId: -1 }];

  const result = await Debug.setConfig(configWith([rule({ id: 'dev' })]));

  assert.equal(result.ok, true);
  assert.equal(state.groupCalls.length, 1, '保存后应立刻处理已存在的标签');
  assert.equal(result.sync.grouped, 1);
});

test('工具栏按钮触发全量同步', async () => {
  reset();
  state.tabsByWindow[5] = [{ id: 11, windowId: 5, url: 'http://localhost:3000/', groupId: -1 }];

  await sendMessage({ type: 'toolbar-execute', windowId: 5 }, { url: browser.runtime.getURL('src/ui/popup.html') });

  assert.equal(state.groupCalls.length, 1);
});

test('addRule：在现有配置上追加规则，不丢失默认规则', async () => {
  reset();

  const result = await Debug.addRule(
    rule({
      id: 'code-github',
      name: '代码',
      color: 'blue',
      minTabs: 3,
      patterns: ['*://*.github.com/*']
    })
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    state.storedConfig.rules.map((item) => item.id),
    ['dev-localhost', 'code-github']
  );
});

test('addRule：同 id 覆盖而不是产生重复规则', async () => {
  reset();

  await Debug.addRule(rule({ id: 'code-github', name: '代码', minTabs: 1 }));
  await Debug.addRule(rule({ id: 'code-github', name: '代码', minTabs: 2 }));

  const github = state.storedConfig.rules.filter((item) => item.id === 'code-github');
  assert.equal(github.length, 1);
  assert.equal(github[0].tabGroup.minTabs, 2);
});

test('addRule：缺少规则 id 时拒绝', async () => {
  reset();
  const result = await Debug.addRule({ name: '无 id' });
  assert.equal(result.ok, false);
  assert.equal(state.storedConfig, null);
});

test('removeRule：只删除指定规则', async () => {
  reset();
  await Debug.addRule(rule({ id: 'code-github', name: '代码' }));

  const result = await Debug.removeRule('code-github');

  assert.equal(result.ok, true);
  assert.deepEqual(state.storedConfig.rules.map((item) => item.id), ['dev-localhost']);
});

test('removeRule：规则不存在时报错且不改动配置', async () => {
  reset();
  const before = state.storedConfig;

  const result = await Debug.removeRule('nope');

  assert.equal(result.ok, false);
  assert.equal(state.storedConfig, before);
});

test('setConfig：非法配置不写入并打印原因', async () => {
  reset();
  const result = await Debug.setConfig(configWith([rule({ name: '' })]));

  assert.equal(result.ok, false);
  const failed = Logger.recent().find((entry) => entry.level === 'error');
  assert.match(failed.message, /配置未保存/);
  assert.ok(Array.isArray(failed.detail));
  assert.equal(state.storedConfig, null, '非法配置不应落盘');
});

test('收到 sync-all 消息时执行同步并返回统计', async () => {
  reset();
  state.tabsByWindow[6] = [{ id: 13, windowId: 6, url: 'http://localhost:3000/', groupId: -1 }];

  const stats = await sendMessage({ type: 'sync-all' });

  assert.equal(stats.grouped, 1);
  assert.equal(state.groupCalls.length, 1);
});

test('无关消息不触发同步', async () => {
  reset();
  const result = await sendMessage({ type: 'something-else' });
  assert.equal(result, undefined);
  assert.equal(state.groupCalls.length, 0);
});

test('开发期旧格式配置会被拒绝并回退默认', async () => {
  reset();
  state.storedConfig = {
    schemaVersion: 1,
    globalEnabled: true,
    rules: [
      {
        id: 'dev-localhost',
        enabled: true,
        priority: 100,
        match: { urlPattern: '*://localhost:*/*', minTabs: 1 },
        actions: [{ type: 'group', name: '开发', color: 'green', collapsed: false }]
      }
    ]
  };
  const tab = localhostTab(14, 15);
  state.tabsByWindow[15] = [tab];

  Background.schedule(tab);
  await Background.flush();

  assert.equal(state.groupCalls.length, 1, '回退默认配置后仍应归组');
  assert.equal(
    state.storedConfig.schemaVersion,
    1,
    '旧配置不会被迁移或改写，仍保持原样'
  );
  assert.ok(
    Logger.recent().some((entry) => /配置校验失败/.test(entry.message)),
    '应记录配置回退告警'
  );
});

test('page-style：命中的分组开启标识时返回渲染规格', async () => {
  reset();
  state.storedConfig = {
    schemaVersion: 1,
    globalEnabled: true,
    rules: [
      {
        id: 'dev',
        enabled: true,
        name: '开发',
        color: 'green',
        collapsed: false,
        minTabs: 1,
        note: '',
        patterns: ['*://localhost:*/*'],
        highlight: {
          enabled: true,
          border: { sides: ['top'], width: 6 },
          banner: { positions: ['topLeft'], size: 30, fontSize: 16 }
        }
      }
    ]
  };
  state.tabsByWindow[1] = [{ id: 1, windowId: 1, url: 'http://localhost:3000/', groupId: -1 }];

  const style = await sendMessage(
    { type: 'page-style', url: 'http://localhost:3000/x' },
    { tab: { id: 1, windowId: 1, url: 'http://localhost:3000/x' } }
  );

  assert.equal(style.ruleId, 'dev');
  assert.equal(style.name, '开发');
  assert.equal(style.colorHex, '#008865');
  assert.deepEqual(style.highlight.border.sides, ['top']);
  assert.deepEqual(style.highlight.banner.positions, ['topLeft']);
  assert.equal(style.titleRule.enabled, false);
});

test('page-style：只启用标题规则时也返回配置', async () => {
  reset();
  state.storedConfig = {
    schemaVersion: 1,
    globalEnabled: true,
    rules: [
      {
        id: 'title-only',
        enabled: true,
        name: '标题组',
        color: 'blue',
        collapsed: false,
        minTabs: 1,
        note: '',
        patterns: ['*://localhost:*/*'],
        highlight: {
          enabled: false,
          border: { sides: [], width: 4, opacity: 100 },
          banner: { positions: [], size: 28, fontSize: 14, opacity: 60 }
        },
        titleRule: {
          enabled: true,
          rules: [{ pattern: '工作', replacement: '办公', description: '' }],
          testText: ''
        }
      }
    ]
  };
  state.tabsByWindow[1] = [{ id: 1, windowId: 1, url: 'http://localhost:3000/' }];

  const style = await sendMessage(
    { type: 'page-style', url: 'http://localhost:3000/' },
    { tab: { id: 1, windowId: 1 } }
  );

  assert.ok(style, '只开标题规则时也应返回配置');
  assert.equal(style.titleRule.enabled, true);
  assert.equal(style.titleRule.rules[0].titlePattern, '工作');
  assert.equal(style.highlight.enabled, false);
  const store = await import('../src/app/store.js');
  const loaded = await store.loadConfig();
  assert.equal(loaded.source, 'storage');
  assert.equal(loaded.config.schemaVersion, 2);
  assert.equal(state.storedConfig.schemaVersion, 1, '读取迁移不覆盖旧存储');
  assert.equal((await store.saveConfig(loaded.config)).ok, true);
  assert.equal(state.storedConfig.schemaVersion, 2, '保存后持久化 schema 2');
  assert.equal('pattern' in state.storedConfig.rules[0].titleRule.rules[0], false);

});

test('page-style：标识未开启或未命中时返回 null', async () => {
  reset();
  state.storedConfig = {
    schemaVersion: 1,
    globalEnabled: true,
    rules: [
      {
        id: 'dev',
        enabled: true,
        name: '开发',
        color: 'green',
        patterns: ['*://localhost:*/*'],
        highlight: { enabled: false }
      }
    ]
  };

  const disabled = await sendMessage(
    { type: 'page-style', url: 'http://localhost:3000/' },
    { tab: { id: 1, windowId: 1 } }
  );
  assert.equal(disabled, null);

  const noMatch = await sendMessage(
    { type: 'page-style', url: 'https://example.com/' },
    { tab: { id: 1, windowId: 1 } }
  );
  assert.equal(noMatch, null);
});

test('配置变化会通知所有页面刷新标识', async () => {
  reset();
  state.tabsByWindow[2] = [
    { id: 7, windowId: 2, url: 'http://localhost:3000/' },
    { id: 8, windowId: 2, url: 'https://example.com/' }
  ];

  listeners.configChanged[0]({ 'tabpilot:config': { oldValue: null, newValue: {} } }, 'local');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.pageMessages.length, 2);
  assert.deepEqual(state.pageMessages[0], { tabId: 7, message: { type: 'tabpilot:refresh' } });
});

test('点击行为：默认仅同步，不折叠任何分组', async () => {
  reset();
  state.storedConfig = configWith([rule({})]);
  state.existingGroups = [{ id: 1, title: '开发', collapsed: false, windowId: 3 }];

  const result = await Background.handleToolbarClick({ windowId: 3 });

  assert.equal(result.action, undefined, '仅同步不返回折叠信息');
  assert.deepEqual(state.updateCalls, []);
});

test('点击行为：syncCollapseAll 折叠点击窗口内的所有分组', async () => {
  reset();
  state.storedConfig = { ...configWith([]), clickAction: 'syncCollapseAll' };
  state.existingGroups = [
    { id: 1, title: 'A', collapsed: false, windowId: 3 },
    { id: 2, title: 'B', collapsed: true, windowId: 3 },
    { id: 3, title: 'C', collapsed: false, windowId: 4 }
  ];

  const result = await Background.handleToolbarClick({ windowId: 3 });

  assert.equal(result.collapsed, 1, '已折叠的不重复处理');
  assert.deepEqual(state.updateCalls, [{ id: 1, patch: { collapsed: true } }]);
});

test('点击行为：syncCollapseInactive 跳过包含活动标签的分组', async () => {
  reset();
  state.storedConfig = { ...configWith([]), clickAction: 'syncCollapseInactive' };
  state.existingGroups = [
    { id: 1, title: 'A', collapsed: false, windowId: 3 },
    { id: 2, title: 'B', collapsed: false, windowId: 3 }
  ];
  state.tabsByWindow[3] = [
    { id: 10, windowId: 3, url: 'about:blank', groupId: 2, active: true },
    { id: 11, windowId: 3, url: 'about:blank', groupId: 1, active: false }
  ];

  const result = await Background.handleToolbarClick({ windowId: 3 });

  assert.equal(result.collapsed, 1);
  assert.deepEqual(state.updateCalls, [{ id: 1, patch: { collapsed: true } }]);
});

test('点击行为：syncRuleCollapse 只折叠开启了「自动折叠」的规则分组', async () => {
  reset();
  state.storedConfig = {
    schemaVersion: 1,
    globalEnabled: true,
    clickAction: 'syncRuleCollapse',
    rules: [
      rule({ id: 'dev', name: '开发', collapsed: true }),
      rule({ id: 'code', name: '代码', collapsed: false, patterns: ['*://*.github.com/*'] })
    ]
  };
  state.existingGroups = [
    { id: 1, title: '开发', collapsed: false, windowId: 3 },
    { id: 2, title: '代码', collapsed: false, windowId: 3 },
    { id: 3, title: '手动分组', collapsed: false, windowId: 3 }
  ];

  const result = await Background.handleToolbarClick({ windowId: 3 });

  assert.equal(result.collapsed, 1);
  assert.deepEqual(state.updateCalls, [{ id: 1, patch: { collapsed: true } }]);
});

test('点击行为：旧配置 globalEnabled=false 不再阻止折叠', async () => {
  reset();
  state.storedConfig = { ...configWith([], false), clickAction: 'syncCollapseAll' };
  state.existingGroups = [{ id: 1, title: 'A', collapsed: false, windowId: 3 }];

  await Background.handleToolbarClick({ windowId: 3 });

  assert.deepEqual(state.updateCalls, [{ id: 1, patch: { collapsed: true } }]);
  assert.equal(state.groupCalls.length, 0);
});


test('syncAll：开启分组前置才整理，旧全局开关不生效', async () => {
  reset();
  state.tabsByWindow = { 1: [
    { id: 1, windowId: 1, index: 0, pinned: true, groupId: -1, url: 'about:blank' },
    { id: 2, windowId: 1, index: 1, groupId: -1, url: 'about:blank' },
    { id: 3, windowId: 1, index: 2, groupId: 8, url: 'https://example.com' }
  ] };
  state.storedConfig = configWith([]);
  await Background.syncAll();
  assert.equal(state.moveCalls.length, 0);
  state.storedConfig.groupsFirst = true;
  await Background.syncAll();
  assert.deepEqual(state.moveCalls, [{ groupId: 8, windowId: 1, index: 1 }]);
  state.storedConfig.globalEnabled = false;
  await Background.syncAll();
  assert.equal(state.moveCalls.length, 2);
});

test('popup 动作：返回本地化结果，不向网页发送提示', async () => {
  reset();
  state.storedConfig = { ...configWith([]), language: 'zh' };
  const result = await sendMessage({ type: 'toolbar-execute', windowId: 1 }, { url: browser.runtime.getURL('src/ui/popup.html') });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'TabPilot：同步完成');
  assert.deepEqual(state.pageMessages, []);
  state.storedConfig.globalEnabled = false;
  const resultWithLegacyFlag = await Background.executeToolbarClick({ windowId: 1 });
  assert.equal(resultWithLegacyFlag.text, 'TabPilot：同步完成');
});

test('popup 动作：拒绝网页来源与非法窗口', async () => {
  reset();
  for (const [windowId, sender] of [
    [1, { tab: { id: 1 }, url: 'https://example.com' }],
    [-1, { url: browser.runtime.getURL('src/ui/popup.html') }],
    [1, { url: 'https://example.com' }]
  ]) {
    assert.equal(await sendMessage({ type: 'toolbar-execute', windowId }, sender), undefined);
  }
  assert.deepEqual(state.groupCalls, []);
});


test('严格模式接入导航处理：移出不匹配标签，本批不重新归组；手动同步不主动移出', async () => {
  reset();
  const tab={id:90,windowId:1,groupId:3,url:'https://other.example/'};
  state.tabsByWindow={1:[tab]};
  state.existingGroups=[{id:3,windowId:1,title:'开发'}];
  state.storedConfig={...configWith([rule({strictMode:true})])};
  await Background.syncAll();
  assert.equal(state.ungroupCalls.length,0);
  listeners.updated[0](tab.id,{url:tab.url},tab);
  await Background.flush();
  assert.deepEqual(state.ungroupCalls,[90]);
  assert.equal(state.groupCalls.length,0);
});

test('保存旧配置会移除全局开关，保留单条规则停用状态',async()=>{
  reset();
  const disabled = rule({ enabled: false });
  state.tabsByWindow[1]=[localhostTab(1,1)];
  const result=await Debug.setConfig({ ...configWith([disabled]),globalEnabled:false });
  assert.equal(result.ok,true);
  assert.equal('globalEnabled' in state.storedConfig,false);
  assert.equal(state.storedConfig.rules[0].enabled,false);
  assert.equal(state.groupCalls.length,0);
});

test('导航折叠例外：当前标签仍在展开的原组时保留展开，颜色照常更新',async()=>{
  reset();
  state.storedConfig=configWith([rule({collapsed:true})]);
  state.existingGroups=[{id:42,windowId:1,title:'开发',color:'grey',collapsed:false}];
  const tab={id:1,windowId:1,groupId:42,active:true,url:'http://localhost:3000/next'};
  state.tabsByWindow={1:[tab]};
  listeners.updated[0](1,{url:tab.url},tab);
  listeners.updated[0](1,{status:'complete'},tab);
  await Background.flush();
  assert.deepEqual(state.updateCalls,[{id:42,patch:{color:'green'}}]);
  assert.equal(state.groupCalls.length,0);
});

test('自动折叠：后台标签组内导航不折叠，组外进入才折叠',async()=>{
  for(const [active,groupId] of [[false,42],[true,-1],[true,8]]){
    reset();
    state.storedConfig=configWith([rule({collapsed:true})]);
    state.existingGroups=[{id:42,windowId:1,title:'开发',color:'green',collapsed:false}];
    const tab={id:1,windowId:1,groupId,active,url:'http://localhost:3000/next'};
    state.tabsByWindow={1:[tab]};
    listeners.updated[0](1,{url:tab.url},tab);
    await Background.flush();
    assert.deepEqual(state.updateCalls,groupId === 42 ? [] : [{id:42,patch:{collapsed:true}}]);
  }
});

test('自动折叠：已在组内时创建/同步不改变状态，显式按规则折叠仍执行',async()=>{
  reset();
  state.storedConfig=configWith([rule({collapsed:true})]);
  state.existingGroups=[{id:42,windowId:1,title:'开发',color:'green',collapsed:false}];
  const tab={id:1,windowId:1,groupId:42,active:true,url:'http://localhost:3000/'};
  state.tabsByWindow={1:[tab]};
  listeners.created[0](tab);
  await Background.flush();
  assert.deepEqual(state.updateCalls,[]);
  state.updateCalls=[];
  await Background.syncAll({includeGrouped:true});
  assert.deepEqual(state.updateCalls,[]);
  await Background.collapseGroups('syncRuleCollapse',state.storedConfig,1);
  assert.deepEqual(state.updateCalls,[{id:42,patch:{collapsed:true}}]);
});

test('自动折叠：组内导航不依赖活动状态，已折叠的组不主动展开',async()=>{
  reset();
  state.storedConfig=configWith([rule({collapsed:true})]);
  state.existingGroups=[{id:42,windowId:1,title:'开发',color:'green',collapsed:false}];
  const tab={id:1,windowId:1,groupId:42,active:true,url:'http://localhost:3000/next'};
  state.tabsByWindow={1:[{...tab,active:false}]};
  listeners.updated[0](1,{url:tab.url},tab);
  await Background.flush();
  assert.deepEqual(state.updateCalls,[]);
  state.updateCalls=[];
  state.existingGroups[0].collapsed=true;
  state.tabsByWindow[1][0].active=true;
  listeners.updated[0](1,{status:'complete'},tab);
  await Background.flush();
  assert.deepEqual(state.updateCalls,[]);
});

async function withGroupPositionUpdates(run) {
  const original = { group: browser.tabs.group, update: browser.tabGroups.update, move: browser.tabGroups.move, ungroup: browser.tabs.ungroup };
  browser.tabs.group = async options => {
    state.groupCalls.push(options);
    const tabs = Object.values(state.tabsByWindow).flat();
    const groupId = options.groupId ?? (100 + state.existingGroups.length);
    if (options.createProperties) state.existingGroups.push({ id: groupId, windowId: options.createProperties.windowId, title: '', collapsed: false });
    for (const id of options.tabIds) tabs.find(tab => tab.id === id).groupId = groupId;
    return groupId;
  };
  browser.tabGroups.update = async (id, patch) => {
    state.updateCalls.push({ id, patch });
    Object.assign(state.existingGroups.find(group => group.id === id), patch);
  };
  browser.tabGroups.move = async (groupId, options) => {
    state.moveCalls.push({ groupId, ...options });
    const tabs = state.tabsByWindow[options.windowId].slice().sort((a,b) => a.index-b.index);
    const moving = tabs.filter(tab => tab.groupId === groupId);
    const remaining = tabs.filter(tab => tab.groupId !== groupId);
    remaining.splice(options.index, 0, ...moving);
    remaining.forEach((tab,index) => { tab.index=index; });
    return {id:groupId};
  };
  browser.tabs.ungroup = async id => {
    state.ungroupCalls.push(id);
    Object.values(state.tabsByWindow).flat().find(tab => tab.id === id).groupId=-1;
  };
  try { await run(); } finally {
    browser.tabs.group=original.group;
    browser.tabGroups.update=original.update;
    browser.tabGroups.move=original.move;
    browser.tabs.ungroup=original.ungroup;
  }
}

test('分组前置：游离标签末尾的新页面自动创建组后立即前移，其他窗口不变',async()=>{
  for(const enabled of [false,true]){
    reset();state.storedConfig={...configWith([rule()]),groupsFirst:enabled};
    const target={id:4,index:3,windowId:1,groupId:-1,url:'http://localhost:3000/',active:true};
    state.tabsByWindow={1:[{id:1,index:0,windowId:1,groupId:-1,pinned:true,url:'about:blank'},{id:2,index:1,windowId:1,groupId:-1,url:'https://loose.example/'},{id:3,index:2,windowId:1,groupId:-1,url:'https://loose.example/2'},target],2:[{id:5,index:0,windowId:2,groupId:-1,url:'https://loose.example/'},{id:6,index:1,windowId:2,groupId:44,url:'https://manual.example/'}]};
    state.existingGroups=[{id:44,windowId:2,title:'其他窗口'}];
    await withGroupPositionUpdates(async()=>{
      listeners.updated[0](target.id,{url:target.url},target);await Background.flush();
      assert.equal(state.moveCalls.length,enabled?1:0);
      if(enabled)assert.deepEqual(state.moveCalls,[{groupId:101,windowId:1,index:1}]);
      assert.equal(target.index,enabled?1:3);
      assert.equal(state.tabsByWindow[1].find(tab=>tab.id===2).groupId,-1);
      assert.equal(state.tabsByWindow[2][1].index,1);
    });
  }
});

test('分组前置：阈值批量归组后整理，重复加载不再次移动',async()=>{
  reset();state.storedConfig={...configWith([rule({minTabs:2})]),groupsFirst:true};
  const first={id:2,index:1,windowId:1,groupId:-1,url:'http://localhost:3000/a'};
  const second={id:3,index:2,windowId:1,groupId:-1,url:'http://localhost:3000/b'};
  state.tabsByWindow={1:[{id:1,index:0,windowId:1,groupId:-1,url:'https://loose.example/'},first,second]};
  await withGroupPositionUpdates(async()=>{
    listeners.created[0](second);await Background.flush();
    assert.deepEqual(state.groupCalls[0].tabIds,[3,2]);assert.equal(state.moveCalls.length,1);
    assert.equal(Math.min(first.index,second.index),0);
    listeners.updated[0](second.id,{status:'complete'},second);await Background.flush();
    assert.equal(state.moveCalls.length,1);
  });
});

test('分组前置：手动改归属仅整理位置，不重新匹配或抢走标签',async()=>{
  reset();state.storedConfig={...configWith([rule()]),groupsFirst:true};
  state.existingGroups=[{id:50,windowId:1,title:'纯手动组',collapsed:false}];
  const target={id:2,index:1,windowId:1,groupId:50,url:'http://localhost:3000/'};
  state.tabsByWindow={1:[{id:1,index:0,windowId:1,groupId:-1,url:'https://loose.example/'},target]};
  await withGroupPositionUpdates(async()=>{
    listeners.updated[0](target.id,{groupId:50},target);await Background.flush();
    assert.equal(state.groupCalls.length,0);assert.equal(target.groupId,50);
    assert.deepEqual(state.moveCalls,[{groupId:50,windowId:1,index:0}]);
  });
});

test('分组前置：严格模式移出后重新整理剩余组',async()=>{
  reset();state.storedConfig={...configWith([rule({strictMode:true})]),groupsFirst:true};
  state.existingGroups=[{id:42,windowId:1,title:'开发'},{id:43,windowId:1,title:'手动组'}];
  const target={id:1,index:0,windowId:1,groupId:42,url:'https://other.example/'};
  state.tabsByWindow={1:[target,{id:2,index:1,windowId:1,groupId:43,url:'https://manual.example/'}]};
  await withGroupPositionUpdates(async()=>{
    listeners.updated[0](target.id,{url:target.url},target);await Background.flush();
    assert.deepEqual(state.ungroupCalls,[1]);assert.deepEqual(state.moveCalls,[{groupId:43,windowId:1,index:0}]);
  });
});

test('分组前置：未命中不整理，不干预其他窗口',async()=>{
  reset();state.storedConfig={...configWith([rule()]),groupsFirst:true};
  const target={id:2,index:1,windowId:1,groupId:-1,url:'https://unmatched.example/'};
  state.tabsByWindow={1:[{id:1,index:0,windowId:1,groupId:-1,url:'https://loose.example/'},target]};
  await withGroupPositionUpdates(async()=>{
    listeners.updated[0](target.id,{url:target.url},target);await Background.flush();assert.deepEqual(state.moveCalls,[]);
  });
});

test('分组前置：同窗口同批多个归属变化只整理一次，受限网址也可整理',async()=>{
  reset();state.storedConfig={...configWith([]),groupsFirst:true};
  state.existingGroups=[{id:50,windowId:1,title:'手动组'}];
  const first={id:2,index:1,windowId:1,groupId:50,url:'about:blank'};
  const second={id:3,index:2,windowId:1,groupId:50,url:'about:blank'};
  state.tabsByWindow={1:[{id:1,index:0,windowId:1,groupId:-1,url:'https://loose.example/'},first,second]};
  await withGroupPositionUpdates(async()=>{
    listeners.created[0](first);listeners.updated[0](second.id,{groupId:50},second);await Background.flush();
    assert.equal(state.moveCalls.length,1);assert.equal(state.groupCalls.length,0);
    assert.equal(first.groupId,50);assert.equal(second.groupId,50);
  });
});

test('保存旧全局严格配置：迁移到规则，落盘不再包含全局 strictMode',async()=>{
  reset();
  const raw={...configWith([rule(),rule({id:'relaxed',name:'宽松',strictMode:false})]),strictMode:true};
  const result=await Debug.setConfig(raw);
  assert.equal(result.ok,true);
  assert.equal('strictMode' in state.storedConfig,false);
  assert.deepEqual(state.storedConfig.rules.map(rule=>rule.tabGroup.strictMode),[true,false]);
});

test('自动折叠：创建新组时执行，阈值同批重复命中不重复入组或折叠',async()=>{
  reset();state.storedConfig=configWith([rule({collapsed:true,minTabs:2})]);
  const first={id:1,index:0,windowId:1,groupId:-1,url:'http://localhost:3000/a'};
  const second={id:2,index:1,windowId:1,groupId:-1,url:'http://localhost:3000/b'};
  state.tabsByWindow={1:[first,second]};
  await withGroupPositionUpdates(async()=>{
    listeners.updated[0](1,{url:first.url},{...first});
    listeners.updated[0](2,{url:second.url},{...second});
    await Background.flush();
    assert.equal(state.groupCalls.length,1);
    assert.equal(state.updateCalls.filter(call=>call.patch.collapsed===true).length,1);
    assert.equal(state.existingGroups[0].collapsed,true);
  });
});

test('自动折叠：当前标签已入组，阈值带入其他标签时仍触发折叠',async()=>{
  reset();state.storedConfig=configWith([rule({collapsed:true,minTabs:2})]);
  state.existingGroups=[{id:42,windowId:1,title:'开发',color:'green',collapsed:false}];
  const current={id:1,index:0,windowId:1,groupId:42,active:true,url:'http://localhost:3000/a'};
  state.tabsByWindow={1:[current,{id:2,index:1,windowId:1,groupId:-1,url:'http://localhost:3000/b'}]};
  await withGroupPositionUpdates(async()=>{
    listeners.updated[0](1,{url:current.url},{...current});await Background.flush();
    assert.deepEqual(state.groupCalls,[{tabIds:[2],groupId:42}]);
    assert.deepEqual(state.updateCalls,[{id:42,patch:{collapsed:true}}]);
  });
});

test('自动折叠：关闭时不展开已有折叠组，组内后台刷新也保持折叠',async()=>{
  reset();state.storedConfig=configWith([rule({collapsed:false})]);
  state.existingGroups=[{id:42,windowId:1,title:'开发',color:'green',collapsed:true}];
  const tab={id:1,index:0,windowId:1,groupId:-1,url:'http://localhost:3000/'};
  state.tabsByWindow={1:[tab]};
  await withGroupPositionUpdates(async()=>{
    listeners.updated[0](1,{url:tab.url},{...tab});await Background.flush();
    assert.equal(tab.groupId,42);
    assert.deepEqual(state.updateCalls,[]);
    listeners.updated[0](1,{status:'complete'},{...tab});await Background.flush();
    assert.deepEqual(state.updateCalls,[]);
    assert.equal(state.groupCalls.length,1);
  });
});

test('自动折叠：入组失败时不折叠目标组',async()=>{
  reset();state.storedConfig=configWith([rule({collapsed:true})]);
  state.existingGroups=[{id:42,windowId:1,title:'开发',color:'green',collapsed:false}];
  const tab={id:1,windowId:1,groupId:-1,url:'http://localhost:3000/'};
  state.tabsByWindow={1:[tab]};
  const original=browser.tabs.group;
  browser.tabs.group=async()=>{throw new Error('group failed');};
  try{
    listeners.updated[0](1,{url:tab.url},tab);await Background.flush();
    assert.deepEqual(state.updateCalls,[]);
    assert.equal(state.existingGroups[0].collapsed,false);
  }finally{browser.tabs.group=original;}
});

test('自动折叠：入组过程临时展开已折叠组时，入组成功后仍折叠',async()=>{
  reset();state.storedConfig=configWith([rule({collapsed:true})]);
  state.existingGroups=[{id:42,windowId:1,title:'开发',color:'green',collapsed:true}];
  const tab={id:1,index:0,windowId:1,groupId:-1,active:true,url:'http://localhost:3000/'};
  state.tabsByWindow={1:[tab]};
  await withGroupPositionUpdates(async()=>{
    const group=browser.tabs.group;
    browser.tabs.group=async options=>{
      const id=await group(options);
      state.existingGroups[0].collapsed=false;
      return id;
    };
    listeners.updated[0](1,{url:tab.url},{...tab});await Background.flush();
    assert.equal(state.existingGroups[0].collapsed,true);
    assert.deepEqual(state.updateCalls,[{id:42,patch:{collapsed:true}}]);
  });
});

test('page-style：schema 2 的 URL-only 标题规则也会下发', async () => {
  reset();
  state.storedConfig = { schemaVersion: 2, rules: [{
    id: 'url-title', enabled: true, name: 'URL title', patterns: ['*://localhost:*/*'],
    titleRule: { enabled: true, rules: [{ titlePattern: '', urlPattern: '/item/([0-9]+)$', replacement: '${url.1}' }],
      testCases: [{ title: 'App', url: 'http://localhost:3000/item/42' }] }
  }] };
  state.tabsByWindow[1] = [{ id: 1, windowId: 1, url: 'http://localhost:3000/item/42' }];
  const style = await sendMessage({ type: 'page-style', url: 'http://localhost:3000/item/42' }, { tab: { id: 1, windowId: 1 } });
  assert.ok(style);
  assert.equal(style.titleRule.rules[0].urlPattern, '/item/([0-9]+)$');
  assert.equal(style.titleRule.testCases[0].title, 'App');
});

test('规则归属与浏览器群组分离：关闭群组或阈值不足仍下发首条规则的标识和标题', async () => {
  for (const enabled of [false, true]) {
    reset();
    const first = rule({ id: 'first', name: '页面规则', tabGroup: { enabled, minTabs: enabled ? 3 : 1, collapsed: true, strictMode: true } });
    first.highlight = { enabled: true, border: { sides: ['top'] } };
    first.titleRule = { enabled: true, rules: [{ titlePattern: 'App', replacement: 'New title' }], testCases: [] };
    const fallback = rule({ id: 'fallback', name: '兜底组' });
    state.storedConfig = { schemaVersion: 2, rules: [first, fallback] };
    const tab = localhostTab(1, 1);
    state.tabsByWindow = { 1: [tab] };
    Background.schedule(tab);
    await Background.flush();
    assert.equal(state.groupCalls.length, 0);
    const stats = await Background.syncAll();
    assert.equal(stats.grouped, 0);
    assert.equal(stats.skipped, 1);
    const style = await sendMessage({ type: 'page-style', url: tab.url }, { tab });
    assert.equal(style.ruleId, 'first');
    assert.equal(style.highlight.enabled, true);
    assert.equal(style.titleRule.rules[0].replacement, 'New title');
    state.storedConfig.rules[0].enabled = false;
    const next = await sendMessage({ type: 'page-style', url: tab.url }, { tab });
    assert.equal(next, null, '总开关关闭才跳过该规则，后续规则未启用页面效果');
  }
});

test('群组关闭不会主动删除已有组，也不参与按规则折叠', async () => {
  reset();
  state.storedConfig = { schemaVersion: 2, rules: [rule({ tabGroup: { enabled: false, collapsed: true, strictMode: true } })] };
  state.existingGroups = [{ id: 42, windowId: 1, title: '开发', collapsed: false }];
  const tab = { ...localhostTab(1, 1), groupId: 42 };
  state.tabsByWindow = { 1: [tab] };
  await Background.syncAll({ includeGrouped: true });
  await Background.collapseGroups('syncRuleCollapse', state.storedConfig, 1);
  assert.equal(state.groupCalls.length, 0);
  assert.equal(state.updateCalls.length, 0);
  assert.equal(state.ungroupCalls.length, 0);
});

test('阈值批量归组不吸收归属前面规则的标签', async () => {
  reset();
  const first = rule({ id: 'specific', name: '特定', patterns: ['http://localhost:3000/special/*'], tabGroup: { enabled: false } });
  const second = rule({ id: 'general', name: '一般', tabGroup: { minTabs: 2 } });
  state.storedConfig = { schemaVersion: 2, rules: [first, second] };
  const tabs = [localhostTab(1, 1, 'http://localhost:3000/special/a'), localhostTab(2, 1), localhostTab(3, 1)];
  state.tabsByWindow = { 1: tabs };
  Background.schedule(tabs[1]);
  await Background.flush();
  assert.deepEqual(state.groupCalls[0].tabIds, [2, 3]);
});

test('SPA URL 更新定向刷新内容脚本，不依赖群组开启或阈值达成', async () => {
  for (const tabGroup of [{ enabled: false }, { enabled: true, minTabs: 5 }]) {
    reset();
    state.storedConfig = { schemaVersion: 2, rules: [rule({ tabGroup })] };
    const tab = localhostTab(1, 1);
    state.tabsByWindow = { 1: [tab] };
    listeners.updated[0](tab.id, { url: tab.url }, tab);
    assert.deepEqual(state.pageMessages, [{ tabId: tab.id, message: { type: 'tabpilot:refresh', reason: 'navigation' } }]);
    await Background.flush();
    assert.equal(state.groupCalls.length, 0);
  }
});

test('内容脚本刷新独立于严格移出，消息发送失败不阻止后台归组', async () => {
  reset();
  const tab = { ...localhostTab(1, 1), groupId: 42, url: 'https://outside.example/' };
  state.tabsByWindow = { 1: [tab] };
  state.existingGroups = [{ id: 42, windowId: 1, title: '开发' }];
  state.storedConfig = { schemaVersion: 2, rules: [rule({ tabGroup: { strictMode: true } })] };
  listeners.updated[0](tab.id, { url: tab.url }, tab);
  await Background.flush();
  assert.equal(state.pageMessages.length, 1);
  assert.deepEqual(state.ungroupCalls, [1]);
  reset();
  const regular = localhostTab(2, 1);
  state.tabsByWindow = { 1: [regular] };
  const original = browser.tabs.sendMessage;
  browser.tabs.sendMessage = async () => { throw new Error('Receiving end does not exist'); };
  try {
    listeners.updated[0](regular.id, { url: regular.url }, regular);
    await Background.flush();
    assert.equal(state.groupCalls.length, 1);
  } finally { browser.tabs.sendMessage = original; }
});

test('标题和群组成员变化不触发导航刷新，避免重命名和归组消息循环', async () => {
  reset();
  const tab = localhostTab(1, 1);
  state.tabsByWindow = { 1: [tab] };
  listeners.updated[0](tab.id, { title: 'Renamed' }, tab);
  listeners.updated[0](tab.id, { groupId: 42 }, { ...tab, groupId: 42 });
  await Background.flush();
  assert.equal(state.pageMessages.length, 0);
});

test('page-style：全局重命名不依赖规则组，且优先于组内规则、不影响高亮归属', async () => {
  const { applyTitleRules } = await import('../src/core/title-rule.js');
  reset();
  const globalTitleRule = { enabled: true, rules: [{ titlePattern: '', urlPattern: 'https://example\\.com/detail', replacement: 'Global' }] };
  state.storedConfig = { schemaVersion: 2, rules: [], globalTitleRule };
  const message = { type: 'page-style', url: 'https://example.com/detail' };
  const sender = { tab: { id: 1, windowId: 1 } };
  let style = await sendMessage(message, sender);
  assert.equal(style.ruleId, '__global-title__');
  assert.equal(style.highlight.enabled, false);
  assert.equal(applyTitleRules({ titleRule: style.titleRule }, 'App', message.url).result, 'Global');
  state.storedConfig.rules = [{ id: 'group', enabled: true, name: 'Work', patterns: ['*://example.com/*'], color: 'red',
    tabGroup: { enabled: false }, highlight: { enabled: true },
    titleRule: { enabled: true, rules: [{ titlePattern: '.*', replacement: 'Group' }] } }];
  style = await sendMessage(message, sender);
  assert.equal(style.ruleId, 'group');
  assert.equal(style.highlight.enabled, true);
  assert.equal(applyTitleRules({ titleRule: style.titleRule }, 'App', message.url).result, 'Global');
  message.url = 'https://example.com/other';
  style = await sendMessage(message, sender);
  assert.equal(applyTitleRules({ titleRule: style.titleRule }, 'App', message.url).result, 'Group');
  assert.equal(state.groupCalls.length, 0);
});

test('动作菜单显式选择覆盖默认配置，不把菜单或重命名当作折叠动作', async () => {
  reset();
  state.storedConfig = { schemaVersion: 2, clickAction: 'actionMenu', rules: [] };
  state.existingGroups = [{ id: 1, title: 'Work', collapsed: false, windowId: 1 }];
  const sender = { url: browser.runtime.getURL('src/ui/popup.html') };
  const sync = await sendMessage({ type: 'toolbar-execute', windowId: 1, action: 'sync' }, sender);
  assert.equal(sync.ok, true);
  assert.equal(state.updateCalls.length, 0);
  const collapse = await sendMessage({ type: 'toolbar-execute', windowId: 1, action: 'syncCollapseAll' }, sender);
  assert.equal(collapse.ok, true);
  assert.equal(state.updateCalls.length, 1);
  assert.equal(await sendMessage({ type: 'toolbar-execute', windowId: 1, action: 'renameTab' }, sender), undefined);
  assert.equal(await sendMessage({ type: 'toolbar-execute', windowId: 1, action: 'actionMenu' }, sender), undefined);
  await assert.rejects(Background.handleToolbarClick({ windowId: 1 }), /Unsupported sync action/);
});


test('页内主题切换只改变渲染色值，不改变规则或群组颜色枚举', async () => {
  reset();
  state.storedConfig = { schemaVersion: 2, colorTheme: 'classic', rules: [{
    id: 'work', name: 'Work', color: 'blue', patterns: ['https://example.com/*'], highlight: { enabled: true, border: { sides: ['top'] } }
  }] };
  const message = { type: 'page-style', url: 'https://example.com/a' };
  const sender = { tab: { id: 1, windowId: 1 } };
  assert.equal((await sendMessage(message, sender)).colorHex, '#1a73e8');
  state.storedConfig.colorTheme = 'vivid-dark';
  const style = await sendMessage(message, sender);
  assert.equal(style.colorHex, '#a8c6ff');
  assert.equal(style.ruleId, 'work');
  assert.equal(state.storedConfig.rules[0].color, 'blue');
  assert.equal(state.groupCalls.length, 0);
});


test('手动新建群组：命名过程中不前置，点击页面后整理，并覆盖手动移动后的遗漏', async () => {
  reset();
  state.storedConfig = { schemaVersion: 2, groupsFirst: true, rules: [] };
  const group = { id: 8001, windowId: 1, title: '' };
  const loose = { id: 801, index: 0, windowId: 1, groupId: -1, url: 'https://loose.example/' };
  const target = { id: 802, index: 1, windowId: 1, groupId: 8001, active: true, url: 'https://manual.example/' };
  state.existingGroups = [group];
  state.tabsByWindow = { 1: [loose, target] };
  await withGroupPositionUpdates(async () => {
    await listeners.groupCreated[0](group);
    listeners.updated[0](target.id, { groupId: group.id }, target);
    await Background.flush();
    assert.equal(state.moveCalls.length, 0, '空名称时不能移动');
    await listeners.activated[0]({ windowId: 1, tabId: target.id });
    await Background.flushWindowOrder();
    assert.equal(state.moveCalls.length, 0, '新建组自动激活标签不能提前解除命名保护');
    group.title = '工'; await listeners.groupUpdated[0](group);
    group.title = '工作'; await listeners.groupUpdated[0](group);
    await Background.flushWindowOrder();
    assert.equal(state.moveCalls.length, 0, '完成文字输入仍等待明确页面交互');
    await sendMessage({ type: 'tabpilot:page-interaction' }, { tab: target });
    await Background.flushWindowOrder();
    assert.deepEqual(state.moveCalls, [{ groupId: 8001, windowId: 1, index: 0 }]);
    assert.equal(state.groupCalls.length, 0);
    target.index = 1; loose.index = 0;
    listeners.groupMoved[0](group);
    await Background.flushWindowOrder();
    assert.equal(state.moveCalls.length, 2, '群组手动移动后也能重新前置');
  });
  state.tabsByWindow = {};
  await listeners.groupRemoved[0](group);
  await Background.flushWindowOrder();
});

test('已有群组改名：切换标签后解除保护，无需依赖命名停顿时长', async () => {
  reset();
  state.storedConfig = { schemaVersion: 2, groupsFirst: true, rules: [] };
  const group = { id: 8002, windowId: 2, title: '旧名称' };
  const tab = { id: 803, index: 1, windowId: 2, groupId: 8002, url: 'https://manual.example/' };
  state.existingGroups = [group];
  state.tabsByWindow = { 2: [{ id: 804, index: 0, windowId: 2, groupId: -1, url: 'https://loose.example/' }, tab] };
  await withGroupPositionUpdates(async () => {
    await listeners.groupCreated[0](group);
    await listeners.activated[0]({ windowId: 2, tabId: 804 });
    await Background.flushWindowOrder();
    state.moveCalls = [];
    tab.index = 1; state.tabsByWindow[2][0].index = 0;
    group.title = '新名称'; await listeners.groupUpdated[0](group);
    await Background.flushWindowOrder();
    assert.equal(state.moveCalls.length, 0);
    await listeners.activated[0]({ windowId: 2, tabId: 804 });
    await Background.flushWindowOrder();
    assert.equal(state.moveCalls.length, 1);
  });
  state.tabsByWindow = {};
  await listeners.groupRemoved[0](group);
  await Background.flushWindowOrder();
});
