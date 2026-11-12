const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONFIG,
  GROUP_COLORS,
  SCHEMA_VERSION,
  validateConfig,
  clone
} = require('../src/store.js');

function validConfig() {
  return clone(DEFAULT_CONFIG);
}

test('默认配置能通过校验', () => {
  const result = validateConfig(validConfig());
  assert.equal(result.ok, true);
  assert.equal(result.config.schemaVersion, SCHEMA_VERSION);
});

test('clone 产生独立副本', () => {
  const copy = clone(DEFAULT_CONFIG);
  copy.rules[0].match.minTabs = 99;
  assert.equal(DEFAULT_CONFIG.rules[0].match.minTabs, 1);
});

test('schemaVersion 不符时拒绝', () => {
  const config = validConfig();
  config.schemaVersion = 2;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
});

test('globalEnabled 非布尔值被拒绝', () => {
  const config = validConfig();
  config.globalEnabled = 'true';
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /globalEnabled/);
});

test('rules 不是数组时拒绝', () => {
  const config = validConfig();
  config.rules = {};
  assert.equal(validateConfig(config).ok, false);
});

test('重复 id 被拒绝', () => {
  const config = validConfig();
  config.rules.push(clone(config.rules[0]));
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /重复/);
});

test('minTabs 必须 >= 1 的整数', () => {
  for (const bad of [0, 1.5, -2, '2', null]) {
    const config = validConfig();
    config.rules[0].match.minTabs = bad;
    assert.equal(validateConfig(config).ok, false, `minTabs=${JSON.stringify(bad)} 应被拒绝`);
  }
  const okConfig = validConfig();
  okConfig.rules[0].match.minTabs = 3;
  assert.equal(validateConfig(okConfig).ok, true);
});

test('未知分组颜色被拒绝', () => {
  const config = validConfig();
  config.rules[0].actions[0].color = 'magenta';
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /color/);
});

test('所有 Firefox 预设色都可接受', () => {
  for (const color of GROUP_COLORS) {
    const config = validConfig();
    config.rules[0].actions[0].color = color;
    assert.equal(validateConfig(config).ok, true, `${color} 应被接受`);
  }
});

test('缺少 urlPattern 或为空时拒绝', () => {
  const config = validConfig();
  delete config.rules[0].match.urlPattern;
  assert.equal(validateConfig(config).ok, false);
});

test('actions 为空数组时拒绝', () => {
  const config = validConfig();
  config.rules[0].actions = [];
  assert.equal(validateConfig(config).ok, false);
});

test('不支持的 action 类型被拒绝', () => {
  const config = validConfig();
  config.rules[0].actions[0].type = 'highlight';
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /只支持/);
});

test('错误信息带字段路径', () => {
  const config = validConfig();
  config.rules[0].actions[0].name = '';
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^rules\[0\]\.actions\[0\]/);
});

test('非对象输入被拒绝', () => {
  for (const bad of [null, 'x', 42, []]) {
    assert.equal(validateConfig(bad).ok, false);
  }
});
