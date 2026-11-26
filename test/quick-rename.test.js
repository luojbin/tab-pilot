import test from 'node:test';
import assert from 'node:assert/strict';
import { quickRenamePattern, addQuickRename, effectiveTitleRule, previewTitleRules, quickRenameContext } from '../src/core/quick-rename.js';
import { applyTitleRules, compilePattern } from '../src/core/title-rule.js';
import { validateConfig, buildConfigFromRules, parseConfigText } from '../src/app/store.js';
import { appendRules } from '../src/core/append-rules.js';
import { registerQuickRename } from '../src/app/quick-rename.js';
import { startQuickRename } from '../src/ui/quick-rename.js';

const spec = (rules, enabled = true) => ({ enabled, rules, testCases: [] });
const entry = (urlPattern, replacement, titlePattern = '') => ({ urlPattern, replacement, titlePattern });

test('快捷 URL 正则：转义元字符，精确匹配路径、参数和 hash', () => {
  const address = 'https://example.com/a.b+(x)?id=123&key=a.b#route';
  const regex = compilePattern(quickRenamePattern(address));
  assert.equal(regex.test(address), true);
  for (const variant of [address + '/more', address.replace('123', '124'), address.replace('a.b+', 'axb+'), address.replace('#route', '#other')]) {
    assert.equal(regex.test(variant), false, variant);
  }
  assert.throws(() => quickRenamePattern('about:config'));
});

test('忽略参数：允许无参数、任意参数；不吞路径或 hash', () => {
  const regex = compilePattern(quickRenamePattern('https://example.com/detail?id=1#route', true));
  for (const url of ['https://example.com/detail#route', 'https://example.com/detail?x=2#route', 'https://example.com/detail?#route']) {
    assert.equal(regex.test(url), true, url);
  }
  for (const url of ['https://example.com/detailOther#route', 'https://example.com/detail/a#route', 'https://example.com/detail?x=2#other', 'https://example.com/detail']) {
    assert.equal(regex.test(url), false, url);
  }
  const emptyHash = compilePattern(quickRenamePattern('https://example.com/detail?id=1#', true));
  assert.equal(emptyHash.test('https://example.com/detail?x=2#'), true);
  assert.equal(emptyHash.test('https://example.com/detail?x=2'), false);
});

test('快捷创建：字面标题美元转义，置前更新，保留原始配置和全局测试用例', () => {
  const config = { schemaVersion: 2, rules: [], globalTitleRule: { ...spec([entry('.*', 'fallback')]), testCases: [{ title: 'App', url: '' }] } };
  const title = '${url.1} $& $$';
  const next = addQuickRename(config, 'https://example.com/a', title, false);
  assert.equal(next.globalTitleRule.rules.length, 2);
  assert.equal(next.globalTitleRule.rules[0].description, `全局标题 | ${title}`);
  assert.equal(applyTitleRules({ titleRule: next.globalTitleRule }, 'App', 'https://example.com/a').result, title);
  assert.equal(config.globalTitleRule.rules.length, 1);
  const updated = addQuickRename(next, 'https://example.com/a', 'New', false);
  assert.equal(updated.globalTitleRule.rules.length, 2);
  assert.equal(updated.globalTitleRule.rules[0].replacement, 'New');
  assert.equal(updated.globalTitleRule.rules[0].description, '全局标题 | New');
  assert.equal(addQuickRename(config, 'https://example.com/a', 'New', true, 'en').globalTitleRule.rules[0].description,
    'Global title | New');
  assert.deepEqual(updated.globalTitleRule.testCases, config.globalTitleRule.testCases);
});

