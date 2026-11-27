import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_THEMES, COLOR_LABEL_SETS, themeColor } from '../src/core/color-themes.js';
import { GROUP_COLORS, GROUP_COLOR_HEX, DEFAULT_COLOR_THEME, colorHexOf, validateConfig, buildConfigFromRules, parseConfigText } from '../src/app/store.js';
import { appendRules } from '../src/core/append-rules.js';

test('经典主题保留原有渲染色值，未知颜色回退灰色', () => {
  assert.equal(colorHexOf({ color: 'blue' }, 'classic'), '#1a73e8');
  assert.equal(themeColor('invalid', 'classic'), GROUP_COLOR_HEX.grey);
});

test('主题缺省使用目标默认，显式经典或其他主题保留；非法导入被拒绝', () => {
  assert.equal(colorHexOf({ color: 'blue' }), COLOR_THEMES[DEFAULT_COLOR_THEME].colors.blue);
  assert.equal(validateConfig({ schemaVersion: 2, rules: [] }).ok, true);
  for (const colorTheme of [null, '', 'unknown', 42, ['classic'], {}]) {
    assert.equal(validateConfig({ schemaVersion: 2, rules: [], colorTheme }).ok, false);
  }
  const config = buildConfigFromRules([], 'sync', 'en', false, { colorTheme: 'classic' });
  assert.equal(config.colorTheme, 'classic');
  assert.equal(parseConfigText(JSON.stringify(config)).config.colorTheme, 'classic');
  assert.equal(appendRules(config, [], () => 'id').colorTheme, 'classic');
  assert.equal(parseConfigText(JSON.stringify({ ...config, colorTheme: 'invalid' }), { rulesOnly: true }).ok, true);
});


test('Edge 颜色名称对应其原生槽位，不受页内主题选择影响', () => {
  assert.equal(COLOR_LABEL_SETS.edge.red, '紫罗兰色');
  assert.equal(COLOR_LABEL_SETS.edge.green, '亮蓝色');
  assert.equal(COLOR_LABEL_SETS.edge.pink, '粉红');
  assert.equal(COLOR_LABEL_SETS.standard.red, '红色');
  assert.equal(COLOR_LABEL_SETS.standard.green, '绿色');
  assert.deepEqual(Object.keys(COLOR_LABEL_SETS.edge).sort(), [...GROUP_COLORS].sort());
});

const custom = () => ({ id: 'theme-test', name: '我的主题', colors: { ...COLOR_THEMES.classic.colors, blue: '#123456' } });

test('多套自定义主题随配置导出导入，追加导入保留本机主题', () => {
  const themes = [custom(), { ...custom(), id: 'theme-second', name: '另一套主题' }];
  const config = buildConfigFromRules([], 'sync', 'en', false, { colorTheme: 'theme-test', customColorThemes: themes });
  themes[0].colors.blue = '#ffffff';
  assert.equal(config.customColorThemes[0].colors.blue, '#123456', '构建配置不与编辑草稿共享色板');
  assert.equal(validateConfig(config).ok, true);
  assert.equal(colorHexOf({ color: 'blue' }, config.colorTheme, config.customColorThemes), '#123456');
  const imported = parseConfigText(JSON.stringify(config));
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.config.customColorThemes, config.customColorThemes);
  assert.deepEqual(appendRules(config, [], () => 'id').customColorThemes, config.customColorThemes);

});

test('自定义主题拒绝重复或内置标识、空名称、缺失颜色及非法色值和引用', () => {
  const invalid = [null, {}, [null], [custom(), custom()], [{ ...custom(), id: 'classic' }],
    [{ ...custom(), id: '' }], [{ ...custom(), name: ' ' }],
    [{ ...custom(), colors: { blue: '#123456' } }],
    [{ ...custom(), colors: { ...custom().colors, blue: '#fff' } }],
    [{ ...custom(), colors: { ...custom().colors, blue: 'red' } }]];
  for (const customColorThemes of invalid) {
    assert.equal(validateConfig({ schemaVersion: 2, rules: [], customColorThemes }).ok, false, JSON.stringify(customColorThemes));
  }
  assert.equal(validateConfig({ schemaVersion: 2, rules: [], colorTheme: 'missing', customColorThemes: [custom()] }).ok, false);
  assert.equal(validateConfig({ schemaVersion: 2, rules: [], colorTheme: 'classic', customColorThemes: [custom()] }).ok, true);
});
