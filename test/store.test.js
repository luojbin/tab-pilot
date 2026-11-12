const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONFIG,
  GROUP_COLORS,
  SCHEMA_VERSION,
  validateConfig,
  migrate,
  parseConfigText,
  colorOf,
  clone
} = require('../src/store.js');

function validConfig() {
  return clone(DEFAULT_CONFIG);
}

function legacyConfig() {
  return {
    schemaVersion: 1,
    globalEnabled: true,
    rules: [
      {
        id: 'dev-localhost',
        enabled: true,
        priority: 100,
        note: '本地开发环境',
        match: { urlPattern: '*://localhost:*/*', minTabs: 1 },
        actions: [{ type: 'group', name: '开发', color: 'green', collapsed: false }]
      },
      {
        id: 'code-github',
        enabled: true,
        priority: 90,
        match: { urlPattern: '*://*.github.com/*', minTabs: 3 },
        actions: [{ type: 'group', name: '代码', color: 'blue', collapsed: false }]
      }
    ]
  };
}

test('默认配置能通过校验', () => {
  const result = validateConfig(validConfig());
  assert.equal(result.ok, true);
  assert.equal(result.config.schemaVersion, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 2);
});

test('clone 产生独立副本', () => {
  const copy = clone(DEFAULT_CONFIG);
  copy.rules[0].minTabs = 99;
  assert.equal(DEFAULT_CONFIG.rules[0].minTabs, 1);
});

test('schemaVersion 不符时拒绝', () => {
  const config = validConfig();
  config.schemaVersion = 3;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
});

test('migrate：v1 配置升级为 v2 结构', () => {
  const migrated = migrate(legacyConfig());
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(
    migrated.rules.map((rule) => rule.id),
    ['dev-localhost', 'code-github'],
    '按旧 priority 降序排列'
  );
  assert.deepEqual(migrated.rules[0].patterns, ['*://localhost:*/*']);
  assert.equal(migrated.rules[0].name, '开发');
  assert.equal(migrated.rules[0].color, 'green');
  assert.equal(migrated.rules[1].minTabs, 3);
  assert.equal(validateConfig(migrated).ok, true, '迁移结果必须通过校验');
});

test('migrate：非 v1 配置原样返回', () => {
  const config = validConfig();
  assert.equal(migrate(config), config);
  assert.equal(migrate(null), null);
});

test('migrate：保留 enabled=false 并丢弃没有路径的规则', () => {
  const legacy = legacyConfig();
  legacy.rules[0].enabled = false;
  legacy.rules.push({ id: 'no-match', enabled: true, match: {}, actions: [] });
  const migrated = migrate(legacy);
  assert.equal(migrated.rules[0].enabled, false);
  assert.equal(migrated.rules.find((rule) => rule.id === 'no-match'), undefined);
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

test('分组名必须非空', () => {
  const config = validConfig();
  config.rules[0].name = '   ';
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /name/);
});

test('patterns 必须是非空数组', () => {
  for (const patterns of [[], undefined, 'x', ['']]) {
    const config = validConfig();
    if (patterns === undefined) delete config.rules[0].patterns;
    else config.rules[0].patterns = patterns;
    assert.equal(validateConfig(config).ok, false, `${JSON.stringify(patterns)} 应被拒绝`);
  }
  const okConfig = validConfig();
  okConfig.rules[0].patterns = ['*://a/*', '*://b/*'];
  assert.equal(validateConfig(okConfig).ok, true);
});

test('minTabs 必须 >= 1 的整数', () => {
  for (const bad of [0, 1.5, -2, '2', null]) {
    const config = validConfig();
    config.rules[0].minTabs = bad;
    assert.equal(validateConfig(config).ok, false, `minTabs=${JSON.stringify(bad)} 应被拒绝`);
  }
  const okConfig = validConfig();
  okConfig.rules[0].minTabs = 3;
  assert.equal(validateConfig(okConfig).ok, true);
});

test('未知分组颜色被拒绝，预设颜色全部接受', () => {
  const bad = validConfig();
  bad.rules[0].color = 'magenta';
  assert.equal(validateConfig(bad).ok, false);

  for (const color of GROUP_COLORS) {
    const config = validConfig();
    config.rules[0].color = color;
    assert.equal(validateConfig(config).ok, true, `${color} 应被接受`);
  }
});

test('enabled / collapsed 必须是布尔值', () => {
  const config = validConfig();
  config.rules[0].enabled = 'yes';
  config.rules[0].collapsed = 1;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => /enabled|collapsed/.test(error)).length, 2);
});

test('colorOf：非法或缺失颜色回退到 grey', () => {
  assert.equal(colorOf({ color: 'blue' }), 'blue');
  assert.equal(colorOf({ color: 'magenta' }), 'grey');
  assert.equal(colorOf({}), 'grey');
  assert.equal(colorOf(null), 'grey');
});

test('错误信息带字段路径', () => {
  const config = validConfig();
  config.rules[0].patterns = [''];
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^rules\[0\]\.patterns\[0\]/);
});

test('非对象输入被拒绝', () => {
  for (const bad of [null, 'x', 42, []]) {
    assert.equal(validateConfig(bad).ok, false);
  }
});

test('parseConfigText：合法 JSON 文本通过', () => {
  const result = parseConfigText(JSON.stringify(validConfig()));
  assert.equal(result.ok, true);
  assert.equal(result.config.rules.length, 1);
});

test('parseConfigText：旧格式 JSON 文本会先迁移', () => {
  const result = parseConfigText(JSON.stringify(legacyConfig()));
  assert.equal(result.ok, true);
  assert.equal(result.config.schemaVersion, 2);
  assert.equal(result.config.rules.length, 2);
});

test('parseConfigText：JSON 语法错误给出明确提示', () => {
  const result = parseConfigText('{ "rules": [ }');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^JSON 语法错误/);
});

test('parseConfigText：空文本与非字符串被拒绝', () => {
  assert.equal(parseConfigText('   \n ').ok, false);
  assert.equal(parseConfigText(null).ok, false);
  assert.equal(parseConfigText(123).ok, false);
});

test('导出文本可被导入解析（round-trip）', () => {
  const config = validConfig();
  config.rules.push({
    id: 'code-github',
    enabled: true,
    name: '代码',
    color: 'blue',
    collapsed: false,
    minTabs: 3,
    note: '攒够 3 个再归组',
    patterns: ['*://*.github.com/*', '*://gitlab.com/*']
  });

  const text = `${JSON.stringify(config, null, 2)}\n`;
  const parsed = parseConfigText(text);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.config, config);
});

test('导入旧格式文件会先迁移再落库', () => {
  const text = JSON.stringify(legacyConfig(), null, 2);
  const parsed = parseConfigText(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.config.schemaVersion, 2);
  assert.deepEqual(
    parsed.config.rules.map((rule) => rule.id),
    ['dev-localhost', 'code-github']
  );
});