test('全局优先且支持双源捕获，未命中回退组内；关闭全局后组内继续生效', () => {
  const global = spec([entry('https://example.com/(.*)', '${title.1}-${url.1}', 'App (.*)')]);
  const group = spec([entry('.*', 'Group')]);
  const apply = (g, title, url) => applyTitleRules({ titleRule: effectiveTitleRule(g, group) }, title, url);
  assert.equal(apply(global, 'App Work', 'https://example.com/a').result, 'Work-a');
  assert.equal(apply(global, 'Other', 'https://example.com/a').result, 'Group');
  assert.equal(apply(global, 'App Work', 'https://other.com/a').result, 'Group');
  assert.equal(apply({ ...global, enabled: false }, 'App Work', 'https://example.com/a').result, 'Group');
  assert.equal(applyTitleRules({ titleRule: effectiveTitleRule(global) }, 'App Work', 'https://example.com/a').result, 'Work-a');
  assert.equal(effectiveTitleRule(global, undefined, 'https://other.com/a').enabled, false,
    '无关 URL 不开启额外标题监听');
});

test('全局规则：可选字段兼容、非法条件定位、保存导出与追加导入保留', () => {
  assert.equal(validateConfig({ schemaVersion: 2, rules: [] }).ok, true);
  const global = spec([entry('[', 'New')]);
  const invalid = validateConfig({ schemaVersion: 2, rules: [], globalTitleRule: global });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorDetails[0].ruleIndex, undefined);
  assert.equal(invalid.errorDetails[0].path, 'globalTitleRule.rules[0].urlPattern');
  global.rules[0].urlPattern = '.*';
  const built = buildConfigFromRules([], 'sync', 'en', false, { globalTitleRule: global });
  assert.equal(validateConfig(built).ok, true);
  assert.deepEqual(parseConfigText(JSON.stringify(built)).config.globalTitleRule, global);
  assert.deepEqual(appendRules(built, [], () => 'id').globalTitleRule, global);
  assert.equal(parseConfigText(JSON.stringify({ ...built, globalTitleRule: 42 }), { rulesOnly: true }).ok, true);
});

function fixture(namespace = 'menus') {
  const installed = [], clicked = [], opened = [], menus = [], messages = [];
  let config = { schemaVersion: 2, rules: [] };
  const tab = { id: 7, windowId: 1, url: 'https://example.com/detail?id=1', title: 'App' };
  const api = { runtime: { onInstalled: { addListener(fn) { installed.push(fn); } }, getURL: path => `extension://${path}` },
    i18n: { getMessage: () => 'Rename tab' },
    [namespace]: { async remove() {}, create(value, cb) { menus.push(value); cb(); }, onClicked: { addListener(fn) { clicked.push(fn); } } },
    action: { async openPopup(value) { opened.push(value); } },
    storage: { local: { data: {}, async get(key) { return { [key]: this.data[key] }; }, async set(data) { Object.assign(this.data, data); } } },
    tabs: { async query() { return [tab]; }, async get() { return tab; }, async sendMessage(id, message) { messages.push({ id, message }); } } };
  const store = { async loadConfig() { return { config }; }, async saveConfig(next) { config = next; return { ok: true }; } };
  const controller = registerQuickRename(api, store);
  const sender = { url: api.runtime.getURL('src/ui/popup.html') };
  const send = (value, source = sender) => new Promise(resolve => {
    if (controller.handleMessage({ tabId: 7, ...value }, source, resolve) !== true) resolve(undefined);
  });
  return { api, store, tab, installed, clicked, opened, menus, messages, send, get config() { return config; } };
}

for (const namespace of ['menus', 'contextMenus']) {
  test(`快捷入口 ${namespace}：右键目标标签、工具栏 popup、保存及刷新，不依赖活动标签`, async () => {
    const f = fixture(namespace);
    await f.installed[0]();
    assert.deepEqual(f.menus[0].contexts, ['tab']);
    await f.clicked[0]({ menuItemId: 'tabpilot-quick-rename' }, f.tab);
    assert.deepEqual(f.opened[0], { windowId: 1 });
    assert.equal((await f.send({ type: 'quick-rename-pending', windowId: 1 })).title, '');
    assert.equal(await f.send({ type: 'quick-rename-pending', windowId: 1 }), null);
    const result = await f.send({ type: 'quick-rename-save', url: f.tab.url, title: 'Details', ignoreQuery: true });
    assert.equal(result.ok, true);
    assert.equal(f.config.globalTitleRule.rules[0].replacement, 'Details');
    assert.equal(f.messages[0].id, 7);
    assert.deepEqual(f.config.rules, []);
  });
}

