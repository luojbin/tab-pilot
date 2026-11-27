import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Store from '../src/app/store.js';
import * as Highlight from '../src/core/highlight.js';
import * as TitleRule from '../src/core/title-rule.js';
import { normalizeTabGroup } from '../src/core/tab-group.js';
import { customTheme } from '../src/core/color-themes.js';

const source = fs.readFileSync(new URL('../src/ui/options.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
function setup(extra = {}) {
  const context = vm.createContext({ Store, Highlight, TitleRule, normalizeTabGroup, t: text => text,
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

test('主题选择即时更新色块、计入未保存状态，切回原主题后恢复干净状态', () => {
  const element = () => ({ style: {}, children: [], handlers: {}, setAttribute() {},
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    addEventListener(type, fn) { this.handlers[type] = fn; } });
  let rendered = 0;
  const context = setup({ document: { createElement: element, createTextNode: text => ({ textContent: text }) },
    t: text => text, COLOR_LABEL: Object.fromEntries(Store.GROUP_COLORS.map(color => [color, color])),
    customTheme, renderGlobalDetail() { context.syncDirtyState(); },
    renderList() { rendered++; } });
  context.state.colorTheme = 'classic';
  context.state.rules = [{ color: 'blue' }];
  context.savedSnapshot = context.snapshot();
  vm.runInContext(section('function colorHex(', 'function snapshot()'), context);
  vm.runInContext(section('function createColorThemeBlock()', 'function renderGlobalDetail()'), context);
  const block = context.createColorThemeBlock();
  const select = block.children[1].children[0].children.find(child => child.className === 'color-theme-select');
  assert.equal(select.children.length, 9);
  select.value = 'vivid-dark';
  select.handlers.change();
  assert.equal(context.state.colorTheme, 'vivid-dark');
  assert.equal(context.colorHex('blue'), '#a8c6ff');
  assert.equal(context.els.save.disabled, false);
  assert.equal(context.state.rules[0].color, 'blue');
  select.value = 'classic';
  select.handlers.change();
  assert.equal(context.els.save.disabled, true);
  assert.equal(rendered, 2);
});

test('自定义主题可连续复制、命名、改色、切换和删除，色板互不影响', () => {
  const element = tag => ({ tag, style: {}, children: [], handlers: {}, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    get options() { return this.children; },
    get selectedIndex() { return this.children.findIndex(item => item.value === this.value); } });
  let block, sequence = 0, confirm = false;
  const context = setup({ document: { createElement: element, createTextNode: text => ({ textContent: text }) },
    window: { confirm: () => confirm }, customTheme, newRuleId: () => String(++sequence),
    COLOR_LABEL: Object.fromEntries(Store.GROUP_COLORS.map(color => [color, color])), renderList() {},
    renderGlobalDetail() { block = context.createColorThemeBlock(); context.syncDirtyState(); } });
  context.state.colorTheme = 'classic';
  context.state.customColorThemes = [];
  context.savedSnapshot = context.snapshot();
  vm.runInContext(section('function colorHex(', 'function snapshot()'), context);
  vm.runInContext(section('function createColorThemeBlock()', 'function renderGlobalDetail()'), context);
  context.renderGlobalDetail();
  const controls = () => block.children.find(child => child.className === 'theme-actions');
  const select = () => block.children[1].children[0].children.find(child => child.className === 'color-theme-select');
  block.children[1].children[1].handlers.click();
  const firstId = context.state.colorTheme;
  assert.equal(context.state.customColorThemes.length, 1);
  assert.equal(context.els.save.disabled, false);
  const name = controls().children[0].children.find(child => child.tag === 'input');
  name.value = '全局配置';
  name.handlers.input();
  assert.equal(context.state.customColorThemes[0].name, '全局配置');
  assert.equal(select().options.at(-1).textContent, '[自定义] 全局配置');
  assert.equal(select().options.at(-1).attributes['data-i18n-skip'], '');
  const swatches = block.children.find(child => child.className === 'theme-swatches');
  const blue = swatches.children[Store.GROUP_COLORS.indexOf('blue')].children[0];
  const hex = swatches.children[Store.GROUP_COLORS.indexOf('blue')].children[2];
  blue.value = '#123456'; blue.handlers.input();
  assert.equal(hex.value, '123456', '原生颜色选择同步 HEX 输入框');
  hex.value = '#ABCDEF'; hex.handlers.input();
  assert.equal(context.colorHex('blue'), '#abcdef', '接受带井号的大写 HEX');
  assert.equal(blue.value, '#abcdef');
  hex.value = '123456'; hex.handlers.input();
  assert.equal(context.colorHex('blue'), '#123456');
  hex.value = 'invalid'; hex.handlers.input();
  assert.equal(hex.attributes['aria-invalid'], 'true');
  assert.equal(context.colorHex('blue'), '#123456', '非法输入不污染主题');
  hex.handlers.blur();
  assert.equal(hex.value, '123456', '离开输入框时还原最近有效色值');
  assert.equal(Store.COLOR_THEMES.classic.colors.blue, '#1a73e8');
  block.children[1].children[1].handlers.click();
  assert.equal(context.state.customColorThemes.length, 2);
  assert.equal(context.colorHex('blue'), '#123456');
  context.state.customColorThemes[1].colors.blue = '#654321';
  assert.equal(context.state.customColorThemes[0].colors.blue, '#123456');
  select().value = firstId; select().handlers.change();
  assert.equal(context.colorHex('blue'), '#123456');
  controls().children.at(-1).handlers.click();
  assert.equal(context.state.customColorThemes.length, 2, '取消删除保持不变');
  confirm = true;
  controls().children.at(-1).handlers.click();
  assert.equal(context.state.customColorThemes.length, 1);
  assert.equal(context.state.colorTheme, Store.DEFAULT_COLOR_THEME);
});
