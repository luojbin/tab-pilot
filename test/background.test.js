/**
 * background 编排层测试
 *
 * 用一个极简 browser 桩模拟浏览器环境，验证“事件 → 防抖合并 → 读配置 →
 * 匹配 → 执行动作 → 记日志”这条链路，以及幂等、同步与配置回退行为。
 * 真实 tabGroups API 的形态已在 Firefox 实机验证。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// 按 manifest.json 中 background.scripts 的顺序加载，确保全局层已就绪
require('../src/core/highlight.js');
require('../src/core/title-rule.js');
require('../src/app/store.js');
require('../src/core/logger.js');
require('../src/core/rules.js');
require('../src/app/actions.js');

const state = {
  tabsByWindow: {},
  existingGroups: [],
  storedConfig: null,
  groupCalls: [],
  updateCalls: [],
  pageMessages: []
};

const listeners = { created: [], updated: [], actionClicked: [], message: [], configChanged: [] };

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
    async query(queryInfo) {
      const windowId = queryInfo ? queryInfo.windowId : undefined;
      if (windowId === undefined) {
        return Object.keys(state.tabsByWindow).flatMap((key) => state.tabsByWindow[key]);
      }
      return state.tabsByWindow[windowId] || [];
    },
    async group(options) {
      state.groupCalls.push(options);
      return options.createProperties ? 42 : options.groupId;
    },
    onCreated: { addListener(fn) { listeners.created.push(fn); } },
    onUpdated: { addListener(fn) { listeners.updated.push(fn); } },
    async sendMessage(tabId, message) {
      state.pageMessages.push({ tabId, message });
    }
  },
  tabGroups: {
    async query() {
      return state.existingGroups;
    },
    async update(id, patch) {
      state.updateCalls.push({ id, patch });
    }
  },
  action: {
    onClicked: { addListener(fn) { listeners.actionClicked.push(fn); } }
  },
  runtime: {
    getManifest() {
      return { version: '0.2.0' };
    },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(fn) { listeners.message.push(fn); } }
  }
};

require('../src/app/background.js');

const Background = globalThis.TabPilotBackground;
const Debug = globalThis.TabPilotDebug;
const Logger = globalThis.TabPilotLogger;

function reset() {
  state.tabsByWindow = {};
  state.existingGroups = [];
  state.storedConfig = null;
  state.groupCalls = [];
  state.updateCalls = [];
  state.pageMessages = [];
  Logger.clear();
}

function rule(overrides) {
  return {
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

test('background 注册了事件、工具栏与消息监听', () => {
  assert.equal(listeners.created.length, 1);
  assert.equal(listeners.updated.length, 1);
  assert.equal(listeners.actionClicked.length, 1);
  assert.equal(listeners.message.length, 1);
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

test('全局暂停时不执行任何动作', async () => {
  reset();
  state.storedConfig = configWith([rule({})], false);
  const tab = localhostTab(6, 11);
  state.tabsByWindow[11] = [tab];

  Background.schedule(tab);
  await Background.flush();

  assert.equal(state.groupCalls.length, 0);
  assert.ok(Logger.recent().some((entry) => /全局暂停/.test(entry.message)));
});

test('阈值未达成时按窗口内标签数判断，不归组', async () => {
  reset();
  state.storedConfig = githubConfig(3);
  const tab = { id: 7, windowId: 12, url: 'https://www.github.com/a', groupId: -1 };
  state.tabsByWindow[12] = [tab, { id: 8, windowId: 12, url: 'https://gist.github.com/b' }];

  Background.schedule(tab);
  await Background.flush();

  assert.equal(state.groupCalls.length, 0, '只有 2 个 github 标签，未达阈值 3');
  const miss = Logger.recent().find((entry) => entry.message.startsWith('无规则命中'));
  assert.match(miss.message, /数量不足（2\/3）/);
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

  await listeners.actionClicked[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));

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
  assert.equal(github[0].minTabs, 2);
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
  assert.equal(style.colorHex, '#1e8e3e');
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
  assert.equal(style.titleRule.rules[0].pattern, '工作');
  assert.equal(style.highlight.enabled, false);
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