test('快捷保存：拒绝网页来源、空标题和已导航页面；投递失败仍保留规则', async () => {
  const f = fixture();
  const message = { type: 'quick-rename-save', url: f.tab.url, title: 'New', ignoreQuery: false };
  assert.equal(await f.send(message, { tab: f.tab, url: f.tab.url }), undefined);
  assert.equal((await f.send({ ...message, title: ' ' })).ok, false);
  f.tab.url += '&changed=1';
  assert.equal((await f.send(message)).reason, 'stale');
  assert.equal(f.config.globalTitleRule, undefined);
  f.api.tabs.sendMessage = async () => { throw new Error('no content script'); };
  assert.deepEqual(await f.send({ ...message, url: f.tab.url }), { ok: true, refreshFailed: true });
  assert.equal(f.config.globalTitleRule.rules.length, 1);
});

function popupFixture(request = { ok: true, tabId: 7, url: 'https://example.com/a', title: '', previousRule: null }) {
  const elements = Object.fromEntries(['panel', 'popupHeader', 'renameForm', 'renameTitle', 'ignoreQuery', 'ignoreQueryLabel', 'confirmRename', 'cancelRename', 'resetRename', 'renameOptions', 'status'].map(id => [id, {
    handlers: {}, value: '', checked: false, classList: { add(value) { this.value = value; } }, setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; }, focus() {}, select() {}
  }]));
  const messages = [];
  let closed = 0, opened = 0;
  const api = { runtime: { async openOptionsPage() { opened++; }, async sendMessage(value) { messages.push(value); return { ok: true }; } } };
  const timers = new Map();
  let sequence = 0;
  const view = { close() { closed++; }, setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; } };
  const advance = () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); return timer.ms; };
  const run = preferences => startQuickRename(api, { getElementById: id => elements[id] }, view, request, preferences);
  return { api, elements, messages, run, timers, advance, get closed() { return closed; }, get opened() { return opened; } };
}

test('重命名 popup：输入默认空、参数默认不勾，确认写入，取消不写配置', async () => {
  const f = popupFixture();
  await f.run();
  assert.equal(f.elements.popupHeader.hidden, true);
  assert.equal(f.elements.renameTitle.value, '');
  assert.equal(f.elements.ignoreQuery.checked, false);
  assert.equal(f.elements.status.hidden, true);
  f.elements.renameTitle.value = 'New';
  f.elements.ignoreQuery.checked = true;
  await f.elements.renameForm.handlers.submit({ preventDefault() {} });
  assert.deepEqual(f.messages.map(message => message.type), ['quick-rename-save']);
  assert.equal(f.messages[0].ignoreQuery, true);
  assert.equal(f.closed, 0);
  assert.equal(f.elements.renameForm.hidden, true);
  assert.ok(f.elements.status.textContent.includes('New'));
  assert.equal(f.advance(), 3000);
  assert.equal(f.elements.panel.classList.value, 'fading');
  assert.equal(f.advance(), 300);
  assert.equal(f.closed, 1);
  const canceled = popupFixture();
  await canceled.run();
  canceled.elements.cancelRename.handlers.click();
  assert.equal(canceled.messages.length, 0);
  assert.equal(canceled.closed, 1);
});

test('重命名 popup：已有标题回填；重置删除原规则，无规则重置等价取消', async () => {
  const previousRule = entry('https://example.com/a', 'Existing');
  const f = popupFixture({ ok: true, tabId: 7, url: 'https://example.com/a', title: 'Existing', previousRule });
  await f.run();
  assert.equal(f.elements.renameTitle.value, 'Existing');
  await f.elements.resetRename.handlers.click();
  assert.equal(f.messages[0].type, 'quick-rename-reset');
  assert.deepEqual(f.messages[0].previousRule, previousRule);
  assert.equal(f.closed, 0);
  assert.ok(f.elements.status.textContent.includes('Existing'));
  assert.equal(f.advance(), 3000);
  assert.equal(f.advance(), 300);
  assert.equal(f.closed, 1);
  const empty = popupFixture();
  await empty.run();
  await empty.elements.resetRename.handlers.click();
  assert.equal(empty.closed, 1);
  assert.equal(empty.messages.length, 0);
});

