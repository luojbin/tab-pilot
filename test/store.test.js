import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONFIG,
  GROUP_COLORS,
  SCHEMA_VERSION,
  validateConfig,
  buildConfigFromRules,
  normalizeClickAction,
  normalizeLanguage,
  colorForIndex,
  parseConfigText,
  colorOf,
  clone
} from '../src/app/store.js';

function validConfig() {
  return clone(DEFAULT_CONFIG);
}


test('默认配置能通过校验', () => {
  const result = validateConfig(validConfig());
  assert.equal(result.ok, true);
  assert.equal(result.config.schemaVersion, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 1);
});

test('clone 产生独立副本', () => {
  const copy = clone(DEFAULT_CONFIG);
  copy.rules[0].minTabs = 99;
  assert.equal(DEFAULT_CONFIG.rules[0].minTabs, 1);
});

test('schemaVersion 不符时拒绝', () => {
  const config = validConfig();
  config.schemaVersion = 2;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
});

test('开发期旧格式配置被拒绝（1.0 起不再迁移）', () => {
  const old = {
    schemaVersion: 5,
    globalEnabled: true,
    rules: [
      {
        id: 'dev-localhost',
        enabled: true,
        priority: 100,
        match: { urlPattern: '^*://localhost:*/*' },
        actions: [{ type: 'group', name: '开发', color: 'green' }]
      }
    ]
  };
  const result = validateConfig(old);
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

test('parseConfigText：开发期旧格式会被拒绝', () => {
  const old = { schemaVersion: 4, globalEnabled: true, rules: [] };
  const result = parseConfigText(JSON.stringify(old));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
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

test('导入开发期旧版本文件会被拒绝', () => {
  const old = {
    schemaVersion: 5,
    globalEnabled: true,
    rules: [
      { id: 'dev', enabled: true, name: '开发', color: 'green', patterns: ['*://localhost:*/*'] }
    ]
  };
  const result = parseConfigText(JSON.stringify(old, null, 2));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /schemaVersion/);
});

test('highlight：非法结构与越界数值被拒绝', () => {
  const config = validConfig();
  config.rules[0].highlight = {
    enabled: 'yes',
    border: { sides: 'top', width: 99 },
    banner: { positions: [1], size: 999, fontSize: 2 }
  };

  const result = validateConfig(config);
  assert.equal(result.ok, false);
  const joined = result.errors.join('\n');
  assert.match(joined, /highlight\.enabled/);
  assert.match(joined, /highlight\.border\.sides/);
  assert.match(joined, /highlight\.border\.width/);
  assert.match(joined, /highlight\.banner\.positions/);
  assert.match(joined, /highlight\.banner\.size/);
  assert.match(joined, /highlight\.banner\.fontSize/);
});

test('highlight：合法配置通过校验', () => {
  const config = validConfig();
  config.rules[0].highlight = {
    enabled: true,
    border: { sides: ['top', 'left'], width: 8 },
    banner: { positions: ['topLeft', 'bottomRight'], size: 36, fontSize: 15 }
  };
  assert.equal(validateConfig(config).ok, true);
});

test('buildConfigFromRules：保留 highlight / titleRule 并规范化字段（回归）', () => {
  const config = buildConfigFromRules(true, [
    {
      id: 'dev',
      name: '  开发  ',
      color: 'green',
      minTabs: undefined,
      note: '  本地  ',
      patterns: [' *://localhost:*/* ', ''],
      highlight: {
        enabled: true,
        border: { sides: ['top'], width: 6 },
        banner: { positions: ['topRight'], size: 30, fontSize: 15 }
      },
      titleRule: {
        enabled: true,
        rules: [
          { pattern: '^(.*)$', replacement: '[T] X $1', description: '测试' }
        ],
        testText: 'a\nb'
      }
    }
  ]);

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.rules[0].name, '开发');
  assert.equal(config.rules[0].note, '本地');
  assert.equal(config.rules[0].minTabs, 1);
  assert.deepEqual(config.rules[0].patterns, ['*://localhost:*/*']);
  assert.equal(config.rules[0].highlight.enabled, true, 'highlight 不能在组装时丢失');
  assert.equal(config.rules[0].titleRule.enabled, true, 'titleRule 不能在组装时丢失');
  assert.equal(config.rules[0].titleRule.rules[0].pattern, '^(.*)$');
  assert.equal(config.rules[0].titleRule.rules[0].replacement, '[T] X $1');
  assert.equal(config.rules[0].titleRule.testText, 'a\nb');
  assert.equal(validateConfig(config).ok, true);
});

test('buildConfigFromRules：没有 highlight 时不凭空补字段', () => {
  const config = buildConfigFromRules(true, [
    { id: 'x', name: 'X', patterns: ['*://x/*'] }
  ]);
  assert.equal('highlight' in config.rules[0], false);
  assert.equal('titleRule' in config.rules[0], false);
  assert.equal(validateConfig(config).ok, true);
});

test('默认配置带 titleRule：默认关闭、规则组为空', () => {
  const titleRule = DEFAULT_CONFIG.rules[0].titleRule;
  assert.equal(titleRule.enabled, false);
  assert.deepEqual(titleRule.rules, []);
  assert.equal(titleRule.testText, '');
});

test('titleRule：规则里的非法正则被拒绝', () => {
  const bad = validConfig();
  bad.rules[0].titleRule = {
    enabled: true,
    rules: [{ pattern: '([', replacement: 'x' }],
    testText: ''
  };
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /titleRule\.rules\[0\]\.pattern 不是合法的正则/);
});

test('titleRule：空 pattern 被拒绝', () => {
  const bad = validConfig();
  bad.rules[0].titleRule = { enabled: true, rules: [{ pattern: '   ' }], testText: '' };
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /titleRule\.rules\[0\]\.pattern 必须是非空字符串/);
});

