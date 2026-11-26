import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Store from '../src/app/store.js';
import * as Highlight from '../src/core/highlight.js';
import * as TitleRule from '../src/core/title-rule.js';
import { normalizeTabGroup } from '../src/core/tab-group.js';

const source = fs.readFileSync(new URL('../src/ui/options.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
function setup(extra = {}) {
  const context = vm.createContext({ Store, Highlight, TitleRule, normalizeTabGroup,
    state: { rules: [] }, savedSnapshot: '', busy: false,
    els: { addRule: {}, save: {}, reload: {} }, syncExportState() {}, ...extra });
  vm.runInContext(section('function snapshot()', 'function selectedRule()'), context);
  vm.runInContext(section('function syncDirtyState()', '/**\n * 导出只针对'), context);
  vm.runInContext(section('function editableRule(', 'function applyConfig('), context);
  return context;
}

test('颜色菜单点击立即更新保存状态，选回原色恢复禁用', () => {
  const element = () => ({ style: {}, children: [], handlers: {},
    setAttribute() {}, append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    querySelectorAll() { return this.children; } });
  const rule = { id: 'a', color: 'blue' };
  const context = setup({ document: { createElement: element }, createIcon: element,
    colorHex: value => value, COLOR_LABEL: {}, closeColorMenu: null, updateListItem() {} });
  context.state.rules = [rule];
  context.savedSnapshot = context.snapshot();
  vm.runInContext(section('function createColorPicker(', 'function renderDetail('), context);
  const menu = context.createColorPicker(rule).children[1];
  const choose = color => menu.children[Store.GROUP_COLORS.indexOf(color)].handlers.click({ stopPropagation() {} });
  choose('red');
  assert.equal(rule.color, 'red');
  assert.equal(context.els.save.disabled, false);
  assert.equal(context.els.reload.disabled, false);
  choose('blue');
  assert.equal(context.els.save.disabled, true);
  assert.equal(context.els.reload.disabled, true);
});

test('放弃修改重新读取稀疏配置后，渲染和切换规则组不产生脏状态', async () => {
  const config = { schemaVersion: 2, rules: [
    { id: 'a', name: 'A', patterns: ['https://a/*'] },
    { id: 'b', name: 'B', patterns: ['https://b/*'] }
  ] };
  const context = setup({ Store: { ...Store, async loadConfig() { return { config, source: 'storage' }; } },
    GLOBAL_ID: 'global', GLOBAL_TITLE_ID: 'global-title', loadSelected: () => 'a', persistSelected() {},
    setLanguage() {}, resolveLanguage: x => x, applyI18n() {}, document: {}, closeMenus() {},
    renderList() {}, renderDetail() {}, markInvalid() {}, setStatus() {} });
  context.renderDetail = () => {
    const rule = context.state.rules.find(rule => rule.id === context.state.selectedId);
    rule.tabGroup = normalizeTabGroup(rule);
    rule.highlight = Highlight.normalizeHighlight(rule);
    rule.titleRule = TitleRule.normalizeTitleRule(rule);
  };
  vm.runInContext(section('async function load()', 'async function reset()'), context);
  await context.load();
  context.state.rules[0].name = 'changed';
  context.syncDirtyState();
  assert.equal(context.els.save.disabled, false);
  await context.load();
  assert.equal(context.els.save.disabled, true);
  assert.equal(context.els.reload.disabled, true);
  context.state.selectedId = 'b';
  context.renderDetail();
  context.syncDirtyState();
  assert.equal(context.els.save.disabled, true);
  assert.equal(config.rules[0].highlight, undefined, '不改变读取的原始配置');
});

test('外部快捷规则更新：无编辑时重读，有编辑时保留草稿并阻止覆盖保存', async () => {
  let changed, reads = 0;
  const context = setup({ externalConfigChanged: false,
    browser: { storage: { onChanged: { addListener(fn) { changed = fn; } } } },
    async load() { reads++; }, setStatus() {} });
  context.state.rules = [{ name: 'Original' }];
  context.savedSnapshot = context.snapshot();
  vm.runInContext(section('browser.storage.onChanged.addListener(', "document.addEventListener('input', syncDirtyState);"), context);
  changed({ [Store.CONFIG_KEY]: {} }, 'local');
  assert.equal(reads, 1);
  context.state.rules[0].name = 'Draft';
  changed({ [Store.CONFIG_KEY]: {} }, 'local');
  assert.equal(reads, 1);
  assert.equal(context.state.rules[0].name, 'Draft');
  assert.equal(context.externalConfigChanged, true);
  vm.runInContext(section('async function persist(', 'async function save()'), context);
  assert.equal(await context.persist('保存'), false);
});