test('旧 Chromium 不支持标签菜单时安全降级；多个窗口保存不会丢规则', async () => {
  const f = fixture('contextMenus');
  f.api.contextMenus.create = () => { throw new Error('unsupported context'); };
  await assert.doesNotReject(f.installed[0]());
  const message = { type: 'quick-rename-save', url: f.tab.url, title: 'Precise', ignoreQuery: false };
  await Promise.all([f.send(message), f.send({ ...message, title: 'General', ignoreQuery: true })]);
  assert.equal(f.config.globalTitleRule.rules.length, 2);
  assert.equal(f.config.globalTitleRule.rules[0].replacement, 'General');
});


test('组内重命名预览：先检查全局，标明来源并保留原列表序号', () => {
  const global = spec([entry('https://example\\.com/other', 'Other'),
    entry('https://example\\.com/a', 'Global')]);
  const group = spec([entry('https://example\\.com/b', 'Group')]);
  const rows = [{ title: 'App', url: 'https://example.com/a' },
    { title: 'App', url: 'https://example.com/b' }, { title: 'App', url: 'https://example.com/c' }];
  const results = previewTitleRules(global, group, rows);
  assert.deepEqual(results.map(row => [row.result, row.ruleScope, row.ruleIndex]),
    [['Global', 'global', 1], ['Group', 'group', 0], ['App', null, null]]);
  const disabled = previewTitleRules({ ...global, enabled: false }, group, rows);
  assert.equal(disabled[0].matched, false);
  assert.equal(disabled[1].ruleScope, 'group');
  assert.equal(disabled[1].ruleIndex, 0);
  const onlyGlobal = previewTitleRules(global, undefined, rows);
  assert.equal(onlyGlobal[0].ruleScope, 'global');
  assert.equal(onlyGlobal[1].matched, false);
});

test('组内预览检查匹配路径：不匹配当前组时跳过组内规则，但保留全局结果', () => {
  const currentGroup = { patterns: ['https://work.example/*'] };
  const global = spec([entry('https://other\\.example/global', 'Global')]);
  const group = spec([entry('.*', 'Group')]);
  const rows = ['https://work.example/a', 'https://other.example/a', 'https://other.example/global', '']
    .map(url => ({ title: 'App', url }));
  const results = previewTitleRules(global, group, rows, currentGroup);
  assert.deepEqual(results.map(row => [row.result, row.groupMatched, row.ruleScope]), [
    ['Group', true, 'group'], ['App', false, null], ['Global', false, 'global'], ['App', false, null]
  ]);
  assert.equal(previewTitleRules(global, undefined, rows)[2].groupMatched, null,
    '全局编辑器不检查规则组归属');
});


test('已有快捷规则：识别并回填字面目标，切换参数选项更新原规则，重置只删除该规则', async () => {
  const f = fixture();
  const original = { type: 'quick-rename-save', url: f.tab.url, title: '$Original', ignoreQuery: true };
  await f.send(original);
  // 另一条宽泛的手写规则必须保留。
  f.config.globalTitleRule.rules.push({ titlePattern: '', urlPattern: '.*', replacement: 'Generic', description: 'Manual' });
  await f.clicked[0]({ menuItemId: 'tabpilot-quick-rename' }, f.tab);
  const loaded = await f.send({ type: 'quick-rename-pending', windowId: 1 });
  assert.equal(loaded.title, '$Original');
  assert.ok(loaded.previousRule);
  const updated = await f.send({ ...original, title: 'Updated', ignoreQuery: false, previousRule: loaded.previousRule });
  assert.equal(updated.ok, true);
  assert.equal(f.config.globalTitleRule.rules.length, 2);
  assert.equal(f.config.globalTitleRule.rules[0].urlPattern, quickRenamePattern(f.tab.url));
  const previousRule = f.config.globalTitleRule.rules[0];
  const reset = await f.send({ type: 'quick-rename-reset', url: f.tab.url, previousRule });
  assert.equal(reset.ok, true);
  assert.equal(f.config.globalTitleRule.rules.length, 1);
  assert.equal(f.config.globalTitleRule.rules[0].replacement, 'Generic');
  assert.equal((await f.send({ ...original, previousRule })).reason, 'stale-rule');
});