test('highlight：边框与 banner 的不透明度各自校验 0~100', () => {
  const bad = validConfig();
  bad.rules[0].highlight = {
    enabled: true,
    border: { opacity: 150 },
    banner: { opacity: -5 }
  };
  const badResult = validateConfig(bad);
  assert.equal(badResult.ok, false);
  const joined = badResult.errors.join('\n');
  assert.match(joined, /highlight\.border\.opacity/);
  assert.match(joined, /highlight\.banner\.opacity/);

  const good = validConfig();
  good.rules[0].highlight = {
    enabled: true,
    border: { opacity: 100 },
    banner: { opacity: 35 }
  };
  assert.equal(validateConfig(good).ok, true);
});

test('colorForIndex：按序号循环取色，9 个颜色一轮', () => {
  assert.equal(colorForIndex(0), GROUP_COLORS[0]);
  assert.equal(colorForIndex(1), GROUP_COLORS[1]);
  assert.equal(colorForIndex(9), GROUP_COLORS[0]);
  assert.equal(colorForIndex(10), GROUP_COLORS[1]);
  assert.equal(colorForIndex(-1), GROUP_COLORS[1]);
  assert.equal(colorForIndex('2'), GROUP_COLORS[2]);
  assert.equal(colorForIndex('x'), GROUP_COLORS[0]);
});

test('clickAction：四个取值均可通过校验，未知值被拒绝', () => {
  for (const action of ['sync', 'syncRuleCollapse', 'syncCollapseInactive', 'syncCollapseAll']) {
    const config = validConfig();
    config.clickAction = action;
    assert.equal(validateConfig(config).ok, true, `${action} 应被接受`);
  }

  const bad = validConfig();
  bad.clickAction = 'collapseEverything';
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /clickAction/);
});

test('clickAction：缺省或未知值回退到 sync，构建配置会补上默认值', () => {
  const legacy = validConfig();
  delete legacy.clickAction;
  assert.equal(validateConfig(legacy).ok, true, '旧配置没有该字段也能读取');

  assert.equal(normalizeClickAction(undefined), 'sync');
  assert.equal(normalizeClickAction('collapseEverything'), 'sync');
  assert.equal(normalizeClickAction('syncCollapseAll'), 'syncCollapseAll');

  const built = buildConfigFromRules(
    true,
    [{ id: 'a', name: 'A', patterns: ['*://a/*'] }],
    'syncCollapseAll'
  );
  assert.equal(built.clickAction, 'syncCollapseAll');
  assert.equal(buildConfigFromRules(true, []).clickAction, 'sync');
});

test('language：auto / zh / en 通过校验，未知值被拒绝', () => {
  for (const language of ['auto', 'zh', 'en']) {
    const config = validConfig();
    config.language = language;
    assert.equal(validateConfig(config).ok, true, `${language} 应被接受`);
  }

  const bad = validConfig();
  bad.language = 'fr';
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /language/);
});

test('language：缺省或未知值回退到 auto，构建配置会写入默认值', () => {
  const legacy = validConfig();
  delete legacy.language;
  assert.equal(validateConfig(legacy).ok, true, '旧配置没有该字段也能读取');

  assert.equal(normalizeLanguage(undefined), 'auto');
  assert.equal(normalizeLanguage('fr'), 'auto');
  assert.equal(normalizeLanguage('en'), 'en');

  const built = buildConfigFromRules(true, [], 'sync', 'en');
  assert.equal(built.language, 'en');
  assert.equal(buildConfigFromRules(true, []).language, 'auto');
});