test('无快捷规则重置不保存配置，旧浏览器 openPopup 失败可点击图标读取目标', async () => {
  const f = fixture();
  let writes = 0;
  f.store.saveConfig = async () => { writes++; return { ok: true }; };
  assert.equal((await f.send({ type: 'quick-rename-reset', url: f.tab.url, previousRule: null })).ok, true);
  assert.equal(writes, 0);
  f.api.action.openPopup = async () => { throw new Error('not supported'); };
  await f.clicked[0]({ menuItemId: 'tabpilot-quick-rename' }, f.tab);
  assert.equal((await f.send({ type: 'quick-rename-pending', windowId: 1 })).tabId, 7);
});

test('重命名目标已关闭：消费请求并返回目标信息，不误执行普通工具栏动作', async () => {
  const f = fixture();
  await f.clicked[0]({ menuItemId: 'tabpilot-quick-rename' }, f.tab);
  f.api.tabs.get = async () => { throw new Error('closed tab'); };
  const result = await f.send({ type: 'quick-rename-pending', windowId: 1 });
  assert.equal(result.tabId, 7);
  assert.equal(result.ok, false);
  assert.equal(await f.send({ type: 'quick-rename-pending', windowId: 1 }), null);
});


test('快捷入口识别生效来源：全局通用优先，未命中后才使用所属组，精确快捷规则仍可删除', () => {
  const tab = { id: 7, url: 'https://example.com/a', title: 'Renamed' };
  const config = { schemaVersion: 2, globalTitleRule: spec([entry('https://example\\.com/.*', 'Global', 'App')]),
    rules: [{ id: 'work', name: 'Work', patterns: ['https://example.com/*'],
      titleRule: spec([entry('', 'Group', 'App')]) }] };
  assert.deepEqual(quickRenameContext(config, tab, 'App'), { title: '', previousRule: null, managedSource: 'global' });
  config.globalTitleRule.enabled = false;
  assert.deepEqual(quickRenameContext(config, tab, 'App'), { title: '', previousRule: null, managedSource: 'group' });
  const quick = addQuickRename(config, tab.url, 'Quick', false);
  const context = quickRenameContext(quick, tab, 'App');
  assert.equal(context.managedSource, null);
  assert.equal(context.previousRule.replacement, 'Quick');
});

for (const managedSource of ['global', 'group']) {
  test(`重置 ${managedSource} 通用规则：解释来源、显示配置入口，不删除规则`, async () => {
    const f = popupFixture({ ok: true, tabId: 7, url: 'https://example.com/a', title: 'Managed', previousRule: null, managedSource });
    await f.run();
    assert.equal(f.elements.renameOptions.hidden, true);
    assert.equal(f.elements.renameTitle.value, '', '通用规则和组内规则不回填标题');
    await f.elements.resetRename.handlers.click();
    assert.equal(f.closed, 0);
    assert.equal(f.messages.length, 0);
    assert.equal(f.elements.status.hidden, false);
    assert.equal(f.elements.renameOptions.hidden, false);
    assert.match(f.elements.status.textContent, managedSource === 'global' ? /global|全局/ : /group|组内/);
    await f.elements.renameOptions.handlers.click();
    assert.equal(f.opened, 1);
    assert.equal(f.closed, 1);
  });
}

test('后台使用页面原标题识别组内来源，无快捷规则重置不写配置；删除快捷规则后告知组内回退', async () => {
  const f = fixture();
  f.config.rules.push({ id: 'work', name: 'Work', patterns: ['https://example.com/*'],
    titleRule: spec([entry('', 'Group', 'App')]) });
  f.tab.title = 'Group';
  f.api.tabs.sendMessage = async () => ({ url: f.tab.url, title: 'App' });
  await f.clicked[0]({ menuItemId: 'tabpilot-quick-rename' }, f.tab);
  const pending = await f.send({ type: 'quick-rename-pending', windowId: 1 });
  assert.equal(pending.managedSource, 'group');
  assert.equal(pending.title, '');
  const untouched = JSON.stringify(f.config);
  const reset = await f.send({ type: 'quick-rename-reset', url: f.tab.url, previousRule: null });
  assert.equal(reset.managedSource, 'group');
  assert.equal(JSON.stringify(f.config), untouched);
  await f.send({ type: 'quick-rename-save', url: f.tab.url, title: 'Quick', ignoreQuery: false });
  const previousRule = f.config.globalTitleRule.rules[0];
  const removed = await f.send({ type: 'quick-rename-reset', url: f.tab.url, previousRule });
  assert.equal(removed.managedSource, 'group');
  assert.equal(f.config.globalTitleRule.rules.length, 0);
});


for (const source of ['global', 'group']) {
  test(`删除快捷规则后回退 ${source}：提示被删标题，保留绿色提示及配置入口`, async () => {
    const title = '$& <原目标标题>';
    const f = popupFixture({ ok: true, tabId: 7, url: 'https://example.com/a', title,
      previousRule: entry('https://example.com/a', title) });
    f.api.runtime.sendMessage = async () => ({ ok: true, managedSource: source });
    await f.run();
    f.elements.renameTitle.value = '尚未保存的输入';
    await f.elements.resetRename.handlers.click();
    assert.equal(f.closed, 0);
    assert.equal(f.elements.status.className, 'success');
    assert.equal(f.elements.renameOptions.hidden, false);
    assert.ok(f.elements.status.textContent.includes(title));
    assert.equal(f.elements.status.textContent.includes('尚未保存的输入'), false);
    const text = f.elements.status.textContent;
    await f.elements.resetRename.handlers.click();
    assert.equal(f.elements.status.textContent, text, '再次重置保留删除成功提示');
  });
}


for (const resetting of [false, true]) {
  test(`关闭操作结果提示：${resetting ? '删除' : '保存'}成功后直接关闭，无淡出计时`, async () => {
    const f = popupFixture({ ok: true, tabId: 7, url: 'https://example.com/a', title: 'Old',
      previousRule: entry('https://example.com/a', 'Old') });
    await f.run({ showActionResult: false });
    f.elements.renameTitle.value = 'New';
    if (resetting) await f.elements.resetRename.handlers.click();
    else await f.elements.renameForm.handlers.submit({ preventDefault() {} });
    assert.equal(f.closed, 1);
    assert.equal(f.timers.size, 0);
    assert.equal(f.elements.status.hidden, true);
  });
}

test('关闭操作结果提示仍保留配置维护入口，隐藏删除成功前缀且不自动关闭', async () => {
  const f = popupFixture({ ok: true, tabId: 7, url: 'https://example.com/a', title: 'Old',
    previousRule: entry('https://example.com/a', 'Old') });
  f.api.runtime.sendMessage = async () => ({ ok: true, managedSource: 'group' });
  await f.run({ showActionResult: false });
  await f.elements.resetRename.handlers.click();
  assert.equal(f.closed, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.elements.renameOptions.hidden, false);
  assert.equal(f.elements.status.textContent.includes('Old'), false);
});


test('图标重命名：按当前窗口查询活动标签，并拒绝内部页面', async () => {
  const f = fixture();
  let queried;
  f.api.tabs.query = async query => { queried = query; return [f.tab]; };
  const result = await f.send({ type: 'quick-rename-active', windowId: 3 });
  assert.deepEqual(queried, { active: true, windowId: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.tabId, 7);
  f.tab.url = 'about:config';
  assert.equal((await f.send({ type: 'quick-rename-active', windowId: 3 })).ok, false);
});
